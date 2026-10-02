import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { DEFAULT_LEAD_QUALIFICATION_PROMPT } from '../src/modules/leads/lead-qualification-prompt.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemoryChannelLimitsRepository } from '../src/modules/monitoring/channel-limits.js';
import { createMemoryConnectionMonitorRepository } from '../src/modules/monitoring/connection-monitor-repository.js';
import { createMemorySdrConfigChangeRepository } from '../src/modules/sdr-agents/config-history.js';
import { agentToBody, mergeTabBody } from '../src/modules/sdr-agents/sdr-agent-pages.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { decryptSecret, encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const apps: AppInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const ok = (body: unknown): UazapiResult => ({ status: 200, ok: true, body });
const form = { 'content-type': 'application/x-www-form-urlencoded' };

async function scenario(options: { uazapi?: Partial<UazapiClient> } = {}) {
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
    name: 'KyberFood',
    legalName: null,
    cnpj: null,
    segment: null,
    description: null,
    websiteUrl: null,
    defaultHandoffName: null,
    defaultHandoffPhone: null,
  });
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const mariana = await sdrAgentRepository.create({
    companyId: company.id,
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    prompt: 'Prompt da conversa',
    firstMessagePrompt: 'Prompt da primeira mensagem',
    secondMessage: 'Segunda mensagem fixa',
    leadQualificationPrompt: null,
    openaiApiKeyEncrypted: encryptSecret('sk-guardada'),
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceId: 'SDR-Mariana',
    uazapiInstanceTokenEncrypted: encryptSecret('token-mariana'),
    followupEnabled: true,
    dailyInitialSendLimit: 40,
    timezone: 'America/Sao_Paulo',
  });
  const leadRepository = createMemoryLeadRepository();
  const connectionMonitorRepository = createMemoryConnectionMonitorRepository();
  const channelLimitsRepository = createMemoryChannelLimitsRepository();
  const jobLogRepository = createMemoryJobLogRepository();
  const configChangeRepository = createMemorySdrConfigChangeRepository();
  const app = buildApp({
    authRepository,
    channelLimitsRepository,
    companyRepository,
    configChangeRepository,
    connectionMonitorRepository,
    jobLogRepository,
    leadRepository,
    sdrAgentRepository,
    uazapiClient: options.uazapi as UazapiClient | undefined,
  });
  apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
  const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
  return {
    app,
    channelLimitsRepository,
    company,
    configChangeRepository,
    connectionMonitorRepository,
    cookie,
    jobLogRepository,
    leadRepository,
    mariana,
    sdrAgentRepository,
  };
}

