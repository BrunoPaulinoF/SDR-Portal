import { desc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { sdrConfigChanges } from '../../db/schema.js';
import type { SdrConfigChangeRepository } from './config-history.js';

export function createDbSdrConfigChangeRepository(): SdrConfigChangeRepository {
  return {
    async record(changes) {
      if (changes.length === 0) return;
      await db.insert(sdrConfigChanges).values(changes);
    },
    async listForAgent(sdrAgentId, limit) {
      return db
        .select()
        .from(sdrConfigChanges)
        .where(eq(sdrConfigChanges.sdrAgentId, sdrAgentId))
        .orderBy(desc(sdrConfigChanges.createdAt))
        .limit(limit);
    },
  };
}
