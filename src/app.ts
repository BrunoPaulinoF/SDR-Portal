import cookie from '@fastify/cookie';
import formBody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { env } from './config/env.js';
import { createHttpAiClient, type AiClient } from './modules/ai/ai-client.js';
import { createMemoryAiRunRepository, type AiRunRepository } from './modules/ai/ai-run-repository.js';
import { createAiResponseService } from './modules/ai/ai-response-service.js';
import { createInboundResponseBuffer } from './modules/ai/inbound-response-buffer.js';
import { createAudioTranscriptionService } from './modules/audio/audio-transcription-service.js';
import { registerAiRunRoutes } from './modules/ai/ai-run-routes.js';
import { registerPromptAssistantRoutes } from './modules/ai/prompt-assistant-routes.js';
import { createMemoryAuthRepository, type AuthRepository } from './modules/auth/auth-repository.js';
import { registerAuthRoutes } from './modules/auth/auth-routes.js';
import { createMemoryCompanyRepository, type CompanyRepository } from './modules/companies/company-repository.js';
import { registerCompanyRoutes } from './modules/companies/company-routes.js';
import { createMemoryConversationRepository, type ConversationRepository } from './modules/conversations/conversation-repository.js';
import { registerConversationRoutes } from './modules/conversations/conversation-routes.js';
import { registerDashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import {
  createMemoryFirstMessageVariantRepository,
  type FirstMessageVariantRepository,
} from './modules/first-message-variants/first-message-variant-repository.js';
import { registerFirstMessageVariantRoutes } from './modules/first-message-variants/first-message-variant-routes.js';
import { createMemoryJobLogRepository, type JobLogRepository } from './modules/jobs/job-log-repository.js';
import { registerJobLogRoutes } from './modules/jobs/job-log-routes.js';
import { createMemoryLeadResearchRepository, type LeadResearchRepository } from './modules/leads/lead-research-repository.js';
import {
  createHttpLeadResearchProvider,
  createLeadResearchService,
  type LeadResearchProvider,
  type LeadResearchService,
} from './modules/leads/lead-research-service.js';
import { createMemoryLeadRepository, type LeadRepository } from './modules/leads/lead-repository.js';
import { registerLeadRoutes } from './modules/leads/lead-routes.js';
import { createInitialOutreachService } from './modules/scheduler/initial-outreach.js';
import { createFollowupOutreachService } from './modules/scheduler/followup-outreach.js';
import { registerSchedulerRoutes } from './modules/scheduler/scheduler-routes.js';
import { createMemorySdrAgentRepository, type SdrAgentRepository } from './modules/sdr-agents/sdr-agent-repository.js';
import { registerSdrAgentRoutes } from './modules/sdr-agents/sdr-agent-routes.js';
import { createHttpUazapiClient, type UazapiClient } from './modules/uazapi/uazapi-client.js';
import { registerUazapiRoutes } from './modules/uazapi/uazapi-routes.js';
import { registerInstanceConnectRoutes } from './modules/uazapi/instance-connect-routes.js';
import {
  createMemoryInstanceShareLinkRepository,
  type InstanceShareLinkRepository,
} from './modules/uazapi/instance-share-link-repository.js';
import { registerAssetsRoutes } from './modules/web/assets.js';
import { registerWebhookEventRoutes } from './modules/webhooks/webhook-event-routes.js';
import { createMemoryWebhookEventRepository, type WebhookEventRepository } from './modules/webhooks/webhook-event-repository.js';
import { createResetConversationService } from './modules/webhooks/reset-conversation-service.js';
import { registerUazapiWebhookRoutes } from './modules/webhooks/uazapi-webhook-routes.js';

export type AppInstance = FastifyInstance;

export interface AppOptions extends FastifyServerOptions {
  aiClient?: AiClient;
  aiRunRepository?: AiRunRepository;
  authRepository?: AuthRepository;
  companyRepository?: CompanyRepository;
  conversationRepository?: ConversationRepository;
  firstMessageVariantRepository?: FirstMessageVariantRepository;
  jobLogRepository?: JobLogRepository;
  leadResearchProvider?: LeadResearchProvider;
  leadResearchService?: LeadResearchService;
  leadResearchRepository?: LeadResearchRepository;
  leadRepository?: LeadRepository;
  inboundResponseBufferMs?: number;
  instanceShareLinkRepository?: InstanceShareLinkRepository;
  sdrAgentRepository?: SdrAgentRepository;
  uazapiClient?: UazapiClient;
  webhookEventRepository?: WebhookEventRepository;
}

function createLazyDbAiRunRepository(): AiRunRepository {
  return {
    async create(input) {
      const { createDbAiRunRepository } = await import('./modules/ai/db-ai-run-repository.js');
      return createDbAiRunRepository().create(input);
    },
    async findByLeadId(leadId) {
      const { createDbAiRunRepository } = await import('./modules/ai/db-ai-run-repository.js');
      return createDbAiRunRepository().findByLeadId(leadId);
    },
    async list() {
      const { createDbAiRunRepository } = await import('./modules/ai/db-ai-run-repository.js');
      return createDbAiRunRepository().list();
    },
  };
}

function createLazyDbConversationRepository(): ConversationRepository {
  return {
    async create(input) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().create(input);
    },
    async createMessage(input) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().createMessage(input);
    },
    async findById(id) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().findById(id);
    },
    async findByLeadId(leadId) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().findByLeadId(leadId);
    },
    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().findBySdrAndWhatsapp(sdrAgentId, whatsappNumber);
    },
    async list() {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().list();
    },
    async listAllMessages() {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().listAllMessages();
    },
    async listMessages(conversationId) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().listMessages(conversationId);
    },
    async touch(id, lastMessageAt) {
      const { createDbConversationRepository } = await import('./modules/conversations/db-conversation-repository.js');
      return createDbConversationRepository().touch(id, lastMessageAt);
    },
  };
}

