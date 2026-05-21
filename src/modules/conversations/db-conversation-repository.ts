import { asc, desc, eq, and } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { conversations, messages } from '../../db/schema.js';
import type { ConversationRepository } from './conversation-repository.js';

export function createDbConversationRepository(): ConversationRepository {
  return {
    async create(input) {
      const [conversation] = await db.insert(conversations).values(input).returning();
      if (!conversation) throw new Error('Failed to create conversation');
      return conversation;
    },

    async createMessage(input) {
      const [message] = await db.insert(messages).values(input).returning();
      if (!message) throw new Error('Failed to create message');
      return message;
    },

    async findById(id) {
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
      return conversation ?? null;
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.sdrAgentId, sdrAgentId), eq(conversations.whatsappNumber, whatsappNumber)))
        .orderBy(desc(conversations.createdAt))
        .limit(1);
      return conversation ?? null;
    },

    async list() {
      return db.select().from(conversations).orderBy(desc(conversations.lastMessageAt));
    },

    async listAllMessages() {
      return db.select().from(messages).orderBy(desc(messages.createdAt));
    },

    async listMessages(conversationId) {
      return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
    },

    async touch(id, lastMessageAt) {
      const [conversation] = await db
        .update(conversations)
        .set({ lastMessageAt, updatedAt: lastMessageAt })
        .where(eq(conversations.id, id))
        .returning();
      return conversation ?? null;
    },
  };
}
