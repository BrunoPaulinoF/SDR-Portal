import PgBoss from 'pg-boss';

import { env } from '../../config/env.js';
import type { createFollowupOutreachService } from './followup-outreach.js';
import type { createInitialOutreachService } from './initial-outreach.js';
import type { createPendingReplyService } from './pending-reply.js';
import type { ConnectionMonitorService } from '../monitoring/connection-monitor-service.js';
import type { DailyReportService } from '../monitoring/daily-report-service.js';

type InitialOutreachService = ReturnType<typeof createInitialOutreachService>;
type FollowupOutreachService = ReturnType<typeof createFollowupOutreachService>;
type PendingReplyService = ReturnType<typeof createPendingReplyService>;

const initialQueueName = 'initial-outreach-tick';
const followupQueueName = 'followup-outreach-tick';
const pendingReplyQueueName = 'pending-reply-tick';
const connectionMonitorQueueName = 'connection-monitor-tick';
const dailyReportQueueName = 'daily-report-tick';

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

export async function startPgBossPendingReplyScheduler(pendingReplyService: PendingReplyService): Promise<PgBoss | null> {
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
  await boss.createQueue(pendingReplyQueueName);
  await boss.work(pendingReplyQueueName, async () => {
    await pendingReplyService.runOnce();
  });
  await boss.schedule(pendingReplyQueueName, env.PENDING_REPLY_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}

export async function startPgBossConnectionMonitorScheduler(
  connectionMonitorService: ConnectionMonitorService,
): Promise<PgBoss | null> {
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
  await boss.createQueue(connectionMonitorQueueName);
  await boss.work(connectionMonitorQueueName, async () => {
    await connectionMonitorService.runOnce();
  });
  await boss.schedule(connectionMonitorQueueName, env.CONNECTION_MONITOR_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}

export async function startPgBossDailyReportScheduler(dailyReportService: DailyReportService): Promise<PgBoss | null> {
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
  await boss.createQueue(dailyReportQueueName);
  await boss.work(dailyReportQueueName, async () => {
    await dailyReportService.runOnce();
  });
  await boss.schedule(dailyReportQueueName, env.DAILY_REPORT_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}
