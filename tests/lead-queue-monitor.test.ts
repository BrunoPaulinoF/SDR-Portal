import { describe, expect, it } from 'vitest';

import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import {
  createMemoryConnectionMonitorRepository,
  defaultMonitorSettings,
  type ConnectionMonitorRepository,
  type MonitorSettingsInput,
} from '../src/modules/monitoring/connection-monitor-repository.js';
import { buildLeadQueueAlert } from '../src/modules/monitoring/lead-queue-message.js';
import { createLeadQueueMonitorService } from '../src/modules/monitoring/lead-queue-monitor-service.js';
import { createMemorySdrAgentRepository, type SdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { Lead, SdrAgent } from '../src/db/schema.js';

const NOW = new Date('2026-09-02T17:00:00.000Z');

function ok(body: unknown): UazapiResult {
  return { status: 200, ok: true, body };
}

function fakeUazapiClient(): UazapiClient & { sent: SendTextInput[] } {
  const sent: SendTextInput[] = [];
  const naoUsado = async (): Promise<UazapiResult> => ok({});
  const client = {
    sent,
    checkChats: naoUsado,
    configureWebhook: naoUsado,
    connectInstance: naoUsado,
    createInstance: naoUsado,
    deleteInstance: naoUsado,
    downloadMessage: naoUsado,
    getInstanceStatus: naoUsado,
    listInstances: naoUsado,
    sendContact: naoUsado,
    sendPresence: naoUsado,
    async sendText(input: SendTextInput) {
      sent.push(input);
      return ok({ messageid: 'm1' });
    },
  };

  return client as unknown as UazapiClient & { sent: SendTextInput[] };
}

function lead(id: string, sdrAgentId: string, status = 'pending'): Lead {
  const now = new Date('2026-09-01T12:00:00.000Z');
  return {
    id,
    companyId: 'company-1',
    sdrAgentId,
    whatsappNumber: `55199999${id}`,
    whatsappJid: null,
    whatsappLid: null,
    cnpj: null,
    companyName: `Lead ${id}`,
    tradeName: null,
    segment: null,
    city: null,
    state: null,
    contactName: null,
    extraData: null,
    status,
    conversationStage: 'permission',
    source: 'manual',
    firstMessageVariantId: null,
    firstMessageSentAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    followupDueAt: null,
    followupSentAt: null,
    followupDisabledAt: null,
    followupAttempts: 0,
    humanPausedUntil: null,
    aiPausedAt: null,
    aiPauseReason: null,
    handoffRequestedAt: null,
    handoffSummary: null,
    notInterestedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedSettings(repository: ConnectionMonitorRepository, overrides: Partial<MonitorSettingsInput> = {}): Promise<void> {
  await repository.saveSettings({
    ...defaultMonitorSettings(),
    isEnabled: true,
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-monitor'),
    alertRecipients: '5519888880000',
    leadsAlertEnabled: true,
    ...overrides,
  });
}

interface Harness {
  agent: SdrAgent;
  leads: ReturnType<typeof createMemoryLeadRepository>;
  monitors: ConnectionMonitorRepository;
  jobLogs: ReturnType<typeof createMemoryJobLogRepository>;
  uazapi: ReturnType<typeof fakeUazapiClient>;
  service: ReturnType<typeof createLeadQueueMonitorService>;
  agents: SdrAgentRepository;
}

async function buildHarness(pendentes: number, overrides: Partial<MonitorSettingsInput> = {}): Promise<Harness> {
  const agents = createMemorySdrAgentRepository();
  const agent = await agents.create({ companyId: 'company-1', name: 'Franc', displayName: 'Franc', isActive: true });
  const seed = Array.from({ length: pendentes }, (_, index) => lead(`p${index}`, agent.id));
  // Lead ja abordado nao conta como fila.
  seed.push(lead('abordado', agent.id, 'initial_sent'));
  const leads = createMemoryLeadRepository(seed);
  const monitors = createMemoryConnectionMonitorRepository();
  await seedSettings(monitors, overrides);
  const uazapi = fakeUazapiClient();
  const jobLogs = createMemoryJobLogRepository();
  const service = createLeadQueueMonitorService({
    connectionMonitorRepository: monitors,
    jobLogRepository: jobLogs,
    leadRepository: leads,
    sdrAgentRepository: agents,
    uazapiClient: uazapi,
  });

  return { agent, agents, leads, monitors, jobLogs, uazapi, service };
}

describe('aviso de fila de leads', () => {
  it('avisa quando a fila zera, contando so os leads pendentes', async () => {
    const { uazapi, service } = await buildHarness(0);

    const result = await service.runOnce(NOW);

    expect(result.emptied).toEqual([{ name: 'Franc', pendingLeads: 0 }]);
    expect(uazapi.sent).toHaveLength(1);
    expect(uazapi.sent[0]?.text).toContain('Franc');
    expect(uazapi.sent[0]?.text).toContain('0 lead(s) na fila');
  });

  it('nao avisa enquanto ainda ha fila', async () => {
    const { uazapi, service } = await buildHarness(5);

    const result = await service.runOnce(NOW);

    expect(result.emptied).toEqual([]);
    expect(result.queues).toEqual([{ name: 'Franc', pendingLeads: 5 }]);
    expect(uazapi.sent).toHaveLength(0);
  });

  it('avisa uma vez so enquanto a fila continua vazia', async () => {
    const { uazapi, service } = await buildHarness(0);

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 15 * 60000));
    await service.runOnce(new Date(NOW.getTime() + 30 * 60000));

    expect(uazapi.sent).toHaveLength(1);
  });

  it('rearma quando entram leads novos e avisa de novo ao esvaziar', async () => {
    const { agent, leads, uazapi, service } = await buildHarness(0);

    await service.runOnce(NOW);
    expect(uazapi.sent).toHaveLength(1);

    const novo = await leads.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: '5519999997777',
      companyName: 'Lead novo',
    });
    const comFila = await service.runOnce(new Date(NOW.getTime() + 60 * 60000));
    expect(comFila.refilled).toEqual(['Franc']);
    expect(uazapi.sent).toHaveLength(1);

    await leads.markInitialSent(novo.id, new Date(), null);
    await service.runOnce(new Date(NOW.getTime() + 120 * 60000));
    expect(uazapi.sent).toHaveLength(2);
  });

  it('respeita o limite configurado, avisando antes de zerar', async () => {
    const { uazapi, service } = await buildHarness(10, { leadsAlertThreshold: 10 });

    const result = await service.runOnce(NOW);

    expect(result.emptied).toEqual([{ name: 'Franc', pendingLeads: 10 }]);
    expect(uazapi.sent[0]?.text).toContain('10 lead(s) na fila');
  });

  it('nao mistura a memoria da fila com a da conexao', async () => {
    const { agent, monitors, service } = await buildHarness(0);

    await service.runOnce(NOW);
    await monitors.saveState({
      sdrAgentId: agent.id,
      status: 'disconnected',
      instanceStatus: 'disconnected',
      disconnectReason: '401',
      lastCheckedAt: NOW,
      lastConnectedAt: null,
      disconnectedAt: NOW,
      lastAlertAt: NOW,
    });

    const estado = await monitors.findState(agent.id);
    expect(estado?.status).toBe('disconnected');
    // O alerta de queda nao pode apagar a marca da fila, senao o aviso repetiria.
    expect(estado?.leadsAlertAt).not.toBeNull();
    expect(estado?.pendingLeads).toBe(0);
  });

  it('respeita as chaves de desligado e a falta de numero', async () => {
    const desligado = await buildHarness(0, { leadsAlertEnabled: false });
    expect((await desligado.service.runOnce(NOW)).skipped).toContain('desligado');
    expect(desligado.uazapi.sent).toHaveLength(0);

    const semNumero = await buildHarness(0, { alertRecipients: '' });
    expect((await semNumero.service.runOnce(NOW)).skipped).toContain('Nenhum numero');
  });

  it('ignora SDR desligado quando a opcao pede so os ativos', async () => {
    const { agents, agent, monitors, uazapi, leads, jobLogs } = await buildHarness(0);
    await agents.setActive(agent.id, false);
    const service = createLeadQueueMonitorService({
      connectionMonitorRepository: monitors,
      jobLogRepository: jobLogs,
      leadRepository: leads,
      sdrAgentRepository: agents,
      uazapiClient: uazapi,
    });

    const result = await service.runOnce(NOW);

    expect(result.checked).toBe(0);
    expect(uazapi.sent).toHaveLength(0);
  });

  it('registra o aviso em job_logs e nao escreve em tick sem novidade', async () => {
    const comFila = await buildHarness(3);
    await comFila.service.runOnce(NOW);
    expect(await comFila.jobLogs.list()).toHaveLength(0);

    const vazia = await buildHarness(0);
    await vazia.service.runOnce(NOW);
    const logs = await vazia.jobLogs.list();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.jobName).toBe('lead-queue-monitor');
  });
});

describe('texto do aviso de fila', () => {
  it('lista os SDRs e usa o link do portal quando existe', () => {
    const texto = buildLeadQueueAlert({
      template: null,
      sdrs: [
        { name: 'Franc', pendingLeads: 0 },
        { name: 'Mariana', pendingLeads: 0 },
      ],
      now: NOW,
      timeZone: 'America/Sao_Paulo',
      portalUrl: 'https://portal.test/',
    });

    expect(texto).toContain('• Franc — 0 lead(s) na fila');
    expect(texto).toContain('• Mariana — 0 lead(s) na fila');
    expect(texto).toContain('https://portal.test/leads/import');
  });

  it('aceita texto proprio', () => {
    const texto = buildLeadQueueAlert({
      template: 'Sem leads: {sdrs}',
      sdrs: [{ name: 'Franc', pendingLeads: 0 }],
      now: NOW,
      timeZone: 'America/Sao_Paulo',
      portalUrl: null,
    });

    expect(texto).toBe('Sem leads: • Franc — 0 lead(s) na fila');
  });
});
