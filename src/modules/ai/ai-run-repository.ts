import { randomUUID } from 'node:crypto';

import type { AiRun, NewAiRun } from '../../db/schema.js';
import type { RecentLogFilter } from '../logs/recent-log-filter.js';

export type AiRunInput = Pick<
  NewAiRun,
  | 'sdrAgentId'
  | 'leadId'
  | 'conversationId'
  | 'provider'
  | 'model'
  | 'purpose'
  | 'inputMessages'
  | 'outputText'
  | 'parsedJson'
  | 'error'
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'promptCacheHitTokens'
  | 'latencyMs'
>;

/** O que o painel le de cada chamada de IA. `inputMessages` (o prompt inteiro) fica de fora. */
export type AiRunStat = Pick<AiRun, 'createdAt' | 'leadId' | 'sdrAgentId' | 'error' | 'totalTokens'>;

/** Uma linha da tela Registros: o prompt enviado (`inputMessages`) e o JSON interpretado ficam de fora. */
export type AiRunListItem = Omit<AiRun, 'inputMessages' | 'parsedJson'>;

export interface AiRunRepository {
  /** Quantas geracoes de resposta ja rodaram nesta conversa depois de um instante. */
  countRepliesSince(conversationId: string, since: Date): Promise<number>;
  create(input: AiRunInput): Promise<AiRun>;
  findByLeadId(leadId: string): Promise<AiRun[]>;
  list(): Promise<AiRun[]>;
  /** Chamadas a partir de `since` (todas com `null`), so com as colunas que o painel usa. */
  listStats(since: Date | null): Promise<AiRunStat[]>;
  /** Uma pagina da tela Registros, do mais novo para o mais velho. */
  listRecent(filter: RecentLogFilter, limit: number, offset: number): Promise<AiRunListItem[]>;
}

export function createMemoryAiRunRepository(seedRuns: AiRun[] = []): AiRunRepository {
  const rows = new Map<string, AiRun>();
  for (const run of seedRuns) rows.set(run.id, run);

  return {
    async countRepliesSince(conversationId, since) {
      return [...rows.values()].filter(
        (run) =>
          run.conversationId === conversationId &&
          run.purpose === 'reply_generation' &&
          run.createdAt.getTime() >= since.getTime(),
      ).length;
    },

    async create(input) {
      const run: AiRun = {
        id: randomUUID(),
        sdrAgentId: input.sdrAgentId ?? null,
        leadId: input.leadId ?? null,
        conversationId: input.conversationId ?? null,
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        inputMessages: input.inputMessages ?? null,
        outputText: input.outputText ?? null,
        parsedJson: input.parsedJson ?? null,
        error: input.error ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        promptCacheHitTokens: input.promptCacheHitTokens ?? null,
        latencyMs: input.latencyMs ?? null,
        createdAt: new Date(),
      };
      rows.set(run.id, run);
      return run;
    },

    async findByLeadId(leadId) {
      return [...rows.values()].filter((run) => run.leadId === leadId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async list() {
      return [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async listStats(since) {
      return [...rows.values()]
        .filter((run) => !since || run.createdAt.getTime() >= since.getTime())
        .map(({ createdAt, leadId, sdrAgentId, error, totalTokens }) => ({ createdAt, leadId, sdrAgentId, error, totalTokens }));
    },

    async listRecent(filter, limit, offset) {
      return [...rows.values()]
        .filter((run) => (!filter.onlyErrors || run.error !== null) && (!filter.sdrAgentId || run.sdrAgentId === filter.sdrAgentId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(offset, offset + limit)
        .map((run) => {
          const item: AiRunListItem & Partial<Pick<AiRun, 'inputMessages' | 'parsedJson'>> = { ...run };
          delete item.inputMessages;
          delete item.parsedJson;
          return item;
        });
    },
  };
}
