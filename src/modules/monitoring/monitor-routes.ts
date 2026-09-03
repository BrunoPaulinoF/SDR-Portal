import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { encryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { requestConnectionQr, type InstanceConnectionState } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { ConnectionMonitorRepository } from './connection-monitor-repository.js';
import { defaultMonitorSettings } from './connection-monitor-repository.js';
import { monitorCredentials, type ConnectionMonitorService, type MonitorRunResult } from './connection-monitor-service.js';
import type { DailyReportResult, DailyReportService } from './daily-report-service.js';
import type { LeadQueueMonitorService, LeadQueueResult } from './lead-queue-monitor-service.js';
import { renderMonitorPage } from './monitor-pages.js';

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

function emptyToNull(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

/** URL do webhook que a UAZAPI ja chama por SDR: a tela so mostra o formato. */
function webhookUrlHint(): string | null {
  if (!env.APP_URL) return null;
  return new URL('/webhooks/uazapi/<id-do-sdr>', env.APP_URL).toString();
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

    return reply.type('text/html').send(await renderPage());
  });

  app.post('/monitoring', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = settingsFormSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.type('text/html').send(await renderPage({ error: 'Confira os campos do formulario.' }));
    }

    const data = parsed.data;
    const current = await connectionMonitorRepository.getSettings();

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

    return reply.type('text/html').send(await renderPage({ notice: 'Configuracao do monitor salva.' }));
  });

  app.post('/monitoring/run', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const runResult = await connectionMonitorService.runOnce();
    return reply.type('text/html').send(await renderPage({ runResult }));
  });

  app.post('/monitoring/qr', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const credentials = monitorCredentials(await connectionMonitorRepository.getSettings());
    if (!credentials) {
      return reply
        .type('text/html')
        .send(await renderPage({ error: 'Salve a URL base e o token da instancia do monitor antes de gerar o QR code.' }));
    }

    try {
      return reply.type('text/html').send(await renderPage({ qr: await requestConnectionQr(uazapiClient, credentials) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao falar com a UAZAPI.';
      return reply.type('text/html').send(await renderPage({ error: message }));
    }
  });

  app.post('/monitoring/report', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const reportResult = await dailyReportService.sendNow();
    return reply
      .type('text/html')
      .send(await renderPage(reportResult.errors.length > 0 ? { reportResult, error: reportResult.errors.join(' | ') } : { reportResult }));
  });

  app.post('/monitoring/leads', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const leadQueueResult = await leadQueueMonitorService.checkNow();
    return reply
      .type('text/html')
      .send(
        await renderPage(
          leadQueueResult.errors.length > 0 ? { leadQueueResult, error: leadQueueResult.errors.join(' | ') } : { leadQueueResult },
        ),
      );
  });

  app.post('/monitoring/test', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const test = await connectionMonitorService.sendTestAlert();
    const notice = `Teste enviado para ${test.sent} de ${test.recipients} numero(s).`;

    return reply
      .type('text/html')
      .send(await renderPage(test.errors.length > 0 ? { error: test.errors.join(' | '), notice } : { notice }));
  });
}
