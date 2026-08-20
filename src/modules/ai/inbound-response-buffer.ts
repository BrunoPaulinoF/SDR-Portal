import type { Conversation, Lead, SdrAgent } from '../../db/schema.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { createAiResponseService } from './ai-response-service.js';

type AiResponseService = ReturnType<typeof createAiResponseService>;

interface BufferInput {
  agent: SdrAgent;
  conversation: Conversation;
  lead: Lead;
}

interface PendingResponse extends BufferInput {
  timer: NodeJS.Timeout;
}

interface InboundResponseBufferDependencies {
  aiResponseService: AiResponseService;
  conversationRepository: ConversationRepository;
  delayMs: number;
  leadRepository: LeadRepository;
}

export function createInboundResponseBuffer(deps: InboundResponseBufferDependencies): AiResponseService & { close(): void } {
  const pending = new Map<string, PendingResponse>();
  /**
   * Conversas com uma resposta em andamento. Gerar + enviar leva de segundos a
   * minutos (chamada da IA, atraso de digitacao, varias partes); sem esta trava
   * uma mensagem que chegava nesse meio tempo abria uma segunda resposta em
   * paralelo e o lead recebia duas respostas para o mesmo turno.
   */
  const running = new Set<string>();
  /** Ultimo input que chegou enquanto a IA respondia: vira uma nova rodada no fim. */
  const queued = new Map<string, BufferInput>();

  async function respond(item: BufferInput): Promise<void> {
    const [conversation, lead] = await Promise.all([
      deps.conversationRepository.findById(item.conversation.id),
      deps.leadRepository.findById(item.lead.id),
    ]);
    if (!conversation || !lead) return;

    await deps.aiResponseService.respondToInbound({ agent: item.agent, conversation, lead });
  }

  async function flush(conversationId: string): Promise<void> {
    const item = pending.get(conversationId);
    if (!item) return;
    pending.delete(conversationId);

    // Ja existe resposta rodando nesta thread: guarda o input e reprograma no fim,
    // em vez de responder duas vezes a mesma conversa ao mesmo tempo.
    if (running.has(conversationId)) {
      queued.set(conversationId, item);
      return;
    }

    running.add(conversationId);
    try {
      await respond(item);
    } finally {
      running.delete(conversationId);
    }

    const next = queued.get(conversationId);
    if (next) {
      queued.delete(conversationId);
      // Volta pelo caminho normal para que novas mensagens ainda sejam agrupadas.
      await bufferedRespond(next);
    }
  }

  async function bufferedRespond(input: BufferInput): Promise<void> {
    if (deps.delayMs <= 0) {
      if (running.has(input.conversation.id)) {
        queued.set(input.conversation.id, input);
        return;
      }
      running.add(input.conversation.id);
      try {
        await deps.aiResponseService.respondToInbound(input);
      } finally {
        running.delete(input.conversation.id);
      }
      const next = queued.get(input.conversation.id);
      if (next) {
        queued.delete(input.conversation.id);
        await bufferedRespond(next);
      }
      return;
    }

    const previous = pending.get(input.conversation.id);
    if (previous) clearTimeout(previous.timer);

    const timer = setTimeout(() => {
      void flush(input.conversation.id);
    }, deps.delayMs);
    timer.unref?.();
    pending.set(input.conversation.id, { ...input, timer });
  }

  return {
    respondToInbound: bufferedRespond,

    close() {
      for (const item of pending.values()) clearTimeout(item.timer);
      pending.clear();
      queued.clear();
      running.clear();
    },
  };
}