function createLazyDbWebhookEventRepository(): WebhookEventRepository {
  return {
    async create(input) {
      const { createDbWebhookEventRepository } = await import('./modules/webhooks/db-webhook-event-repository.js');
      return createDbWebhookEventRepository().create(input);
    },
    async list() {
      const { createDbWebhookEventRepository } = await import('./modules/webhooks/db-webhook-event-repository.js');
      return createDbWebhookEventRepository().list();
    },
    async updateProcessing(id, input) {
      const { createDbWebhookEventRepository } = await import('./modules/webhooks/db-webhook-event-repository.js');
      return createDbWebhookEventRepository().updateProcessing(id, input);
    },
  };
}

function createLazyDbJobLogRepository(): JobLogRepository {
  return {
    async create(input) {
      const { createDbJobLogRepository } = await import('./modules/jobs/db-job-log-repository.js');
      return createDbJobLogRepository().create(input);
    },

    async findByLeadId(leadId) {
      const { createDbJobLogRepository } = await import('./modules/jobs/db-job-log-repository.js');
      return createDbJobLogRepository().findByLeadId(leadId);
    },

    async list() {
      const { createDbJobLogRepository } = await import('./modules/jobs/db-job-log-repository.js');
      return createDbJobLogRepository().list();
    },
  };
}

function createLazyDbAuthRepository(): AuthRepository {
  return {
    async createUser(user) {
      const { createDbAuthRepository } = await import('./modules/auth/db-auth-repository.js');
      return createDbAuthRepository().createUser(user);
    },

    async findByEmail(email) {
      const { createDbAuthRepository } = await import('./modules/auth/db-auth-repository.js');
      return createDbAuthRepository().findByEmail(email);
    },

    async findById(id) {
      const { createDbAuthRepository } = await import('./modules/auth/db-auth-repository.js');
      return createDbAuthRepository().findById(id);
    },
  };
}

function createLazyDbCompanyRepository(): CompanyRepository {
  return {
    async create(input) {
      const { createDbCompanyRepository } = await import('./modules/companies/db-company-repository.js');
      return createDbCompanyRepository().create(input);
    },

    async delete(id) {
      const { createDbCompanyRepository } = await import('./modules/companies/db-company-repository.js');
      return createDbCompanyRepository().delete(id);
    },

    async findById(id) {
      const { createDbCompanyRepository } = await import('./modules/companies/db-company-repository.js');
      return createDbCompanyRepository().findById(id);
    },

    async list() {
      const { createDbCompanyRepository } = await import('./modules/companies/db-company-repository.js');
      return createDbCompanyRepository().list();
    },

    async update(id, input) {
      const { createDbCompanyRepository } = await import('./modules/companies/db-company-repository.js');
      return createDbCompanyRepository().update(id, input);
    },
  };
}

