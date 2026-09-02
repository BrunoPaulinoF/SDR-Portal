import { env } from '../../config/env.js';
import type { MonitorSettings } from '../../db/schema.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { dayKeyInTimeZone, startOfDayInTimeZone } from '../timezone.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { ConnectionMonitorRepository } from './connection-monitor-repository.js';
import { monitorCredentials } from './connection-monitor-service.js';
import { buildDailyReport, type DailyReportLine } from './daily-report-message.js';
import { parseAlertRecipients } from './alert-recipients.js';
import { sendToRecipients } from './monitor-sender.js';

export const DAILY_REPORT_JOB = 'daily-report';

export interface DailyReportDeps {
  connectionMonitorRepository: ConnectionMonitorRepository;
  jobLogRepository: JobLogRepository;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
  uazapiClient: UazapiClient;
}

export interface DailyReportResult {
  /** Preenchido quando nada foi enviado, com o porque. */
  skipped: string | null;
  sdrs: DailyReportLine[];
  sent: number;
  recipients: number;
  errors: string[];
  /** Texto que foi (ou seria) enviado. A tela mostra para conferencia. */
  message: string | null;
}

export type DailyReportService = ReturnType<typeof createDailyReportService>;

function emptyResult(skipped: string | null): DailyReportResult {
  return { skipped, sdrs: [], sent: 0, recipients: 0, errors: [], message: null };
}

/** `18:30` -> 1110 minutos. Hora invalida no cadastro nao pode travar o job. */
export function parseReportTime(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Ja passou da hora marcada, hoje, no fuso do portal? O tick roda de 15 em 15 minutos e o
 * relatorio sai na primeira passada depois do horario — por isso a resposta e "ja passou",
 * nao "e exatamente agora": tick perdido (deploy, container reiniciando) nao pode comer o
 * relatorio do dia.
 */
export function isReportDue(settings: MonitorSettings, now: Date, timeZone: string): boolean {
  const minutes = parseReportTime(settings.dailyReportTime);
  if (minutes === null) return false;

  const due = new Date(startOfDayInTimeZone(now, timeZone).getTime() + minutes * 60000);
  return now.getTime() >= due.getTime();
}

/**
 * Relatorio de fim de dia dos SDRs ativos, enviado pela mesma instancia e para os mesmos
 * numeros do monitor de conexao.
 *
 * As tres contagens seguem as definicoes do dashboard (`countDailyActivityForSdr`): numero
 * que aparece no WhatsApp e numero que aparece na tela.
 */
export function createDailyReportService(deps: DailyReportDeps) {
  const { connectionMonitorRepository, jobLogRepository, leadRepository, sdrAgentRepository, uazapiClient } = deps;

  async function collect(now: Date, timeZone: string): Promise<DailyReportLine[]> {
    const start = startOfDayInTimeZone(now, timeZone);
    const agents = (await sdrAgentRepository.list()).filter((agent) => agent.isActive);
    const linhas: DailyReportLine[] = [];

    for (const agent of agents) {
      const activity = await leadRepository.countDailyActivityForSdr(agent.id, start, now);
      linhas.push({ name: agent.name, ...activity });
    }

    return linhas;
  }

  async function send(now: Date, trigger: string, markDay: boolean): Promise<DailyReportResult> {
    const settings = await connectionMonitorRepository.getSettings();

    if (!settings?.isEnabled) return emptyResult('Monitor de conexao desligado.');
    if (!settings.dailyReportEnabled) return emptyResult('Relatorio diario desligado.');

    const credentials = monitorCredentials(settings);
    if (!credentials) return emptyResult('Configure a instancia UAZAPI do monitor (URL base e token).');

    const recipients = parseAlertRecipients(settings.alertRecipients);
    if (recipients.length === 0) return emptyResult('Nenhum numero cadastrado para receber o relatorio.');

    const timeZone = env.DEFAULT_TIMEZONE;
    const sdrs = await collect(now, timeZone);
    const message = buildDailyReport({
      template: settings.dailyReportTemplate,
      sdrs,
      now,
      timeZone,
      portalUrl: env.APP_URL ?? null,
    });
    const errors: string[] = [];
    const sent = await sendToRecipients(uazapiClient, credentials, recipients, message, errors, 'sdr-portal-relatorio');

    // So marca o dia quando alguma mensagem saiu: relatorio que falhou inteiro tem de poder
    // sair no proximo tick, em vez de ficar marcado como entregue.
    if (markDay && sent > 0) await connectionMonitorRepository.markDailyReportSent(dayKeyInTimeZone(now, timeZone));

    await jobLogRepository.create({
      jobName: DAILY_REPORT_JOB,
      jobKey: trigger,
      sdrAgentId: null,
      leadId: null,
      status: errors.length > 0 ? 'failed' : 'success',
      attempt: 1,
      payload: JSON.stringify({ trigger, recipients: recipients.length }),
      result: JSON.stringify({ sdrs, sent }),
      error: errors.length > 0 ? errors.join(' | ') : null,
      startedAt: now,
      finishedAt: new Date(),
    });

    return { skipped: null, sdrs, sent, recipients: recipients.length, errors, message };
  }

  return {
    /** Tick do scheduler: envia uma vez por dia, depois da hora marcada. */
    async runOnce(now: Date = new Date()): Promise<DailyReportResult> {
      const settings = await connectionMonitorRepository.getSettings();

      if (!settings?.isEnabled) return emptyResult('Monitor de conexao desligado.');
      if (!settings.dailyReportEnabled) return emptyResult('Relatorio diario desligado.');

      const timeZone = env.DEFAULT_TIMEZONE;
      if (settings.lastDailyReportOn === dayKeyInTimeZone(now, timeZone)) {
        return emptyResult('Relatorio de hoje ja foi enviado.');
      }

      if (!isReportDue(settings, now, timeZone)) return emptyResult('Ainda nao deu a hora do relatorio.');

      return send(now, 'tick', true);
    },

    /** Botao da tela: manda agora, sem esperar a hora e sem gastar o envio do dia. */
    async sendNow(now: Date = new Date()): Promise<DailyReportResult> {
      return send(now, 'manual', false);
    },

    /** Previa dos numeros de hoje, sem enviar nada. */
    async preview(now: Date = new Date()): Promise<DailyReportLine[]> {
      return collect(now, env.DEFAULT_TIMEZONE);
    },
  };
}
