import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { buildDashboardViewModel } from '../src/modules/dashboard/dashboard-view-model.js';
import { clearMilestone, hasOutcome, markMilestone, type LeadOutcome } from '../src/modules/leads/lead-outcome.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

const vazio: LeadOutcome = { meetingAt: null, trialStartedAt: null, wonAt: null, lostAt: null, lostReason: null };
const SEG = new Date('2026-10-05T15:00:00.000Z');
const TER = new Date('2026-10-06T15:00:00.000Z');

describe('regras do desfecho', () => {
  it('marcar de novo nao muda a data da primeira vez', () => {
    const uma = markMilestone(vazio, 'meeting', SEG);
    const duas = markMilestone(uma, 'meeting', TER);

    expect(duas.meetingAt).toEqual(SEG);
  });

  it('cliente e perdido se excluem', () => {
    const perdido = markMilestone(vazio, 'lost', SEG, 'achou caro');
    expect(perdido.lostReason).toBe('achou caro');

    const voltou = markMilestone(perdido, 'won', TER);
    expect(voltou.wonAt).toEqual(TER);
    expect(voltou.lostAt).toBeNull();
    expect(voltou.lostReason).toBeNull();

    expect(markMilestone(voltou, 'lost', TER).wonAt).toBeNull();
  });

  it('desfazer limpa so o marco escolhido', () => {
    const tudo = markMilestone(markMilestone(vazio, 'meeting', SEG), 'trial', TER);

    const semTeste = clearMilestone(tudo, 'trial');

    expect(semTeste.trialStartedAt).toBeNull();
    expect(semTeste.meetingAt).toEqual(SEG);
    expect(hasOutcome(semTeste)).toBe(true);
    expect(hasOutcome(clearMilestone(semTeste, 'meeting'))).toBe(false);
  });
});

async function loggedInApp() {
  const authRepository = createMemoryAuthRepository();
  await authRepository.createUser({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('segredo123'),
    role: 'admin',
  });
  const leadRepository = createMemoryLeadRepository();
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const companyRepository = createMemoryCompanyRepository();
  const agent = await sdrAgentRepository.create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });
  const lead = await leadRepository.create({
    companyId: 'c1',
    sdrAgentId: agent.id,
    whatsappNumber: '5513999990000',
    companyName: 'Fit013 Marmitas',
    status: 'in_conversation',
    source: 'manual',
  });
  await leadRepository.markTransferred(lead.id, new Date(), 'Quer o teste de 3 dias');

  const app = buildApp({ authRepository, companyRepository, leadRepository, sdrAgentRepository });
  const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
  const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
  return { app, cookie, lead, leadRepository };
}

describe('tela do lead', () => {
  it('mostra o painel e marca o desfecho', async () => {
    const { app, cookie, lead, leadRepository } = await loggedInApp();

    const page = await app.inject({ method: 'GET', url: `/leads/${lead.id}`, headers: { cookie } });
    expect(page.body).toContain('Depois do handoff');
    expect(page.body).toContain('Reuniao marcada');

    const marcar = await app.inject({
      method: 'POST',
      url: `/leads/${lead.id}/desfecho`,
      headers: { cookie },
      payload: { marco: 'meeting' },
    });
    expect(marcar.statusCode).toBe(302);
    expect((await leadRepository.findById(lead.id))?.meetingAt).toBeInstanceOf(Date);
    // O desfecho nao mexe no status: o lead continua transferido.
    expect((await leadRepository.findById(lead.id))?.status).toBe('transferred');

    await app.inject({ method: 'POST', url: `/leads/${lead.id}/desfecho`, headers: { cookie }, payload: { marco: 'lost', motivo: 'ja usa outro sistema' } });
    expect((await leadRepository.findById(lead.id))?.lostReason).toBe('ja usa outro sistema');

    await app.inject({ method: 'POST', url: `/leads/${lead.id}/desfecho`, headers: { cookie }, payload: { marco: 'meeting', desfazer: '1' } });
    expect((await leadRepository.findById(lead.id))?.meetingAt).toBeNull();
    await app.close();
  });

  it('recusa marco que nao existe', async () => {
    const { app, cookie, lead, leadRepository } = await loggedInApp();

    await app.inject({ method: 'POST', url: `/leads/${lead.id}/desfecho`, headers: { cookie }, payload: { marco: 'vendido' } });

    const saved = await leadRepository.findById(lead.id);
    expect(hasOutcome(saved ?? vazio)).toBe(false);
    await app.close();
  });

  it('exige login', async () => {
    const { app, lead } = await loggedInApp();

    const response = await app.inject({ method: 'POST', url: `/leads/${lead.id}/desfecho`, payload: { marco: 'won' } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    await app.close();
  });
});

describe('painel cobra o desfecho', () => {
  async function model(handoffDaysAgo: number, outcome: Partial<LeadOutcome> = {}) {
    const leadRepository = createMemoryLeadRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });
    const now = new Date('2026-10-10T15:00:00.000Z');
    const lead = await leadRepository.create({
      companyId: 'c1',
      sdrAgentId: agent.id,
      whatsappNumber: '5513999990000',
      companyName: 'Fit013 Marmitas',
      status: 'in_conversation',
      source: 'manual',
    });
    await leadRepository.markTransferred(lead.id, new Date(now.getTime() - handoffDaysAgo * 24 * 60 * 60000), 'resumo');
    await leadRepository.setOutcome(lead.id, { ...vazio, ...outcome }, now);

    return buildDashboardViewModel({
      aiRuns: [],
      companies: [],
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: '7d', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: await leadRepository.list(),
      messages: [],
      now,
      sdrAgents: await sdrAgentRepository.list(),
      userLabel: 'Admin',
    });
  }

  it('avisa do handoff de dias atras sem nada marcado', async () => {
    expect((await model(5)).alerts.join(' ')).toContain('1 handoff(s) de mais de 3 dias sem desfecho marcado: Fit013 Marmitas');
  });

  it('nao cobra quem ja tem desfecho, nem o handoff de ontem', async () => {
    expect((await model(5, { meetingAt: new Date() })).alerts.join(' ')).not.toContain('sem desfecho');
    expect((await model(1)).alerts.join(' ')).not.toContain('sem desfecho');
  });
});
