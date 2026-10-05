import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { webhookEvents } from '../../db/schema.js';
import type { WebhookEventRepository } from './webhook-event-repository.js';

export function createDbWebhookEventRepository(): WebhookEventRepository {
  return {
    async create(input) {
      const [event] = await db.insert(webhookEvents).values(input).returning();
      if (!event) throw new Error('Failed to create webhook event');
      return event;
    },

    async list() {
      return db.select().from(webhookEvents).orderBy(desc(webhookEvents.createdAt));
    },

    async listRecent(filter, limit, offset) {
      return db
        .select()
        .from(webhookEvents)
        .where(
          and(
            filter.onlyErrors ? eq(webhookEvents.processingStatus, 'failed') : undefined,
            filter.sdrAgentId ? eq(webhookEvents.sdrAgentId, filter.sdrAgentId) : undefined,
          ),
        )
        .orderBy(desc(webhookEvents.createdAt), desc(webhookEvents.id))
        .limit(limit)
        .offset(offset);
    },

    async updateProcessing(id, input) {
      const [event] = await db.update(webhookEvents).set(input).where(eq(webhookEvents.id, id)).returning();
      return event ?? null;
    },
  };
}
