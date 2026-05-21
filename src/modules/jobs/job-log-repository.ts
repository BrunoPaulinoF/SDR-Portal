import { randomUUID } from 'node:crypto';

import type { JobLog, NewJobLog } from '../../db/schema.js';

export type JobLogInput = Pick<
  NewJobLog,
  'jobName' | 'jobKey' | 'sdrAgentId' | 'leadId' | 'status' | 'attempt' | 'payload' | 'result' | 'error' | 'startedAt' | 'finishedAt'
>;

export interface JobLogRepository {
  create(input: JobLogInput): Promise<JobLog>;
  findByLeadId(leadId: string): Promise<JobLog[]>;
  list(): Promise<JobLog[]>;
}

export function createMemoryJobLogRepository(seedLogs: JobLog[] = []): JobLogRepository {
  const rows = new Map<string, JobLog>();

  for (const log of seedLogs) {
    rows.set(log.id, log);
  }

  return {
    async create(input) {
      const log: JobLog = {
        id: randomUUID(),
        jobName: input.jobName,
        jobKey: input.jobKey ?? null,
        sdrAgentId: input.sdrAgentId ?? null,
        leadId: input.leadId ?? null,
        status: input.status,
        attempt: input.attempt ?? 1,
        payload: input.payload ?? null,
        result: input.result ?? null,
        error: input.error ?? null,
        startedAt: input.startedAt ?? null,
        finishedAt: input.finishedAt ?? null,
        createdAt: new Date(),
      };

      rows.set(log.id, log);
      return log;
    },

    async findByLeadId(leadId) {
      return [...rows.values()].filter((log) => log.leadId === leadId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async list() {
      return [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  };
}
