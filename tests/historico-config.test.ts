import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemorySdrConfigChangeRepository, diffAgentConfig } from '../src/modules/sdr-agents/config-history.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

describe('diferenca de configuracao', () => {
  it('pega so o que mudou, sem segredo e sem espaco no fim', async () => {
    const agent = await createMemorySdrAgentRepository().create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      isActive: true,
      prompt: 'prompt antigo',
      aiModel: 'deepseek-v4-pro',
    });

    const changes = diffAgentConfig(
      agent,
      { prompt: 'prompt antigo  ', aiModel: 'deepseek-v4-flash', dailyInitialSendLimit: agent.dailyInitialSendLimit },
      'portal:admin@example.com',
    );

    expect(changes).toEqual([
      { sdrAgentId: agent.id, field: 'aiModel', before: 'deepseek-v4-pro', after: 'deepseek-v4-flash', changedBy: 'portal:admin@example.com' },
    ]);
  });
});

describe('a tela registra quem mudou o que', () => {
  it('variante criada, pausada e o modo da primeira mensagem entram no historico', async () => {
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const companyRepository = createMemoryCompanyRepository();
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
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Mariana', displayName: 'Mariana', isActive: true });
    const firstMessageVariantRepository = createMemoryFirstMessageVariantRepository();
    const configChangeRepository = createMemorySdrConfigChangeRepository();
    const app = buildApp({ authRepository, companyRepository, configChangeRepository, firstMessageVariantRepository, sdrAgentRepository });
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;

    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}/first-messages`,
      headers: { cookie },
      payload: { label: 'Nao e pedido', body: 'oi, aqui e a Mariana', isActive: 'on' },
    });
    const [variant] = await firstMessageVariantRepository.listForAgent(agent.id);
    await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/first-messages/${variant?.id}/toggle`, headers: { cookie } });
    await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/first-message-mode`, headers: { cookie }, payload: { mode: 'ab_test' } });

    const history = await configChangeRepository.listForAgent(agent.id, 10);
    expect(history.map((change) => [change.field, change.after])).toEqual([
      ['firstMessageMode', 'ab_test'],
      ['variante:Nao e pedido', '[pausada] oi, aqui e a Mariana'],
      ['variante:Nao e pedido', '[ativa] oi, aqui e a Mariana'],
    ]);
    expect(history.every((change) => change.changedBy === 'portal:admin@example.com')).toBe(true);

    const page = await app.inject({ method: 'GET', url: `/sdr-agents/${agent.id}/edit`, headers: { cookie } });
    expect(page.body).toContain('Historico de mudancas');
    expect(page.body).toContain('variante:Nao e pedido');
    await app.close();
  });
});
