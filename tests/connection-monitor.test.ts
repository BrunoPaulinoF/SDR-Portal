import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { parseAlertRecipients } from '../src/modules/monitoring/alert-recipients.js';
import {
  createMemoryConnectionMonitorRepository,
  defaultMonitorSettings,
  type ConnectionMonitorRepository,
  type MonitorSettingsInput,
} from '../src/modules/monitoring/connection-monitor-repository.js';
import { createConnectionMonitorService } from '../src/modules/monitoring/connection-monitor-service.js';
import { createMemorySdrAgentRepository, type SdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { decryptSecret, encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import { readConnectionEvent } from '../src/modules/webhooks/connection-event.js';
import type { SdrAgent } from '../src/db/schema.js';

const NOW = new Date('2026-09-01T17:30:00.000Z');
const MINUTE = 60 * 1000;

function ok(body: unknown): UazapiResult {
  return { status: 200, ok: true, body };
}

/**
 * `statusByToken` diz o que cada instancia responde: e assim que um SDR cai enquanto o
 * outro segue de pe, que e o caso que o alerta precisa separar.
 */
function fakeUazapiClient(statusByToken: Record<string, UazapiResult>): UazapiClient & { sent: SendTextInput[] } {
  const sent: SendTextInput[] = [];
  const client = {
    sent,
    async checkChats() {
      return ok({});
    },
    async configureWebhook() {
      return ok({});
    },
    async connectInstance() {
      return ok({});
    },
    async createInstance() {
      return ok({});
    },
    async deleteInstance() {
      return ok({});
    },
    async downloadMessage() {
      return ok({});
    },
    async getInstanceStatus(input: { token: string }) {
      return statusByToken[input.token] ?? ok({ instance: { status: 'connected' } });
    },
    async listInstances() {
      return ok({});
    },
    async sendContact() {
      return ok({});
    },
    async sendPresence() {
      return ok({});
    },
    async sendText(input: SendTextInput) {
      sent.push(input);
      return ok({ messageid: 'msg-1' });
    },
  };

  return client as unknown as UazapiClient & { sent: SendTextInput[] };
}

async function makeAgents(): Promise<{ agents: SdrAgent[]; repository: SdrAgentRepository }> {
  const repository = createMemorySdrAgentRepository();
  const franc = await repository.create({
    companyId: 'company-1',
    name: 'Franc',
    displayName: 'Franc',
    isActive: true,
    whatsappNumber: '5519999990001',
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-franc'),
  });
  const mariana = await repository.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    whatsappNumber: '5519999990002',
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-mariana'),
  });

  return { agents: [franc, mariana], repository };
}

async function seedSettings(
  repository: ConnectionMonitorRepository,
  overrides: Partial<MonitorSettingsInput> = {},
): Promise<void> {
  await repository.saveSettings({
    ...defaultMonitorSettings(),
    isEnabled: true,
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-monitor'),
    alertRecipients: '5519888880000',
    repeatAlertMinutes: 0,
    ...overrides,
  });
}

interface Harness {
  agents: SdrAgent[];
  monitors: ConnectionMonitorRepository;
  jobLogs: ReturnType<typeof createMemoryJobLogRepository>;
  uazapi: ReturnType<typeof fakeUazapiClient>;
  service: ReturnType<typeof createConnectionMonitorService>;
}

async function buildHarness(
  statusByToken: Record<string, UazapiResult>,
  settings: Partial<MonitorSettingsInput> = {},
): Promise<Harness> {
  const { agents, repository } = await makeAgents();
  const monitors = createMemoryConnectionMonitorRepository();
  await seedSettings(monitors, settings);
  const uazapi = fakeUazapiClient(statusByToken);
  const jobLogs = createMemoryJobLogRepository();
  const service = createConnectionMonitorService({
    connectionMonitorRepository: monitors,
    jobLogRepository: jobLogs,
    sdrAgentRepository: repository,
    uazapiClient: uazapi,
  });

  return { agents, monitors, jobLogs, uazapi, service };
}

describe('parseAlertRecipients', () => {
  it('aceita numeros colados de qualquer jeito e descarta o que nao e WhatsApp', () => {
    expect(parseAlertRecipients('+55 (19) 98888-0000\n5519977770000, 5519977770000; 123')).toEqual([
      '5519988880000',
      '5519977770000',
    ]);
  });

  it('devolve lista vazia quando o campo esta em branco', () => {
    expect(parseAlertRecipients(null)).toEqual([]);
  });
});