describe('cada aba salva so o que e dela', () => {
  it('salvar Envio nao mexe em prompt, chave nem segunda mensagem, e volta para a aba', async () => {
    const { app, configChangeRepository, cookie, mariana, sdrAgentRepository } = await scenario();

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${mariana.id}/aba/envio`,
      headers: { cookie, ...form },
      // Follow-up desmarcado nao vem no POST.
      payload: new URLSearchParams({
        timezone: mariana.timezone,
        sendWindowStart: '15:00',
        sendWindowEnd: mariana.sendWindowEnd,
        sendDaysOfWeek: mariana.sendDaysOfWeek,
        initialCooldownMinMinutes: String(mariana.initialCooldownMinMinutes),
        initialCooldownMaxMinutes: String(mariana.initialCooldownMaxMinutes),
        dailyInitialSendLimit: '25',
        followupAfterHours: String(mariana.followupAfterHours),
        followupMaxTouches: '2',
        dailyFollowupSendLimit: String(mariana.dailyFollowupSendLimit),
        followupCooldownMinMinutes: String(mariana.followupCooldownMinMinutes),
        followupCooldownMaxMinutes: String(mariana.followupCooldownMaxMinutes),
      }).toString(),
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/sdr-agents/${mariana.id}/edit?aba=envio&salvo=1`);
    const saved = (await sdrAgentRepository.findById(mariana.id))!;
    expect(saved).toMatchObject({ dailyInitialSendLimit: 25, followupEnabled: false, followupMaxTouches: 2, sendWindowStart: '15:00' });
    expect(saved).toMatchObject({
      prompt: 'Prompt da conversa',
      firstMessagePrompt: 'Prompt da primeira mensagem',
      secondMessage: 'Segunda mensagem fixa',
      leadQualificationPrompt: null,
      isActive: true,
      uazapiInstanceId: 'SDR-Mariana',
    });
    expect(decryptSecret(saved.openaiApiKeyEncrypted!)).toBe('sk-guardada');
    expect(decryptSecret(saved.uazapiInstanceTokenEncrypted!)).toBe('token-mariana');

    // O historico so ganha o que mudou de verdade.
    const fields = (await configChangeRepository.listForAgent(mariana.id, 20)).map((change) => change.field).sort();
    expect(fields).toEqual(['dailyInitialSendLimit', 'followupEnabled', 'followupMaxTouches', 'sendWindowStart']);
  });

  it('salvar Conversa com o texto-padrao na qualificacao nao grava o padrao nem cria mudanca', async () => {
    const { app, configChangeRepository, cookie, mariana, sdrAgentRepository } = await scenario();

    // A tela mostra o texto-padrao no campo de qualificacao; o navegador manda o que esta la.
    const page = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit?aba=conversa`, headers: { cookie } });
    expect(page.body).toContain('name="leadQualificationPrompt"');

    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${mariana.id}/aba/conversa`,
      headers: { cookie, ...form },
      payload: new URLSearchParams({ displayName: 'Mariana', playbook: 'consultivo', prompt: 'Prompt novo', leadQualificationPrompt: DEFAULT_LEAD_QUALIFICATION_PROMPT }).toString(),
    });

    const saved = (await sdrAgentRepository.findById(mariana.id))!;
    expect(saved.prompt).toBe('Prompt novo');
    expect(saved.leadQualificationPrompt).toBeNull();
    expect((await configChangeRepository.listForAgent(mariana.id, 20)).map((change) => change.field)).toEqual(['prompt']);

    // Texto proprio no campo, ai sim grava.
    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${mariana.id}/aba/conversa`,
      headers: { cookie, ...form },
      payload: new URLSearchParams({ displayName: 'Mariana', playbook: 'consultivo', prompt: 'Prompt novo', leadQualificationPrompt: 'Descartar MEI.' }).toString(),
    });
    expect((await sdrAgentRepository.findById(mariana.id))?.leadQualificationPrompt).toBe('Descartar MEI.');
    expect(saved.dailyInitialSendLimit).toBe(40);
    expect(saved.followupEnabled).toBe(true);
  });

  it('campo invalido volta para a mesma aba com o erro, sem gravar e sem devolver a chave digitada', async () => {
    const { app, cookie, mariana, sdrAgentRepository } = await scenario();

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${mariana.id}/aba/avancado`,
      headers: { cookie, ...form },
      payload: new URLSearchParams({
        companyId: mariana.companyId,
        name: 'Mariana',
        aiProvider: 'openai',
        aiModel: '',
        aiTemperature: '0.4',
        aiMaxOutputTokens: '1500',
        openaiApiKeyEncrypted: 'sk-digitada-agora',
        responseDelayBaseMs: '1000',
        responseDelayPerCharMs: '30',
        responseDelayMaxMs: '9000',
        messageSplitMaxChars: '300',
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Confira os campos obrigatorios do SDR.');
    expect(response.body).toContain('class="tab tab-active" href="/sdr-agents/' + mariana.id + '/edit?aba=avancado"');
    expect(response.body).toContain('value="9000"');
    expect(response.body).not.toContain('sk-digitada-agora');
    const saved = (await sdrAgentRepository.findById(mariana.id))!;
    expect(saved.aiModel).toBe(mariana.aiModel);
    expect(decryptSecret(saved.openaiApiKeyEncrypted!)).toBe('sk-guardada');
  });

  it('aba que nao tem formulario nao salva', async () => {
    const { app, cookie, mariana } = await scenario();

    for (const tab of ['resumo', 'historico', 'abordagem', 'qualquer']) {
      const response = await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/aba/${tab}`, headers: { cookie, ...form }, payload: 'x=1' });
      expect(response.statusCode).toBe(404);
    }
  });

  it('mergeTabBody: caixa ausente e desligada; texto ausente fica com o gravado', async () => {
    const { mariana } = await scenario();

    const merged = mergeTabBody(mariana, 'envio', { dailyInitialSendLimit: '12' });

    expect(merged.dailyInitialSendLimit).toBe('12');
    expect(merged.followupEnabled).toBeUndefined();
    expect(merged.sendWindowStart).toBe(mariana.sendWindowStart);
    expect(merged.isActive).toBe('on');
    expect(merged.prompt).toBe('Prompt da conversa');
    expect(merged.openaiApiKeyEncrypted).toBe('');
    expect(merged.firstMessagePrompt).toBeUndefined();
    expect(agentToBody(mariana).leadQualificationPrompt).toBe('');
  });
});

describe('navegacao pelas abas', () => {
  it('sem aba abre o Resumo; aba desconhecida tambem; Abordagem leva para a Msg inicial', async () => {
    const { app, cookie, mariana } = await scenario();

    const resumo = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit`, headers: { cookie } });
    const desconhecida = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit?aba=xyz`, headers: { cookie } });
    const abordagem = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit?aba=abordagem`, headers: { cookie } });

    expect(resumo.body).toContain('Acoes rapidas');
    expect(resumo.body).toContain('aria-current="page">Resumo</a>');
    expect(desconhecida.body).toContain('aria-current="page">Resumo</a>');
    expect(abordagem.statusCode).toBe(302);
    expect(abordagem.headers.location).toBe(`/sdr-agents/${mariana.id}/first-messages`);
  });

  it('cada aba mostra so os campos dela', async () => {
    const { app, cookie, mariana } = await scenario();
    const tab = async (aba: string) => (await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit?aba=${aba}`, headers: { cookie } })).body;

    const envio = await tab('envio');
    expect(envio).toContain('name="dailyInitialSendLimit"');
    expect(envio).not.toContain('name="prompt"');
    expect(envio).not.toContain('name="openaiApiKeyEncrypted"');
    expect(envio).toContain(`action="/sdr-agents/${mariana.id}/aba/envio"`);

    const voz = await tab('voz');
    expect(voz).toContain('name="elevenlabsVoiceId"');
    expect(voz).not.toContain('name="dailyInitialSendLimit"');

    const avancado = await tab('avancado');
    expect(avancado).toContain('name="aiModel"');
    expect(avancado).toContain(`action="/sdr-agents/${mariana.id}/delete"`);
  });

  it('Msg inicial e Conectar ganham as mesmas abas', async () => {
    const { app, cookie, mariana } = await scenario({
      uazapi: { async getInstanceStatus() { return ok({ instance: { status: 'connected' }, status: { connected: true } }); } },
    });

    const firstMessages = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/first-messages`, headers: { cookie } });
    const conectar = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/conectar`, headers: { cookie } });

    expect(firstMessages.body).toContain('aria-current="page">Abordagem</a>');
    expect(conectar.statusCode).toBe(200);
    expect(conectar.body).toContain('aria-current="page">WhatsApp</a>');
  });

  it('pausar pelo Resumo volta para o Resumo; pela lista, para a lista', async () => {
    const { app, cookie, mariana, sdrAgentRepository } = await scenario();

    const pelaAba = await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/toggle`, headers: { cookie, ...form }, payload: 'voltar=resumo' });
    expect(pelaAba.headers.location).toBe(`/sdr-agents/${mariana.id}/edit?salvo=1`);
    expect((await sdrAgentRepository.findById(mariana.id))?.isActive).toBe(false);

    const pelaLista = await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/toggle`, headers: { cookie } });
    expect(pelaLista.headers.location).toBe('/sdr-agents?salvo=1');
    expect((await sdrAgentRepository.findById(mariana.id))?.isActive).toBe(true);
  });
});

describe('Resumo e lista de SDRs', () => {
  async function comMovimento() {
    const ctx = await scenario();
    const now = new Date();
    await ctx.connectionMonitorRepository.saveState({
      sdrAgentId: ctx.mariana.id,
      status: 'disconnected',
      instanceStatus: 'close',
      disconnectReason: '401: logged out',
      lastCheckedAt: now,
      lastConnectedAt: null,
      disconnectedAt: new Date(now.getTime() - 60 * 60 * 1000),
      lastAlertAt: null,
    });
    await ctx.channelLimitsRepository.save({
      sdrAgentId: ctx.mariana.id,
      canStartConversations: false,
      blockedUntil: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      blockReason: 'WhatsApp bloqueou novas conversas',
      quotaUsed: null,
      quotaTotal: null,
      quotaResetsAt: null,
      source: 'consulta',
      checkedAt: now,
    });
    for (let index = 0; index < 3; index += 1) {
      const lead = await ctx.leadRepository.create({
        companyId: ctx.company.id,
        sdrAgentId: ctx.mariana.id,
        whatsappNumber: `551998800000${index}`,
        companyName: `Pizzaria ${index}`,
        status: 'pending',
        source: 'import',
      });
      if (index === 0) await ctx.leadRepository.markInitialSent(lead.id, now);
    }
    await ctx.jobLogRepository.create({
      jobName: 'initial-outreach',
      jobKey: null,
      sdrAgentId: ctx.mariana.id,
      leadId: null,
      status: 'failed',
      attempt: 1,
      payload: null,
      result: null,
      error: 'UAZAPI recusou o envio',
      startedAt: now,
      finishedAt: now,
    });
    return ctx;
  }

  it('o Resumo junta conexao, bloqueio, envios do dia, fila e o ultimo erro', async () => {
    const { app, cookie, mariana } = await comMovimento();

    const page = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit`, headers: { cookie } });

    expect(page.body).toContain('Desconectado');
    expect(page.body).toContain('Bloqueado');
    expect(page.body).toContain('1 de 40');
    expect(page.body).toContain('2 pendente(s)');
    expect(page.body).toContain('UAZAPI recusou o envio');
    expect(page.body).toContain('Pausar SDR');
  });

  it('a lista mostra um cartao por SDR com o que importa e o botao Abrir', async () => {
    const { app, cookie, mariana } = await comMovimento();

    const page = await app.inject({ method: 'GET', url: '/sdr-agents', headers: { cookie } });

    expect(page.body).toContain('class="panel sdr-card"');
    expect(page.body).toContain(`<a class="button" href="/sdr-agents/${mariana.id}/edit">Abrir</a>`);
    expect(page.body).toContain('Desconectado');
    expect(page.body).toContain('1 de 40');
    expect(page.body).toContain('2 pendente(s)');
    expect(page.body).toContain('nao deixa abrir conversa nova');
  });
});
