import { and, asc, count, eq, isNotNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { firstMessageVariants, leads } from '../../db/schema.js';
import type {
  FirstMessageVariantMetrics,
  FirstMessageVariantRepository,
} from './first-message-variant-repository.js';

export function createDbFirstMessageVariantRepository(): FirstMessageVariantRepository {
  return {
    async listForAgent(sdrAgentId) {
      return db
        .select()
        .from(firstMessageVariants)
        .where(eq(firstMessageVariants.sdrAgentId, sdrAgentId))
        .orderBy(asc(firstMessageVariants.sortOrder), asc(firstMessageVariants.createdAt));
    },

    async listActiveForAgent(sdrAgentId) {
      return db
        .select()
        .from(firstMessageVariants)
        .where(and(eq(firstMessageVariants.sdrAgentId, sdrAgentId), eq(firstMessageVariants.isActive, true)))
        .orderBy(asc(firstMessageVariants.sortOrder), asc(firstMessageVariants.createdAt));
    },

    async findById(id) {
      const [variant] = await db.select().from(firstMessageVariants).where(eq(firstMessageVariants.id, id)).limit(1);
      return variant ?? null;
    },

    async create(input) {
      const [{ value: existing } = { value: 0 }] = await db
        .select({ value: count() })
        .from(firstMessageVariants)
        .where(eq(firstMessageVariants.sdrAgentId, input.sdrAgentId));
      const [variant] = await db
        .insert(firstMessageVariants)
        .values({
          sdrAgentId: input.sdrAgentId,
          label: input.label,
          body: input.body,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? existing,
        })
        .returning();
      if (!variant) {
        throw new Error('Failed to create first message variant');
      }
      return variant;
    },

    async update(id, input) {
      const [variant] = await db
        .update(firstMessageVariants)
        .set({
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(firstMessageVariants.id, id))
        .returning();
      return variant ?? null;
    },

    async setActive(id, isActive) {
      const [variant] = await db
        .update(firstMessageVariants)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(firstMessageVariants.id, id))
        .returning();
      return variant ?? null;
    },

    async delete(id) {
      await db.delete(firstMessageVariants).where(eq(firstMessageVariants.id, id));
    },

    async pickNextForAgent(sdrAgentId) {
      const [chosen] = await db
        .select()
        .from(firstMessageVariants)
        .where(and(eq(firstMessageVariants.sdrAgentId, sdrAgentId), eq(firstMessageVariants.isActive, true)))
        .orderBy(asc(firstMessageVariants.assignedCount), asc(firstMessageVariants.sortOrder), asc(firstMessageVariants.createdAt))
        .limit(1);
      if (!chosen) return null;
      const [updated] = await db
        .update(firstMessageVariants)
        .set({ assignedCount: chosen.assignedCount + 1, updatedAt: new Date() })
        .where(eq(firstMessageVariants.id, chosen.id))
        .returning();
      return updated ?? chosen;
    },

    async metricsForAgent(sdrAgentId) {
      const variants = await db
        .select()
        .from(firstMessageVariants)
        .where(eq(firstMessageVariants.sdrAgentId, sdrAgentId))
        .orderBy(asc(firstMessageVariants.sortOrder), asc(firstMessageVariants.createdAt));

      const metrics: FirstMessageVariantMetrics[] = [];
      for (const variant of variants) {
        const [{ value: sent } = { value: 0 }] = await db
          .select({ value: count() })
          .from(leads)
          .where(eq(leads.firstMessageVariantId, variant.id));
        const [{ value: replied } = { value: 0 }] = await db
          .select({ value: count() })
          .from(leads)
          .where(and(eq(leads.firstMessageVariantId, variant.id), isNotNull(leads.lastInboundAt)));
        metrics.push({ variant, sent, replied });
      }
      return metrics;
    },
  };
}
