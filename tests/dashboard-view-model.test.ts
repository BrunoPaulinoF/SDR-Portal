import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDashboardViewModel } from '../src/modules/dashboard/dashboard-view-model.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository, type LeadInput } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

function leadInput(companyId: string, sdrAgentId: string, companyName: string, whatsappNumber: string): LeadInput {
  return {
    companyId,
    sdrAgentId,
    whatsappNumber,
    companyName,
    cnpj: null,
    tradeName: null,
    segment: null,
    city: null,
    state: null,
    contactName: null,
    extraData: null,
    status: 'pending',
    source: 'manual',
  };
}

describe('dashboard view model timezone handling', () => {
  it('formats last send and daily counter using the SDR timezone', async () => {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: null,
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'kyane',
      displayName: 'Kyane',
      isActive: true,
      timezone: 'America/Sao_Paulo',
      sendWindowStart: '07:00',
      sendWindowEnd: '18:00',
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      dailyInitialSendLimit: 40,
    });
    const sentToday = await leadRepository.create(leadInput(company.id, agent.id, 'Lead Hoje', '5511999999999'));
    const sentYesterdayLocal = await leadRepository.create(leadInput(company.id, agent.id, 'Lead Ontem', '5511888888888'));

    await leadRepository.markInitialSent(sentToday.id, new Date('2026-05-22T20:43:00.000Z'), null);
    await leadRepository.markInitialSent(sentYesterdayLocal.id, new Date('2026-05-22T02:30:00.000Z'), null);

    const model = buildDashboardViewModel({
      aiRuns: [],
      companies: await companyRepository.list(),
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: 'all', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: await leadRepository.list(),
      messages: [],
      now: new Date('2026-05-22T21:05:00.000Z'),
      sdrAgents: await sdrAgentRepository.list(),
      userLabel: 'Admin',
    });

    expect(model.dispatchRows[0]?.lastSentLabel).toBe('22/05, 17:43');
    expect(model.dispatchRows[0]?.sendLimitLabel).toBe('1/40');
  });
});

describe('dashboard stall detection', () => {
  /**
   * O incidente de 25/08: a instancia da Insumo Smart deslogou do WhatsApp e o portal seguiu
   * mostrando o SDR como "Pronto" por dois dias, porque nada no banco contradizia a fila cheia
   * e a janela aberta. O sinal esta na diferenca entre estar liberado e nao ter enviado nada.
   */
  async function buildModel(minutesSinceLastSend: number, cooldownMaxMinutes = 0) {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const now = new Date('2026-08-27T14:00:00.000Z');
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: null,
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'francielly',
      displayName: 'Francielly',
      isActive: true,
      timezone: 'America/Sao_Paulo',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      dailyInitialSendLimit: 40,
      initialCooldownMinMinutes: 0,
      initialCooldownMaxMinutes: cooldownMaxMinutes,
      uazapiBaseUrl: 'https://kybernan.uazapi.com',
      uazapiInstanceTokenEncrypted: 'v1:token-falso',
    });
    const sent = await leadRepository.create(leadInput(company.id, agent.id, 'Ja Abordado', '5511999999999'));
    await leadRepository.create(leadInput(company.id, agent.id, 'Na Fila', '5511888888888'));
    await leadRepository.markInitialSent(sent.id, new Date(now.getTime() - minutesSinceLastSend * 60 * 1000), null);

    return buildDashboardViewModel({
      aiRuns: [],
      companies: await companyRepository.list(),
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: 'all', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: await leadRepository.list(),
      messages: [],
      now,
      sdrAgents: await sdrAgentRepository.list(),
      userLabel: 'Admin',
    });
  }

  it('marca como parado o SDR liberado que nao envia ha horas', async () => {
    const model = await buildModel(40 * 60);

    expect(model.dispatchRows[0]?.statusLabel).toBe('Parado');
    expect(model.dispatchRows[0]?.status).toBe('blocked');
    expect(model.dispatchRows[0]?.detail).toContain('Conectar');
    expect(model.actions[0]).toMatchObject({ tone: 'urgent', title: 'Francielly parou de enviar', label: 'Ver WhatsApp' });
    expect(model.actions[0]?.href).toMatch(/\/sdr-agents\/.+\/edit\?aba=whatsapp$/);
  });

  it('nao acusa parada dentro da folga do piso', async () => {
    const model = await buildModel(60);

    expect(model.dispatchRows[0]?.statusLabel).toBe('Pronto');
    expect(model.actions.some((action) => action.title.includes('parou de enviar'))).toBe(false);
  });

  // Cooldown longo nao pode virar alarme sozinho: o corte anda junto com ele.
  it('respeita o cooldown do SDR antes de acusar parada', async () => {
    const comFolga = await buildModel(200, 240);
    expect(comFolga.dispatchRows[0]?.statusLabel).toBe('Cooldown flexivel');

    const travado = await buildModel(600, 240);
    expect(travado.dispatchRows[0]?.statusLabel).toBe('Parado');
  });
});

