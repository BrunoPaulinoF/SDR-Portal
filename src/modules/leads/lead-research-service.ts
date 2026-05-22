import { env } from '../../config/env.js';
import type { Lead, LeadResearch, SdrAgent } from '../../db/schema.js';
import type { LeadResearchRepository } from './lead-research-repository.js';

export interface LeadResearchResult {
  summary: string;
  sources: string[];
}

export interface LeadResearchProvider {
  research(input: { agent: SdrAgent; lead: Lead; query: string }): Promise<LeadResearchResult | null>;
}

export interface LeadResearchService {
  researchLead(input: { agent: SdrAgent; lead: Lead }): Promise<LeadResearchResult | null>;
}

interface LeadResearchDependencies {
  provider: LeadResearchProvider;
  repository: LeadResearchRepository;
}

function buildQuery(lead: Lead): string {
  return [lead.companyName, lead.tradeName, lead.cnpj, lead.contactName, lead.city, lead.state, lead.segment, lead.extraData]
    .filter(Boolean)
    .join(' ');
}

function resultFromRecord(record: LeadResearch): LeadResearchResult | null {
  if (!record.summary) return null;
  return {
    summary: record.summary,
    sources: record.sources ? JSON.parse(record.sources) as string[] : [],
  };
}

function normalizeSources(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export function createHttpLeadResearchProvider(): LeadResearchProvider {
  return {
    async research(input) {
      if (!env.WEB_RESEARCH_ENDPOINT) return null;

      const response = await fetch(env.WEB_RESEARCH_ENDPOINT, {
        method: 'POST',
        signal: AbortSignal.timeout(env.WEB_RESEARCH_TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          ...(env.WEB_RESEARCH_API_KEY ? { authorization: `Bearer ${env.WEB_RESEARCH_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          query: input.query,
          lead: {
            cnpj: input.lead.cnpj,
            companyName: input.lead.companyName,
            contactName: input.lead.contactName,
            extraData: input.lead.extraData,
            tradeName: input.lead.tradeName,
            segment: input.lead.segment,
            city: input.lead.city,
            state: input.lead.state,
          },
          sdrAgent: {
            name: input.agent.name,
            productName: input.agent.productName,
            offerDescription: input.agent.offerDescription,
          },
        }),
      });

      if (!response.ok) throw new Error(`Research endpoint returned HTTP ${response.status}`);
      const body = await response.json() as { summary?: unknown; sources?: unknown };
      const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
      if (!summary) return null;
      return { summary, sources: normalizeSources(body.sources) };
    },
  };
}

export function createLeadResearchService(deps: LeadResearchDependencies): LeadResearchService {
  return {
    async researchLead(input) {
      const existing = await deps.repository.findByLeadId(input.lead.id);
      if (existing?.status === 'completed' || existing?.status === 'skipped' || existing?.status === 'failed') {
        return resultFromRecord(existing);
      }

      const query = buildQuery(input.lead);
      if (!query) {
        await deps.repository.upsert({
          leadId: input.lead.id,
          sdrAgentId: input.agent.id,
          query,
          summary: null,
          sources: null,
          status: 'skipped',
          error: 'Lead without enough data for research',
        });
        return null;
      }

      try {
        const result = await deps.provider.research({ ...input, query });
        await deps.repository.upsert({
          leadId: input.lead.id,
          sdrAgentId: input.agent.id,
          query,
          summary: result?.summary ?? null,
          sources: result ? JSON.stringify(result.sources) : null,
          status: result ? 'completed' : 'skipped',
          error: result ? null : 'No research result',
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown research error';
        await deps.repository.upsert({
          leadId: input.lead.id,
          sdrAgentId: input.agent.id,
          query,
          summary: null,
          sources: null,
          status: 'failed',
          error: message,
        });
        return null;
      }
    },
  };
}
