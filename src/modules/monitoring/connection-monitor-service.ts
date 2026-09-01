import { env } from '../../config/env.js';
import type { MonitorSettings, SdrAgent, SdrConnectionState } from '../../db/schema.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { checkWhatsappChannel } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import { buildDisconnectAlert, buildRecoveryAlert, type AlertAgentLine } from './alert-message.js';
import { parseAlertRecipients } from './alert-recipients.js';
import type { ConnectionMonitorRepository, ConnectionStatus } from './connection-monitor-repository.js';

export const CONNECTION_MONITOR_JOB = 'connection-monitor';

export interface ConnectionMonitorDeps {
  connectionMonitorRepository: ConnectionMonitorRepository;
  jobLogRepository: JobLogRepository;
  sdrAgentRepository: SdrAgentRepository;
  uazapiClient: UazapiClient;
}

export interface AgentCheckResult {
  agentId: string;
  agentName: string;
  status: ConnectionStatus;
  instanceStatus: string | null;
  disconnectReason: string | null;
  /** O estado mudou neste tick (caiu ou voltou). */
  changed: boolean;
  /** Este SDR entrou na mensagem enviada agora. */
  alerted: boolean;
}

export interface MonitorRunResult {
  /** Preenchido quando o tick nao chegou a consultar nada, com o porque. */
  skipped: string | null;
  checked: number;
  disconnected: string[];
  recovered: string[];
  /** Mensagens efetivamente entregues (uma por numero de destino). */
  alertsSent: number;
  recipients: number;
  errors: string[];
  results: AgentCheckResult[];
}

export type ConnectionMonitorService = ReturnType<typeof createConnectionMonitorService>;

function emptyResult(skipped: string | null): MonitorRunResult {
  return { skipped, checked: 0, disconnected: [], recovered: [], alertsSent: 0, recipients: 0, errors: [], results: [] };
}

