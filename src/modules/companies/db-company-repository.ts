import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { companies } from '../../db/schema.js';
import type { CompanyRepository } from './company-repository.js';

export function createDbCompanyRepository(): CompanyRepository {
  return {
    async create(input) {
      const [company] = await db.insert(companies).values(input).returning();

      if (!company) {
        throw new Error('Failed to create company');
      }

      return company;
    },

    async delete(id) {
      await db.delete(companies).where(eq(companies.id, id));
    },

    async findById(id) {
      const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
      return company ?? null;
    },

    async list() {
      return db.select().from(companies).orderBy(asc(companies.name));
    },

    async update(id, input) {
      const [company] = await db
        .update(companies)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(companies.id, id))
        .returning();

      return company ?? null;
    },
  };
}