function createLazyDbSdrAgentRepository(): SdrAgentRepository {
  return {
    async create(input) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().create(input);
    },

    async delete(id) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().delete(id);
    },

    async findById(id) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().findById(id);
    },

    async list() {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().list();
    },

    async setActive(id, isActive) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().setActive(id, isActive);
    },

    async setFirstMessageMode(id, mode) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().setFirstMessageMode(id, mode);
    },

    async update(id, input) {
      const { createDbSdrAgentRepository } = await import('./modules/sdr-agents/db-sdr-agent-repository.js');
      return createDbSdrAgentRepository().update(id, input);
    },
  };
}

function createLazyDbFirstMessageVariantRepository(): FirstMessageVariantRepository {
  return {
    async listForAgent(sdrAgentId) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().listForAgent(sdrAgentId);
    },
    async listActiveForAgent(sdrAgentId) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().listActiveForAgent(sdrAgentId);
    },
    async findById(id) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().findById(id);
    },
    async create(input) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().create(input);
    },
    async update(id, input) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().update(id, input);
    },
    async setActive(id, isActive) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().setActive(id, isActive);
    },
    async delete(id) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().delete(id);
    },
    async pickNextForAgent(sdrAgentId) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().pickNextForAgent(sdrAgentId);
    },
    async metricsForAgent(sdrAgentId) {
      const { createDbFirstMessageVariantRepository } = await import(
        './modules/first-message-variants/db-first-message-variant-repository.js'
      );
      return createDbFirstMessageVariantRepository().metricsForAgent(sdrAgentId);
    },
  };
}

function createLazyDbLeadRepository(): LeadRepository {
  return {
    async countFollowupSentForSdrSince(sdrAgentId, since) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().countFollowupSentForSdrSince(sdrAgentId, since);
    },

    async countInitialSentForSdrSince(sdrAgentId, since) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().countInitialSentForSdrSince(sdrAgentId, since);
    },

    async create(input) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().create(input);
    },

    async createImport(input) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().createImport(input);
    },

    async delete(id) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().delete(id);
    },

    async deleteBySdrAndStatuses(sdrAgentId, statuses) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().deleteBySdrAndStatuses(sdrAgentId, statuses);
    },

    async findById(id) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findById(id);
    },

    async findBySdrAndWhatsappIdentity(sdrAgentId, identity) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findBySdrAndWhatsappIdentity(sdrAgentId, identity);
    },

    async findLastFollowupSentForSdr(sdrAgentId) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findLastFollowupSentForSdr(sdrAgentId);
    },

    async findLastInitialSentForSdr(sdrAgentId) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findLastInitialSentForSdr(sdrAgentId);
    },

    async findNextFollowupDueForSdr(sdrAgentId, now, options) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findNextFollowupDueForSdr(sdrAgentId, now, options);
    },

    async findNextPendingForSdr(sdrAgentId) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findNextPendingForSdr(sdrAgentId);
    },

    async findBySdrAndWhatsapp(sdrAgentId, whatsappNumber) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().findBySdrAndWhatsapp(sdrAgentId, whatsappNumber);
    },

    async list() {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().list();
    },

    async listImports() {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().listImports();
    },

    async markHumanPaused(id, pausedAt, pausedUntil, reason) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markHumanPaused(id, pausedAt, pausedUntil, reason);
    },

    async markInboundReceived(id, receivedAt, followupDueAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markInboundReceived(id, receivedAt, followupDueAt);
    },

    async markOutboundSent(id, sentAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markOutboundSent(id, sentAt);
    },

    async markFollowupSent(id, sentAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markFollowupSent(id, sentAt);
    },

    async rescheduleFollowup(id, followupDueAt, updatedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().rescheduleFollowup(id, followupDueAt, updatedAt);
    },

    async markDiscarded(id, discardedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markDiscarded(id, discardedAt);
    },

    async markInvalidPhone(id, markedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markInvalidPhone(id, markedAt);
    },

    async markNotInterested(id, markedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markNotInterested(id, markedAt);
    },

    async markTransferred(id, transferredAt, summary) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markTransferred(id, transferredAt, summary);
    },

    async markInitialSent(id, sentAt, followupDueAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().markInitialSent(id, sentAt, followupDueAt);
    },

    async updateWhatsappIdentity(id, identity, updatedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().updateWhatsappIdentity(id, identity, updatedAt);
    },

    async disableFollowup(id, disabledAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().disableFollowup(id, disabledAt);
    },

    async updateStage(id, stage, updatedAt) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().updateStage(id, stage, updatedAt);
    },

    async setFirstMessageVariant(id, variantId) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().setFirstMessageVariant(id, variantId);
    },

    async update(id, input) {
      const { createDbLeadRepository } = await import('./modules/leads/db-lead-repository.js');
      return createDbLeadRepository().update(id, input);
    },
  };
}

