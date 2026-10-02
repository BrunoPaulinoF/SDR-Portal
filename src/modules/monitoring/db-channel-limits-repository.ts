import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { sdrChannelLimits } from '../../db/schema.js';
import type { ChannelLimitsRepository } from './channel-limits.js';

export function createDbChannelLimitsRepository(): ChannelLimitsRepository {
  return {
    async find(sdrAgentId) {
      const [row] = await db.select().from(sdrChannelLimits).where(eq(sdrChannelLimits.sdrAgentId, sdrAgentId)).limit(1);
      return row ?? null;
    },

    async list() {
      return db.select().from(sdrChannelLimits);
    },

    async save(row) {
      const values = {
        canStartConversations: row.canStartConversations,
        blockedUntil: row.blockedUntil,
        blockReason: row.blockReason,
        quotaUsed: row.quotaUsed,
        quotaTotal: row.quotaTotal,
        quotaResetsAt: row.quotaResetsAt,
        source: row.source,
        checkedAt: row.checkedAt,
      };
      await db.insert(sdrChannelLimits).values(row).onConflictDoUpdate({ target: sdrChannelLimits.sdrAgentId, set: values });
    },
  };
}
