import { describe, expect, it } from 'vitest';

import { buildDashboardViewModel } from '../src/modules/dashboard/dashboard-view-model.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
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
