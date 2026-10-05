import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import type { SdrAgent, SdrConnectionEvent } from '../src/db/schema.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { buildDashboardViewModel, type DashboardFilters } from '../src/modules/dashboard/dashboard-view-model.js';
import { createMemoryLeadRepository, type LeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';

const HOUR = 60 * 60000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-05T18:00:00.000Z');
const filters: DashboardFilters = { activeOnly: true, companyId: '', period: '7d', sdrAgentId: '', stage: '', status: '' };

const apps: AppInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function cenario() {
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const leadRepository = createMemoryLeadRepository();
  const comWhatsapp = { uazapiBaseUrl: 'https://uazapi.test', uazapiInstanceTokenEncrypted: encryptSecret('token') };
  const sempreAberto = { sendDaysOfWeek: '0,1,2,3,4,5,6', sendWindowStart: '00:00', sendWindowEnd: '23:59', initialCooldownMinMinutes: 1, initialCooldownMaxMinutes: 2 };
  const mariana = await sdrAgentRepository.create({ companyId: 'company-1', name: 'Mariana', displayName: 'Mariana', isActive: true, ...comWhatsapp, ...sempreAberto });
  const fran = await sdrAgentRepository.create({ companyId: 'company-1', name: 'Francielly', displayName: 'Francielly', isActive: true, ...sempreAberto });
  return { sdrAgentRepository, leadRepository, mariana, fran };
}

async function pendentes(leadRepository: LeadRepository, agent: SdrAgent, quantos: number) {
  for (let index = 0; index < quantos; index += 1) {
    await leadRepository.create({
      companyId: agent.companyId,
      sdrAgentId: agent.id,
      whatsappNumber: `55199${agent.name.length}${String(100000 + index)}`,
      companyName: `${agent.name} lead ${index}`,
      status: 'pending',
      source: 'import',
    });
  }
}

function modelo(input: { agents: SdrAgent[]; leadRepository: LeadRepository; connectionEvents?: SdrConnectionEvent[] }) {
  return input.leadRepository.list().then((leads) =>
    buildDashboardViewModel({
      aiRuns: [],
      companies: [{ id: 'company-1', name: 'KyberFood', segment: null, createdAt: NOW, updatedAt: NOW } as never],
      connectionEvents: input.connectionEvents,
      conversations: [],
      filters,
      jobLogs: [],
      leads,
      messages: [],
      now: NOW,
      sdrAgents: input.agents,
      userLabel: 'Admin',
    }),
  );
}

describe('Precisa de voce agora', () => {
  it('so entra o que pede acao, urgente primeiro, cada um com o botao para o lugar certo', async () => {
    const { leadRepository, mariana, fran } = await cenario();
    await pendentes(leadRepository, mariana, 30);
    const queda: SdrConnectionEvent[] = [
      { id: 'e1', sdrAgentId: mariana.id, status: 'connected', reason: null, occurredAt: new Date(NOW.getTime() - 10 * DAY), createdAt: NOW },
      { id: 'e2', sdrAgentId: mariana.id, status: 'disconnected', reason: '401', occurredAt: new Date(NOW.getTime() - 3 * HOUR), createdAt: NOW },
    ];

    const model = await modelo({ agents: [mariana, fran], leadRepository, connectionEvents: queda });

    expect(model.actions.map((action) => [action.tone, action.title, action.href])).toEqual([
      ['urgent', 'WhatsApp de Mariana fora do ar ha 3h', `/sdr-agents/${mariana.id}/conectar`],
      ['urgent', 'Francielly esta sem WhatsApp configurado', `/sdr-agents/${fran.id}/edit?aba=whatsapp`],
      ['urgent', 'Francielly ficou sem leads na fila', '/leads/import'],
      ['attention', 'Mariana tem so 30 lead(s) na fila', '/leads/import'],
    ]);
    // "Pronto para chamar o proximo lead" e informacao: vai para Relatorios, nao para a caixa de acoes.
    expect(model.actions.some((action) => action.title.includes('pronto'))).toBe(false);
  });

  it('um aviso por SDR: sem WhatsApp configurado, "fora do ar" nao repete o mesmo problema', async () => {
    const { leadRepository, fran } = await cenario();
    await pendentes(leadRepository, fran, 120);
    const queda: SdrConnectionEvent[] = [
      { id: 'e1', sdrAgentId: fran.id, status: 'connected', reason: null, occurredAt: new Date(NOW.getTime() - 10 * DAY), createdAt: NOW },
      { id: 'e2', sdrAgentId: fran.id, status: 'disconnected', reason: '401', occurredAt: new Date(NOW.getTime() - 3 * HOUR), createdAt: NOW },
    ];

    const model = await modelo({ agents: [fran], leadRepository, connectionEvents: queda });

    expect(model.actions.map((action) => action.title)).toEqual(['Francielly esta sem WhatsApp configurado']);
  });

  it('com tudo em ordem a caixa fica vazia', async () => {
    const { leadRepository, mariana } = await cenario();
    await pendentes(leadRepository, mariana, 120);

    const model = await modelo({ agents: [mariana], leadRepository });

    expect(model.actions).toEqual([]);
    expect(model.notes).toContain('1 SDR(s) pronto(s) para chamar o proximo lead.');
  });
});

describe('cartoes dos SDRs e numeros do periodo', () => {
  it('cada SDR ativo ganha um cartao com WhatsApp, envios do dia, fila e o que vem a seguir', async () => {
    const { leadRepository, mariana, fran } = await cenario();
    await pendentes(leadRepository, mariana, 3);
    const [primeiro] = await leadRepository.list();
    await leadRepository.markInitialSent(primeiro!.id, new Date(NOW.getTime() - 30 * 60000));
    const queda: SdrConnectionEvent[] = [
      { id: 'e1', sdrAgentId: mariana.id, status: 'connected', reason: null, occurredAt: new Date(NOW.getTime() - 10 * DAY), createdAt: NOW },
    ];

    const model = await modelo({ agents: [mariana, fran, { ...fran, id: 'pausado', isActive: false }], leadRepository, connectionEvents: queda });

    expect(model.sdrCards.map((card) => card.name)).toEqual(['Mariana', 'Francielly']);
    expect(model.sdrCards[0]).toMatchObject({ statusLabel: 'Pronto', whatsappLabel: '100% em 7 dias', whatsappTone: 'ok', sentLabel: '1 de 40', pending: 2 });
    expect(model.sdrCards[1]).toMatchObject({ statusLabel: 'Config incompleta', whatsappLabel: 'Sem leitura', whatsappTone: 'neutral' });
  });

  it('os 4 numeros saem da safra do funil, para os dois nunca divergirem', async () => {
    const { leadRepository, mariana } = await cenario();
    await pendentes(leadRepository, mariana, 4);
    const leads = await leadRepository.list();
    for (const lead of leads) await leadRepository.markInitialSent(lead.id, new Date(NOW.getTime() - 2 * DAY));
    await leadRepository.markInboundReceived(leads[0]!.id, new Date(NOW.getTime() - DAY));
    await leadRepository.markInboundReceived(leads[1]!.id, new Date(NOW.getTime() - DAY));
    await leadRepository.markTransferred(leads[0]!.id, new Date(NOW.getTime() - DAY), 'quer teste');
    await leadRepository.setOutcome(leads[0]!.id, { meetingAt: null, trialStartedAt: null, wonAt: NOW, lostAt: null, lostReason: null }, NOW);

    const model = await modelo({ agents: [mariana], leadRepository });

    expect(model.headline.map((item) => [item.label, item.value])).toEqual([
      ['Abordados', '4'],
      ['Gente respondeu', '2'],
      ['Handoffs', '1'],
      ['Viraram cliente', '1'],
    ]);
    expect(model.headline[1]?.help).toContain('50% dos abordados');
  });
});

describe('Painel e Relatorios nas rotas', () => {
  async function app() {
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'KyberFood' });
    const { sdrAgentRepository, leadRepository, mariana, fran } = await cenario();
    await sdrAgentRepository.update(mariana.id, { ...mariana, companyId: company.id });
    await sdrAgentRepository.update(fran.id, { ...fran, companyId: company.id });
    const instance = buildApp({ authRepository, companyRepository, leadRepository, sdrAgentRepository });
    apps.push(instance);
    const login = await instance.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
    return { instance, cookie, mariana, fran };
  }

  it('o Painel nao aceita filtro de SDR: aviso de quem ficou de fora do filtro nao pode sumir', async () => {
    const { instance, cookie, mariana, fran } = await app();

    const page = await instance.inject({ method: 'GET', url: `/dashboard?sdrAgentId=${mariana.id}&period=today`, headers: { cookie } });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Precisa de voce agora');
    expect(page.body).toContain('Francielly esta sem WhatsApp configurado');
    expect(page.body).toContain(`href="/sdr-agents/${fran.id}/edit?aba=whatsapp">Configurar</a>`);
    expect(page.body).toContain('class="chip chip-active" href="/dashboard?period=today"');
    expect(page.body).toContain('<a class="nav-link nav-active" href="/dashboard">Painel</a>');
    expect(page.body).not.toContain('name="sdrAgentId"');
  });

  it('Relatorios tem os filtros completos e as tabelas que sairam do Painel', async () => {
    const { instance, cookie, mariana } = await app();

    const page = await instance.inject({ method: 'GET', url: `/relatorios?sdrAgentId=${mariana.id}`, headers: { cookie } });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<form method="get" action="/relatorios"');
    expect(page.body).toContain('Proximos disparos por SDR');
    expect(page.body).toContain('Funil da safra');
    expect(page.body).toContain('<a class="nav-link nav-active" href="/relatorios">Relatorios</a>');
    // Filtro de SDR vale aqui.
    expect(page.body).not.toContain('<td>Francielly</td>');
  });

  it('Relatorios pede login', async () => {
    const { instance } = await app();

    const page = await instance.inject({ method: 'GET', url: '/relatorios' });

    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/login');
  });
});
