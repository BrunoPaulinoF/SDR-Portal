import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { withAgentLock } from '../scheduler/agent-lock.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { createAiResponseService } from './ai-response-service.js';

type AiResponseService = ReturnType<typeof createAiResponseService>;

/**
 * Fila de respostas no banco (pg-boss). O buffer em memoria esperava o lead parar de digitar num
 * `setTimeout`: um deploy ou um restart do container no meio dessa espera apagava a resposta, e
 * o lead so era atendido quando a rede de seguranca (`pending-reply`, 3min+) passava. Na fila, o
 * pedido de resposta sobrevive ao restart e o processo novo responde assim que sobe.
 */
export const REPLY_QUEUE_NAME = 'reply-conversation';

export interface ReplyJobData {
  agentId: string;
  conversationId: string;
  leadId: string;
  /** Quando a primeira mensagem do bloco pediu resposta: limita quanto o lead pode adiar a resposta digitando. */
  firstAt: string;
}

export interface ReplyTransport {
  send(data: ReplyJobData, startAfterSeconds: number): Promise<void>;
}

/**
 * O `buildApp` sobe antes do pg-boss: o webhook recebe este encaixe vazio e o `server.ts` liga a
 * fila depois. Enquanto nada estiver ligado (teste, scheduler desligado, os segundos do boot), a
 * resposta vai pelo buffer em memoria, como sempre foi.
 */
export interface ReplyTransportSlot extends ReplyTransport {
  attach(transport: ReplyTransport): void;
  ready(): boolean;
}

export function createReplyTransportSlot(): ReplyTransportSlot {
  let current: ReplyTransport | null = null;
  return {
    attach(transport) {
      current = transport;
    },
    ready() {
      return current !== null;
    },
    async send(data, startAfterSeconds) {
      if (!current) throw new Error('fila de respostas ainda nao ligada');
      await current.send(data, startAfterSeconds);
    },
  };
}

interface DispatcherDependencies {
  delayMs: number;
  /** O buffer em memoria: vale sem fila ligada e quando a fila recusa o pedido. */
  fallback: AiResponseService & { close(): void };
  transport?: ReplyTransportSlot;
  now?: () => Date;
}

export function createReplyDispatcher(deps: DispatcherDependencies): AiResponseService & { close(): void } {
  const now = deps.now ?? (() => new Date());

  return {
    async respondToInbound(input) {
      if (!deps.transport?.ready() || deps.delayMs <= 0) {
        await deps.fallback.respondToInbound(input);
        return;
      }

      try {
        await deps.transport.send(
          { agentId: input.agent.id, conversationId: input.conversation.id, leadId: input.lead.id, firstAt: now().toISOString() },
          Math.ceil(deps.delayMs / 1000),
        );
      } catch (error) {
        // Banco fora do ar para a fila e o mesmo banco que gravou a mensagem do lead um instante
        // antes: e raro, mas responder pela memoria e melhor do que deixar o lead esperando.
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`reply-queue: conversa ${input.conversation.id} foi para o buffer em memoria: ${message}\n`);
        await deps.fallback.respondToInbound(input);
      }
    },

    close() {
      deps.fallback.close();
    },
  };
}

export type ReplyJobOutcome = 'answered' | 'waiting' | 'busy' | 'gone';

interface ProcessorDependencies {
  aiResponseService: AiResponseService;
  conversationRepository: ConversationRepository;
  delayMs: number;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
  transport: ReplyTransport;
  /** Teto da espera: lead que manda mensagem a cada 15s nao pode adiar a resposta para sempre. */
  maxWaitMs?: number;
  now?: () => Date;
}

export function createReplyJobProcessor(deps: ProcessorDependencies) {
  const now = deps.now ?? (() => new Date());
  const maxWaitMs = deps.maxWaitMs ?? deps.delayMs * 4;

  return {
    async process(data: ReplyJobData): Promise<ReplyJobOutcome> {
      // Tudo relido do banco na hora: a conversa ganhou mensagens durante a espera e o SDR pode
      // ter mudado de prompt ou ter sido pausado.
      const [agent, conversation, lead] = await Promise.all([
        deps.sdrAgentRepository.findById(data.agentId),
        deps.conversationRepository.findById(data.conversationId),
        deps.leadRepository.findById(data.leadId),
      ]);
      if (!agent || !conversation || !lead) return 'gone';

      // A fila nao reinicia o relogio a cada mensagem como o buffer fazia (um pedido por conversa
      // na fila, o resto e descartado). Quem confere se o lead parou de digitar e o proprio job:
      // ultima mensagem do lead ha menos de `delayMs` -> volta para a fila pelo que falta.
      const current = now().getTime();
      const lastInbound = lead.lastInboundAt?.getTime() ?? 0;
      const remainingMs = lastInbound + deps.delayMs - current;
      const waitedMs = current - Date.parse(data.firstAt);
      if (remainingMs > 1000 && waitedMs < maxWaitMs) {
        await deps.transport.send(data, Math.ceil(remainingMs / 1000));
        return 'waiting';
      }

      // Duas geracoes da mesma conversa em paralelo mandariam duas respostas: a segunda espera.
      const ran = await withAgentLock(`reply:${conversation.id}`, async () => {
        await deps.aiResponseService.respondToInbound({ agent, conversation, lead });
        return true;
      });
      if (!ran) {
        await deps.transport.send(data, Math.ceil(deps.delayMs / 1000));
        return 'busy';
      }
      return 'answered';
    },
  };
}
