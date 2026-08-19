import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AiClient, AiGenerateInput } from '../src/modules/ai/ai-client.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import {
  createMemoryInstanceShareLinkRepository,
  generateShareToken,
  hashShareToken,
  isShareLinkUsable,
  shareLinkExpiresAt,
  shareLinkTtlMinutes,
} from '../src/modules/uazapi/instance-share-link-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const ok = (body: unknown): UazapiResult => ({ ok: true, status: 200, body });

function stubUazapiClient(overrides: Partial<UazapiClient> = {}): UazapiClient {
  const notCalled = (): Promise<UazapiResult> => Promise.resolve(ok({}));
  return {
    checkChats: notCalled,
    configureWebhook: notCalled,
    connectInstance: notCalled,
    createInstance: notCalled,
    downloadMessage: notCalled,
    getInstanceStatus: notCalled,
    sendContact: notCalled,
    sendPresence: notCalled,
    sendText: notCalled,
    ...overrides,
  };
}

async function loggedInApp(options: Parameters<typeof buildApp>[0] = {}) {
  const authRepository = createMemoryAuthRepository();
  await authRepository.createUser({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('segredo123'),
    role: 'admin',
  });
  const app = buildApp({ authRepository, ...options });
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'segredo123' },
  });
  const cookie = login.cookies[0];
  return { app, cookie: `${cookie?.name}=${cookie?.value}` };
}

describe('limpeza de leads em massa', () => {
  it('apaga apenas os status escolhidos do SDR escolhido', async () => {
    const leads = createMemoryLeadRepository();
    const base = { companyId: 'c1', whatsappNumber: '5519999999999', companyName: 'Lead', source: 'manual' };
    await leads.create({ ...base, sdrAgentId: 'sdr-1', status: 'pending' });
    await leads.create({ ...base, sdrAgentId: 'sdr-1', status: 'pending' });
    await leads.create({ ...base, sdrAgentId: 'sdr-1', status: 'in_conversation' });
    await leads.create({ ...base, sdrAgentId: 'sdr-2', status: 'pending' });

    const removed = await leads.deleteBySdrAndStatuses('sdr-1', ['pending']);

    expect(removed).toBe(2);
    const rest = await leads.list();
    expect(rest).toHaveLength(2);
    expect(rest.every((lead) => !(lead.sdrAgentId === 'sdr-1' && lead.status === 'pending'))).toBe(true);
  });

  it('nao apaga nada quando nenhum status e enviado', async () => {
    const leads = createMemoryLeadRepository();
    await leads.create({
      companyId: 'c1',
      sdrAgentId: 'sdr-1',
      whatsappNumber: '5519999999999',
      companyName: 'Lead',
      status: 'pending',
      source: 'manual',
    });

    expect(await leads.deleteBySdrAndStatuses('sdr-1', [])).toBe(0);
    expect(await leads.list()).toHaveLength(1);
  });

  it('a rota recusa envio sem status e nao apaga leads', async () => {
    const leadRepository = createMemoryLeadRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana' });
    await leadRepository.create({
      companyId: 'c1',
      sdrAgentId: agent.id,
      whatsappNumber: '5519999999999',
      companyName: 'Lead',
      status: 'pending',
      source: 'manual',
    });

    const { app, cookie } = await loggedInApp({ leadRepository, sdrAgentRepository });
    const response = await app.inject({
      method: 'POST',
      url: '/leads/limpar',
      headers: { cookie },
      payload: { sdrAgentId: agent.id },
    });

    expect(response.statusCode).toBe(400);
    expect(await leadRepository.list()).toHaveLength(1);
    await app.close();
  });
});

describe('link publico de conexao', () => {
  it('expira depois da janela configurada', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const link = {
      id: 'l1',
      sdrAgentId: 'sdr-1',
      tokenHash: 'hash',
      expiresAt: shareLinkExpiresAt(now),
      revokedAt: null,
      connectedAt: null,
      createdByUserId: null,
      createdAt: now,
    };

    expect(isShareLinkUsable(link, now)).toBe(true);
    const justBefore = new Date(now.getTime() + (shareLinkTtlMinutes - 1) * 60_000);
    expect(isShareLinkUsable(link, justBefore)).toBe(true);
    const justAfter = new Date(now.getTime() + (shareLinkTtlMinutes + 1) * 60_000);
    expect(isShareLinkUsable(link, justAfter)).toBe(false);
  });

  it('gerar um link novo revoga o anterior', async () => {
    const repo = createMemoryInstanceShareLinkRepository();
    const now = new Date();
    const first = generateShareToken();
    await repo.create({ sdrAgentId: 'sdr-1', createdByUserId: null, expiresAt: shareLinkExpiresAt(now), tokenHash: hashShareToken(first) });

    await repo.revokeActiveForAgent('sdr-1', now);
    const stored = await repo.findByTokenHash(hashShareToken(first));

    expect(stored?.revokedAt).not.toBeNull();
    expect(isShareLinkUsable(stored!, now)).toBe(false);
  });

  it('nao guarda o token cru, so o hash', async () => {
    const repo = createMemoryInstanceShareLinkRepository();
    const token = generateShareToken();
    const link = await repo.create({
      sdrAgentId: 'sdr-1',
      createdByUserId: null,
      expiresAt: shareLinkExpiresAt(new Date()),
      tokenHash: hashShareToken(token),
    });

    expect(link.tokenHash).not.toContain(token);
    expect(await repo.findByTokenHash(hashShareToken(token))).not.toBeNull();
    expect(await repo.findByTokenHash(token)).toBeNull();
  });

  it('a pagina publica recusa token expirado sem revelar o SDR', async () => {
    const shareLinks = createMemoryInstanceShareLinkRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({ companyId: 'c1', name: 'SDR Secreto', displayName: 'SDR Secreto' });
    const token = generateShareToken();
    await shareLinks.create({
      sdrAgentId: agent.id,
      createdByUserId: null,
      expiresAt: new Date(Date.now() - 60_000),
      tokenHash: hashShareToken(token),
    });

    const app = buildApp({ instanceShareLinkRepository: shareLinks, sdrAgentRepository });
    const response = await app.inject({ method: 'GET', url: `/conectar/${token}` });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('SDR Secreto');
    await app.close();
  });

  it('a pagina publica nao exige login e nao mostra o menu do portal', async () => {
    const shareLinks = createMemoryInstanceShareLinkRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const token = generateShareToken();
    await shareLinks.create({
      sdrAgentId: agent.id,
      createdByUserId: null,
      expiresAt: shareLinkExpiresAt(new Date()),
      tokenHash: hashShareToken(token),
    });

    const app = buildApp({
      instanceShareLinkRepository: shareLinks,
      sdrAgentRepository,
      uazapiClient: stubUazapiClient({
        getInstanceStatus: async () => ok({ instance: { status: 'connecting', qrcode: '2@abcdef' } }),
      }),
    });
    const response = await app.inject({ method: 'GET', url: `/conectar/${token}` });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Conectar o WhatsApp');
    expect(response.body).toContain('<svg');
    expect(response.body).not.toContain('nav-link');
    await app.close();
  });
});

