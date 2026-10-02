import PgBoss from 'pg-boss';

import { env } from '../../config/env.js';
import { REPLY_QUEUE_NAME, type ReplyJobData, type ReplyTransportSlot, type createReplyJobProcessor } from '../ai/reply-queue.js';
import type { createFollowupOutreachService } from './followup-outreach.js';
import type { createInitialOutreachService } from './initial-outreach.js';
import type { createPendingReplyService } from './pending-reply.js';
import type { ConnectionMonitorService } from '../monitoring/connection-monitor-service.js';
import type { DailyReportService } from '../monitoring/daily-report-service.js';
import type { LeadQueueMonitorService } from '../monitoring/lead-queue-monitor-service.js';

type InitialOutreachService = ReturnType<typeof createInitialOutreachService>;
type FollowupOutreachService = ReturnType<typeof createFollowupOutreachService>;
type PendingReplyService = ReturnType<typeof createPendingReplyService>;
type ReplyJobProcessor = ReturnType<typeof createReplyJobProcessor>;

const initialQueueName = 'initial-outreach-tick';
const followupQueueName = 'followup-outreach-tick';
const pendingReplyQueueName = 'pending-reply-tick';
const connectionMonitorQueueName = 'connection-monitor-tick';
const dailyReportQueueName = 'daily-report-tick';
const leadQueueMonitorQueueName = 'lead-queue-monitor-tick';

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

export async function startPgBossLeadQueueMonitorScheduler(
  leadQueueMonitorService: LeadQueueMonitorService,
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
  await boss.createQueue(leadQueueMonitorQueueName);
  await boss.work(leadQueueMonitorQueueName, async () => {
    await leadQueueMonitorService.runOnce();
  });
  await boss.schedule(leadQueueMonitorQueueName, env.LEAD_QUEUE_MONITOR_CRON, {}, { tz: env.DEFAULT_TIMEZONE });

  return boss;
}

/**
 * Workers da fila de respostas. Cada `work()` e um consumidor: com um so, uma resposta longa
 * (IA + digitacao das partes) seguraria a de todos os outros leads, coisa que o buffer em
 * memoria nunca fez.
 */
const REPLY_WORKERS = 4;
/** Job preso (processo morreu no meio da resposta) expira e cai para o `pending-reply`. */
const REPLY_JOB_EXPIRE_SECONDS = 10 * 60;

export async function startPgBossReplyQueue(processor: ReplyJobProcessor, slot: ReplyTransportSlot): Promise<PgBoss | null> {
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
  await attachReplyQueue(boss, processor, slot);

  return boss;
}

/** Separado do `start` para o teste rodar a fila de verdade num Postgres de teste. */
export async function attachReplyQueue(
  boss: PgBoss,
  processor: Pick<ReplyJobProcessor, 'process'>,
  slot: ReplyTransportSlot,
): Promise<void> {
  // `short`: um pedido esperando por conversa (o segundo e descartado pelo banco), mas o job em
  // andamento pode pedir a proxima rodada. Sem retentativa: reenviar no escuro pode responder
  // duas vezes, e quem cobre a falha e o `pending-reply`.
  await boss.createQueue(REPLY_QUEUE_NAME, {
    name: REPLY_QUEUE_NAME,
    policy: 'short',
    retryLimit: 0,
    expireInSeconds: REPLY_JOB_EXPIRE_SECONDS,
  });
  // Antes dos workers: job que sobrou do processo anterior pode precisar voltar para a fila ja
  // na primeira leitura.
  slot.attach({
    async send(data, startAfterSeconds) {
      await boss.send(REPLY_QUEUE_NAME, data, {
        singletonKey: data.conversationId,
        startAfter: startAfterSeconds,
        retryLimit: 0,
        expireInSeconds: REPLY_JOB_EXPIRE_SECONDS,
      });
    },
  });
  for (let worker = 0; worker < REPLY_WORKERS; worker += 1) {
    await boss.work<ReplyJobData>(REPLY_QUEUE_NAME, { pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) await processor.process(job.data);
    });
  }
}
