import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { AI_PAUSE_REASONS } from '../leads/ai-pause.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { resolveTimeZone } from '../timezone.js';
import { buildInboxChats, buildInboxThread, type InboxThread } from './conversation-inbox.js';
import type { ConversationRepository } from './conversation-repository.js';
import {
  inboxSignature,
  renderConversationNotFoundPage,
  renderInboxChatsFragment,
  renderInboxThreadFragment,
  renderInboxPage,
  type InboxPageOptions,
} from './conversation-pages.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const inboxQuerySchema = z.object({
  sdr: z.string().uuid().optional(),
  chat: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});
/** A pagina manda de volta a assinatura do HTML que ja tem: igual, o servidor nao reenvia nada. */
const inboxUpdatesQuerySchema = inboxQuerySchema.extend({
  chatsSig: z.string().max(64).optional(),
  threadSig: z.string().max(64).optional(),
});
const aiSwitchBodySchema = z.object({ acao: z.enum(['pausar', 'liberar']) });

interface InboxFilters {
  sdr?: string | undefined;
  chat?: string | undefined;
  q?: string | undefined;
}

interface InboxDependencies {
  conversationRepository: ConversationRepository;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
}

interface InboxState extends InboxPageOptions {
  thread: InboxThread | null;
}

/** Estado da caixa de conversas. A pagina inteira e a atualizacao em tempo real leem daqui. */
async function loadInbox(deps: InboxDependencies, filters: InboxFilters): Promise<InboxState> {
  const agents = await deps.sdrAgentRepository.list();
  const requestedChat = filters.chat ? await deps.conversationRepository.findById(filters.chat) : null;
  // Link direto para uma conversa ja diz de qual SDR ela e; sem ele vale o SDR escolhido no topo.
  const requestedAgent = agents.find((agent) => agent.id === (requestedChat?.sdrAgentId ?? filters.sdr)) ?? null;
  let selectedAgent = requestedAgent ?? agents[0] ?? null;
  const search = filters.q ?? '';

  if (!selectedAgent) {
    return { agents, chats: [], hiddenChats: 0, search: '', selectedAgent: null, thread: null, totalChats: 0 };
  }

  let conversations = await deps.conversationRepository.listBySdr(selectedAgent.id);
  if (!requestedAgent && conversations.length === 0) {
    // Sem SDR escolhido a caixa abre no primeiro que tem conversa: um SDR novo e vazio nao esconde o resto.
    for (const agent of agents) {
      if (agent.id === selectedAgent.id) continue;
      const found = await deps.conversationRepository.listBySdr(agent.id);
      if (found.length === 0) continue;
      selectedAgent = agent;
      conversations = found;
      break;
    }
  }

  const timeZone = resolveTimeZone(selectedAgent.timezone);
  const now = new Date();
  const [lastMessages, leads] = await Promise.all([
    deps.conversationRepository.listLastMessages(conversations.map((conversation) => conversation.id)),
    deps.leadRepository.listByIds([...new Set(conversations.map((conversation) => conversation.leadId))]),
  ]);
  const inbox = buildInboxChats({ conversations, lastMessages, leads, now, search, timeZone });

  // Sem conversa escolhida a caixa ja abre na mais recente, como o WhatsApp Web faz.
  const activeId = requestedChat?.id ?? inbox.chats[0]?.conversationId ?? '';
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const thread = activeConversation
    ? buildInboxThread({
        conversation: activeConversation,
        lead: leads.find((lead) => lead.id === activeConversation.leadId) ?? null,
        messages: await deps.conversationRepository.listMessages(activeConversation.id),
        now,
        timeZone,
      })
    : null;

  return {
    agents,
    chats: inbox.chats,
    hiddenChats: inbox.hidden,
    search,
    selectedAgent,
    thread,
    totalChats: inbox.total,
  };
}

function wantsJson(request: FastifyRequest): boolean {
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('application/json');
}

export function registerConversationRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  conversationRepository: ConversationRepository,
  leadRepository: LeadRepository,
  sdrAgentRepository: SdrAgentRepository,
): void {
  const deps: InboxDependencies = { conversationRepository, leadRepository, sdrAgentRepository };

  app.get('/conversations', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = inboxQuerySchema.safeParse(request.query ?? {});
    const state = await loadInbox(deps, parsed.success ? parsed.data : {});

    return reply.type('text/html').send(renderInboxPage(state));
  });

  /**
   * Novidades da caixa de conversas em JSON, buscadas de poucos em poucos segundos e a cada
   * clique num chat. Devolve o mesmo HTML que a pagina renderiza, mas so das partes cujo
   * conteudo mudou — o resto vem sem `chatsHtml`/`threadHtml` e a tela nao e tocada.
   */
  app.get('/conversations/updates', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = inboxUpdatesQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false });
    const state = await loadInbox(deps, parsed.data);
    const chatsHtml = renderInboxChatsFragment(state);
    const chatsSig = inboxSignature(chatsHtml);
    const threadHtml = renderInboxThreadFragment(state.thread, Boolean(state.selectedAgent));
    const threadSig = inboxSignature(threadHtml);

    return reply.send({
      sdr: state.selectedAgent?.id ?? '',
      chat: state.thread?.conversationId ?? '',
      chatsSig,
      threadSig,
      ...(parsed.data.chatsSig === chatsSig ? {} : { chatsHtml }),
      ...(parsed.data.threadSig === threadSig ? {} : { threadHtml }),
    });
  });

  /** Pausa ou libera a IA da conversa. A pausa nao expira: so este botao devolve a IA. */
  app.post('/conversations/:id/ia', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    const body = aiSwitchBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.status(400).send({ ok: false });

    const conversation = await conversationRepository.findById(params.data.id);
    const lead = conversation ? await leadRepository.findById(conversation.leadId) : null;
    if (!conversation || !lead) {
      if (wantsJson(request)) return reply.status(404).send({ ok: false });
      return reply.status(404).type('text/html').send(renderConversationNotFoundPage());
    }

    const now = new Date();
    if (body.data.acao === 'pausar') await leadRepository.pauseAi(lead.id, now, AI_PAUSE_REASONS.portal);
    else await leadRepository.resumeAi(lead.id, now);
    request.log.info({ leadId: lead.id, conversationId: conversation.id, acao: body.data.acao }, 'AI pause switched from portal');

    if (wantsJson(request)) return reply.send({ ok: true, acao: body.data.acao });
    return reply.redirect(`/conversations?sdr=${conversation.sdrAgentId}&chat=${conversation.id}`, 302);
  });

  app.get('/conversations/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).type('text/html').send(renderConversationNotFoundPage());
    const conversation = await conversationRepository.findById(params.data.id);
    if (!conversation) return reply.status(404).type('text/html').send(renderConversationNotFoundPage());

    // Link antigo de conversa continua valendo: abre o mesmo chat dentro da caixa do SDR.
    return reply.redirect(`/conversations?sdr=${conversation.sdrAgentId}&chat=${conversation.id}`, 302);
  });
}