describe('monitor de conexao', () => {
  it('avisa os numeros cadastrados quando o WhatsApp de um SDR cai, com nome e hora', async () => {
    const { uazapi, service } = await buildHarness({
      'token-franc': ok({ instance: { status: 'disconnected', lastDisconnectReason: '401: logged out from another device' } }),
    });

    const result = await service.runOnce(NOW);

    expect(result.disconnected).toEqual(['Franc']);
    expect(result.recovered).toEqual([]);
    expect(result.alertsSent).toBe(1);
    expect(uazapi.sent).toHaveLength(1);
    expect(uazapi.sent[0]?.number).toBe('5519888880000');
    expect(uazapi.sent[0]?.text).toContain('Franc');
    // Hora local do alerta: 17:30 UTC = 14:30 em America/Sao_Paulo.
    expect(uazapi.sent[0]?.text).toContain('14:30');
    expect(uazapi.sent[0]?.text).toContain('logged out');
    // Mariana esta de pe: nao entra na mensagem.
    expect(uazapi.sent[0]?.text).not.toContain('Mariana');
  });

  it('nao repete o alerta enquanto o SDR continua fora', async () => {
    const { uazapi, service } = await buildHarness({
      'token-franc': ok({ instance: { status: 'disconnected' } }),
    });

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 5 * MINUTE));
    await service.runOnce(new Date(NOW.getTime() + 10 * MINUTE));

    expect(uazapi.sent).toHaveLength(1);
  });

  it('repete o alerta depois do intervalo configurado', async () => {
    const { uazapi, service } = await buildHarness(
      { 'token-franc': ok({ instance: { status: 'disconnected' } }) },
      { repeatAlertMinutes: 30 },
    );

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 29 * MINUTE));
    expect(uazapi.sent).toHaveLength(1);

    await service.runOnce(new Date(NOW.getTime() + 31 * MINUTE));
    expect(uazapi.sent).toHaveLength(2);
  });

  it('avisa a volta com o tempo que o SDR ficou fora', async () => {
    const statuses: Record<string, UazapiResult> = {
      'token-franc': ok({ instance: { status: 'disconnected' } }),
    };
    const { uazapi, service } = await buildHarness(statuses);

    await service.runOnce(NOW);
    statuses['token-franc'] = ok({ instance: { status: 'connected' } });
    const result = await service.runOnce(new Date(NOW.getTime() + 45 * MINUTE));

    expect(result.recovered).toEqual(['Franc']);
    expect(uazapi.sent).toHaveLength(2);
    expect(uazapi.sent[1]?.text).toContain('Franc');
    expect(uazapi.sent[1]?.text).toContain('45 min fora');
  });

  it('nao avisa a volta quando a opcao esta desligada', async () => {
    const statuses: Record<string, UazapiResult> = {
      'token-franc': ok({ instance: { status: 'disconnected' } }),
    };
    const { uazapi, service } = await buildHarness(statuses, { notifyOnRecovery: false });

    await service.runOnce(NOW);
    statuses['token-franc'] = ok({ instance: { status: 'connected' } });
    await service.runOnce(new Date(NOW.getTime() + 10 * MINUTE));

    expect(uazapi.sent).toHaveLength(1);
  });

  it('trata gateway fora do ar como SDR fora do ar', async () => {
    const { uazapi, service } = await buildHarness({
      'token-franc': { status: 503, ok: false, body: { error: 'service unavailable' } },
    });

    const result = await service.runOnce(NOW);

    expect(result.disconnected).toEqual(['Franc']);
    expect(uazapi.sent[0]?.text).toContain('Franc');
  });

  it('nao envia nada com o monitor desligado nem sem numero cadastrado', async () => {
    const desligado = await buildHarness({ 'token-franc': ok({ instance: { status: 'disconnected' } }) }, { isEnabled: false });
    expect((await desligado.service.runOnce(NOW)).skipped).toContain('desligado');
    expect(desligado.uazapi.sent).toHaveLength(0);

    const semNumero = await buildHarness({ 'token-franc': ok({ instance: { status: 'disconnected' } }) }, { alertRecipients: '' });
    expect((await semNumero.service.runOnce(NOW)).skipped).toContain('Nenhum numero');
    expect(semNumero.uazapi.sent).toHaveLength(0);
  });

  it('ignora SDR desligado no portal quando a opcao pede so os ativos', async () => {
    const { agents } = await makeAgents();
    const monitors = createMemoryConnectionMonitorRepository();
    await seedSettings(monitors);
    const uazapi = fakeUazapiClient({ 'token-franc': ok({ instance: { status: 'disconnected' } }) });
    const service = createConnectionMonitorService({
      connectionMonitorRepository: monitors,
      jobLogRepository: createMemoryJobLogRepository(),
      sdrAgentRepository: createMemorySdrAgentRepository(agents.map((agent) => ({ ...agent, isActive: false }))),
      uazapiClient: uazapi,
    });

    const result = await service.runOnce(NOW);

    expect(result.checked).toBe(0);
    expect(uazapi.sent).toHaveLength(0);
  });

  it('registra o alerta em job_logs, mas nao escreve linha em tick silencioso', async () => {
    const { jobLogs, service } = await buildHarness({ 'token-franc': ok({ instance: { status: 'connected' } }) });

    await service.runOnce(NOW);
    expect(await jobLogs.list()).toHaveLength(0);

    const caiu = await buildHarness({ 'token-franc': ok({ instance: { status: 'disconnected' } }) });
    await caiu.service.runOnce(NOW);
    const logs = await caiu.jobLogs.list();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.jobName).toBe('connection-monitor');
    expect(logs[0]?.result).toContain('Franc');
  });

  it('checkAgent confere so o SDR do evento', async () => {
    const { agents, uazapi, service } = await buildHarness({
      'token-franc': ok({ instance: { status: 'disconnected' } }),
      'token-mariana': ok({ instance: { status: 'disconnected' } }),
    });

    const result = await service.checkAgent(agents[0]?.id ?? '', NOW);

    expect(result.checked).toBe(1);
    expect(result.disconnected).toEqual(['Franc']);
    expect(uazapi.sent[0]?.text).not.toContain('Mariana');
  });
});

