import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { encryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiActionOutcome } from '../uazapi/action-summary.js';
import { requestConnectionQr, type InstanceConnectionState } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { MonitorSettings } from '../../db/schema.js';
import type { ConnectionMonitorRepository } from './connection-monitor-repository.js';
import { defaultMonitorSettings } from './connection-monitor-repository.js';
import { monitorCredentials, type ConnectionMonitorService, type MonitorRunResult } from './connection-monitor-service.js';
import type { DailyReportResult, DailyReportService } from './daily-report-service.js';
import type { LeadQueueMonitorService, LeadQueueResult } from './lead-queue-monitor-service.js';
import { MONITOR_CHECKBOXES, MONITOR_TAB_FIELDS, MONITOR_TABS, renderMonitorPage, resolveMonitorTab, type MonitorTab } from './monitor-pages.js';

const checkbox = z.preprocess((value) => value === 'on' || value === 'true', z.boolean());

const settingsFormSchema = z.object({
  isEnabled: checkbox.default(false),
  uazapiBaseUrl: z.string().trim().optional().default(''),
  uazapiInstanceId: z.string().trim().optional().default(''),
  uazapiInstanceTokenEncrypted: z.string().trim().optional().default(''),
  alertRecipients: z.string().trim().optional().default(''),
  alertTemplate: z.string().optional().default(''),
  recoveryTemplate: z.string().optional().default(''),
  notifyOnRecovery: checkbox.default(false),
  onlyActiveAgents: checkbox.default(false),
  repeatAlertMinutes: z.coerce.number().int().nonnegative().default(0),
  dailyReportEnabled: checkbox.default(false),
  dailyReportTime: z.string().trim().regex(/^\d{1,2}:\d{2}$/).optional().default('18:30'),
  dailyReportTemplate: z.string().optional().default(''),
  leadsAlertEnabled: checkbox.default(false),
  leadsAlertThreshold: z.coerce.number().int().nonnegative().default(0),
  leadsAlertTemplate: z.string().optional().default(''),
});

const tabParamsSchema = z.object({ aba: z.enum(MONITOR_TABS) });

/** O que esta gravado, no formato que o formulario envia. Token em branco = manter o salvo. */
function settingsToBody(settings: MonitorSettings | null): Record<string, string> {
  const current = settings ?? { ...defaultMonitorSettings(), lastDailyReportOn: null };
  const body: Record<string, string> = {
    uazapiBaseUrl: current.uazapiBaseUrl ?? '',
    uazapiInstanceId: current.uazapiInstanceId ?? '',
    uazapiInstanceTokenEncrypted: '',
    alertRecipients: current.alertRecipients ?? '',
    alertTemplate: current.alertTemplate ?? '',
    recoveryTemplate: current.recoveryTemplate ?? '',
    repeatAlertMinutes: String(current.repeatAlertMinutes),
    dailyReportTime: current.dailyReportTime,
    dailyReportTemplate: current.dailyReportTemplate ?? '',
    leadsAlertThreshold: String(current.leadsAlertThreshold),
    leadsAlertTemplate: current.leadsAlertTemplate ?? '',
  };
  const flags: Record<string, boolean> = {
    isEnabled: current.isEnabled,
    notifyOnRecovery: current.notifyOnRecovery,
    onlyActiveAgents: current.onlyActiveAgents,
    dailyReportEnabled: current.dailyReportEnabled,
    leadsAlertEnabled: current.leadsAlertEnabled,
  };
  for (const [key, on] of Object.entries(flags)) if (on) body[key] = 'on';
  return body;
}

/** Junta a aba enviada com o resto gravado: caixa ausente = desligada; texto ausente = fica o gravado. */
function mergeMonitorTab(settings: MonitorSettings | null, tab: MonitorTab, submitted: Record<string, unknown>): Record<string, string> {
  const merged = settingsToBody(settings);
  for (const field of MONITOR_TAB_FIELDS[tab]) {
    const value = submitted[field];
    if (MONITOR_CHECKBOXES.has(field)) {
      if (value) merged[field] = 'on';
      else delete merged[field];
    } else if (typeof value === 'string') {
      merged[field] = value;
    }
  }
  return merged;
}

function wantsJson(request: FastifyRequest): boolean {
  return (request.headers.accept ?? '').includes('application/json');
}

