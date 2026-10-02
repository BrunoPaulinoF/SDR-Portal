import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { TextToSpeechClient } from '../src/modules/audio/text-to-speech-client.js';
import { APP_SCRIPT } from '../src/modules/web/app-script.js';

const apps: AppInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const ok = (body: unknown): UazapiResult => ({ status: 200, ok: true, body });

async function scenario(options: { uazapi?: Partial<UazapiClient>; leads?: number; tts?: TextToSpeechClient } = {}) {
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
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-mariana'),
    timezone: 'America/Sao_Paulo',
  });
  const francielly = await sdrAgentRepository.create({ companyId: company.id, name: 'Francielly', displayName: 'Francielly', isActive: true });
  const leadRepository = createMemoryLeadRepository();
  for (let index = 0; index < (options.leads ?? 0); index += 1) {
    await leadRepository.create({
      companyId: company.id,
      sdrAgentId: index % 2 === 0 ? mariana.id : francielly.id,
      whatsappNumber: `5519988${String(100000 + index)}`,
      companyName: `Pizzaria ${index}`,
      status: index % 3 === 0 ? 'initial_sent' : 'pending',
      source: 'import',
    });
  }
  const app = buildApp({
    authRepository,
    companyRepository,
    leadRepository,
    sdrAgentRepository,
    textToSpeechClient: options.tts,
    uazapiClient: options.uazapi as UazapiClient | undefined,
  });
  apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
  const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
  return { app, company, cookie, francielly, leadRepository, mariana, sdrAgentRepository };
}