describe('esforco de raciocinio', () => {
  it('vai para o provider no lugar do valor fixo', async () => {
    const calls: AiGenerateInput[] = [];
    const aiClient: AiClient = {
      async generate(input) {
        calls.push(input);
        return {
          outputText: JSON.stringify({ prompt: 'prompt gerado com folga suficiente para passar' }),
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          promptCacheHitTokens: null,
        };
      },
    };
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      aiProvider: 'openai',
      aiModel: 'gpt-5',
      aiReasoningEffort: 'high',
      openaiApiKeyEncrypted: encryptSecret('sk-teste'),
    });

    const { app, cookie } = await loggedInApp({ aiClient, sdrAgentRepository });
    await app.inject({
      method: 'POST',
      url: '/prompt-assistant/generate',
      headers: { cookie },
      payload: { sdrAgentId: agent.id, briefing: 'briefing com tamanho suficiente' },
    });

    expect(calls[0]?.reasoningEffort).toBe('high');
    await app.close();
  });

  it('cai para low quando o banco tiver um valor fora da lista', async () => {
    const calls: AiGenerateInput[] = [];
    const aiClient: AiClient = {
      async generate(input) {
        calls.push(input);
        return {
          outputText: JSON.stringify({ prompt: 'prompt gerado com folga suficiente para passar' }),
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          promptCacheHitTokens: null,
        };
      },
    };
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      aiReasoningEffort: 'turbo',
      deepseekApiKeyEncrypted: encryptSecret('sk-teste'),
    });

    const { app, cookie } = await loggedInApp({ aiClient, sdrAgentRepository });
    await app.inject({
      method: 'POST',
      url: '/prompt-assistant/generate',
      headers: { cookie },
      payload: { sdrAgentId: agent.id, briefing: 'briefing com tamanho suficiente' },
    });

    expect(calls[0]?.reasoningEffort).toBe('low');
    await app.close();
  });
});

describe('prompt da primeira mensagem fora do formulario', () => {
  it('salvar o SDR sem o campo preserva o prompt ja gravado', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      firstMessagePrompt: 'Prompt original da primeira mensagem',
    });

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}`,
      headers: { cookie },
      payload: {
        companyId: company.id,
        name: 'Mariana',
        displayName: 'Mariana',
        aiModel: 'deepseek-v4-pro',
        aiTemperature: '0.4',
        aiMaxOutputTokens: '1500',
        aiReasoningEffort: 'low',
        timezone: 'America/Sao_Paulo',
        sendWindowStart: '08:00',
        sendWindowEnd: '18:00',
        sendDaysOfWeek: '1,2,3,4,5',
        initialCooldownMinMinutes: '10',
        initialCooldownMaxMinutes: '30',
        followupAfterHours: '24',
        followupCooldownMinMinutes: '10',
        followupCooldownMaxMinutes: '30',
        dailyInitialSendLimit: '45',
        dailyFollowupSendLimit: '50',
        responseDelayBaseMs: '1200',
        responseDelayPerCharMs: '35',
        responseDelayMaxMs: '12000',
        messageSplitMaxChars: '450',
        humanPauseHours: '24',
      },
    });

    expect(response.statusCode).toBe(302);
    const saved = await sdrAgentRepository.findById(agent.id);
    expect(saved?.firstMessagePrompt).toBe('Prompt original da primeira mensagem');
    await app.close();
  });

  it('a tela de editar nao mostra mais o campo de primeira mensagem', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Mariana', displayName: 'Mariana' });

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    const response = await app.inject({ method: 'GET', url: `/sdr-agents/${agent.id}/edit`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('name="firstMessagePrompt"');
    expect(response.body).toContain('name="prompt"');
    await app.close();
  });
});
