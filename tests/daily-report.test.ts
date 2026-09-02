import { describe, expect, it } from 'vitest';

import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import {
  createMemoryConnectionMonitorRepository,
  defaultMonitorSettings,
  type ConnectionMonitorRepository,
  type MonitorSettingsInput,
} from '../src/modules/monitoring/connection-monitor-repository.js';
import { buildDailyReport } from '../src/modules/monitoring/daily-report-message.js';
import { createDailyReportService, isReportDue, parseReportTime } from '../src/modules/monitoring/daily-report-service.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { Lead, MonitorSettings } from '../src/db/schema.js';

/** 01/09/2026 as 18:40 em America/Sao_Paulo (UTC-3): depois da hora padrao do relatorio. */
const DEPOIS_DA_HORA = new Date('2026-09-01T21:40:00.000Z');
/** Mesmo dia, 14:00 local: antes da hora. */
const ANTES_DA_HORA = new Date('2026-09-01T17:00:00.000Z');

function ok(body: unknown): UazapiResult {
  return { status: 200, ok: true, body };
}

function fakeUazapiClient(sendResult: UazapiResult = ok({ messageid: 'm1' })): UazapiClient & { sent: SendTextInput[] } {
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
      return sendResult;
    },
  };

  return client as unknown as UazapiClient & { sent: SendTextInput[] };
}

function lead(overrides: Partial<Lead>): Lead {
  const now = new Date('2026-09-01T12:00:00.000Z');
  return {
    id: overrides.id ?? 'lead-1',
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber: '5519999990000',
    whatsappJid: null,
    whatsappLid: null,
    cnpj: null,
    companyName: 'Empresa',
    tradeName: null,
    segment: null,
    city: null,
    state: null,
    contactName: null,
    extraData: null,
    status: 'pending',
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
    ...overrides,
  };
}

async function seedSettings(
  repository: ConnectionMonitorRepository,
  overrides: Partial<MonitorSettingsInput> = {},
): Promise<MonitorSettings> {
  return repository.saveSettings({
    ...defaultMonitorSettings(),
    isEnabled: true,
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('token-monitor'),
    alertRecipients: '5519888880000',
    dailyReportEnabled: true,
    ...overrides,
  });
}

/** Hoje: 3 prospectados, 2 responderam, 1 handoff. Ontem nao pode entrar na conta. */
function leadsDeHoje(): Lead[] {
  const hoje = new Date('2026-09-01T15:00:00.000Z');
  const ontem = new Date('2026-08-31T15:00:00.000Z');
  return [
    lead({ id: 'l1', firstMessageSentAt: hoje }),
    lead({ id: 'l2', firstMessageSentAt: hoje, lastInboundAt: hoje }),
    lead({ id: 'l3', firstMessageSentAt: hoje, lastInboundAt: hoje, handoffRequestedAt: hoje }),
    lead({ id: 'l4', firstMessageSentAt: ontem, lastInboundAt: ontem, handoffRequestedAt: ontem }),
    lead({ id: 'l5', sdrAgentId: 'sdr-2', firstMessageSentAt: hoje }),
  ];
}

async function buildHarness(overrides: Partial<MonitorSettingsInput> = {}, seedLeads: Lead[] = leadsDeHoje()) {
  const agents = createMemorySdrAgentRepository();
  const franc = await agents.create({ companyId: 'company-1', name: 'Franc', displayName: 'Franc', isActive: true });
  const monitors = createMemoryConnectionMonitorRepository();
  await seedSettings(monitors, overrides);
  const uazapi = fakeUazapiClient();
  const jobLogs = createMemoryJobLogRepository();
  const service = createDailyReportService({
    connectionMonitorRepository: monitors,
    jobLogRepository: jobLogs,
    leadRepository: createMemoryLeadRepository(seedLeads.map((l) => ({ ...l, sdrAgentId: l.sdrAgentId === 'sdr-1' ? franc.id : l.sdrAgentId }))),
    sdrAgentRepository: agents,
    uazapiClient: uazapi,
  });

  return { agents, franc, monitors, jobLogs, uazapi, service };
}

describe('hora do relatorio', () => {
  it('le HH:MM e recusa hora invalida', () => {
    expect(parseReportTime('18:30')).toBe(1110);
    expect(parseReportTime('9:05')).toBe(545);
    expect(parseReportTime('25:00')).toBeNull();
    expect(parseReportTime('')).toBeNull();
    expect(parseReportTime(null)).toBeNull();
  });

  it('so vence depois da hora marcada no fuso do portal', async () => {
    const monitors = createMemoryConnectionMonitorRepository();
    const settings = await seedSettings(monitors);

    expect(isReportDue(settings, ANTES_DA_HORA, 'America/Sao_Paulo')).toBe(false);
    expect(isReportDue(settings, DEPOIS_DA_HORA, 'America/Sao_Paulo')).toBe(true);
  });
});