describe('webhook de conexao', () => {
  it('reconhece o evento connection e ignora o resto', () => {
    expect(readConnectionEvent({ EventType: 'connection', instance: { status: 'disconnected', id: 'inst-1' } })).toEqual({
      status: 'disconnected',
      instanceId: 'inst-1',
    });
    expect(readConnectionEvent({ event: 'messages', data: { text: 'oi' } })).toBeNull();
  });

  it('marca o evento como processado e dispara a verificacao do SDR', async () => {
    const { agents, repository } = await makeAgents();
    const monitors = createMemoryConnectionMonitorRepository();
    await seedSettings(monitors);
    const uazapi = fakeUazapiClient({ 'token-franc': ok({ instance: { status: 'disconnected' } }) });
    const app = buildApp({
      connectionMonitorRepository: monitors,
      sdrAgentRepository: repository,
      uazapiClient: uazapi,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agents[0]?.id ?? ''}`,
      payload: { EventType: 'connection', instance: { id: 'inst-1', status: 'disconnected' } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, event: 'connection' });
    expect(uazapi.sent).toHaveLength(1);
    expect(uazapi.sent[0]?.text).toContain('Franc');
    await app.close();
  });
});

describe('tela do monitor', () => {
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
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = login.headers['set-cookie'];

    return { app, cookie: Array.isArray(cookie) ? (cookie[0] ?? '') : (cookie ?? '') };
  }

  it('salva a configuracao com o token criptografado e mantem o token quando o campo vem vazio', async () => {
    const monitors = createMemoryConnectionMonitorRepository();
    const { app, cookie } = await loggedInApp({ connectionMonitorRepository: monitors });

    const salvo = await app.inject({
      method: 'POST',
      url: '/monitoring',
      headers: { cookie },
      payload: {
        isEnabled: 'on',
        uazapiBaseUrl: 'https://uazapi.test',
        uazapiInstanceTokenEncrypted: 'token-monitor',
        alertRecipients: '5519888880000',
        repeatAlertMinutes: '30',
        notifyOnRecovery: 'on',
        onlyActiveAgents: 'on',
      },
    });

    expect(salvo.statusCode).toBe(200);
    const settings = await monitors.getSettings();
    expect(settings?.isEnabled).toBe(true);
    expect(settings?.repeatAlertMinutes).toBe(30);
    expect(settings?.uazapiInstanceTokenEncrypted).not.toBe('token-monitor');
    expect(decryptSecret(settings?.uazapiInstanceTokenEncrypted ?? '')).toBe('token-monitor');

    await app.inject({
      method: 'POST',
      url: '/monitoring',
      headers: { cookie },
      payload: { isEnabled: 'on', uazapiBaseUrl: 'https://uazapi.test', alertRecipients: '5519888880000', repeatAlertMinutes: '30' },
    });

    const depois = await monitors.getSettings();
    expect(decryptSecret(depois?.uazapiInstanceTokenEncrypted ?? '')).toBe('token-monitor');
    expect(depois?.notifyOnRecovery).toBe(false);
    await app.close();
  });

  it('mostra o estado de cada SDR na tela', async () => {
    const { repository } = await makeAgents();
    const monitors = createMemoryConnectionMonitorRepository();
    await seedSettings(monitors);
    const uazapi = fakeUazapiClient({ 'token-franc': ok({ instance: { status: 'disconnected' } }) });
    const { app, cookie } = await loggedInApp({
      connectionMonitorRepository: monitors,
      sdrAgentRepository: repository,
      uazapiClient: uazapi,
    });

    const executado = await app.inject({ method: 'POST', url: '/monitoring/run', headers: { cookie } });

    expect(executado.statusCode).toBe(200);
    expect(executado.body).toContain('Franc');
    expect(executado.body).toContain('desconectado');
    expect(executado.body).toContain('Caiu agora: Franc');
    await app.close();
  });
});

describe('QR do numero do monitor', () => {
  it('pede o QR da instancia do monitor e mostra na tela', async () => {
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const monitors = createMemoryConnectionMonitorRepository();
    await seedSettings(monitors);
    const uazapi = fakeUazapiClient({
      'token-monitor': ok({ instance: { status: 'connecting', qrcode: '2@abc', paircode: 'ABCD-1234' } }),
    });
    const app = buildApp({ authRepository, connectionMonitorRepository: monitors, uazapiClient: uazapi });
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const rawCookie = login.headers['set-cookie'];
    const cookie = Array.isArray(rawCookie) ? (rawCookie[0] ?? '') : (rawCookie ?? '');

    const response = await app.inject({ method: 'POST', url: '/monitoring/qr', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Numero do monitor');
    expect(response.body).toContain('ABCD-1234');
    await app.close();
  });
});
