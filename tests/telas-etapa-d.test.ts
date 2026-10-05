import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import type { AiRun, JobLog, WebhookEvent } from '../src/db/schema.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { friendlyError } from '../src/modules/logs/log-labels.js';
import { jobLogRow } from '../src/modules/logs/log-pages.js';
import {
  createMemoryConnectionMonitorRepository,
  defaultMonitorSettings,
} from '../src/modules/monitoring/connection-monitor-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { createMemoryWebhookEventRepository } from '../src/modules/webhooks/webhook-event-repository.js';

const apps: AppInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const BASE = new Date('2026-10-05T15:00:00.000Z');
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60000);

function jobLog(overrides: Partial<JobLog> = {}): JobLog {
  return {
    id: crypto.randomUUID(),
    jobName: 'initial-outreach',
    jobKey: null,
    sdrAgentId: null,
    leadId: null,
    status: 'completed',
    attempt: 1,
    payload: null,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: BASE,
    ...overrides,
  };
}

function aiRun(overrides: Partial<AiRun> = {}): AiRun {
  return {
    id: crypto.randomUUID(),
    sdrAgentId: null,
    leadId: null,
    conversationId: null,
    provider: 'openai',
    model: 'gpt-4o-mini',
    purpose: 'reply_generation',
    inputMessages: 'PROMPT INTEIRO QUE NAO VAI PARA A TELA',
    outputText: '{"mensagem_usuario":"Oi"}',
    parsedJson: null,
    error: null,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    promptCacheHitTokens: null,
    latencyMs: 1200,
    createdAt: BASE,
    ...overrides,
  };
}

function webhook(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: crypto.randomUUID(),
    sdrAgentId: null,
    eventType: 'messages',
    messageType: 'conversation',
    instanceId: null,
    whatsappMessageId: null,
    fromNumber: '5519988887777',
    toNumber: null,
    fromMe: false,
    wasSentByApi: false,
    rawHeaders: null,
    rawBody: '{"text":"Oi, pode falar"}',
    normalizedBody: null,
    processingStatus: 'processed',
    processingError: null,
    createdAt: BASE,
    ...overrides,
  };
}

async function portal(seed: { jobs?: JobLog[]; runs?: AiRun[]; events?: WebhookEvent[] } = {}, options: Parameters<typeof buildApp>[0] = {}) {
  const authRepository = createMemoryAuthRepository();
  await authRepository.createUser({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: await hashPassword('segredo123'),
    role: 'admin',
  });
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const mariana = await sdrAgentRepository.create({ companyId: 'company-1', name: 'mariana-kf', displayName: 'Mariana', isActive: true });
  const jobLogRepository = createMemoryJobLogRepository(seed.jobs);
  const app = buildApp({
    authRepository,
    sdrAgentRepository,
    jobLogRepository,
    aiRunRepository: createMemoryAiRunRepository(seed.runs),
    webhookEventRepository: createMemoryWebhookEventRepository(seed.events),
    ...options,
  });
  apps.push(app);
  const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
  const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { cookie, ...headers } });
  return { app, cookie, get, mariana, jobLogRepository };
}

describe('menu', () => {
  it('cinco itens de uso diario e as configuracoes, sem registro tecnico em ingles', async () => {
    const { get } = await portal();

    const page = (await get('/dashboard')).body;
    const nav = page.slice(page.indexOf('<nav class="nav-groups"'), page.indexOf('</nav>', page.indexOf('<nav class="nav-groups"')));

    expect([...nav.matchAll(/class="nav-link[^"]*" href="[^"]+">([^<]+)</g)].map((match) => match[1])).toEqual([
      'Painel',
      'Conversas',
      'Leads',
      'SDRs',
      'Relatorios',
      'Empresas',
      'Monitor',
      'IA auxiliar',
      'Registros',
    ]);
    expect(nav).not.toMatch(/Job logs|AI logs|Webhook logs/);
  });
});

