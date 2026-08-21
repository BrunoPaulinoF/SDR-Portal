import { randomUUID } from 'node:crypto';

import type { AiRun, NewAiRun } from '../../db/schema.js';

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

export interface AiRunRepository {
  /** Quantas geracoes de resposta ja rodaram nesta conversa depois de um instante. */
  countRepliesSince(conversationId: string, since: Date): Promise<number>;
  create(input: AiRunInput): Promise<AiRun>;
  findByLeadId(leadId: string): Promise<AiRun[]>;
  list(): Promise<AiRun[]>;
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
  };
}