describe('relatorio do fim do dia', () => {
  it('conta prospectados, responderam e possiveis clientes do dia por SDR ativo', async () => {
    const { uazapi, service } = await buildHarness();

    const result = await service.runOnce(DEPOIS_DA_HORA);

    expect(result.skipped).toBeNull();
    expect(result.sdrs).toEqual([{ name: 'Franc', prospected: 3, responded: 2, handoffs: 1 }]);
    expect(uazapi.sent).toHaveLength(1);
    const texto = uazapi.sent[0]?.text ?? '';
    expect(texto).toContain('Franc');
    expect(texto).toContain('Prospectados: 3');
    expect(texto).toContain('Responderam: 2');
    expect(texto).toContain('Possiveis clientes: 1');
    expect(texto).toContain('01/09/2026');
  });

  it('nao envia antes da hora nem repete no mesmo dia', async () => {
    const { uazapi, service } = await buildHarness();

    expect((await service.runOnce(ANTES_DA_HORA)).skipped).toContain('Ainda nao deu a hora');
    expect(uazapi.sent).toHaveLength(0);

    await service.runOnce(DEPOIS_DA_HORA);
    expect(uazapi.sent).toHaveLength(1);

    // Ticks seguintes do mesmo dia nao podem mandar de novo.
    expect((await service.runOnce(new Date(DEPOIS_DA_HORA.getTime() + 15 * 60000))).skipped).toContain('ja foi enviado');
    expect(uazapi.sent).toHaveLength(1);
  });

  it('volta a enviar no dia seguinte', async () => {
    const { uazapi, service } = await buildHarness();

    await service.runOnce(DEPOIS_DA_HORA);
    await service.runOnce(new Date(DEPOIS_DA_HORA.getTime() + 24 * 60 * 60000));

    expect(uazapi.sent).toHaveLength(2);
  });

  it('tick perdido nao come o relatorio: sai na passada seguinte', async () => {
    const { uazapi, service } = await buildHarness();

    // Container fora as 18:30; primeira passada so as 22:00 local.
    await service.runOnce(new Date('2026-09-02T01:00:00.000Z'));

    expect(uazapi.sent).toHaveLength(1);
  });

  it('nao marca o dia quando nenhum envio deu certo', async () => {
    const { agents, monitors } = await buildHarness();
    const recusaTudo = fakeUazapiClient({ status: 500, ok: false, body: { error: 'instancia fora' } });
    const comFalha = createDailyReportService({
      connectionMonitorRepository: monitors,
      jobLogRepository: createMemoryJobLogRepository(),
      leadRepository: createMemoryLeadRepository([]),
      sdrAgentRepository: agents,
      uazapiClient: recusaTudo,
    });

    const result = await comFalha.runOnce(DEPOIS_DA_HORA);

    expect(result.errors).toHaveLength(1);
    expect(result.sent).toBe(0);
    // Sem a marca, o proximo tick tenta de novo em vez de dar o dia por entregue.
    expect((await monitors.getSettings())?.lastDailyReportOn).toBeNull();
  });

  it('respeita as chaves de desligado', async () => {
    const semRelatorio = await buildHarness({ dailyReportEnabled: false });
    expect((await semRelatorio.service.runOnce(DEPOIS_DA_HORA)).skipped).toContain('Relatorio diario desligado');

    const semMonitor = await buildHarness({ isEnabled: false });
    expect((await semMonitor.service.runOnce(DEPOIS_DA_HORA)).skipped).toContain('desligado');

    const semNumero = await buildHarness({ alertRecipients: '' });
    expect((await semNumero.service.runOnce(DEPOIS_DA_HORA)).skipped).toContain('Nenhum numero');
  });

  it('salvar a tela nao reabre o envio do dia', async () => {
    const { monitors, service, uazapi } = await buildHarness();

    await service.runOnce(DEPOIS_DA_HORA);
    await seedSettings(monitors, { dailyReportTime: '19:00' });

    expect((await monitors.getSettings())?.lastDailyReportOn).toBe('2026-09-01');
    await service.runOnce(new Date(DEPOIS_DA_HORA.getTime() + 30 * 60000));
    expect(uazapi.sent).toHaveLength(1);
  });

  it('botao da tela envia na hora sem gastar o relatorio do dia', async () => {
    const { monitors, service, uazapi } = await buildHarness();

    const manual = await service.sendNow(ANTES_DA_HORA);

    expect(manual.sent).toBe(1);
    expect((await monitors.getSettings())?.lastDailyReportOn).toBeNull();
    await service.runOnce(DEPOIS_DA_HORA);
    expect(uazapi.sent).toHaveLength(2);
  });

  it('registra o envio em job_logs', async () => {
    const { jobLogs, service } = await buildHarness();

    await service.runOnce(DEPOIS_DA_HORA);
    const logs = await jobLogs.list();

    expect(logs).toHaveLength(1);
    expect(logs[0]?.jobName).toBe('daily-report');
    expect(logs[0]?.result).toContain('Franc');
  });
});

describe('texto do relatorio', () => {
  const base = { now: DEPOIS_DA_HORA, timeZone: 'America/Sao_Paulo', portalUrl: null };

  it('soma o total quando ha mais de um SDR', () => {
    const texto = buildDailyReport({
      ...base,
      template: null,
      sdrs: [
        { name: 'Franc', prospected: 3, responded: 2, handoffs: 1 },
        { name: 'Mariana', prospected: 5, responded: 1, handoffs: 0 },
      ],
    });

    expect(texto).toContain('Total: 8 prospectado(s), 3 responderam, 1 possivel(is) cliente(s).');
  });

  it('aceita texto proprio com marcadores', () => {
    const texto = buildDailyReport({
      ...base,
      template: 'Fechamento {data}\n{sdrs}',
      sdrs: [{ name: 'Franc', prospected: 1, responded: 0, handoffs: 0 }],
    });

    expect(texto.startsWith('Fechamento 01/09/2026')).toBe(true);
    expect(texto).toContain('Prospectados: 1');
  });

  it('avisa quando nenhum SDR esta ativo', () => {
    expect(buildDailyReport({ ...base, template: null, sdrs: [] })).toContain('Nenhum SDR ativo hoje.');
  });
});
