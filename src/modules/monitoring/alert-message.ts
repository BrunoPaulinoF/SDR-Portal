import { formatWhatsappNumber } from '../phone/whatsapp-number.js';
import { formatDayInTimeZone, formatTimeInTimeZone } from '../timezone.js';

export interface AlertAgentLine {
  name: string;
  whatsappNumber: string | null;
  /** `status` cru da instancia na UAZAPI (`disconnected`, `connecting`, ...). */
  instanceStatus: string | null;
  disconnectReason: string | null;
  /** Momento da queda (alerta) ou da volta (recuperacao). */
  since: Date | null;
  /** Minutos que o SDR passou fora. So no aviso de volta. */
  downtimeMinutes?: number | null;
}

export interface AlertInput {
  /** Texto salvo na tela do monitor. Vazio: usa o padrao. */
  template: string | null;
  agents: AlertAgentLine[];
  now: Date;
  timeZone: string;
  portalUrl: string | null;
}

/** Motivo cru da UAZAPI pode vir enorme: no WhatsApp so cabe o comeco. */
const maxReasonChars = 120;

export function defaultAlertTemplate(portalUrl: string | null): string {
  const link = portalUrl ? `\nReconecte lendo o QR code em {portal}/sdr-agents` : '';
  return `🔴 WhatsApp de SDR fora do ar ({total})\n\n{sdrs}\n\nVerificado em {data} as {hora}.${link}`;
}

export function defaultRecoveryTemplate(): string {
  return '🟢 WhatsApp de SDR reconectado ({total})\n\n{sdrs}\n\nVerificado em {data} as {hora}.';
}

function describeAgent(agent: AlertAgentLine, timeZone: string): string {
  const number = agent.whatsappNumber ? ` (${formatWhatsappNumber(agent.whatsappNumber)})` : '';
  const parts = [`• ${agent.name}${number}`];

  if (agent.since) {
    parts.push(`${formatDayInTimeZone(agent.since, timeZone)} as ${formatTimeInTimeZone(agent.since, timeZone)}`);
  }

  if (typeof agent.downtimeMinutes === 'number' && agent.downtimeMinutes > 0) {
    parts.push(`${agent.downtimeMinutes} min fora`);
  }

  if (agent.instanceStatus) parts.push(`status ${agent.instanceStatus}`);
  if (agent.disconnectReason) parts.push(`motivo: ${agent.disconnectReason.slice(0, maxReasonChars)}`);

  return parts.join(' — ');
}

function renderTemplate(template: string, input: AlertInput): string {
  const values: Record<string, string> = {
    sdrs: input.agents.map((agent) => describeAgent(agent, input.timeZone)).join('\n'),
    total: String(input.agents.length),
    data: formatDayInTimeZone(input.now, input.timeZone),
    hora: formatTimeInTimeZone(input.now, input.timeZone),
    portal: input.portalUrl ? input.portalUrl.replace(/\/+$/, '') : '',
  };

  return template.replaceAll(/\{(sdrs|total|data|hora|portal)\}/g, (_match, key: string) => values[key] ?? '').trim();
}

export function buildDisconnectAlert(input: AlertInput): string {
  return renderTemplate(input.template?.trim() || defaultAlertTemplate(input.portalUrl), input);
}

export function buildRecoveryAlert(input: AlertInput): string {
  return renderTemplate(input.template?.trim() || defaultRecoveryTemplate(), input);
}
