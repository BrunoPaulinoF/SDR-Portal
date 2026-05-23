import { buildApp } from './app.js';
import { env } from './config/env.js';
import { createHttpAiClient } from './modules/ai/ai-client.js';
import { createDbAiRunRepository } from './modules/ai/db-ai-run-repository.js';
import { createDbConversationRepository } from './modules/conversations/db-conversation-repository.js';
import { createDbJobLogRepository } from './modules/jobs/db-job-log-repository.js';
import { createDbLeadResearchRepository } from './modules/leads/db-lead-research-repository.js';
import { createHttpLeadResearchProvider, createLeadResearchService } from './modules/leads/lead-research-service.js';
import { createDbLeadRepository } from './modules/leads/db-lead-repository.js';
import { createFollowupOutreachService } from './modules/scheduler/followup-outreach.js';
import { createInitialOutreachService } from './modules/scheduler/initial-outreach.js';
import { startPgBossFollowupScheduler, startPgBossInitialOutreachScheduler } from './modules/scheduler/pg-boss-scheduler.js';
import { createDbSdrAgentRepository } from './modules/sdr-agents/db-sdr-agent-repository.js';
import { createHttpUazapiClient } from './modules/uazapi/uazapi-client.js';
import type PgBoss from 'pg-boss';

const app = buildApp({
  logger: {
    level: env.LOG_LEVEL,
  },
});
const bosses: PgBoss[] = [];

async function start(): Promise<void> {
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    const initialBoss = await startPgBossInitialOutreachScheduler(
      createInitialOutreachService({
        aiClient: createHttpAiClient(),
        aiRunRepository: createDbAiRunRepository(),
        conversationRepository: createDbConversationRepository(),
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
        jobLogRepository: createDbJobLogRepository(),
        leadRepository: createDbLeadRepository(),
        sdrAgentRepository: createDbSdrAgentRepository(),
        uazapiClient: createHttpUazapiClient(),
      }),
    );
    if (initialBoss) bosses.push(initialBoss);
    if (followupBoss) bosses.push(followupBoss);
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
