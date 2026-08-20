import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { resolveTimeZone } from '../timezone.js';
import { buildInboxChats, buildInboxThread } from './conversation-inbox.js';
import type { ConversationRepository } from './conversation-repository.js';
import { renderConversationNotFoundPage, renderInboxPage } from './conversation-pages.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const inboxQuerySchema = z.object({
  sdr: z.string().uuid().optional(),
  chat: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});

export function registerConversationRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  conversationRepository: ConversationRepository,
  leadRepository: LeadRepository,
  sdrAgentRepository: SdrAgentRepository,
): void {
  app.get('/conversations', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = inboxQuerySchema.safeParse(request.query ?? {});
    const filters = parsed.success ? parsed.data : {};
    const agents = await sdrAgentRepository.list();
    const requestedChat = filters.chat ? await conversationRepository.findById(filters.chat) : null;
    // Link direto para uma conversa ja diz de qual SDR ela e; sem ele vale o SDR escolhido no topo.
    const requestedAgent = agents.find((agent) => agent.id === (requestedChat?.sdrAgentId ?? filters.sdr)) ?? null;
    let selectedAgent = requestedAgent ?? agents[0] ?? null;

    if (!selectedAgent) {
      return reply
        .type('text/html')
        .send(renderInboxPage({ agents, chats: [], hiddenChats: 0, search: '', selectedAgent: null, thread: null, totalChats: 0 }));
    }

    let conversations = await conversationRepository.listBySdr(selectedAgent.id);
    if (!requestedAgent && conversations.length === 0) {
      // Sem SDR escolhido a caixa abre no primeiro que tem conversa: um SDR novo e vazio nao esconde o resto.
      for (const agent of agents) {
        if (agent.id === selectedAgent.id) continue;
        const found = await conversationRepository.listBySdr(agent.id);
        if (found.length === 0) continue;
        selectedAgent = agent;
        conversations = found;
        break;
      }
    }

    const search = filters.q ?? '';
    const timeZone = resolveTimeZone(selectedAgent.timezone);
    const now = new Date();
    const [lastMessages, leads] = await Promise.all([
      conversationRepository.listLastMessages(conversations.map((conversation) => conversation.id)),
      leadRepository.listByIds([...new Set(conversations.map((conversation) => conversation.leadId))]),
    ]);
    const inbox = buildInboxChats({ conversations, lastMessages, leads, now, search, timeZone });

    // Sem conversa escolhida a caixa ja abre na mais recente, como o WhatsApp Web faz.
    const activeId = requestedChat?.id ?? inbox.chats[0]?.conversationId ?? '';
    const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
    const thread = activeConversation
      ? buildInboxThread({
          conversation: activeConversation,
          lead: leads.find((lead) => lead.id === activeConversation.leadId) ?? null,
          messages: await conversationRepository.listMessages(activeConversation.id),
          now,
          timeZone,
        })
      : null;

    return reply.type('text/html').send(
      renderInboxPage({
        agents,
        chats: inbox.chats,
        hiddenChats: inbox.hidden,
        search,
        selectedAgent,
        thread,
        totalChats: inbox.total,
      }),
    );
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