describe('Registros', () => {
  it('abre nos erros das tres origens, do mais novo para o mais velho, em portugues', async () => {
    const { get, mariana } = await portal({
      jobs: [
        jobLog({ id: 'job-ok', createdAt: at(1) }),
        jobLog({ status: 'failed', error: 'UAZAPI returned HTTP 463 WHATSAPP_REACHOUT_TIMELOCK', createdAt: at(3), leadId: '22222222-2222-4222-8222-222222222222' }),
      ],
      runs: [aiRun({ error: 'OpenAI HTTP 401: invalid api key', createdAt: at(2) }), aiRun({ createdAt: at(4) })],
      events: [webhook({ processingStatus: 'failed', processingError: 'Unexpected token < in JSON', createdAt: at(5) }), webhook({ createdAt: at(6) })],
    });

    const body = (await get('/registros')).body;

    expect(body).toContain('aria-current="page">Erros</a>');
    const summaries = [...body.matchAll(/<td>([^<]+)(?:<br><a href="\/leads)?[^<]*(?:<\/a>)?<\/td>\s*<td><details>/g)].map((match) => match[1]);
    expect(summaries).toEqual([
      'A IA respondeu fora do formato esperado.',
      'O WhatsApp bloqueou novas conversas deste numero por um tempo.',
      'Acesso recusado: chave ou token invalido, ou WhatsApp deslogado.',
    ]);
    expect(body).toContain('href="/leads/22222222-2222-4222-8222-222222222222">Abrir lead</a>');
    // O texto cru continua la, recolhido.
    expect(body).toContain('WHATSAPP_REACHOUT_TIMELOCK');
    expect(body).not.toContain('PROMPT INTEIRO');
    expect(mariana.id).toBeTruthy();
  });

  it('pagina de 50 em 50 e diz o nome do SDR em vez do codigo', async () => {
    const seedSdr = '33333333-3333-4333-8333-333333333333';
    const jobs = Array.from({ length: 60 }, (_, index) => jobLog({ createdAt: at(index), jobKey: `chave-${index}`, sdrAgentId: seedSdr }));
    const { get } = await portal({ jobs });

    const first = (await get('/registros?aba=tarefas')).body;
    const second = (await get('/registros?aba=tarefas&pagina=2')).body;

    expect(first.match(/<tr>/g)?.length).toBe(51); // cabecalho + 50
    expect(first).toContain('href="/registros?aba=tarefas&amp;pagina=2">Mais antigos</a>');
    expect(first).toContain('chave-59');
    expect(second.match(/<tr>/g)?.length).toBe(11);
    expect(second).toContain('chave-0');
    expect(second).not.toContain('Mais antigos');
  });

  it('filtra por SDR e so o que deu errado', async () => {
    const { get, mariana, jobLogRepository } = await portal();
    const base = { jobName: 'initial-outreach', jobKey: null, leadId: null, attempt: 1, payload: null, result: null, startedAt: null, finishedAt: null };
    await jobLogRepository.create({ ...base, sdrAgentId: mariana.id, status: 'failed', error: 'chat not found' });
    await jobLogRepository.create({ ...base, sdrAgentId: mariana.id, jobKey: 'deu-certo', status: 'completed', error: null });
    await jobLogRepository.create({ ...base, sdrAgentId: '44444444-4444-4444-8444-444444444444', status: 'failed', error: 'outro sdr' });

    const body = (await get(`/registros?aba=tarefas&erros=1&sdr=${mariana.id}`)).body;

    expect(body).toContain('O numero nao existe no WhatsApp.');
    expect(body).toContain('<td>Mariana</td>');
    expect(body).not.toContain('deu-certo');
    expect(body).not.toContain('outro sdr');
  });

  it('a tarefa mostra payload e resultado nos detalhes: o resultado guarda a resposta da UAZAPI', () => {
    const row = jobLogRow(
      jobLog({ status: 'failed', payload: JSON.stringify({ agentId: 'sdr-1' }), result: JSON.stringify({ uazapi: { error: 'chat not found' } }) }),
      new Map(),
    );

    expect(row.technical).toContain('agentId');
    expect(row.technical).toContain('chat not found');
    expect(row.what).toBe('Primeira mensagem');
    expect(row.statusLabel).toBe('Falhou');
  });

  it('erro que o portal ja grava em portugues passa como esta', () => {
    expect(friendlyError('consulta de limites falhou: sem resposta')).toBe('consulta de limites falhou: sem resposta');
    expect(friendlyError('ElevenLabs HTTP 402 - payment_required: Free users cannot use library voices')).toBe(
      'Sem credito ou sem permissao no servico (IA ou voz).',
    );
    expect(friendlyError(null)).toBeNull();
  });
});

describe('Monitor em abas', () => {
  it('cada aba mostra so o que e dela, e o aviso de desligado aparece enquanto o monitor estiver desligado', async () => {
    const { get } = await portal();

    const queda = (await get('/monitoring')).body;
    const fila = (await get('/monitoring?aba=fila')).body;
    const numero = (await get('/monitoring?aba=numero')).body;

    expect(queda).toContain('aria-current="page">Queda do WhatsApp</a>');
    expect(queda).toContain('name="alertTemplate"');
    expect(queda).not.toContain('name="leadsAlertThreshold"');
    expect(queda).toContain('O monitor esta desligado');
    expect(fila).toContain('name="leadsAlertThreshold"');
    expect(fila).not.toContain('name="alertRecipients"');
    expect(numero).toContain('name="alertRecipients"');
    expect(numero).not.toContain('O monitor esta desligado');
  });

  it('os botoes respondem em portugues na propria tela', async () => {
    const monitors = createMemoryConnectionMonitorRepository();
    await monitors.saveSettings({ ...defaultMonitorSettings(), isEnabled: false });
    const { app, cookie } = await portal({}, { connectionMonitorRepository: monitors });

    const run = await app.inject({ method: 'POST', url: '/monitoring/run', headers: { cookie, accept: 'application/json' } });
    const test = await app.inject({ method: 'POST', url: '/monitoring/test', headers: { cookie, accept: 'application/json' } });

    expect(run.headers['content-type']).toContain('application/json');
    expect(run.json()).toMatchObject({ title: 'Verificacao das conexoes', ok: false, summary: 'Monitor de conexao desligado.' });
    expect(test.json()).toMatchObject({ title: 'Mensagem de teste', ok: false, summary: 'Teste enviado para 0 de 0 numero(s).' });
    expect(test.json().hint).toContain('Cadastre os numeros');
  });
});