describe('salvar fica na mesma tela', () => {
  it('salvar o SDR volta para a tela dele com o aviso, nao para a lista', async () => {
    const { app, company, cookie, mariana } = await scenario();
    const form = new URLSearchParams({
      companyId: company.id,
      name: 'Mariana',
      displayName: 'Mariana',
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v4-flash',
      aiTemperature: '0.5',
      aiMaxOutputTokens: '900',
      timezone: 'America/Sao_Paulo',
      sendWindowStart: '09:00',
      sendWindowEnd: '17:00',
      sendDaysOfWeek: '1,2,3,4,5',
      initialCooldownMinMinutes: '6',
      initialCooldownMaxMinutes: '16',
      followupAfterHours: '36',
      followupCooldownMinMinutes: '11',
      followupCooldownMaxMinutes: '31',
      dailyInitialSendLimit: '40',
      dailyFollowupSendLimit: '20',
      responseDelayBaseMs: '1300',
      responseDelayPerCharMs: '40',
      responseDelayMaxMs: '13000',
      messageSplitMaxChars: '400',
    }).toString();

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${mariana.id}`,
      payload: form,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/sdr-agents/${mariana.id}/edit?salvo=1`);
  });

  it('toda tela carrega o script que mostra o aviso e devolve ao mesmo ponto', async () => {
    const { app, cookie, mariana } = await scenario();

    const page = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit?salvo=1`, headers: { cookie } });
    const script = await app.inject({ method: 'GET', url: '/app.js' });

    expect(page.body).toContain('<script src="/app.js" defer></script>');
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('javascript');
    expect(script.body).toContain('Alteracoes salvas');
    // O script e codigo valido.
    expect(() => new Function(APP_SCRIPT)).not.toThrow();
  });
});

describe('testes do WhatsApp na propria tela', () => {
  it('a tela do SDR manda os testes para o quadro de resultado', async () => {
    const { app, cookie, mariana } = await scenario();

    const page = await app.inject({ method: 'GET', url: `/sdr-agents/${mariana.id}/edit`, headers: { cookie } });

    expect(page.body).toContain('data-inline-result="resultado-whatsapp"');
    expect(page.body).toContain('id="resultado-whatsapp"');
    expect(page.body).toContain('data-inline-result="resultado-audio"');
  });

  it('status responde em portugues, em JSON para o script', async () => {
    const { app, cookie, mariana } = await scenario({
      uazapi: { async getInstanceStatus() { return ok({ instance: { status: 'connected', profileName: 'Mariana KyberFood' } }); } },
    });

    const response = await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/uazapi/status`, headers: { cookie, accept: 'application/json' } });

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ ok: true, title: 'Status do WhatsApp', summary: 'WhatsApp conectado (Mariana KyberFood). Pode enviar e receber.' });
  });

  it('WhatsApp caido diz o que fazer', async () => {
    const { app, cookie, mariana } = await scenario({
      uazapi: { async getInstanceStatus() { return ok({ instance: { status: 'disconnected', lastDisconnectReason: '401: logged out' } }); } },
    });

    const result = (await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/uazapi/status`, headers: { cookie, accept: 'application/json' } })).json();

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('WhatsApp fora do ar');
    expect(result.hint).toContain('QR code');
  });

  it('limites do WhatsApp em portugues, com a data do bloqueio', async () => {
    const { app, cookie, mariana } = await scenario({
      uazapi: {
        async getMessageLimits() {
          return ok({ can_send_new_messages: false, reachout_timelock: { active: true, until: '2026-10-02T12:00:00.000Z', enforcement_type: 'BIZ_QUALITY' } });
        },
      },
    });

    const result = (await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/uazapi/limites`, headers: { cookie, accept: 'application/json' } })).json();

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('nao deixa iniciar conversas novas ate 02/10');
  });

  it('voz da biblioteca no plano gratuito vira explicacao, nao codigo', async () => {
    const tts: TextToSpeechClient = {
      async synthesize() {
        throw new Error('ElevenLabs HTTP 402 - payment_required: Free users cannot use library voices via the API.');
      },
    };
    const { app, cookie, sdrAgentRepository, company } = await scenario({ tts });
    const agent = await sdrAgentRepository.create({
      companyId: company.id,
      name: 'Voz',
      displayName: 'Voz',
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('t'),
      elevenlabsApiKeyEncrypted: encryptSecret('xi'),
      elevenlabsVoiceId: 'voz-biblioteca',
    });

    const result = (
      await app.inject({
        method: 'POST',
        url: `/sdr-agents/${agent.id}/uazapi/send-audio-test`,
        headers: { cookie, accept: 'application/json' },
        payload: { number: '5519999999999', text: 'Oi' },
      })
    ).json();

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('no plano gratuito so as vozes padrao funcionam');
    expect(result.hint).toContain('voz padrao');
  });

  it('sem o script, o mesmo resultado vem numa pagina com volta para o SDR', async () => {
    const { app, cookie, mariana } = await scenario({
      uazapi: { async configureWebhook() { return ok({ response: 'webhook configured' }); } },
    });

    const response = await app.inject({ method: 'POST', url: `/sdr-agents/${mariana.id}/uazapi/configure-webhook`, headers: { cookie } });

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain(`/sdr-agents/${mariana.id}/edit`);
  });
});

