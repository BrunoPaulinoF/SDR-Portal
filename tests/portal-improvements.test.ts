import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AiClient, AiGenerateInput } from '../src/modules/ai/ai-client.js';
import { providerDefaultEffort, reasoningEffortOptions, resolveReasoningEffort } from '../src/modules/ai/reasoning-effort.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
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

  it('omite o parametro quando o nivel salvo nao existe na escala do provider', async () => {
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
      aiProvider: 'deepseek',
      aiReasoningEffort: 'medium',
      deepseekApiKeyEncrypted: encryptSecret('sk-teste'),
    });

    const { app, cookie } = await loggedInApp({ aiClient, sdrAgentRepository });
    await app.inject({
      method: 'POST',
      url: '/prompt-assistant/generate',
      headers: { cookie },
      payload: { sdrAgentId: agent.id, briefing: 'briefing com tamanho suficiente' },
    });

    // 'medium' e da escala da OpenAI: no DeepSeek (low/high/max) o parametro nao vai.
    expect(calls[0]?.reasoningEffort).toBeNull();
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

describe('acesso a tela de conexao', () => {
  it('a tela de editar SDR leva para o QR e recolhe a configuracao manual', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceId: 'SDR-Teste',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    const response = await app.inject({ method: 'GET', url: `/sdr-agents/${agent.id}/edit`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`/sdr-agents/${agent.id}/conectar`);
    // os campos continuam no formulario, apenas recolhidos, para nao apagar o que ja esta salvo
    expect(response.body).toContain('<details');
    expect(response.body).toContain('name="uazapiInstanceTokenEncrypted"');
    await app.close();
  });

  it('salvar pelo formulario preserva a instancia ja configurada', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceId: 'SDR-Teste',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}`,
      headers: { cookie },
      payload: {
        companyId: company.id,
        name: 'Mariana',
        displayName: 'Mariana',
        uazapiBaseUrl: 'https://uazapi.test',
        uazapiInstanceId: 'SDR-Teste',
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

    const saved = await sdrAgentRepository.findById(agent.id);
    expect(saved?.uazapiInstanceTokenEncrypted).toBe(agent.uazapiInstanceTokenEncrypted);
    expect(saved?.uazapiBaseUrl).toBe('https://uazapi.test');
    await app.close();
  });
});

describe('escala de esforco por provider', () => {
  it('cada provider oferece a sua propria escala', () => {
    const valores = (provider: string) => reasoningEffortOptions(provider).map((option) => option.value);

    expect(valores('deepseek')).toEqual(['default', 'low', 'high', 'max']);
    expect(valores('openai')).toContain('minimal');
    expect(valores('openai')).toContain('medium');
    expect(valores('deepseek')).not.toContain('medium');
    expect(valores('deepseek')).not.toContain('minimal');
    expect(valores('openrouter')).toContain('none');
  });

  it('resolve o nivel apenas quando ele existe na escala do provider', () => {
    expect(resolveReasoningEffort('deepseek', 'max')).toBe('max');
    expect(resolveReasoningEffort('deepseek', 'medium')).toBeNull();
    expect(resolveReasoningEffort('openai', 'medium')).toBe('medium');
    expect(resolveReasoningEffort('openai', 'max')).toBe('max');
    expect(resolveReasoningEffort('deepseek', providerDefaultEffort)).toBeNull();
    expect(resolveReasoningEffort('deepseek', null)).toBeNull();
  });

  it('o formulario mostra a escala do provider salvo', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      aiProvider: 'deepseek',
    });

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    const response = await app.inject({ method: 'GET', url: `/sdr-agents/${agent.id}/edit`, headers: { cookie } });
    const select = /name="aiReasoningEffort"[^>]*>([\s\S]*?)<\/select>/.exec(response.body)?.[1] ?? '';

    expect(select).toContain('value="max"');
    expect(select).not.toContain('value="medium"');
    expect(select).not.toContain('value="minimal"');
    await app.close();
  });
});

describe('excluir SDR apaga a instancia na UAZAPI', () => {
  async function cenario(deleteResult: UazapiResult) {
    const chamadas: Array<{ baseUrl: string; token: string }> = [];
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    });
    const uazapiClient = stubUazapiClient({
      deleteInstance: async (input) => {
        chamadas.push({ baseUrl: input.baseUrl, token: input.token });
        return deleteResult;
      },
    });
    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository, uazapiClient });
    return { app, cookie, agent, sdrAgentRepository, chamadas };
  }

  it('apaga a instancia antes de remover o SDR', async () => {
    const { app, cookie, agent, sdrAgentRepository, chamadas } = await cenario({ ok: true, status: 200, body: {} });

    const response = await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/delete`, headers: { cookie } });

    expect(response.statusCode).toBe(302);
    expect(chamadas).toEqual([{ baseUrl: 'https://uazapi.test', token: 'instance-token' }]);
    expect(await sdrAgentRepository.findById(agent.id)).toBeNull();
    await app.close();
  });

  it('instancia que ja nao existe (404) nao impede a exclusao', async () => {
    const { app, cookie, agent, sdrAgentRepository } = await cenario({ ok: false, status: 404, body: {} });

    await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/delete`, headers: { cookie } });

    expect(await sdrAgentRepository.findById(agent.id)).toBeNull();
    await app.close();
  });

  it('falha na UAZAPI mantem o SDR, para o token nao ser perdido', async () => {
    const { app, cookie, agent, sdrAgentRepository } = await cenario({ ok: false, status: 500, body: {} });

    const response = await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/delete`, headers: { cookie } });

    expect(response.statusCode).toBe(502);
    expect(response.body).toContain('Nao foi possivel apagar a instancia');
    expect(response.body).toContain('manterInstancia');
    expect(await sdrAgentRepository.findById(agent.id)).not.toBeNull();
    await app.close();
  });

  it('manterInstancia=1 exclui so do portal, sem chamar a UAZAPI', async () => {
    const { app, cookie, agent, sdrAgentRepository, chamadas } = await cenario({ ok: false, status: 500, body: {} });

    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}/delete`,
      headers: { cookie },
      payload: { manterInstancia: '1' },
    });

    expect(chamadas).toHaveLength(0);
    expect(await sdrAgentRepository.findById(agent.id)).toBeNull();
    await app.close();
  });

  it('SDR sem instancia configurada e removido direto', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'Kybernan' });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Sem instancia', displayName: 'X' });
    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });

    const response = await app.inject({ method: 'POST', url: `/sdr-agents/${agent.id}/delete`, headers: { cookie } });

    expect(response.statusCode).toBe(302);
    expect(await sdrAgentRepository.findById(agent.id)).toBeNull();
    await app.close();
  });
});

describe('instrucao de pesquisa web so quando a ferramenta existe', () => {
  it('deepseek nao recebe ordem de pesquisar e nao pode descartar por falta de dado', async () => {
    const calls: AiGenerateInput[] = [];
    const aiClient: AiClient = {
      async generate(input) {
        calls.push(input);
        return {
          outputText: JSON.stringify({ qualified: true, reason: 'nome fantasia indica pizzaria' }),
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          promptCacheHitTokens: null,
        };
      },
    };
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const leadRepository = createMemoryLeadRepository();
    const agent = await sdrAgentRepository.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      isActive: true,
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v4-pro',
      deepseekApiKeyEncrypted: encryptSecret('sk-teste'),
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('token'),
      sendDaysOfWeek: '0,1,2,3,4,5,6',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      firstMessagePrompt: 'Escreva a abordagem.',
    });
    await leadRepository.create({
      companyId: 'c1',
      sdrAgentId: agent.id,
      whatsappNumber: '5519999999999',
      companyName: 'PIZZARIA DO ZE',
      status: 'pending',
      source: 'manual',
    });

    const { createInitialOutreachService } = await import('../src/modules/scheduler/initial-outreach.js');
    const service = createInitialOutreachService({
      aiClient,
      aiRunRepository: createMemoryAiRunRepository(),
      conversationRepository: createMemoryConversationRepository(),
      firstMessageVariantRepository: createMemoryFirstMessageVariantRepository(),
      jobLogRepository: createMemoryJobLogRepository(),
      leadResearchService: { async researchLead() { return null; } },
      leadRepository,
      sdrAgentRepository,
      uazapiClient: stubUazapiClient({
        checkChats: async () => ok([{ isInWhatsapp: true, jid: '5519999999999@s.whatsapp.net' }]),
        sendText: async () => ok({}),
        sendPresence: async () => ok({}),
      }),
    });

    await service.runOnce();

    const sistema = calls.map((call) => call.messages[0]?.content ?? '').join('\n');
    expect(sistema).toContain('NAO tem ferramenta de pesquisa web');
    expect(sistema).not.toContain('use a ferramenta de pesquisa web');
    expect(sistema).toContain('nunca descarte um lead so por faltar informacao');
  });
});