function createLazyDbInstanceShareLinkRepository(): InstanceShareLinkRepository {
  return {
    async create(input) {
      const { createDbInstanceShareLinkRepository } = await import('./modules/uazapi/db-instance-share-link-repository.js');
      return createDbInstanceShareLinkRepository().create(input);
    },
    async findByTokenHash(tokenHash) {
      const { createDbInstanceShareLinkRepository } = await import('./modules/uazapi/db-instance-share-link-repository.js');
      return createDbInstanceShareLinkRepository().findByTokenHash(tokenHash);
    },
    async markConnected(id, connectedAt) {
      const { createDbInstanceShareLinkRepository } = await import('./modules/uazapi/db-instance-share-link-repository.js');
      return createDbInstanceShareLinkRepository().markConnected(id, connectedAt);
    },
    async revokeActiveForAgent(sdrAgentId, revokedAt) {
      const { createDbInstanceShareLinkRepository } = await import('./modules/uazapi/db-instance-share-link-repository.js');
      return createDbInstanceShareLinkRepository().revokeActiveForAgent(sdrAgentId, revokedAt);
    },
  };
}

function createLazyDbLeadResearchRepository(): LeadResearchRepository {
  return {
    async findByLeadId(leadId) {
      const { createDbLeadResearchRepository } = await import('./modules/leads/db-lead-research-repository.js');
      return createDbLeadResearchRepository().findByLeadId(leadId);
    },

    async upsert(input) {
      const { createDbLeadResearchRepository } = await import('./modules/leads/db-lead-research-repository.js');
      return createDbLeadResearchRepository().upsert(input);
    },
  };
}

