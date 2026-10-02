import { describe, expect, it } from 'vitest';

import type { SdrConnectionEvent } from '../src/db/schema.js';
import { buildDashboardViewModel } from '../src/modules/dashboard/dashboard-view-model.js';
import { computeChannelHealth } from '../src/modules/monitoring/channel-health.js';
import {
  createMemoryConnectionMonitorRepository,
  defaultMonitorSettings,
} from '../src/modules/monitoring/connection-monitor-repository.js';
import { createConnectionMonitorService } from '../src/modules/monitoring/connection-monitor-service.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const HOUR = 60 * 60000;
const DAY = 24 * HOUR;
const event = (status: 'connected' | 'disconnected', at: Date): Pick<SdrConnectionEvent, 'occurredAt' | 'status'> => ({ status, occurredAt: at });
const sempreAberto = () => true;

describe('conta do tempo conectado', () => {
  const from = new Date('2026-09-22T00:00:00.000Z');
  const to = new Date('2026-09-29T00:00:00.000Z');

  it('sem historico nao inventa numero', () => {
    const health = computeChannelHealth({ events: [], from, to, isInsideWindow: sempreAberto });

    expect(health.percent).toBeNull();
  });

  it('conta so o horario de envio: queda de madrugada nao pesa', () => {
    // Caiu 00h e voltou 06h de cada... aqui, uma queda so, de madrugada, com janela 15h-21h UTC.
    const janela = (at: Date) => at.getUTCHours() >= 15 && at.getUTCHours() < 21;
    const events = [
      event('connected', new Date(from.getTime() - DAY)),
      event('disconnected', new Date('2026-09-23T01:00:00.000Z')),
      event('connected', new Date('2026-09-23T05:00:00.000Z')),
    ];

    const health = computeChannelHealth({ events, from, to, isInsideWindow: janela });

    expect(health.percent).toBe(100);
    expect(health.drops).toBe(1);
    expect(health.averageReconnectMinutes).toBe(4 * 60);
    expect(health.downForMinutes).toBeNull();
  });

  it('mede a queda que ainda nao voltou', () => {
    const events = [event('connected', new Date(from.getTime() - DAY)), event('disconnected', new Date(to.getTime() - 2 * DAY))];

    const health = computeChannelHealth({ events, from, to, isInsideWindow: sempreAberto });

    // 5 de 7 dias no ar.
    expect(health.percent).toBe(71);
    expect(health.downForMinutes).toBe(2 * 24 * 60);
    expect(health.averageReconnectMinutes).toBeNull();
  });

  it('com historico curto mede so o periodo coberto', () => {
    const events = [event('connected', new Date(to.getTime() - DAY))];

    const health = computeChannelHealth({ events, from, to, isInsideWindow: sempreAberto });

    expect(health.coveredFrom).toEqual(new Date(to.getTime() - DAY));
    expect(health.percent).toBe(100);
  });
});

function uazapiCom(status: string): UazapiClient {
  const ok = (body: unknown): UazapiResult => ({ status: 200, ok: true, body });
  return {
    checkChats: async () => ok({}),
    configureWebhook: async () => ok({}),
    downloadMessage: async () => ok({}),
    getInstanceStatus: async () => ok({ instance: { status, lastDisconnectReason: status === 'connected' ? null : 'same number connected' } }),
    sendContact: async () => ok({}),
    sendPresence: async () => ok({}),
    sendText: async () => ok({ messageid: 'm1' }),
  } as UazapiClient;
}

describe('monitor grava o historico', () => {
  it('grava a primeira leitura e cada transicao, nao cada tick', async () => {
    const agents = createMemorySdrAgentRepository();
    await agents.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      isActive: true,
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('token-mariana'),
    });
    const monitors = createMemoryConnectionMonitorRepository();
    await monitors.saveSettings({
      ...defaultMonitorSettings(),
      isEnabled: true,
      uazapiBaseUrl: 'https://uazapi.test',
      uazapiInstanceTokenEncrypted: encryptSecret('token-monitor'),
      alertRecipients: '5519888880000',
    });
    const run = (status: string, at: Date) =>
      createConnectionMonitorService({
        connectionMonitorRepository: monitors,
        jobLogRepository: createMemoryJobLogRepository(),
        sdrAgentRepository: agents,
        uazapiClient: uazapiCom(status),
      }).runOnce(at);

    const t0 = new Date('2026-09-29T18:00:00.000Z');
    await run('connected', t0);
    await run('connected', new Date(t0.getTime() + 5 * 60000));
    await run('disconnected', new Date(t0.getTime() + 10 * 60000));
    await run('disconnected', new Date(t0.getTime() + 15 * 60000));
    await run('connected', new Date(t0.getTime() + 20 * 60000));

    const events = await monitors.listConnectionEvents(new Date(0));
    expect(events.map((item) => item.status)).toEqual(['connected', 'disconnected', 'connected']);
    expect(events[1]?.reason).toContain('same number connected');
  });
});

describe('painel mostra a saude do WhatsApp', () => {
  it('avisa o SDR abaixo da meta e diz ha quanto tempo esta fora', async () => {
    const agents = createMemorySdrAgentRepository();
    const mariana = await agents.create({
      companyId: 'c1',
      name: 'Mariana',
      displayName: 'Mariana',
      isActive: true,
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      sendDaysOfWeek: '0,1,2,3,4,5,6',
    });
    const now = new Date('2026-10-02T12:00:00.000Z');
    const connectionEvents: SdrConnectionEvent[] = [
      { id: 'e1', sdrAgentId: mariana.id, status: 'connected', reason: null, occurredAt: new Date(now.getTime() - 10 * DAY), createdAt: now },
      { id: 'e2', sdrAgentId: mariana.id, status: 'disconnected', reason: 'same number connected', occurredAt: new Date(now.getTime() - 3 * DAY), createdAt: now },
    ];

    const model = buildDashboardViewModel({
      aiRuns: [],
      companies: [],
      connectionEvents,
      conversations: [],
      filters: { activeOnly: true, companyId: '', period: '7d', sdrAgentId: '', stage: '', status: '' },
      jobLogs: [],
      leads: [],
      messages: [],
      now,
      sdrAgents: await agents.list(),
      userLabel: 'Admin',
    });

    expect(model.channelRows[0]?.connectedLabel).toBe('57%');
    expect(model.channelRows[0]?.downNowLabel).toBe('3d');
    expect(model.alerts.join(' ')).toContain('Mariana (57%, fora ha 3d)');
  });
});