function agentCredentials(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

export function monitorCredentials(settings: MonitorSettings | null): { baseUrl: string; token: string } | null {
  if (!settings?.uazapiBaseUrl || !settings.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: settings.uazapiBaseUrl, token: decryptSecret(settings.uazapiInstanceTokenEncrypted) };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

/**
 * Ja passou o tempo de repetir o alerta de um SDR que continua fora? `0` desliga a
 * repeticao: avisa na queda e cala ate a proxima.
 */
function shouldRepeatAlert(state: SdrConnectionState | null, repeatAlertMinutes: number, now: Date): boolean {
  if (repeatAlertMinutes <= 0) return false;
  const last = state?.lastAlertAt;
  if (!last) return true;
  return now.getTime() - last.getTime() >= repeatAlertMinutes * 60000;
}

/**
 * Vigia das instancias dos SDRs: le o status de cada WhatsApp e, quando um cai, manda uma
 * mensagem pronta pelos numeros cadastrados na tela do monitor.
 *
 * Quem envia e uma **instancia UAZAPI separada** — a do proprio SDR acabou de cair, entao
 * ela e justamente a que nao pode ser usada para dar a noticia.
 *
 * O alerta sai na transicao (`connected` -> fora), nao a cada tick: sem a memoria em
 * `sdr_connection_states` o job de 5 em 5 minutos mandaria a mesma mensagem 288 vezes por
 * dia. Enquanto o SDR segue fora, o lembrete volta so a cada `repeatAlertMinutes`.
 */
export function createConnectionMonitorService(deps: ConnectionMonitorDeps) {
  const { connectionMonitorRepository, jobLogRepository, sdrAgentRepository, uazapiClient } = deps;

  async function sendAlert(
    credentials: { baseUrl: string; token: string },
    recipients: string[],
    text: string,
    errors: string[],
  ): Promise<number> {
    let sent = 0;

    for (const number of recipients) {
      try {
        const result = await uazapiClient.sendText({
          ...credentials,
          number,
          text,
          trackSource: 'sdr-portal-monitor',
          trackId: `monitor-${Date.now()}`,
        });

        if (result.ok) sent += 1;
        else errors.push(`Falha ao avisar ${number}: a UAZAPI respondeu HTTP ${result.status}.`);
      } catch (error) {
        errors.push(`Falha ao avisar ${number}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      }
    }

    return sent;
  }

  async function run(agents: SdrAgent[], trigger: string, now: Date): Promise<MonitorRunResult> {
    const settings = await connectionMonitorRepository.getSettings();

    if (!settings?.isEnabled) return emptyResult('Monitor de conexao desligado.');

    const credentials = monitorCredentials(settings);
    if (!credentials) return emptyResult('Configure a instancia UAZAPI do monitor (URL base e token).');

    const recipients = parseAlertRecipients(settings.alertRecipients);
    if (recipients.length === 0) return emptyResult('Nenhum numero cadastrado para receber o alerta.');

    const monitored = agents.filter((agent) => (settings.onlyActiveAgents ? agent.isActive : true) && agentCredentials(agent));
    const result: MonitorRunResult = { ...emptyResult(null), recipients: recipients.length };
    const fellDown: AlertAgentLine[] = [];
    const cameBack: AlertAgentLine[] = [];

    for (const agent of monitored) {
      const agentCredential = agentCredentials(agent);
      if (!agentCredential) continue;

      const previous = await connectionMonitorRepository.findState(agent.id);
      let status: ConnectionStatus = 'connected';
      let instanceStatus: string | null = null;
      let disconnectReason: string | null = null;

      try {
        const channel = await checkWhatsappChannel(uazapiClient, agentCredential);
        status = channel.usable ? 'connected' : 'disconnected';
        instanceStatus = channel.status;
        disconnectReason = channel.disconnectReason ?? (channel.usable ? null : channel.reason);
      } catch (error) {
        // Gateway fora do ar tambem e SDR fora do ar: quem atende precisa saber igual.
        status = 'disconnected';
        disconnectReason = error instanceof Error ? error.message : 'erro desconhecido ao consultar a UAZAPI';
      }

      result.checked += 1;
      const wasDown = previous?.status === 'disconnected';
      const changed = (previous?.status ?? 'connected') !== status;
      let alerted = false;

      if (status === 'disconnected') {
        const disconnectedAt = wasDown ? (previous?.disconnectedAt ?? now) : now;
        alerted = !wasDown || shouldRepeatAlert(previous, settings.repeatAlertMinutes, now);

        if (!wasDown) result.disconnected.push(agent.name);
        if (alerted) {
          fellDown.push({
            name: agent.name,
            whatsappNumber: agent.whatsappNumber,
            instanceStatus,
            disconnectReason,
            since: disconnectedAt,
          });
        }

        await connectionMonitorRepository.saveState({
          sdrAgentId: agent.id,
          status,
          instanceStatus,
          disconnectReason,
          lastCheckedAt: now,
          lastConnectedAt: previous?.lastConnectedAt ?? null,
          disconnectedAt,
          lastAlertAt: alerted ? now : (previous?.lastAlertAt ?? null),
        });
      } else {
        if (wasDown) {
          result.recovered.push(agent.name);
          if (settings.notifyOnRecovery) {
            alerted = true;
            cameBack.push({
              name: agent.name,
              whatsappNumber: agent.whatsappNumber,
              instanceStatus,
              disconnectReason: null,
              since: now,
              downtimeMinutes: previous?.disconnectedAt ? minutesBetween(previous.disconnectedAt, now) : null,
            });
          }
        }

        await connectionMonitorRepository.saveState({
          sdrAgentId: agent.id,
          status,
          instanceStatus,
          disconnectReason: null,
          lastCheckedAt: now,
          lastConnectedAt: now,
          disconnectedAt: null,
          lastAlertAt: null,
        });
      }

      result.results.push({
        agentId: agent.id,
        agentName: agent.name,
        status,
        instanceStatus,
        disconnectReason,
        changed,
        alerted,
      });
    }

    const timeZone = env.DEFAULT_TIMEZONE;
    const portalUrl = env.APP_URL ?? null;

    if (fellDown.length > 0) {
      const text = buildDisconnectAlert({ template: settings.alertTemplate, agents: fellDown, now, timeZone, portalUrl });
      result.alertsSent += await sendAlert(credentials, recipients, text, result.errors);
    }

    if (cameBack.length > 0) {
      const text = buildRecoveryAlert({ template: settings.recoveryTemplate, agents: cameBack, now, timeZone, portalUrl });
      result.alertsSent += await sendAlert(credentials, recipients, text, result.errors);
    }

    // Tick silencioso nao vira linha: 288 registros por dia dizendo "tudo certo" so
    // enterrariam o que aconteceu de verdade em /job-logs.
    if (fellDown.length > 0 || cameBack.length > 0 || result.errors.length > 0) {
      await jobLogRepository.create({
        jobName: CONNECTION_MONITOR_JOB,
        jobKey: trigger,
        sdrAgentId: null,
        leadId: null,
        status: result.errors.length > 0 ? 'failed' : 'success',
        attempt: 1,
        payload: JSON.stringify({ trigger, checked: result.checked, recipients: recipients.length }),
        result: JSON.stringify({
          disconnected: result.disconnected,
          recovered: result.recovered,
          alerted: [...fellDown, ...cameBack].map((agent) => agent.name),
          alertsSent: result.alertsSent,
        }),
        error: result.errors.length > 0 ? result.errors.join(' | ') : null,
        startedAt: now,
        finishedAt: new Date(),
      });
    }

    return result;
  }

  return {
    /** Tick do scheduler: confere todos os SDRs monitorados. */
    async runOnce(now: Date = new Date()): Promise<MonitorRunResult> {
      return run(await sdrAgentRepository.list(), 'tick', now);
    },

    /**
     * Webhook `connection` da UAZAPI: confere **este** SDR na hora, sem esperar o tick.
     * O status vem sempre de uma leitura nova da instancia — o payload do evento so diz
     * "olhe agora", porque um `connecting` de meio segundo nao pode virar alerta.
     */
    async checkAgent(agentId: string, now: Date = new Date()): Promise<MonitorRunResult> {
      const agent = await sdrAgentRepository.findById(agentId);
      if (!agent) return emptyResult('SDR nao encontrado.');
      return run([agent], 'webhook', now);
    },

    /** Manda uma mensagem de teste pela instancia do monitor, para validar o cadastro. */
    async sendTestAlert(now: Date = new Date()): Promise<{ sent: number; recipients: number; errors: string[] }> {
      const settings = await connectionMonitorRepository.getSettings();
      const credentials = monitorCredentials(settings);
      const recipients = parseAlertRecipients(settings?.alertRecipients);
      const errors: string[] = [];

      if (!credentials) return { sent: 0, recipients: recipients.length, errors: ['Configure a instancia UAZAPI do monitor.'] };
      if (recipients.length === 0) return { sent: 0, recipients: 0, errors: ['Nenhum numero cadastrado para receber o alerta.'] };

      const text = buildDisconnectAlert({
        template: settings?.alertTemplate ?? null,
        agents: [
          {
            name: 'SDR de teste',
            whatsappNumber: null,
            instanceStatus: 'disconnected',
            disconnectReason: 'mensagem de teste do monitor',
            since: now,
          },
        ],
        now,
        timeZone: env.DEFAULT_TIMEZONE,
        portalUrl: env.APP_URL ?? null,
      });

      const sent = await sendAlert(credentials, recipients, text, errors);
      return { sent, recipients: recipients.length, errors };
    },
  };
}