export function buildApp(options: AppOptions = {}): AppInstance {
  const {
    aiClient,
    aiRunRepository,
    authRepository,
    companyRepository,
    conversationRepository,
    firstMessageVariantRepository,
    jobLogRepository,
    leadResearchProvider,
    leadResearchService,
    leadResearchRepository,
    leadRepository,
    inboundResponseBufferMs,
    instanceShareLinkRepository,
    sdrAgentRepository,
    uazapiClient,
    webhookEventRepository,
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);
  const repository = authRepository ?? (env.NODE_ENV === 'test' ? createMemoryAuthRepository() : createLazyDbAuthRepository());
  const companies =
    companyRepository ?? (env.NODE_ENV === 'test' ? createMemoryCompanyRepository() : createLazyDbCompanyRepository());
  const sdrAgents =
    sdrAgentRepository ?? (env.NODE_ENV === 'test' ? createMemorySdrAgentRepository() : createLazyDbSdrAgentRepository());
  const leads = leadRepository ?? (env.NODE_ENV === 'test' ? createMemoryLeadRepository() : createLazyDbLeadRepository());
  const jobLogs = jobLogRepository ?? (env.NODE_ENV === 'test' ? createMemoryJobLogRepository() : createLazyDbJobLogRepository());
  const conversations =
    conversationRepository ?? (env.NODE_ENV === 'test' ? createMemoryConversationRepository() : createLazyDbConversationRepository());
  const firstMessageVariants =
    firstMessageVariantRepository ??
    (env.NODE_ENV === 'test' ? createMemoryFirstMessageVariantRepository() : createLazyDbFirstMessageVariantRepository());
  const webhookEvents =
    webhookEventRepository ??
    (env.NODE_ENV === 'test' ? createMemoryWebhookEventRepository() : createLazyDbWebhookEventRepository());
  const uazapi = uazapiClient ?? createHttpUazapiClient();
  const instanceShareLinks =
    instanceShareLinkRepository ??
    (env.NODE_ENV === 'test' ? createMemoryInstanceShareLinkRepository() : createLazyDbInstanceShareLinkRepository());
  const ai = aiClient ?? createHttpAiClient();
  const aiRuns = aiRunRepository ?? (env.NODE_ENV === 'test' ? createMemoryAiRunRepository() : createLazyDbAiRunRepository());
  const leadResearchRepo =
    leadResearchRepository ?? (env.NODE_ENV === 'test' ? createMemoryLeadResearchRepository() : createLazyDbLeadResearchRepository());
  const researchService =
    leadResearchService ??
    createLeadResearchService({ provider: leadResearchProvider ?? createHttpLeadResearchProvider(), repository: leadResearchRepo });
  const initialOutreach = createInitialOutreachService({
    aiClient: ai,
    aiRunRepository: aiRuns,
    conversationRepository: conversations,
    firstMessageVariantRepository: firstMessageVariants,
    jobLogRepository: jobLogs,
    leadResearchService: researchService,
    leadRepository: leads,
    sdrAgentRepository: sdrAgents,
    uazapiClient: uazapi,
  });
  const resetConversation = createResetConversationService({
    aiClient: ai,
    aiRunRepository: aiRuns,
    conversationRepository: conversations,
    firstMessageVariantRepository: firstMessageVariants,
    jobLogRepository: jobLogs,
    leadResearchService: researchService,
    leadRepository: leads,
    uazapiClient: uazapi,
  });
  const followupOutreach = createFollowupOutreachService({
    aiClient: ai,
    aiRunRepository: aiRuns,
    conversationRepository: conversations,
    jobLogRepository: jobLogs,
    leadRepository: leads,
    sdrAgentRepository: sdrAgents,
    uazapiClient: uazapi,
  });
  const aiResponseService = createAiResponseService({
    aiClient: ai,
    aiRunRepository: aiRuns,
    conversationRepository: conversations,
    leadRepository: leads,
    uazapiClient: uazapi,
  });
  const bufferedAiResponseService = createInboundResponseBuffer({
    aiResponseService,
    conversationRepository: conversations,
    delayMs: inboundResponseBufferMs ?? (env.NODE_ENV === 'test' ? 0 : env.INBOUND_RESPONSE_BUFFER_MS),
    leadRepository: leads,
  });
  const audioTranscriptionService = createAudioTranscriptionService({ uazapiClient: uazapi });

  void app.register(cookie, {
    secret: env.SESSION_SECRET ?? 'test_session_secret_for_sdr_portal',
  });
  void app.register(formBody);
  void app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  registerAssetsRoutes(app);
  registerAuthRoutes(app, repository);
  registerDashboardRoutes(app, repository, companies, sdrAgents, leads, conversations, aiRuns, jobLogs);
  registerCompanyRoutes(app, repository, companies);
  registerSdrAgentRoutes(app, repository, companies, sdrAgents, uazapi);
  registerFirstMessageVariantRoutes(app, repository, sdrAgents, firstMessageVariants);
  registerLeadRoutes(app, repository, companies, sdrAgents, leads, aiRuns, jobLogs);
  registerUazapiRoutes(app, repository, sdrAgents, uazapi);
  registerInstanceConnectRoutes(app, repository, sdrAgents, instanceShareLinks, uazapi);
  registerSchedulerRoutes(app, repository, initialOutreach, followupOutreach);
  registerConversationRoutes(app, repository, conversations, leads, sdrAgents);
  registerWebhookEventRoutes(app, repository, webhookEvents);
  registerAiRunRoutes(app, repository, aiRuns);
  registerJobLogRoutes(app, repository, jobLogs);
  app.addHook('onClose', async () => {
    bufferedAiResponseService.close();
  });
  registerUazapiWebhookRoutes(
    app,
    sdrAgents,
    leads,
    conversations,
    webhookEvents,
    bufferedAiResponseService,
    audioTranscriptionService,
    resetConversation,
  );
  registerPromptAssistantRoutes(app, repository, sdrAgents, ai, aiRuns);

  return app;
}
