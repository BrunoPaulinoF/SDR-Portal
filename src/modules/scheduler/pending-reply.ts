import type { Conversation, Lead, Message, SdrAgent } from '../../db/schema.js';
import type { createAiResponseService } from '../ai/ai-response-service.js';
import type { AiRunRepository } from '../ai/ai-run-repository.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import { isAiPaused } from '../leads/ai-pause.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';

type AiResponseService = ReturnType<typeof createAiResponseService>;

/**
 * Rede de seguranca para o lead que respondeu e ficou sem resposta.
 *
 * O caminho normal e o webhook: mensagem do lead chega, o buffer de rajada espera alguns
 * segundos e a IA responde. Esse caminho vive na memoria do processo e falha em silencio de
 * tres formas — o container reinicia dentro da janela do buffer (deploy!), a chamada da IA
 * estoura as tentativas, ou a UAZAPI recusa o envio. Em qualquer uma delas o lead fica
 * falando sozinho e nada tenta de novo: o follow-up so olha lead frio, nao lead ignorado.
 *
 * Aqui a fonte da verdade e a tabela de mensagens: conversa cuja ULTIMA mensagem e do lead,
 * parada ha mais tempo do que o silencio tolerado, e um lead sem resposta. Se a IA tivesse
 * respondido, a ultima mensagem seria a dela.
 */
export interface PendingReplyResult {
  retried: number;
  skipped: number;
  errors: number;
  details: string[];
}

interface PendingReplyDependencies {
  aiResponseService: AiResponseService;
  aiRunRepository: AiRunRepository;
  conversationRepository: ConversationRepository;
  jobLogRepository: JobLogRepository;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
  /** Silencio tolerado antes de considerar a resposta perdida (default 3 min). */
  afterMs?: number;
  /** Conversa mais velha que isso nao recebe resposta atrasada (default 24 h). */
  windowHours?: number;
  /** Quantas geracoes de resposta podem existir para a mesma mensagem antes de desistir. */
  maxAttempts?: number;
  /** Teto de conversas olhadas por rodada. */
  candidateLimit?: number;
}

const DEFAULT_AFTER_MS = 3 * 60 * 1000;
const DEFAULT_WINDOW_HOURS = 24;
/** 1 = a tentativa que ja rodou e falhou. Na segunda sem resposta, para de insistir. */
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_CANDIDATE_LIMIT = 50;

/** Midia sem texto util nao chama a IA no webhook, e tambem nao pode chamar aqui. */
function hasReplyableContent(message: Message): boolean {
  return Boolean(message.text?.trim() || message.transcription?.trim());
}

function leadLabel(lead: Lead): string {
  return `${lead.companyName} (${lead.whatsappNumber})`;
}

export function createPendingReplyService(deps: PendingReplyDependencies) {
  const afterMs = deps.afterMs ?? DEFAULT_AFTER_MS;
  const windowHours = deps.windowHours ?? DEFAULT_WINDOW_HOURS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const candidateLimit = deps.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;

  /** Ou o alvo da nova tentativa, ou o motivo de deixar esta conversa quieta. */
  async function inspect(
    conversation: Conversation,
    lastMessage: Message,
    now: Date,
  ): Promise<{ agent: SdrAgent; lead: Lead } | { skip: string }> {
    if (!hasReplyableContent(lastMessage)) return { skip: 'midia sem texto' };

    const lead = await deps.leadRepository.findById(conversation.leadId);
    if (!lead) return { skip: 'lead inexistente' };
    if (isAiPaused(lead, now)) return { skip: 'IA pausada' };

    const agent = await deps.sdrAgentRepository.findById(lead.sdrAgentId);
    if (!agent) return { skip: 'SDR inexistente' };
    if (!agent.isActive) return { skip: 'SDR inativo' };

    // A tentativa que ja rodou e falhou tambem conta: com o teto batido, insistir vira spam.
    const attempts = await deps.aiRunRepository.countRepliesSince(conversation.id, lastMessage.createdAt);
    if (attempts >= maxAttempts) return { skip: `ja tentou ${attempts}x` };

    return { agent, lead };
  }

  return {
    async runOnce(): Promise<PendingReplyResult> {
      const result: PendingReplyResult = { retried: 0, skipped: 0, errors: 0, details: [] };
      const now = new Date();
      const before = new Date(now.getTime() - afterMs);
      const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

      const candidates = await deps.conversationRepository.listByLastMessageBetween(since, before, candidateLimit);
      if (candidates.length === 0) return result;

      const lastMessages = await deps.conversationRepository.listLastMessages(candidates.map((item) => item.id));
      const lastByConversation = new Map(lastMessages.map((message) => [message.conversationId, message]));

      for (const conversation of candidates) {
        const lastMessage = lastByConversation.get(conversation.id);
        // Ultima mensagem da SDR: a conversa nao esta esperando ninguem.
        if (!lastMessage || lastMessage.direction !== 'inbound') continue;

        const target = await inspect(conversation, lastMessage, now);
        if ('skip' in target) {
          result.skipped += 1;
          result.details.push(`${conversation.whatsappNumber}: ${target.skip}`);
          continue;
        }

        const startedAt = new Date();
        try {
          await deps.aiResponseService.respondToInbound({ agent: target.agent, conversation, lead: target.lead });
          result.retried += 1;
          result.details.push(`${leadLabel(target.lead)}: resposta pendente reenviada para a IA`);
          await deps.jobLogRepository.create({
            jobName: 'pending-reply',
            jobKey: `pending-reply-${lastMessage.id}`,
            sdrAgentId: target.agent.id,
            leadId: target.lead.id,
            status: 'completed',
            attempt: 1,
            payload: JSON.stringify({
              conversationId: conversation.id,
              lastInboundAt: lastMessage.createdAt.toISOString(),
              silenceMs: now.getTime() - lastMessage.createdAt.getTime(),
            }),
            result: null,
            error: null,
            startedAt,
            finishedAt: new Date(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erro desconhecido';
          result.errors += 1;
          result.details.push(`${leadLabel(target.lead)}: falhou de novo (${message})`);
          await deps.jobLogRepository.create({
            jobName: 'pending-reply',
            jobKey: `pending-reply-${lastMessage.id}`,
            sdrAgentId: target.agent.id,
            leadId: target.lead.id,
            status: 'failed',
            attempt: 1,
            payload: JSON.stringify({ conversationId: conversation.id }),
            result: null,
            error: message,
            startedAt,
            finishedAt: new Date(),
          });
        }
      }

      return result;
    },
  };
}
