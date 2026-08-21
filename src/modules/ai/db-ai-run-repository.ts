import { and, count, desc, eq, gte } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { aiRuns } from '../../db/schema.js';
import type { AiRunRepository } from './ai-run-repository.js';

export function createDbAiRunRepository(): AiRunRepository {
  return {
    async countRepliesSince(conversationId, since) {
      const [row] = await db
        .select({ total: count() })
        .from(aiRuns)
        .where(
          and(
            eq(aiRuns.conversationId, conversationId),
            eq(aiRuns.purpose, 'reply_generation'),
            gte(aiRuns.createdAt, since),
          ),
        );
      return row?.total ?? 0;
    },

    async create(input) {
      const [run] = await db.insert(aiRuns).values(input).returning();
      if (!run) throw new Error('Failed to create AI run');
      return run;
    },

    async findByLeadId(leadId) {
      return db.select().from(aiRuns).where(eq(aiRuns.leadId, leadId)).orderBy(desc(aiRuns.createdAt));
    },

    async list() {
      return db.select().from(aiRuns).orderBy(desc(aiRuns.createdAt));
    },
  };
}