function runOutcome(result: MonitorRunResult): UazapiActionOutcome {
  if (result.skipped) {
    return { title: 'Verificacao das conexoes', ok: false, summary: result.skipped, hint: 'Ligue o monitor na aba Numero e destinatarios.', raw: null };
  }
  return {
    title: 'Verificacao das conexoes',
    ok: result.errors.length === 0,
    summary: `${result.checked} SDR(s) verificado(s). Caiu agora: ${result.disconnected.length ? result.disconnected.join(', ') : 'nenhum'}. Voltou agora: ${result.recovered.length ? result.recovered.join(', ') : 'nenhum'}. Avisos entregues: ${result.alertsSent} de ${result.recipients} numero(s).`,
    hint: null,
    raw: result.errors.length ? result.errors.join('\n') : null,
  };
}

function testOutcome(test: { sent: number; recipients: number; errors: string[] }): UazapiActionOutcome {
  return {
    title: 'Mensagem de teste',
    ok: test.sent > 0 && test.errors.length === 0,
    summary: `Teste enviado para ${test.sent} de ${test.recipients} numero(s).`,
    hint: test.recipients === 0 ? 'Cadastre os numeros que recebem os avisos nesta aba e salve.' : test.sent === 0 ? 'Confira se o numero do monitor esta conectado.' : null,
    raw: test.errors.length ? test.errors.join('\n') : null,
  };
}

function reportOutcome(result: DailyReportResult): UazapiActionOutcome {
  return {
    title: 'Relatorio diario',
    ok: !result.skipped && result.errors.length === 0,
    summary: result.skipped ?? `Relatorio entregue para ${result.sent} de ${result.recipients} numero(s).`,
    hint: result.skipped ? 'Ligue o monitor e cadastre o numero e os destinatarios na aba Numero e destinatarios.' : null,
    raw: [result.message, ...result.errors].filter(Boolean).join('\n\n') || null,
  };
}

function leadQueueOutcome(result: LeadQueueResult): UazapiActionOutcome {
  if (result.skipped) {
    return { title: 'Fila de leads', ok: false, summary: result.skipped, hint: 'Ligue o monitor na aba Numero e destinatarios.', raw: null };
  }
  const filas = result.queues.map((fila) => `${fila.name}: ${fila.pendingLeads} lead(s)`).join('; ');
  return {
    title: 'Fila de leads',
    ok: result.errors.length === 0,
    summary: `${filas || 'Nenhum SDR vigiado.'} Acabou agora: ${result.emptied.length ? result.emptied.map((sdr) => sdr.name).join(', ') : 'nenhum'}. Avisos entregues: ${result.alertsSent} de ${result.recipients} numero(s).`,
    hint: null,
    raw: result.errors.length ? result.errors.join('\n') : null,
  };
}

