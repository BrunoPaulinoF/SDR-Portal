import { randomUUID } from 'node:crypto';

import type { LeadResearch, NewLeadResearch } from '../../db/schema.js';

export type LeadResearchInput = Pick<NewLeadResearch, 'leadId' | 'sdrAgentId' | 'query' | 'summary' | 'sources' | 'status' | 'error'>;

export interface LeadResearchRepository {
  findByLeadId(leadId: string): Promise<LeadResearch | null>;
  upsert(input: LeadResearchInput): Promise<LeadResearch>;
}

export function createMemoryLeadResearchRepository(seedResearch: LeadResearch[] = []): LeadResearchRepository {
  const rows = new Map<string, LeadResearch>();

  for (const research of seedResearch) rows.set(research.leadId, research);

  return {
    async findByLeadId(leadId) {
      return rows.get(leadId) ?? null;
    },

    async upsert(input) {
      const now = new Date();
      const current = rows.get(input.leadId);
      const research: LeadResearch = {
        id: current?.id ?? randomUUID(),
        leadId: input.leadId,
        sdrAgentId: input.sdrAgentId,
        query: input.query ?? null,
        summary: input.summary ?? null,
        sources: input.sources ?? null,
        status: input.status ?? 'pending',
        error: input.error ?? null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      rows.set(research.leadId, research);
      return research;
    },
  };
}
