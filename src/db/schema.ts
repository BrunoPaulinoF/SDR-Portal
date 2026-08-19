import { boolean, integer, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const appMetadata = pgTable('app_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('admin'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_email_unique_idx').on(table.email)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    cnpj: text('cnpj'),
    segment: text('segment'),
    description: text('description'),
    websiteUrl: text('website_url'),
    defaultHandoffName: text('default_handoff_name'),
    defaultHandoffPhone: text('default_handoff_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('companies_cnpj_unique_idx').on(table.cnpj)],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export const sdrAgents = pgTable('sdr_agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').default(false).notNull(),
  productName: text('product_name'),
  productDescription: text('product_description'),
  offerDescription: text('offer_description'),
  prompt: text('prompt'),
  firstMessagePrompt: text('first_message_prompt'),
  leadQualificationPrompt: text('lead_qualification_prompt'),
  followupPrompt: text('followup_prompt'),
  firstMessageMode: text('first_message_mode').default('ai').notNull(),
  playbook: text('playbook').default('consultivo').notNull(),
  aiProvider: text('ai_provider').default('deepseek').notNull(),
  aiModel: text('ai_model').default('deepseek-v4-pro').notNull(),
  aiTemperature: real('ai_temperature').default(0.4).notNull(),
  aiMaxOutputTokens: integer('ai_max_output_tokens').default(800).notNull(),
  aiReasoningEffort: text('ai_reasoning_effort').default('low').notNull(),
  openaiApiKeyEncrypted: text('openai_api_key_encrypted'),
  openrouterApiKeyEncrypted: text('openrouter_api_key_encrypted'),
  deepseekApiKeyEncrypted: text('deepseek_api_key_encrypted'),
  uazapiBaseUrl: text('uazapi_base_url'),
  uazapiInstanceId: text('uazapi_instance_id'),
  uazapiInstanceTokenEncrypted: text('uazapi_instance_token_encrypted'),
  uazapiAdminTokenEncrypted: text('uazapi_admin_token_encrypted'),
  whatsappNumber: text('whatsapp_number'),
  timezone: text('timezone').default('America/Sao_Paulo').notNull(),
  sendWindowStart: text('send_window_start').default('08:00').notNull(),
  sendWindowEnd: text('send_window_end').default('18:00').notNull(),
  sendDaysOfWeek: text('send_days_of_week').default('1,2,3,4,5').notNull(),
  initialCooldownMinMinutes: integer('initial_cooldown_min_minutes').default(5).notNull(),
  initialCooldownMaxMinutes: integer('initial_cooldown_max_minutes').default(15).notNull(),
  followupEnabled: boolean('followup_enabled').default(true).notNull(),
  followupAfterHours: integer('followup_after_hours').default(24).notNull(),
  followupCooldownMinMinutes: integer('followup_cooldown_min_minutes').default(10).notNull(),
  followupCooldownMaxMinutes: integer('followup_cooldown_max_minutes').default(30).notNull(),
  dailyInitialSendLimit: integer('daily_initial_send_limit').default(50).notNull(),
  dailyFollowupSendLimit: integer('daily_followup_send_limit').default(50).notNull(),
  responseDelayBaseMs: integer('response_delay_base_ms').default(1200).notNull(),
  responseDelayPerCharMs: integer('response_delay_per_char_ms').default(35).notNull(),
  responseDelayMaxMs: integer('response_delay_max_ms').default(12000).notNull(),
  messageSplitMaxChars: integer('message_split_max_chars').default(450).notNull(),
  humanPauseHours: integer('human_pause_hours').default(24).notNull(),
  handoffName: text('handoff_name'),
  handoffPhone: text('handoff_phone'),
  handoffMessageTemplate: text('handoff_message_template'),
  demoContactName: text('demo_contact_name'),
  demoContactPhone: text('demo_contact_phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SdrAgent = typeof sdrAgents.$inferSelect;
export type NewSdrAgent = typeof sdrAgents.$inferInsert;

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    sdrAgentId: uuid('sdr_agent_id')
      .notNull()
      .references(() => sdrAgents.id, { onDelete: 'cascade' }),
    whatsappNumber: text('whatsapp_number').notNull(),
    whatsappJid: text('whatsapp_jid'),
    whatsappLid: text('whatsapp_lid'),
    cnpj: text('cnpj'),
    companyName: text('company_name').notNull(),
    tradeName: text('trade_name'),
    segment: text('segment'),
    city: text('city'),
    state: text('state'),
    contactName: text('contact_name'),
    extraData: text('extra_data'),
    status: text('status').default('pending').notNull(),
    conversationStage: text('conversation_stage').default('permission').notNull(),
    source: text('source').default('manual').notNull(),
    firstMessageVariantId: uuid('first_message_variant_id').references(() => firstMessageVariants.id, {
      onDelete: 'set null',
    }),
    firstMessageSentAt: timestamp('first_message_sent_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    followupDueAt: timestamp('followup_due_at', { withTimezone: true }),
    followupSentAt: timestamp('followup_sent_at', { withTimezone: true }),
    followupDisabledAt: timestamp('followup_disabled_at', { withTimezone: true }),
    humanPausedUntil: timestamp('human_paused_until', { withTimezone: true }),
    aiPausedAt: timestamp('ai_paused_at', { withTimezone: true }),
    aiPauseReason: text('ai_pause_reason'),
    handoffRequestedAt: timestamp('handoff_requested_at', { withTimezone: true }),
    handoffSummary: text('handoff_summary'),
    notInterestedAt: timestamp('not_interested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const firstMessageVariants = pgTable('first_message_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  sdrAgentId: uuid('sdr_agent_id')
    .notNull()
    .references(() => sdrAgents.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  body: text('body').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  assignedCount: integer('assigned_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type FirstMessageVariant = typeof firstMessageVariants.$inferSelect;
export type NewFirstMessageVariant = typeof firstMessageVariants.$inferInsert;

export const leadImports = pgTable('lead_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  sdrAgentId: uuid('sdr_agent_id')
    .notNull()
    .references(() => sdrAgents.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  totalRows: integer('total_rows').default(0).notNull(),
  successRows: integer('success_rows').default(0).notNull(),
  errorRows: integer('error_rows').default(0).notNull(),
  mapping: text('mapping'),
  errors: text('errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type LeadImport = typeof leadImports.$inferSelect;
export type NewLeadImport = typeof leadImports.$inferInsert;

export const leadResearch = pgTable(
  'lead_research',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    sdrAgentId: uuid('sdr_agent_id')
      .notNull()
      .references(() => sdrAgents.id, { onDelete: 'cascade' }),
    query: text('query'),
    summary: text('summary'),
    sources: text('sources'),
    status: text('status').default('pending').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('lead_research_lead_unique_idx').on(table.leadId)],
);

export type LeadResearch = typeof leadResearch.$inferSelect;
export type NewLeadResearch = typeof leadResearch.$inferInsert;

export const jobLogs = pgTable('job_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobName: text('job_name').notNull(),
  jobKey: text('job_key'),
  sdrAgentId: uuid('sdr_agent_id').references(() => sdrAgents.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  attempt: integer('attempt').default(1).notNull(),
  payload: text('payload'),
  result: text('result'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type JobLog = typeof jobLogs.$inferSelect;
export type NewJobLog = typeof jobLogs.$inferInsert;

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    sdrAgentId: uuid('sdr_agent_id')
      .notNull()
      .references(() => sdrAgents.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    whatsappNumber: text('whatsapp_number').notNull(),
    status: text('status').default('open').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  sdrAgentId: uuid('sdr_agent_id')
    .notNull()
    .references(() => sdrAgents.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(),
  senderType: text('sender_type').notNull(),
  whatsappMessageId: text('whatsapp_message_id'),
  messageType: text('message_type').notNull(),
  text: text('text'),
  transcription: text('transcription'),
  mediaUrl: text('media_url'),
  rawPayload: text('raw_payload'),
  sentByApi: boolean('sent_by_api').default(false).notNull(),
  fromMe: boolean('from_me').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sdrAgentId: uuid('sdr_agent_id').references(() => sdrAgents.id, { onDelete: 'set null' }),
  eventType: text('event_type'),
  messageType: text('message_type'),
  instanceId: text('instance_id'),
  whatsappMessageId: text('whatsapp_message_id'),
  fromNumber: text('from_number'),
  toNumber: text('to_number'),
  fromMe: boolean('from_me'),
  wasSentByApi: boolean('was_sent_by_api'),
  rawHeaders: text('raw_headers'),
  rawBody: text('raw_body').notNull(),
  normalizedBody: text('normalized_body'),
  processingStatus: text('processing_status').default('received').notNull(),
  processingError: text('processing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export const aiRuns = pgTable('ai_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sdrAgentId: uuid('sdr_agent_id').references(() => sdrAgents.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(),
  inputMessages: text('input_messages'),
  outputText: text('output_text'),
  parsedJson: text('parsed_json'),
  error: text('error'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  promptCacheHitTokens: integer('prompt_cache_hit_tokens'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AiRun = typeof aiRuns.$inferSelect;
export type NewAiRun = typeof aiRuns.$inferInsert;

export const instanceShareLinks = pgTable('instance_share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  sdrAgentId: uuid('sdr_agent_id')
    .notNull()
    .references(() => sdrAgents.id, { onDelete: 'cascade' }),
  /** sha256 do token que vai na URL: o valor cru nunca fica no banco. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type InstanceShareLink = typeof instanceShareLinks.$inferSelect;
export type NewInstanceShareLink = typeof instanceShareLinks.$inferInsert;