function emptyToNull(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

/** URL do webhook que a UAZAPI ja chama por SDR: a tela so mostra o formato. */
function webhookUrlHint(): string | null {
  if (!env.APP_URL) return null;
  return new URL('/webhooks/uazapi/<id-do-sdr>', env.APP_URL).toString();
}

function sendOutcome(reply: FastifyReply, outcome: UazapiActionOutcome) {
  return reply.type('application/json').send(outcome);
}

export function registerMonitorRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  connectionMonitorRepository: ConnectionMonitorRepository,
  connectionMonitorService: ConnectionMonitorService,
  dailyReportService: DailyReportService,
  leadQueueMonitorService: LeadQueueMonitorService,
  uazapiClient: UazapiClient,
): void {
  async function renderPage(
    extra: {
      tab?: MonitorTab;
      error?: string;
      notice?: string;
      runResult?: MonitorRunResult;
      qr?: InstanceConnectionState;
      reportResult?: DailyReportResult;
      leadQueueResult?: LeadQueueResult;
    } = {},
  ): Promise<string> {
    const [settings, agents, states] = await Promise.all([
      connectionMonitorRepository.getSettings(),
      sdrAgentRepository.list(),
      connectionMonitorRepository.listStates(),
    ]);

    return renderMonitorPage({
      settings,
      agents,
      states,
      timeZone: env.DEFAULT_TIMEZONE,
      portalUrl: env.APP_URL ?? null,
      webhookUrlHint: webhookUrlHint(),
      lastDailyReportOn: settings?.lastDailyReportOn ?? null,
      ...extra,
    });
  }

  app.get('/monitoring', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const tab = resolveMonitorTab((request.query as { aba?: unknown } | undefined)?.aba);
    return reply.type('text/html').send(await renderPage({ tab }));
  });

  // Cada aba salva so os campos dela; o resto vai com o valor gravado.
  app.post('/monitoring/aba/:aba', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = tabParamsSchema.safeParse(request.params);
    if (!params.success) return reply.redirect('/monitoring');
    const tab = params.data.aba;

    const current = await connectionMonitorRepository.getSettings();
    const submitted = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const parsed = settingsFormSchema.safeParse(mergeMonitorTab(current, tab, submitted));
    if (!parsed.success) {
      return reply.status(400).type('text/html').send(await renderPage({ tab, error: 'Confira os campos do formulario.' }));
    }

    const data = parsed.data;

    await connectionMonitorRepository.saveSettings({
      ...defaultMonitorSettings(),
      isEnabled: data.isEnabled,
      uazapiBaseUrl: emptyToNull(data.uazapiBaseUrl),
      uazapiInstanceId: emptyToNull(data.uazapiInstanceId),
      // Campo em branco preserva o token salvo: a tela nunca devolve o segredo para reenvio.
      uazapiInstanceTokenEncrypted:
        data.uazapiInstanceTokenEncrypted.length > 0
          ? encryptSecret(data.uazapiInstanceTokenEncrypted)
          : (current?.uazapiInstanceTokenEncrypted ?? null),
      alertRecipients: emptyToNull(data.alertRecipients),
      alertTemplate: emptyToNull(data.alertTemplate),
      recoveryTemplate: emptyToNull(data.recoveryTemplate),
      notifyOnRecovery: data.notifyOnRecovery,
      onlyActiveAgents: data.onlyActiveAgents,
      repeatAlertMinutes: data.repeatAlertMinutes,
      dailyReportEnabled: data.dailyReportEnabled,
      dailyReportTime: data.dailyReportTime,
      dailyReportTemplate: emptyToNull(data.dailyReportTemplate),
      leadsAlertEnabled: data.leadsAlertEnabled,
      leadsAlertThreshold: data.leadsAlertThreshold,
      leadsAlertTemplate: emptyToNull(data.leadsAlertTemplate),
    });

    return reply.redirect(`/monitoring${tab === 'queda' ? '?salvo=1' : `?aba=${tab}&salvo=1`}`);
  });

  app.post('/monitoring/run', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const runResult = await connectionMonitorService.runOnce();
    if (wantsJson(request)) return sendOutcome(reply, runOutcome(runResult));
    return reply.type('text/html').send(await renderPage({ tab: 'queda', runResult }));
  });

  app.post('/monitoring/qr', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const credentials = monitorCredentials(await connectionMonitorRepository.getSettings());
    if (!credentials) {
      return reply
        .type('text/html')
        .send(await renderPage({ tab: 'numero', error: 'Salve a URL base e o token da instancia do monitor antes de gerar o QR code.' }));
    }

    try {
      return reply.type('text/html').send(await renderPage({ tab: 'numero', qr: await requestConnectionQr(uazapiClient, credentials) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao falar com a UAZAPI.';
      return reply.type('text/html').send(await renderPage({ tab: 'numero', error: message }));
    }
  });

  app.post('/monitoring/report', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const reportResult = await dailyReportService.sendNow();
    if (wantsJson(request)) return sendOutcome(reply, reportOutcome(reportResult));
    return reply
      .type('text/html')
      .send(
        await renderPage(
          reportResult.errors.length > 0 ? { tab: 'relatorio', reportResult, error: reportResult.errors.join(' | ') } : { tab: 'relatorio', reportResult },
        ),
      );
  });

  app.post('/monitoring/leads', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const leadQueueResult = await leadQueueMonitorService.checkNow();
    if (wantsJson(request)) return sendOutcome(reply, leadQueueOutcome(leadQueueResult));
    return reply
      .type('text/html')
      .send(
        await renderPage(
          leadQueueResult.errors.length > 0
            ? { tab: 'fila', leadQueueResult, error: leadQueueResult.errors.join(' | ') }
            : { tab: 'fila', leadQueueResult },
        ),
      );
  });

  app.post('/monitoring/test', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const test = await connectionMonitorService.sendTestAlert();
    if (wantsJson(request)) return sendOutcome(reply, testOutcome(test));
    const notice = `Teste enviado para ${test.sent} de ${test.recipients} numero(s).`;

    return reply
      .type('text/html')
      .send(await renderPage(test.errors.length > 0 ? { tab: 'numero', error: test.errors.join(' | '), notice } : { tab: 'numero', notice }));
  });
}
