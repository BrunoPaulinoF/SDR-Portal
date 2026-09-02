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
  | 'autoReply'
>;

export interface ConversationRepository {
  create(input: ConversationInput): Promise<Conversation>;
  createMessage(input: MessageInput): Promise<Message>;
  findById(id: string): Promise<Conversation | null>;
  findByLeadId(leadId: string): Promise<Conversation | null>;
  findBySdrAndWhatsapp(sdrAgentId: string, whatsappNumber: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  listAllMessages(): Promise<Message[]>;
  /** Conversas de um SDR, da mais recente para a mais antiga: e a lista de chats da caixa de conversas. */
  listBySdr(sdrAgentId: string): Promise<Conversation[]>;
  /** Conversas cuja ultima mensagem caiu numa janela de tempo, da mais recente para a mais antiga. */
  listByLastMessageBetween(since: Date, before: Date, limit: number): Promise<Conversation[]>;
  /** Ultima mensagem de cada conversa pedida, para a previa da lista de chats sem um SELECT por conversa. */
  listLastMessages(conversationIds: string[]): Promise<Message[]>;
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
        autoReply: input.autoReply ?? false,
        createdAt: new Date(),
      };
      messages.set(message.id, message);
      return message;
    },

    async findById(id) {
      return conversations.get(id) ?? null;
    },

    async findByLeadId(leadId) {
      return [...conversations.values()]
        .filter((item) => item.leadId === leadId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
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

    async listAllMessages() {
      return [...messages.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async listBySdr(sdrAgentId) {
      return [...conversations.values()]
        .filter((item) => item.sdrAgentId === sdrAgentId)
        .sort((a, b) => (b.lastMessageAt?.getTime() ?? b.createdAt.getTime()) - (a.lastMessageAt?.getTime() ?? a.createdAt.getTime()));
    },

    async listByLastMessageBetween(since, before, limit) {
      return [...conversations.values()]
        .filter((conversation) => {
          const at = conversation.lastMessageAt?.getTime();
          return at !== undefined && at >= since.getTime() && at <= before.getTime();
        })
        .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
        .slice(0, limit);
    },

    async listLastMessages(conversationIds) {
      const wanted = new Set(conversationIds);
      const latest = new Map<string, Message>();

      for (const message of messages.values()) {
        if (!wanted.has(message.conversationId)) continue;
        const current = latest.get(message.conversationId);
        if (!current || message.createdAt.getTime() >= current.createdAt.getTime()) {
          latest.set(message.conversationId, message);
        }
      }

      return [...latest.values()];
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
