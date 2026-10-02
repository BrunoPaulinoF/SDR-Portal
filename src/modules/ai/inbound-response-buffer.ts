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

  async function flush(conversationId: string): Promise<void> {
    const item = pending.get(conversationId);
    if (!item) return;
    pending.delete(conversationId);

    // Roda solto num setTimeout: um erro que escape daqui e rejeicao sem dono, e o Node 22
    // derruba o processo — levando junto todas as respostas que estavam esperando no buffer.
    try {
      const [conversation, lead] = await Promise.all([
        deps.conversationRepository.findById(item.conversation.id),
        deps.leadRepository.findById(item.lead.id),
      ]);
      if (!conversation || !lead) return;

      await deps.aiResponseService.respondToInbound({ agent: item.agent, conversation, lead });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`inbound-response-buffer: conversa ${conversationId} sem resposta: ${message}\n`);
    }
  }

  return {
    async respondToInbound(input) {
      if (deps.delayMs <= 0) {
        await deps.aiResponseService.respondToInbound(input);
        return;
      }

      const previous = pending.get(input.conversation.id);
      if (previous) clearTimeout(previous.timer);

      const timer = setTimeout(() => {
        void flush(input.conversation.id);
      }, deps.delayMs);
      timer.unref?.();
      pending.set(input.conversation.id, { ...input, timer });
    },

    close() {
      for (const item of pending.values()) clearTimeout(item.timer);
      pending.clear();
    },
  };
}