describe('dashboard: resposta de gente e capacidade do dia', () => {
  const now = new Date('2026-09-08T18:00:00.000Z');

  // Os repositorios em memoria carimbam createdAt com o relogio real, e o dashboard ignora o que
  // vem depois de `now`. Sem congelar o relogio no `now` do cenario, a mensagem do lead nasce "no
  // futuro" assim que a data real passa dele, e o teste quebra sozinho com o calendario.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function buildScenario(agentOverrides: Record<string, unknown> = {}) {
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const conversationRepository = createMemoryConversationRepository();
    const company = await companyRepository.create({
      name: 'KyberFood',
      legalName: null,
      cnpj: null,
      segment: null,
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'mariana',
      displayName: 'Mariana',
      isActive: true,
      timezone: 'America/Sao_Paulo',
      sendWindowStart: '08:00',
      sendWindowEnd: '20:00',
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      dailyInitialSendLimit: 40,
      initialCooldownMinMinutes: 5,
      initialCooldownMaxMinutes: 15,
      uazapiBaseUrl: 'https://kybernan.uazapi.com',
      uazapiInstanceTokenEncrypted: 'v1:token-falso',
      ...agentOverrides,
    });

    return { agent, company, companyRepository, conversationRepository, leadRepository, now, sdrAgentRepository };
  }

  async function inboundLead(
    scenario: Awaited<ReturnType<typeof buildScenario>>,
    companyName: string,
    whatsappNumber: string,
    autoReply: boolean,
  ) {
    const lead = await scenario.leadRepository.create(leadInput(scenario.company.id, scenario.agent.id, companyName, whatsappNumber));
    await scenario.leadRepository.markInitialSent(lead.id, new Date(scenario.now.getTime() - 60 * 60 * 1000), null);
    const conversation = await scenario.conversationRepository.create({
      companyId: scenario.company.id,
      sdrAgentId: scenario.agent.id,
      leadId: lead.id,
      whatsappNumber,
      status: 'open',
      lastMessageAt: scenario.now,
    });
    await scenario.conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: lead.id,
      sdrAgentId: scenario.agent.id,
      direction: 'inbound',
      senderType: 'lead',
      messageType: 'conversation',
      text: autoReply ? 'Seja bem-vindo! Confira o cardapio: https://loja.app' : 'sou eu mesmo, sobre o que seria?',
      autoReply,
    });
    return lead;
  }

  /**
   * A tela dizia 60% de resposta numa caixa em que gente respondeu 27%: o robo da loja entrava
   * na conta e escondia o resultado real de qualquer mudanca de abordagem.
   */
  it('conta so a resposta de gente na taxa de resposta', async () => {
    const scenario = await buildScenario();
    await inboundLead(scenario, 'Pizzaria Robo', '5511999999999', true);
    await inboundLead(scenario, 'Hamburgueria Gente', '5511888888888', false);

    const model = buildDashboardViewModel({
      aiRuns: [],
      companies: await scenario.companyRepository.list(),
      conversations: await scenario.conversationRepository.list(),
      filters: { activeOnly: true, companyId: '', period: 'all', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: await scenario.leadRepository.list(),
      messages: await scenario.conversationRepository.listAllMessages(),
      now: scenario.now,
      sdrAgents: await scenario.sdrAgentRepository.list(),
      userLabel: 'Admin',
    });

    expect(model.metrics.find((metric) => metric.label === 'Responderam')?.value).toBe('1');
    expect(model.metrics.find((metric) => metric.label === 'Taxa de resposta')?.value).toBe('50%');
    expect(model.companyRows[0]?.responded).toBe(1);
  });

  async function alertsFor(agentOverrides: Record<string, unknown>) {
    const scenario = await buildScenario(agentOverrides);
    const model = buildDashboardViewModel({
      aiRuns: [],
      companies: await scenario.companyRepository.list(),
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: 'all', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: await scenario.leadRepository.list(),
      messages: [],
      now: scenario.now,
      sdrAgents: await scenario.sdrAgentRepository.list(),
      userLabel: 'Admin',
    });
    return model.actions.map((action) => action.title);
  }

  // Janela curta com cooldown longo nunca chega ao limite: sem o aviso, o SDR parece "sem fila".
  it('avisa quando a janela nao comporta o limite diario', async () => {
    const apertado = await alertsFor({ sendWindowStart: '15:00', sendWindowEnd: '21:00' });
    expect(apertado.some((alert) => alert.includes('Limite diario acima do que a janela permite'))).toBe(true);

    const folgado = await alertsFor({ sendWindowStart: '08:00', sendWindowEnd: '20:00' });
    expect(folgado.some((alert) => alert.includes('Limite diario acima do que a janela permite'))).toBe(false);
  });

  // A conta que a migracao 0027 usa para escolher quem recebe o cooldown de 4-14min: na mesma
  // janela de 360min em que 5-15 parava em ~37, a media de 9 passa dos 40 configurados. Se esta
  // aritmetica mudar, a migracao passa a apertar o espacamento sem entregar o limite.
  it('4-14min de cooldown fazem a janela de 15h as 21h comportar os 40 do limite', async () => {
    const alerts = await alertsFor({
      sendWindowStart: '15:00',
      sendWindowEnd: '21:00',
      initialCooldownMinMinutes: 4,
      initialCooldownMaxMinutes: 14,
    });
    expect(alerts.some((alert) => alert.includes('Limite diario acima do que a janela permite'))).toBe(false);
  });
});

