import PgBoss from 'pg-boss';

import { env } from '../../config/env.js';
import type { createFollowupOutreachService } from './followup-outreach.js';
import type { createInitialOutreachService } from './initial-outreach.js';

type InitialOutreachService = ReturnType<typeof createInitialOutreachService>;
type FollowupOutreachService = ReturnType<typeof createFollowupOutreachService>;

const initialQueueName = 'initial-outreach-tick';
const followupQueueName = 'followup-outreach-tick';

export async function startPgBossInitialOutreachScheduler(initialOutreachService: InitialOutreachService): Promise<PgBoss | null> {
  if (!env.SCHEDULER_ENABLED) {
    return null;
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start scheduler');
  }

  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on('error', (error) => {
    process.stderr.write(`pg-boss error: ${error.message}\n`);
  });

  await boss.start();
  await boss.createQueue(initialQueueName);
  await boss.work(initialQueueName, async () => {
    await initialOutreachService.runOnce();
  });
  await boss.schedule(initialQueueName, env.INITIAL_OUTREACH_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}

export async function startPgBossFollowupScheduler(followupOutreachService: FollowupOutreachService): Promise<PgBoss | null> {
  if (!env.SCHEDULER_ENABLED) {
    return null;
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start scheduler');
  }

  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on('error', (error) => {
    process.stderr.write(`pg-boss error: ${error.message}\n`);
  });

  await boss.start();
  await boss.createQueue(followupQueueName);
  await boss.work(followupQueueName, async () => {
    await followupOutreachService.runOnce();
  });
  await boss.schedule(followupQueueName, env.FOLLOWUP_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}
