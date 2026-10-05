import { and, count, desc, eq, gte, isNotNull } from 'drizzle-orm';

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

    async listStats(since) {
      return db
        .select({ createdAt: aiRuns.createdAt, leadId: aiRuns.leadId, sdrAgentId: aiRuns.sdrAgentId, error: aiRuns.error, totalTokens: aiRuns.totalTokens })
        .from(aiRuns)
        .where(since ? gte(aiRuns.createdAt, since) : undefined);
    },

    async listRecent(filter, limit, offset) {
      return db
        .select({
          id: aiRuns.id,
          sdrAgentId: aiRuns.sdrAgentId,
          leadId: aiRuns.leadId,
          conversationId: aiRuns.conversationId,
          provider: aiRuns.provider,
          model: aiRuns.model,
          purpose: aiRuns.purpose,
          outputText: aiRuns.outputText,
          error: aiRuns.error,
          promptTokens: aiRuns.promptTokens,
          completionTokens: aiRuns.completionTokens,
          totalTokens: aiRuns.totalTokens,
          promptCacheHitTokens: aiRuns.promptCacheHitTokens,
          latencyMs: aiRuns.latencyMs,
          createdAt: aiRuns.createdAt,
        })
        .from(aiRuns)
        .where(
          and(
            filter.onlyErrors ? isNotNull(aiRuns.error) : undefined,
            filter.sdrAgentId ? eq(aiRuns.sdrAgentId, filter.sdrAgentId) : undefined,
          ),
        )
        .orderBy(desc(aiRuns.createdAt), desc(aiRuns.id))
        .limit(limit)
        .offset(offset);
    },
  };
}
