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
      repos.sql`truncate table messages, conversations, job_logs, ai_runs, webhook_events, lead_research, lead_imports, instance_share_links, sdr_connection_events, sdr_connection_states, leads, first_message_variants, sdr_agents, companies cascade`,
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

  it('historico de conexao grava e lista em ordem', async () => {
    const { agent } = await agentAndLead();
    const t0 = new Date('2026-09-29T18:00:00.000Z');
    await repos.monitors.recordConnectionEvent({ sdrAgentId: agent.id, status: 'disconnected', reason: 'same number connected', occurredAt: new Date(t0.getTime() + MINUTE) });
    await repos.monitors.recordConnectionEvent({ sdrAgentId: agent.id, status: 'connected', reason: null, occurredAt: t0 });

    const events = await repos.monitors.listConnectionEvents(new Date(t0.getTime() - MINUTE));

    expect(events.map((event) => event.status)).toEqual(['connected', 'disconnected']);
  });

  it('as migracoes estao todas no journal', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] };
    expect(journal.entries.length).toBeGreaterThan(30);
  });
});
