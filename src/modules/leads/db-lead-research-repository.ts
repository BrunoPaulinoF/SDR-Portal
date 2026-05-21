import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { leadResearch } from '../../db/schema.js';
import type { LeadResearchRepository } from './lead-research-repository.js';

export function createDbLeadResearchRepository(): LeadResearchRepository {
  return {
    async findByLeadId(leadId) {
      const [research] = await db.select().from(leadResearch).where(eq(leadResearch.leadId, leadId)).limit(1);
      return research ?? null;
    },

    async upsert(input) {
      const now = new Date();
      const [research] = await db
        .insert(leadResearch)
        .values({ ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: leadResearch.leadId,
          set: { ...input, updatedAt: now },
        })
        .returning();

      if (!research) throw new Error('Failed to upsert lead research');
      return research;
    },
  };
}
