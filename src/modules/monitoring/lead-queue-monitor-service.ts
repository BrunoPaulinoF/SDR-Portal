import { env } from '../../config/env.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { ConnectionMonitorRepository } from './connection-monitor-repository.js';
import { monitorCredentials } from './connection-monitor-service.js';
import { buildLeadQueueAlert, type LeadQueueLine } from './lead-queue-message.js';
import { parseAlertRecipients } from './alert-recipients.js';
import { sendToRecipients } from './monitor-sender.js';

export const LEAD_QUEUE_JOB = 'lead-queue-monitor';

export interface LeadQueueMonitorDeps {
  connectionMonitorRepository: ConnectionMonitorRepository;
  jobLogRepository: JobLogRepository;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
  uazapiClient: UazapiClient;
}

export interface LeadQueueResult {
  /** Preenchido quando o tick nao chegou a contar nada, com o porque. */
  skipped: string | null;
  checked: number;
  /** SDRs que acabaram de ficar sem fila neste tick. */
  emptied: LeadQueueLine[];
  /** SDRs cuja fila voltou a encher: o aviso deles fica rearmado. */
  refilled: string[];
  queues: LeadQueueLine[];
  alertsSent: number;
  recipients: number;
  errors: string[];
}

export type LeadQueueMonitorService = ReturnType<typeof createLeadQueueMonitorService>;

function emptyResult(skipped: string | null): LeadQueueResult {
  return { skipped, checked: 0, emptied: [], refilled: [], queues: [], alertsSent: 0, recipients: 0, errors: [] };
}

/**
 * Vigia a fila de cada SDR e avisa quando ela acaba — SDR sem lead pendente esta parado, e
 * isso nao aparece em lugar nenhum ate alguem abrir o dashboard.
 *
 * O aviso sai **uma vez por esvaziamento**: `leads_alert_at` guarda que ja avisamos, e so
 * volta a `null` quando a fila enche de novo. Sem isso o tick repetiria o mesmo aviso a cada
 * passada enquanto ninguem importasse leads — exatamente o que o alerta de queda evita com a
 * memoria de conexao.
 */
export function createLeadQueueMonitorService(deps: LeadQueueMonitorDeps) {
  const { connectionMonitorRepository, jobLogRepository, leadRepository, sdrAgentRepository, uazapiClient } = deps;

  async function run(now: Date, trigger: string): Promise<LeadQueueResult> {
    const settings = await connectionMonitorRepository.getSettings();

    if (!settings?.isEnabled) return emptyResult('Monitor de conexao desligado.');
    if (!settings.leadsAlertEnabled) return emptyResult('Aviso de fila de leads desligado.');

    const credentials = monitorCredentials(settings);
    if (!credentials) return emptyResult('Configure a instancia UAZAPI do monitor (URL base e token).');

    const recipients = parseAlertRecipients(settings.alertRecipients);
    if (recipients.length === 0) return emptyResult('Nenhum numero cadastrado para receber o aviso.');

    const agents = (await sdrAgentRepository.list()).filter((agent) => (settings.onlyActiveAgents ? agent.isActive : true));
    const result: LeadQueueResult = { ...emptyResult(null), recipients: recipients.length };

    for (const agent of agents) {
      const pendingLeads = await leadRepository.countPendingForSdr(agent.id);
      const previous = await connectionMonitorRepository.findState(agent.id);
      const jaAvisado = previous?.leadsAlertAt != null;
      const acabou = pendingLeads <= settings.leadsAlertThreshold;

      result.checked += 1;
      result.queues.push({ name: agent.name, pendingLeads });

      if (acabou && !jaAvisado) result.emptied.push({ name: agent.name, pendingLeads });
      if (!acabou && jaAvisado) result.refilled.push(agent.name);

      await connectionMonitorRepository.saveLeadQueueState({
        sdrAgentId: agent.id,
        pendingLeads,
        // Fila cheia zera a marca e rearma o proximo aviso.
        leadsAlertAt: acabou ? (previous?.leadsAlertAt ?? now) : null,
      });
    }

    if (result.emptied.length > 0) {
      const text = buildLeadQueueAlert({
        template: settings.leadsAlertTemplate,
        sdrs: result.emptied,
        now,
        timeZone: env.DEFAULT_TIMEZONE,
        portalUrl: env.APP_URL ?? null,
      });
      result.alertsSent = await sendToRecipients(uazapiClient, credentials, recipients, text, result.errors, 'sdr-portal-fila');

      await jobLogRepository.create({
        jobName: LEAD_QUEUE_JOB,
        jobKey: trigger,
        sdrAgentId: null,
        leadId: null,
        status: result.errors.length > 0 ? 'failed' : 'success',
        attempt: 1,
        payload: JSON.stringify({ trigger, threshold: settings.leadsAlertThreshold, recipients: recipients.length }),
        result: JSON.stringify({ emptied: result.emptied, alertsSent: result.alertsSent }),
        error: result.errors.length > 0 ? result.errors.join(' | ') : null,
        startedAt: now,
        finishedAt: new Date(),
      });
    }

    return result;
  }

  return {
    /** Tick do scheduler. */
    async runOnce(now: Date = new Date()): Promise<LeadQueueResult> {
      return run(now, 'tick');
    },

    /** Botao da tela: conta a fila agora e avisa se alguma acabou de esvaziar. */
    async checkNow(now: Date = new Date()): Promise<LeadQueueResult> {
      return run(now, 'manual');
    },
  };
}
