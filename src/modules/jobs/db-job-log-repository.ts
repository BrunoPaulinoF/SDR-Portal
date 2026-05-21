import { desc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { jobLogs } from '../../db/schema.js';
import type { JobLogRepository } from './job-log-repository.js';

export function createDbJobLogRepository(): JobLogRepository {
  return {
    async create(input) {
      const [log] = await db.insert(jobLogs).values(input).returning();
      if (!log) {
        throw new Error('Failed to create job log');
      }
      return log;
    },

    async findByLeadId(leadId) {
      return db.select().from(jobLogs).where(eq(jobLogs.leadId, leadId)).orderBy(desc(jobLogs.createdAt));
    },

    async list() {
      return db.select().from(jobLogs).orderBy(desc(jobLogs.createdAt));
    },
  };
}
