import { randomUUID } from 'node:crypto';

import type { Conversation, Message, NewConversation, NewMessage } from '../../db/schema.js';

export type ConversationInput = Pick<NewConversation, 'companyId' | 'sdrAgentId' | 'leadId' | 'whatsappNumber' | 'status' | 'lastMessageAt'>;
export type MessageInput = Pick<
  NewMessage,
  | 'conversationId'
  | 'leadId'
  | 'sdrAgentId'
  | 'direction'
  | 'senderType'
  | 'whatsappMessageId'
  | 'messageType'
  | 'text'
  | 'transcription'
  | 'mediaUrl'
  | 'rawPayload'
  | 'sentByApi'
  | 'fromMe'
>;

export interface ConversationRepository {
  create(input: ConversationInput): Promise<Conversation>;
  createMessage(input: MessageInput): Promise<Message>;
  findById(id: string): Promise<Conversation | null>;
  findBySdrAndWhatsapp(sdrAgentId: string, whatsappNumber: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  listMessages(conversationId: string): Promise<Message[]>;
  touch(id: string, lastMessageAt: Date): Promise<Conversation | null>;
}

export function createMemoryConversationRepository(seedConversations: Conversation[] = [], seedMessages: Message[] = []): ConversationRepository {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();

  for (const conversation of seedConversations) conversations.set(conversation.id, conversation);
  for (const message of seedMessages) messages.set(message.id, message);

  return {
    async create(input) {
      const now = new Date();
      const conversation: Conversation = {
        id: randomUUID(),
        companyId: input.companyId,
        sdrAgentId: input.sdrAgentId,
        leadId: input.leadId,
        whatsappNumber: input.whatsappNumber,
        status: input.status ?? 'open',
        lastMessageAt: input.lastMessageAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },

    async createMessage(input) {
      const message: Message = {
        id: randomUUID(),
        conversationId: input.conversationId,
        leadId: input.leadId,
        sdrAgentId: input.sdrAgentId,
        direction: input.direction,
        senderType: input.senderType,
        whatsappMessageId: input.whatsappMessageId ?? null,
        messageType: input.messageType,
        text: input.text ?? null,
        transcription: input.transcription ?? null,
        mediaUrl: input.mediaUrl ?? null,
        rawPayload: input.rawPayload ?? null,
        sentByApi: input.sentByApi ?? false,
        fromMe: input.fromMe ?? false,
        createdAt: new Date(),
      };
      messages.set(message.id, message);
      return message;
    },

    async findById(id) {
      return conversations.get(id) ?? null;
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      return (
        [...conversations.values()]
          .filter((item) => item.sdrAgentId === sdrAgentId && item.whatsappNumber === whatsappNumber)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },

    async list() {
      return [...conversations.values()].sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
    },

    async listMessages(conversationId) {
      return [...messages.values()]
        .filter((message) => message.conversationId === conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async touch(id, lastMessageAt) {
      const current = conversations.get(id);
      if (!current) return null;
      const updated: Conversation = { ...current, lastMessageAt, updatedAt: lastMessageAt };
      conversations.set(id, updated);
      return updated;
    },
  };
}
