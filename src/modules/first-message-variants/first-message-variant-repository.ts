import { randomUUID } from 'node:crypto';

import type { FirstMessageVariant } from '../../db/schema.js';

export interface FirstMessageVariantInput {
  sdrAgentId: string;
  label: string;
  body: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface FirstMessageVariantUpdate {
  label?: string;
  body?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface FirstMessageVariantMetrics {
  variant: FirstMessageVariant;
  sent: number;
  replied: number;
}

export interface FirstMessageVariantRepository {
  listForAgent(sdrAgentId: string): Promise<FirstMessageVariant[]>;
  listActiveForAgent(sdrAgentId: string): Promise<FirstMessageVariant[]>;
  findById(id: string): Promise<FirstMessageVariant | null>;
  create(input: FirstMessageVariantInput): Promise<FirstMessageVariant>;
  update(id: string, input: FirstMessageVariantUpdate): Promise<FirstMessageVariant | null>;
  setActive(id: string, isActive: boolean): Promise<FirstMessageVariant | null>;
  delete(id: string): Promise<void>;
  /**
   * Escolhe a proxima variante ativa por rodizio (menor assignedCount, desempate por sortOrder),
   * incrementa o contador e retorna a variante escolhida. Retorna null se nao houver ativa.
   */
  pickNextForAgent(sdrAgentId: string): Promise<FirstMessageVariant | null>;
  metricsForAgent(sdrAgentId: string): Promise<FirstMessageVariantMetrics[]>;
}

function sortVariants(a: FirstMessageVariant, b: FirstMessageVariant): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function createMemoryFirstMessageVariantRepository(
  seed: FirstMessageVariant[] = [],
): FirstMessageVariantRepository {
  const rows = new Map<string, FirstMessageVariant>();
  for (const variant of seed) {
    rows.set(variant.id, variant);
  }

  function forAgent(sdrAgentId: string): FirstMessageVariant[] {
    return [...rows.values()].filter((row) => row.sdrAgentId === sdrAgentId).sort(sortVariants);
  }

  return {
    async listForAgent(sdrAgentId) {
      return forAgent(sdrAgentId);
    },

    async listActiveForAgent(sdrAgentId) {
      return forAgent(sdrAgentId).filter((row) => row.isActive);
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },

    async create(input) {
      const now = new Date();
      const variant: FirstMessageVariant = {
        id: randomUUID(),
        sdrAgentId: input.sdrAgentId,
        label: input.label,
        body: input.body,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? forAgent(input.sdrAgentId).length,
        assignedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(variant.id, variant);
      return variant;
    },

    async update(id, input) {
      const current = rows.get(id);
      if (!current) return null;
      const updated: FirstMessageVariant = {
        ...current,
        label: input.label ?? current.label,
        body: input.body ?? current.body,
        isActive: input.isActive ?? current.isActive,
        sortOrder: input.sortOrder ?? current.sortOrder,
        updatedAt: new Date(),
      };
      rows.set(id, updated);
      return updated;
    },

    async setActive(id, isActive) {
      const current = rows.get(id);
      if (!current) return null;
      const updated: FirstMessageVariant = { ...current, isActive, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },

    async delete(id) {
      rows.delete(id);
    },

    async pickNextForAgent(sdrAgentId) {
      const active = forAgent(sdrAgentId).filter((row) => row.isActive);
      if (active.length === 0) return null;
      const chosen = [...active].sort((a, b) => {
        if (a.assignedCount !== b.assignedCount) return a.assignedCount - b.assignedCount;
        return sortVariants(a, b);
      })[0]!;
      const updated: FirstMessageVariant = {
        ...chosen,
        assignedCount: chosen.assignedCount + 1,
        updatedAt: new Date(),
      };
      rows.set(updated.id, updated);
      return updated;
    },

    async metricsForAgent(sdrAgentId) {
      // Impl em memoria nao tem acesso a leads/messages; expoe apenas os envios (assignedCount).
      // A metrica real de respostas vem da impl de banco.
      return forAgent(sdrAgentId).map((variant) => ({ variant, sent: variant.assignedCount, replied: 0 }));
    },
  };
}