describe('alertas de lead com interesse', () => {
  async function buildModel(options: { minutesSinceActivity: number; failedNotice?: boolean }) {
    const { HANDOFF_NOTICE_JOB } = await import('../src/modules/ai/ai-response-service.js');
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const now = new Date('2026-09-29T22:00:00.000Z');
    const company = await companyRepository.create({
      name: 'Kybernan',
      legalName: null,
      cnpj: null,
      segment: null,
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Mariana', displayName: 'Mariana', isActive: true });
    const lead = await leadRepository.create({ ...leadInput(company.id, agent.id, 'Fit013 Marmitas', '5513999990000'), status: 'in_conversation' });
    const activityAt = new Date(now.getTime() - options.minutesSinceActivity * 60000);
    await leadRepository.markInboundReceived(lead.id, activityAt);
    await leadRepository.updateStage(lead.id, 'handoff_offer', activityAt);

    return buildDashboardViewModel({
      aiRuns: [],
      companies: await companyRepository.list(),
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: '7d', sdrAgentId: '', stage: '', status: '' },
      jobLogs: options.failedNotice
        ? [
            {
              id: 'log-1',
              jobName: HANDOFF_NOTICE_JOB,
              jobKey: `handoff-${lead.id}`,
              sdrAgentId: agent.id,
              leadId: lead.id,
              status: 'failed',
              attempt: 3,
              payload: null,
              result: null,
              error: 'UAZAPI returned HTTP 503',
              startedAt: now,
              finishedAt: now,
              createdAt: new Date(now.getTime() - 60000),
            },
          ]
        : [],
      leads: await leadRepository.list(),
      messages: [],
      now,
      sdrAgents: await sdrAgentRepository.list(),
      userLabel: 'Admin',
    });
  }

  it('avisa do lead parado na oferta de handoff ha mais de duas horas', async () => {
    const model = await buildModel({ minutesSinceActivity: 6 * 60 });

    const action = model.actions.find((item) => item.title.includes('esperando ha mais de 2h na oferta de handoff'));
    expect(action?.tone).toBe('urgent');
    expect(action?.items?.map((item) => item.label)).toEqual(['Fit013 Marmitas']);
    expect(action?.items?.[0]?.href).toMatch(/^\/leads\/.+/);
  });

  it('esquece a oferta velha: alerta que nunca sai da tela vira paisagem', async () => {
    const model = await buildModel({ minutesSinceActivity: 20 * 24 * 60 });

    expect(model.actions.some((action) => action.title.includes('oferta de handoff'))).toBe(false);
  });

  it('nao avisa enquanto a oferta ainda e recente', async () => {
    const model = await buildModel({ minutesSinceActivity: 30 });

    expect(model.actions.some((action) => action.title.includes('oferta de handoff'))).toBe(false);
  });

  it('avisa quando o aviso de handoff nao chegou a ninguem', async () => {
    const model = await buildModel({ minutesSinceActivity: 30, failedNotice: true });

    const action = model.actions.find((item) => item.title === '1 aviso(s) de handoff nao chegaram a quem atende');
    expect(action).toMatchObject({ tone: 'urgent', href: '/job-logs' });
    expect(action?.items?.map((item) => item.label)).toEqual(['Fit013 Marmitas']);
  });
});

describe('funil da safra', () => {
  it('conta cada degrau sobre os abordados e sobre o degrau anterior', async () => {
    const { buildCohortFunnel } = await import('../src/modules/dashboard/dashboard-view-model.js');
    const leadRepository = createMemoryLeadRepository();
    const make = async (name: string) => leadRepository.create({ ...leadInput('c1', 'sdr-1', name, `55119${name.length}000000`), status: 'initial_sent' });
    const [mudo, robo, gente, proposta, cliente] = await Promise.all([
      make('Mudo'),
      make('So robo'),
      make('Gente'),
      make('Proposta'),
      make('Cliente'),
    ]);
    await leadRepository.updateStage(proposta.id, 'solution', new Date());
    await leadRepository.markTransferred(cliente.id, new Date(), 'resumo');
    await leadRepository.setOutcome(
      cliente.id,
      { meetingAt: null, trialStartedAt: null, wonAt: new Date(), lostAt: null, lostReason: null },
      new Date(),
    );
    const cohort = (await leadRepository.list()).filter((lead) => [mudo, robo, gente, proposta, cliente].some((item) => item.id === lead.id));

    // "So robo" recebeu so automatica: fica fora de "gente respondeu".
    const { rows } = buildCohortFunnel(cohort, new Set([gente.id]));
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));

    expect(byLabel['Abordados']?.count).toBe(5);
    expect(byLabel['Gente respondeu']?.count).toBe(3);
    expect(byLabel['Ouviu a proposta']?.count).toBe(2);
    expect(byLabel['Handoff']?.count).toBe(1);
    // Cliente fechado sem reuniao marcada conta nos degraus de antes: o funil nao sobe.
    expect(byLabel['Reuniao marcada']?.count).toBe(1);
    expect(byLabel['Virou cliente']?.count).toBe(1);
    expect(byLabel['Virou cliente']?.percentOfBase).toBe(20);
    expect(byLabel['Ouviu a proposta']?.percentOfPrevious).toBe(67);
    expect(byLabel['Abordados']?.percentOfPrevious).toBeNull();
  });
});