describe('tela de leads', () => {
  it('mostra 50 por pagina, do mais novo para o mais antigo, com a situacao em portugues', async () => {
    const { app, cookie } = await scenario({ leads: 60 });

    const first = await app.inject({ method: 'GET', url: '/leads', headers: { cookie } });
    const second = await app.inject({ method: 'GET', url: '/leads?pagina=2', headers: { cookie } });

    const names = (body: string) => [...body.matchAll(/>(Pizzaria \d+)</g)].map((match) => match[1]);
    expect((first.body.match(/<tr>/g) ?? []).length).toBe(51);
    expect(first.body).toContain('Pagina 1 de 2');
    expect(first.body).toContain('Pendente');
    expect(first.body).not.toContain('>pending<');
    expect((second.body.match(/<tr>/g) ?? []).length).toBe(11);
    // As duas paginas juntas tem cada lead uma vez so.
    const all = [...names(first.body), ...names(second.body)];
    expect(all).toHaveLength(60);
    expect(new Set(all).size).toBe(60);
  });

  it('busca por nome e por pedaco do numero, e filtra por SDR e situacao', async () => {
    const { app, cookie, mariana } = await scenario({ leads: 12 });

    const byName = await app.inject({ method: 'GET', url: '/leads?q=pizzaria%2011', headers: { cookie } });
    const byNumber = await app.inject({ method: 'GET', url: '/leads?q=100007', headers: { cookie } });
    const filtered = await app.inject({ method: 'GET', url: `/leads?sdr=${mariana.id}&status=initial_sent`, headers: { cookie } });

    expect(byName.body).toContain('Pizzaria 11');
    expect(byName.body).not.toContain('Pizzaria 10<');
    expect(byNumber.body).toContain('Pizzaria 7<');
    // Mariana fica com os pares; abordados sao os multiplos de 3: 0 e 6.
    expect((filtered.body.match(/<tr>/g) ?? []).length).toBe(3);
    expect(filtered.body).toContain('Pizzaria 6<');
  });

  it('filtro invalido na URL vira "todos" em vez de erro', async () => {
    const { app, cookie } = await scenario({ leads: 3 });

    const response = await app.inject({ method: 'GET', url: '/leads?sdr=nao-e-id&status=inventado&pagina=abc', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect((response.body.match(/<tr>/g) ?? []).length).toBe(4);
  });

  it('apagar em massa tem tela propria, com as quantidades do SDR', async () => {
    const { app, cookie, mariana } = await scenario({ leads: 6 });

    const list = await app.inject({ method: 'GET', url: '/leads', headers: { cookie } });
    const page = await app.inject({ method: 'GET', url: `/leads/limpar?sdr=${mariana.id}`, headers: { cookie } });
    const empty = await app.inject({
      method: 'POST',
      url: '/leads/limpar',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `sdrAgentId=${mariana.id}`,
    });

    expect(list.body).not.toContain('Apagar leads marcados');
    expect(list.body).toContain('href="/leads/limpar"');
    // Mariana: leads 0, 2 e 4 -> 0 abordado, 2 e 4 pendentes.
    expect(page.body).toContain('Pendente <span class="muted">(2)</span>');
    expect(page.body).toContain('Abordado <span class="muted">(1)</span>');
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain('Marque ao menos uma situacao');
  });
});

describe('painel le so o periodo', () => {
  it('as consultas leves trazem so o que caiu depois do inicio do periodo', async () => {
    const since = new Date('2026-10-01T00:00:00.000Z');
    const conversations = createMemoryConversationRepository();
    const conversation = await conversations.create({
      companyId: 'c1',
      sdrAgentId: 's1',
      leadId: 'l1',
      whatsappNumber: '5519999999999',
      status: 'open',
      lastMessageAt: since,
    });
    for (const createdAt of [new Date('2026-09-20T00:00:00.000Z'), new Date('2026-10-01T10:00:00.000Z')]) {
      const message = await conversations.createMessage({
        conversationId: conversation.id,
        leadId: 'l1',
        sdrAgentId: 's1',
        direction: 'inbound',
        senderType: 'lead',
        messageType: 'conversation',
        text: 'oi',
      });
      Object.assign(message, { createdAt });
    }
    const aiRuns = createMemoryAiRunRepository();
    const jobLogs = createMemoryJobLogRepository();

    const stats = await conversations.listMessageStats(since);

    expect(stats).toHaveLength(1);
    expect(Object.keys(stats[0] ?? {}).sort()).toEqual(['autoReply', 'createdAt', 'direction', 'leadId']);
    expect(await conversations.listMessageStats(null)).toHaveLength(2);
    expect(await aiRuns.listStats(since)).toEqual([]);
    expect(await jobLogs.listStats(since)).toEqual([]);
  });
});
