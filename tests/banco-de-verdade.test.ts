/**
 * O SQL dos repositorios contra um Postgres de verdade. As outras suites usam os repositorios
 * em memoria, que imitam o banco mas nao executam a consulta — e consulta errada so aparecia
 * em producao (a da rede de seguranca, por exemplo, nunca tinha rodado fora dela).
 *
 * Roda so com `TEST_DATABASE_URL` apontando para um banco DESCARTAVEL: a suite apaga as tabelas
 * entre os testes. Nunca aponte para producao.
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/sdrtest npx vitest run tests/banco-de-verdade.test.ts
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = TEST_DATABASE_URL ? describe : describe.skip;

type Repos = Awaited<ReturnType<typeof loadRepos>>;

async function loadRepos() {
  // Antes de qualquer import de src/: o singleton de env.ts le DATABASE_URL uma vez so.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const client = await import('../src/db/client.js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  await migrate(client.db, { migrationsFolder: 'drizzle' });
  const { sql } = await import('drizzle-orm');
  return {
    client,
    sql,
    conversations: (await import('../src/modules/conversations/db-conversation-repository.js')).createDbConversationRepository(),
    leads: (await import('../src/modules/leads/db-lead-repository.js')).createDbLeadRepository(),
    agents: (await import('../src/modules/sdr-agents/db-sdr-agent-repository.js')).createDbSdrAgentRepository(),
    monitors: (await import('../src/modules/monitoring/db-connection-monitor-repository.js')).createDbConnectionMonitorRepository(),
    blocks: (await import('../src/modules/leads/db-contact-block-repository.js')).createDbContactBlockRepository(),
    history: (await import('../src/modules/sdr-agents/db-config-history.js')).createDbSdrConfigChangeRepository(),
    channelLimits: (await import('../src/modules/monitoring/db-channel-limits-repository.js')).createDbChannelLimitsRepository(),
    aiRuns: (await import('../src/modules/ai/db-ai-run-repository.js')).createDbAiRunRepository(),
    jobLogs: (await import('../src/modules/jobs/db-job-log-repository.js')).createDbJobLogRepository(),
    webhooks: (await import('../src/modules/webhooks/db-webhook-event-repository.js')).createDbWebhookEventRepository(),
  };
}

const MINUTE = 60000;

dbDescribe('repositorios no Postgres', () => {
  let repos: Repos;

  beforeAll(async () => {
    repos = await loadRepos();
  });

  afterAll(async () => {
    await repos?.client.closeDb();
  });

  beforeEach(async () => {
    await repos.client.db.execute(
      repos.sql`truncate table sdr_config_changes, contact_blocks, messages, conversations, job_logs, ai_runs, webhook_events, lead_research, lead_imports, instance_share_links, sdr_connection_events, sdr_connection_states, leads, first_message_variants, sdr_agents, companies cascade`,
    );
  });

  async function agentAndLead(overrides: { whatsappNumber?: string; status?: string } = {}) {
    const [company] = await repos.client.db.execute<{ id: string }>(repos.sql`insert into companies (name) values ('Kybernan') returning id`);
    const agent = await repos.agents.create({ companyId: company!.id, name: 'Mariana', displayName: 'Mariana', isActive: true });
    const lead = await repos.leads.create({
      companyId: company!.id,
      sdrAgentId: agent.id,
      whatsappNumber: overrides.whatsappNumber ?? '5513999990000',
      companyName: 'Fit013 Marmitas',
      cnpj: null,
      tradeName: null,
      segment: null,
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: overrides.status ?? 'in_conversation',
      source: 'manual',
    });
    return { agent, lead };
  }

  async function message(conversationId: string, leadId: string, sdrAgentId: string, direction: 'inbound' | 'outbound', at: Date, autoReply = false) {
    const created = await repos.conversations.createMessage({
      conversationId,
      leadId,
      sdrAgentId,
      direction,
      senderType: direction === 'inbound' ? 'lead' : 'ai',
      whatsappMessageId: null,
      messageType: 'conversation',
      text: direction === 'inbound' ? 'oi' : 'ola',
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: direction === 'outbound',
      fromMe: direction === 'outbound',
      autoReply,
    });
    await repos.client.db.execute(repos.sql`update messages set created_at = ${at.toISOString()} where id = ${created.id}`);
    return created;
  }

  it('listAwaitingReply: so conversa cuja ultima fala que nao e automatica e do lead', async () => {
    const { agent, lead } = await agentAndLead();
    const conversation = await repos.conversations.create({
      companyId: lead.companyId,
      sdrAgentId: agent.id,
      leadId: lead.id,
      whatsappNumber: lead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });
    const now = Date.now();
    const human = await message(conversation.id, lead.id, agent.id, 'inbound', new Date(now - 10 * MINUTE));
    await message(conversation.id, lead.id, agent.id, 'inbound', new Date(now - 9 * MINUTE), true);

    const waiting = await repos.conversations.listAwaitingReply(new Date(now - 24 * 60 * MINUTE), new Date(now - 3 * MINUTE), 50);
    expect(waiting.map((item) => item.message.id)).toEqual([human.id]);
    expect(waiting[0]?.conversation.id).toBe(conversation.id);

    await message(conversation.id, lead.id, agent.id, 'outbound', new Date(now - 8 * MINUTE));
    expect(await repos.conversations.listAwaitingReply(new Date(now - 24 * 60 * MINUTE), new Date(now - 3 * MINUTE), 50)).toEqual([]);
  });

  it('countDailyActivityForSdr conta reuniao e cliente', async () => {
    const { agent, lead } = await agentAndLead();
    const now = new Date();
    await repos.leads.markTransferred(lead.id, now, 'resumo');
    await repos.leads.setOutcome(lead.id, { meetingAt: now, trialStartedAt: null, wonAt: now, lostAt: null, lostReason: null }, now);

    const activity = await repos.leads.countDailyActivityForSdr(agent.id, new Date(now.getTime() - 60 * MINUTE), new Date(now.getTime() + MINUTE));

    expect(activity).toMatchObject({ handoffs: 1, meetings: 1, won: 1 });
  });

  it('liberar a IA religa o follow-up que a pausa desligou (mesma data no banco)', async () => {
    const { lead } = await agentAndLead();
    await repos.leads.pauseAi(lead.id, new Date(), 'lead_image_message');

    const resumed = await repos.leads.resumeAi(lead.id, new Date());

    expect(resumed?.followupDisabledAt).toBeNull();
  });

  it('findNextFollowupDueForSdr acha o lead vencido e respeita o chat quente', async () => {
    const { agent, lead } = await agentAndLead({ status: 'initial_sent' });
    const now = new Date();
    await repos.leads.markInitialSent(lead.id, new Date(now.getTime() - 30 * 60 * MINUTE), new Date(now.getTime() - MINUTE));

    expect((await repos.leads.findNextFollowupDueForSdr(agent.id, now, { quietSince: new Date(now.getTime() - 24 * 60 * MINUTE) }))?.id).toBe(lead.id);

    await repos.leads.markOutboundSent(lead.id, new Date(now.getTime() - 60 * MINUTE));
    expect(await repos.leads.findNextFollowupDueForSdr(agent.id, now, { quietSince: new Date(now.getTime() - 24 * 60 * MINUTE) })).toBeNull();
  });

  it('cadencia: o lead com follow-up enviado volta enquanto tiver toque sobrando', async () => {
    const { agent, lead } = await agentAndLead({ status: 'initial_sent' });
    const now = new Date();
    const quietSince = new Date(now.getTime() - 24 * 60 * MINUTE);
    await repos.leads.markInitialSent(lead.id, new Date(now.getTime() - 60 * 60 * MINUTE), new Date(now.getTime() - 30 * 60 * MINUTE));

    const sentAt = new Date(now.getTime() - 26 * 60 * MINUTE);
    const marked = await repos.leads.markFollowupSent(lead.id, sentAt, new Date(now.getTime() - MINUTE));
    expect(marked?.followupCount).toBe(1);
    expect(marked?.followupDisabledAt).toBeNull();

    expect(await repos.leads.findNextFollowupDueForSdr(agent.id, now, { quietSince, maxTouches: 1 })).toBeNull();
    expect((await repos.leads.findNextFollowupDueForSdr(agent.id, now, { quietSince, maxTouches: 2 }))?.id).toBe(lead.id);

    const last = await repos.leads.markFollowupSent(lead.id, now, null);
    expect(last?.followupCount).toBe(2);
    expect(last?.followupDisabledAt).not.toBeNull();
  });

  it('nao contatar: acha pelas variantes e bloquear de novo so atualiza', async () => {
    await repos.blocks.add({ whatsappNumber: '5519999990000', reason: 'taxi', source: 'portal:a' });
    await repos.blocks.add({ whatsappNumber: '5519999990000', reason: 'pediu para parar', source: 'portal:b' });

    const block = await repos.blocks.findBlocked('551999990000');

    expect(block?.reason).toBe('pediu para parar');
    expect(await repos.blocks.list()).toHaveLength(1);
  });

  it('acha leads de qualquer SDR pelas variantes do numero', async () => {
    const { lead } = await agentAndLead({ whatsappNumber: '5519999990000' });

    const found = await repos.leads.findByWhatsappNumbers(['551999990000', '5519999990000']);

    expect(found.map((item) => item.id)).toEqual([lead.id]);
  });

  it('historico de configuracao grava e lista o mais recente primeiro', async () => {
    const { agent } = await agentAndLead();
    await repos.history.record([{ sdrAgentId: agent.id, field: 'aiModel', before: 'deepseek-v4-pro', after: 'deepseek-v4-flash', changedBy: 'portal:a' }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repos.history.record([{ sdrAgentId: agent.id, field: 'prompt', before: 'velho', after: 'novo', changedBy: 'script:apply-sdr-prompts' }]);

    const history = await repos.history.listForAgent(agent.id, 10);

    expect(history.map((change) => change.field)).toEqual(['prompt', 'aiModel']);
  });

  it('historico de conexao grava e lista em ordem', async () => {
    const { agent } = await agentAndLead();
    const t0 = new Date('2026-09-29T18:00:00.000Z');
    await repos.monitors.recordConnectionEvent({ sdrAgentId: agent.id, status: 'disconnected', reason: 'same number connected', occurredAt: new Date(t0.getTime() + MINUTE) });
    await repos.monitors.recordConnectionEvent({ sdrAgentId: agent.id, status: 'connected', reason: null, occurredAt: t0 });

    const events = await repos.monitors.listConnectionEvents(new Date(t0.getTime() - MINUTE));

    expect(events.map((event) => event.status)).toEqual(['connected', 'disconnected']);
  });

  it('limites do WhatsApp: grava, regrava por cima e some junto com o SDR', async () => {
    const { agent } = await agentAndLead();
    const checkedAt = new Date('2026-10-01T14:00:00.000Z');
    const blocked = {
      sdrAgentId: agent.id,
      canStartConversations: false,
      blockedUntil: new Date('2026-10-02T09:00:00.000Z'),
      blockReason: 'WhatsApp bloqueou novas conversas (BIZ_QUALITY)',
      quotaUsed: 4,
      quotaTotal: 10,
      quotaResetsAt: null,
      source: 'consulta',
      checkedAt,
    };
    await repos.channelLimits.save(blocked);
    await repos.channelLimits.save({ ...blocked, canStartConversations: true, blockedUntil: null, blockReason: null, source: 'envio' });

    expect(await repos.channelLimits.list()).toHaveLength(1);
    expect(await repos.channelLimits.find(agent.id)).toMatchObject({ canStartConversations: true, blockedUntil: null, source: 'envio', quotaUsed: 4 });

    await repos.agents.delete(agent.id);
    expect(await repos.channelLimits.find(agent.id)).toBeNull();
  });

  it('aquecimento: a data de inicio vai e volta do banco', async () => {
    const { agent } = await agentAndLead();
    const startedAt = new Date('2026-10-01T12:00:00.000Z');

    await repos.agents.update(agent.id, { companyId: agent.companyId, name: agent.name, displayName: agent.displayName, warmupStartedAt: startedAt });
    expect((await repos.agents.findById(agent.id))?.warmupStartedAt?.toISOString()).toBe(startedAt.toISOString());

    await repos.agents.update(agent.id, { companyId: agent.companyId, name: agent.name, displayName: agent.displayName, warmupStartedAt: null });
    expect((await repos.agents.findById(agent.id))?.warmupStartedAt).toBeNull();
  });

  it('lista de leads: busca, filtros, pagina e contagem por situacao', async () => {
    const { agent, lead } = await agentAndLead({ whatsappNumber: '5519988887777' });
    for (let index = 0; index < 4; index += 1) {
      await repos.leads.create({
        companyId: agent.companyId,
        sdrAgentId: agent.id,
        whatsappNumber: `551997770000${index}`,
        companyName: index === 3 ? 'Cantina 100%_real' : `Pizzaria ${index}`,
        status: index % 2 === 0 ? 'pending' : 'initial_sent',
        source: 'import',
      });
    }

    const firstPage = await repos.leads.search({}, 1, 2);
    const byNumber = await repos.leads.search({ q: '(19) 98888-7777' }, 1, 50);
    const byStatus = await repos.leads.search({ sdrAgentId: agent.id, status: 'initial_sent' }, 1, 50);
    // % e _ digitados sao texto: "100%_" so acha a Cantina, nao tudo.
    const literal = await repos.leads.search({ q: '100%_' }, 1, 50);
    const counts = await repos.leads.countByStatus(agent.id);

    expect(firstPage.total).toBe(5);
    expect(firstPage.leads).toHaveLength(2);
    expect(byNumber.leads.map((item) => item.id)).toEqual([lead.id]);
    expect(byStatus.total).toBe(2);
    expect(literal.leads.map((item) => item.companyName)).toEqual(['Cantina 100%_real']);
    expect(counts).toEqual({ in_conversation: 1, pending: 2, initial_sent: 2 });
  });

  it('painel: consultas leves so do periodo, sem texto nem prompt', async () => {
    const { agent, lead } = await agentAndLead();
    const conversation = await repos.conversations.create({
      companyId: agent.companyId,
      sdrAgentId: agent.id,
      leadId: lead.id,
      whatsappNumber: lead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });
    const old = new Date('2026-09-01T12:00:00.000Z');
    const recent = new Date('2026-10-01T12:00:00.000Z');
    for (const createdAt of [old, recent]) await message(conversation.id, lead.id, agent.id, 'inbound', createdAt);
    await repos.aiRuns.create({
      sdrAgentId: agent.id,
      leadId: lead.id,
      conversationId: conversation.id,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      purpose: 'reply_generation',
      inputMessages: 'prompt enorme',
      outputText: null,
      parsedJson: null,
      error: null,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      promptCacheHitTokens: null,
      latencyMs: 10,
    });
    await repos.jobLogs.create({
      jobName: 'initial-outreach',
      jobKey: 'k',
      sdrAgentId: agent.id,
      leadId: lead.id,
      status: 'failed',
      attempt: 1,
      payload: 'grande',
      result: null,
      error: 'x',
      startedAt: recent,
      finishedAt: recent,
    });

    const since = new Date('2026-09-15T00:00:00.000Z');
    const messageStats = await repos.conversations.listMessageStats(since);
    const runStats = await repos.aiRuns.listStats(null);
    const logStats = await repos.jobLogs.listStats(null);

    expect(messageStats).toHaveLength(1);
    expect(Object.keys(messageStats[0] ?? {}).sort()).toEqual(['autoReply', 'createdAt', 'direction', 'leadId']);
    expect(await repos.conversations.listMessageStats(null)).toHaveLength(2);
    expect(runStats[0]).toMatchObject({ totalTokens: 2, error: null });
    expect(runStats[0]).not.toHaveProperty('inputMessages');
    expect(logStats[0]).toMatchObject({ status: 'failed', jobName: 'initial-outreach' });
    expect(logStats[0]).not.toHaveProperty('payload');
  });

  it('registros: pagina do mais novo para o mais velho, filtra erro e SDR, sem o prompt', async () => {
    const { agent, lead } = await agentAndLead();
    const run = (error: string | null) =>
      repos.aiRuns.create({
        sdrAgentId: agent.id,
        leadId: lead.id,
        conversationId: null,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        purpose: 'reply_generation',
        inputMessages: 'prompt enorme',
        outputText: 'ok',
        parsedJson: '{}',
        error,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        promptCacheHitTokens: null,
        latencyMs: 10,
      });
    await run(null);
    await run('HTTP 500');
    const job = (status: string, jobKey: string, sdrAgentId: string | null) =>
      repos.jobLogs.create({
        jobName: 'initial-outreach',
        jobKey,
        sdrAgentId,
        leadId: null,
        status,
        attempt: 1,
        payload: null,
        result: null,
        error: status === 'failed' ? 'x' : null,
        startedAt: null,
        finishedAt: null,
      });
    for (let index = 0; index < 5; index += 1) await job('completed', `ok-${index}`, agent.id);
    await job('failed', 'falhou', agent.id);
    await job('failed', 'sem-sdr', null);
    await repos.webhooks.create({ sdrAgentId: agent.id, rawBody: '{}', processingStatus: 'processed' } as never);
    await repos.webhooks.create({ sdrAgentId: agent.id, rawBody: '{}', processingStatus: 'failed', processingError: 'boom' } as never);

    const runs = await repos.aiRuns.listRecent({}, 10, 0);
    const runErrors = await repos.aiRuns.listRecent({ onlyErrors: true }, 10, 0);
    const page1 = await repos.jobLogs.listRecent({ sdrAgentId: agent.id }, 3, 0);
    const page2 = await repos.jobLogs.listRecent({ sdrAgentId: agent.id }, 3, 3);
    const jobErrors = await repos.jobLogs.listRecent({ onlyErrors: true }, 10, 0);
    const webhookErrors = await repos.webhooks.listRecent({ onlyErrors: true, sdrAgentId: agent.id }, 10, 0);

    expect(runs).toHaveLength(2);
    expect(runs[0]).not.toHaveProperty('inputMessages');
    expect(runs[0]).not.toHaveProperty('parsedJson');
    expect(runErrors.map((item) => item.error)).toEqual(['HTTP 500']);
    expect(page1.map((log) => log.jobKey)).toEqual(['falhou', 'ok-4', 'ok-3']);
    expect(page2.map((log) => log.jobKey)).toEqual(['ok-2', 'ok-1', 'ok-0']);
    expect(jobErrors.map((log) => log.jobKey)).toEqual(['sem-sdr', 'falhou']);
    expect(webhookErrors.map((event) => event.processingError)).toEqual(['boom']);
  });

  it('as migracoes estao todas no journal', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThan(30);
  });
});
