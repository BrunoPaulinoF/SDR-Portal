import { randomUUID } from 'node:crypto';

import type { ContactBlock } from '../../db/schema.js';
import { digitsOnly, whatsappNumberVariants } from '../phone/whatsapp-number.js';

export interface ContactBlockInput {
  whatsappNumber: string;
  reason: string | null;
  source: string;
}

/** Lista de "nao contatar": vale para a importacao e para o disparo de todos os SDRs. */
export interface ContactBlockRepository {
  /** Bloqueia o numero; bloquear de novo so atualiza o motivo. */
  add(input: ContactBlockInput): Promise<ContactBlock>;
  /** O bloqueio que cobre este telefone, em qualquer das variantes (com e sem o 9). */
  findBlocked(whatsappNumber: string): Promise<ContactBlock | null>;
  list(): Promise<ContactBlock[]>;
  remove(id: string): Promise<void>;
}

export function createMemoryContactBlockRepository(seed: ContactBlock[] = []): ContactBlockRepository {
  const rows = new Map<string, ContactBlock>(seed.map((block) => [block.whatsappNumber, block]));

  return {
    async add(input) {
      const whatsappNumber = digitsOnly(input.whatsappNumber);
      const current = rows.get(whatsappNumber);
      const block: ContactBlock = {
        id: current?.id ?? randomUUID(),
        whatsappNumber,
        reason: input.reason,
        source: input.source,
        createdAt: current?.createdAt ?? new Date(),
      };
      rows.set(whatsappNumber, block);
      return block;
    },

    async findBlocked(whatsappNumber) {
      for (const variant of whatsappNumberVariants(whatsappNumber)) {
        const block = rows.get(variant);
        if (block) return block;
      }
      return null;
    },

    async list() {
      return [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async remove(id) {
      for (const [number, block] of rows) {
        if (block.id === id) rows.delete(number);
      }
    },
  };
}
