import { asc, desc, eq, and, gte, inArray, lte, sql } from 'drizzle-orm';

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

    async findByLeadId(leadId) {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.leadId, leadId))
        .orderBy(desc(conversations.createdAt))
        .limit(1);
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

    async listBySdr(sdrAgentId) {
      // Conversa sem mensagem nenhuma tem last_message_at nulo e no DESC do Postgres viria primeiro.
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.sdrAgentId, sdrAgentId))
        .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt));
    },

    async listByLastMessageBetween(since, before, limit) {
      return db
        .select()
        .from(conversations)
        .where(and(gte(conversations.lastMessageAt, since), lte(conversations.lastMessageAt, before)))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit);
    },

    async listLastMessages(conversationIds) {
      if (conversationIds.length === 0) return [];
      return db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(messages.conversationId, desc(messages.createdAt));
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
