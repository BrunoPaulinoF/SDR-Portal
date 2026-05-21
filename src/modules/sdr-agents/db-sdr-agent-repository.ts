import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { sdrAgents } from '../../db/schema.js';
import type { SdrAgentRepository } from './sdr-agent-repository.js';

export function createDbSdrAgentRepository(): SdrAgentRepository {
  return {
    async create(input) {
      const [agent] = await db.insert(sdrAgents).values(input).returning();

      if (!agent) {
        throw new Error('Failed to create SDR agent');
      }

      return agent;
    },

    async delete(id) {
      await db.delete(sdrAgents).where(eq(sdrAgents.id, id));
    },

    async findById(id) {
      const [agent] = await db.select().from(sdrAgents).where(eq(sdrAgents.id, id)).limit(1);
      return agent ?? null;
    },

    async list() {
      return db.select().from(sdrAgents).orderBy(asc(sdrAgents.name));
    },

    async setActive(id, isActive) {
      const [agent] = await db
        .update(sdrAgents)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(sdrAgents.id, id))
        .returning();

      return agent ?? null;
    },

    async update(id, input) {
      const [agent] = await db
        .update(sdrAgents)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(sdrAgents.id, id))
        .returning();

      return agent ?? null;
    },
  };
}
