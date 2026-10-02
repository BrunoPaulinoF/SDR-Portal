import { randomUUID } from 'node:crypto';

import type { SdrAgent, SdrConfigChange } from '../../db/schema.js';

export interface ConfigChangeInput {
  sdrAgentId: string;
  field: string;
  before: string | null;
  after: string | null;
  changedBy: string;
}

export interface SdrConfigChangeRepository {
  record(changes: ConfigChangeInput[]): Promise<void>;
  /** Mais recentes primeiro. */
  listForAgent(sdrAgentId: string, limit: number): Promise<SdrConfigChange[]>;
}

/**
 * Campos que mudam o que o SDR diz ou como ele trabalha. Ficam de fora tokens, chaves e ids de
 * instancia: segredo nao vai para historico, nem cifrado.
 */
export const TRACKED_AGENT_FIELDS = [
  'prompt',
  'offerDescription',
  'firstMessagePrompt',
  'secondMessage',
  'followupPrompt',
  'bumpPrompt',
  'leadQualificationPrompt',
  'handoffMessageTemplate',
  'playbook',
  'firstMessageMode',
  'aiProvider',
  'aiModel',
  'aiReasoningEffort',
  'aiTemperature',
  'aiMaxOutputTokens',
  'isActive',
  'sendWindowStart',
  'sendWindowEnd',
  'sendDaysOfWeek',
  'initialCooldownMinMinutes',
  'initialCooldownMaxMinutes',
  'dailyInitialSendLimit',
  'warmupStartedAt',
  'followupEnabled',
  'followupAfterHours',
  'followupMaxTouches',
  'dailyFollowupSendLimit',
  'audioReplyMode',
  'handoffName',
  'handoffPhone',
] as const satisfies ReadonlyArray<keyof SdrAgent>;

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value);
}

/** O que mudou entre o SDR gravado e o que vai ser gravado, campo a campo. */
export function diffAgentConfig(
  before: SdrAgent,
  after: Partial<Record<(typeof TRACKED_AGENT_FIELDS)[number], unknown>>,
  changedBy: string,
): ConfigChangeInput[] {
  const changes: ConfigChangeInput[] = [];
  for (const field of TRACKED_AGENT_FIELDS) {
    if (!(field in after)) continue;
    const previous = asText(before[field]);
    const next = asText(after[field]);
    // Texto so com espaco diferente no fim nao e mudanca: o portal faz trim ao salvar.
    if ((previous ?? '').trim() === (next ?? '').trim()) continue;
    changes.push({ sdrAgentId: before.id, field, before: previous, after: next, changedBy });
  }
  return changes;
}

export function createMemorySdrConfigChangeRepository(): SdrConfigChangeRepository {
  const rows: SdrConfigChange[] = [];
  return {
    async record(changes) {
      const now = Date.now();
      // Mesmo lote, mesma hora: o deslocamento so mantem a ordem estavel na listagem.
      changes.forEach((change, index) => rows.push({ id: randomUUID(), ...change, createdAt: new Date(now + index) }));
    },
    async listForAgent(sdrAgentId, limit) {
      return rows
        .filter((row) => row.sdrAgentId === sdrAgentId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
  };
}
