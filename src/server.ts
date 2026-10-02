import { buildApp } from './app.js';
import { env } from './config/env.js';
import { createHttpAiClient } from './modules/ai/ai-client.js';
import { createAiResponseService } from './modules/ai/ai-response-service.js';
import { createDbAiRunRepository } from './modules/ai/db-ai-run-repository.js';
import { createReplyJobProcessor, createReplyTransportSlot } from './modules/ai/reply-queue.js';
import { createElevenLabsTextToSpeechClient } from './modules/audio/text-to-speech-client.js';
import { createDbConversationRepository } from './modules/conversations/db-conversation-repository.js';
import { createDbFirstMessageVariantRepository } from './modules/first-message-variants/db-first-message-variant-repository.js';
import { createDbJobLogRepository } from './modules/jobs/db-job-log-repository.js';
import { createDbLeadResearchRepository } from './modules/leads/db-lead-research-repository.js';
import { createHttpLeadResearchProvider, createLeadResearchService } from './modules/leads/lead-research-service.js';
import { createDbContactBlockRepository } from './modules/leads/db-contact-block-repository.js';
import { createDbLeadRepository } from './modules/leads/db-lead-repository.js';
import { createDbConnectionMonitorRepository } from './modules/monitoring/db-connection-monitor-repository.js';
import { createChannelLimitsGate } from './modules/monitoring/channel-limits.js';
import { createDbChannelLimitsRepository } from './modules/monitoring/db-channel-limits-repository.js';
import { createConnectionMonitorService } from './modules/monitoring/connection-monitor-service.js';
import { createDailyReportService } from './modules/monitoring/daily-report-service.js';
import { createLeadQueueMonitorService } from './modules/monitoring/lead-queue-monitor-service.js';
import { createFollowupOutreachService } from './modules/scheduler/followup-outreach.js';
import { createInitialOutreachService } from './modules/scheduler/initial-outreach.js';
import { createPendingReplyService } from './modules/scheduler/pending-reply.js';
import {
  startPgBossConnectionMonitorScheduler,
  startPgBossDailyReportScheduler,
  startPgBossLeadQueueMonitorScheduler,
  startPgBossFollowupScheduler,
  startPgBossInitialOutreachScheduler,
  startPgBossPendingReplyScheduler,
  startPgBossReplyQueue,
} from './modules/scheduler/pg-boss-scheduler.js';
import { createDbSdrAgentRepository } from './modules/sdr-agents/db-sdr-agent-repository.js';
import { createHttpUazapiClient } from './modules/uazapi/uazapi-client.js';
import type PgBoss from 'pg-boss';

const replyTransport = createReplyTransportSlot();
const app = buildApp({
  logger: {
    level: env.LOG_LEVEL,
  },
  replyTransport,
});
const bosses: PgBoss[] = [];

async function start(): Promise<void> {
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    // Primeiro a fila de respostas: lead esperando resposta vale mais do que qualquer cron.
    const replyBoss = await startPgBossReplyQueue(
      createReplyJobProcessor({
        aiResponseService: createAiResponseService({
          aiClient: createHttpAiClient(),
          aiRunRepository: createDbAiRunRepository(),
          conversationRepository: createDbConversationRepository(),
          jobLogRepository: createDbJobLogRepository(),
          leadRepository: createDbLeadRepository(),
          textToSpeechClient: createElevenLabsTextToSpeechClient(),
          uazapiClient: createHttpUazapiClient(),
        }),
        conversationRepository: createDbConversationRepository(),
        delayMs: env.INBOUND_RESPONSE_BUFFER_MS,
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        transport: replyTransport,
      }),
      replyTransport,
    );
    if (replyBoss) bosses.push(replyBoss);
    const initialBoss = await startPgBossInitialOutreachScheduler(
      createInitialOutreachService({
        aiClient: createHttpAiClient(),
        aiRunRepository: createDbAiRunRepository(),
        channelLimits: createChannelLimitsGate({
          jobLogRepository: createDbJobLogRepository(),
          repository: createDbChannelLimitsRepository(),
          uazapiClient: createHttpUazapiClient(),
        }),
        contactBlockRepository: createDbContactBlockRepository(),
        conversationRepository: createDbConversationRepository(),
        firstMessageVariantRepository: createDbFirstMessageVariantRepository(),
        jobLogRepository: createDbJobLogRepository(),
        leadResearchService: createLeadResearchService({
          provider: createHttpLeadResearchProvider(),
          repository: createDbLeadResearchRepository(),
        }),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    const followupBoss = await startPgBossFollowupScheduler(
      createFollowupOutreachService({
        aiClient: createHttpAiClient(),
        aiRunRepository: createDbAiRunRepository(),
        conversationRepository: createDbConversationRepository(),
        jobLogRepository: createDbJobLogRepository(),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    const pendingReplyBoss = await startPgBossPendingReplyScheduler(
      createPendingReplyService({
        afterMs: env.PENDING_REPLY_AFTER_MS,
        aiResponseService: createAiResponseService({
          aiClient: createHttpAiClient(),
          aiRunRepository: createDbAiRunRepository(),
          conversationRepository: createDbConversationRepository(),
          jobLogRepository: createDbJobLogRepository(),
          leadRepository: createDbLeadRepository(),
          textToSpeechClient: createElevenLabsTextToSpeechClient(),
          uazapiClient: createHttpUazapiClient(),
        }),
        aiRunRepository: createDbAiRunRepository(),
        conversationRepository: createDbConversationRepository(),
        jobLogRepository: createDbJobLogRepository(),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        windowHours: env.PENDING_REPLY_WINDOW_HOURS,
      }),
    );
    const connectionMonitorBoss = await startPgBossConnectionMonitorScheduler(
      createConnectionMonitorService({
        connectionMonitorRepository: createDbConnectionMonitorRepository(),
        jobLogRepository: createDbJobLogRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    const dailyReportBoss = await startPgBossDailyReportScheduler(
      createDailyReportService({
        channelLimitsRepository: createDbChannelLimitsRepository(),
        connectionMonitorRepository: createDbConnectionMonitorRepository(),
        jobLogRepository: createDbJobLogRepository(),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    const leadQueueBoss = await startPgBossLeadQueueMonitorScheduler(
      createLeadQueueMonitorService({
        connectionMonitorRepository: createDbConnectionMonitorRepository(),
        jobLogRepository: createDbJobLogRepository(),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    if (initialBoss) bosses.push(initialBoss);
    if (followupBoss) bosses.push(followupBoss);
    if (pendingReplyBoss) bosses.push(pendingReplyBoss);
    if (connectionMonitorBoss) bosses.push(connectionMonitorBoss);
    if (dailyReportBoss) bosses.push(dailyReportBoss);
    if (leadQueueBoss) bosses.push(leadQueueBoss);
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Shutting down server');
  await Promise.all(bosses.map((boss) => boss.stop({ graceful: true, wait: true })));
  await app.close();
  process.exit(0);
}

process.on('SIGINT', (signal) => {
  void shutdown(signal);
});

process.on('SIGTERM', (signal) => {
  void shutdown(signal);
});

void start();
