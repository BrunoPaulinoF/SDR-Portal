import { formatDayInTimeZone, formatTimeInTimeZone } from '../timezone.js';

export interface LeadQueueLine {
  name: string;
  pendingLeads: number;
}

export interface LeadQueueAlertInput {
  /** Texto salvo na tela do monitor. Vazio: usa o padrao. */
  template: string | null;
  sdrs: LeadQueueLine[];
  now: Date;
  timeZone: string;
  portalUrl: string | null;
}

export function defaultLeadQueueTemplate(portalUrl: string | null): string {
  const link = portalUrl ? '\nImporte novos leads em {portal}/leads/import' : '';
  return `🟡 Fila de leads no fim\n\n{sdrs}\n\nVerificado em {data} as {hora}.${link}`;
}

export function buildLeadQueueAlert(input: LeadQueueAlertInput): string {
  const template = input.template?.trim() || defaultLeadQueueTemplate(input.portalUrl);
  const values: Record<string, string> = {
    sdrs: input.sdrs.map((sdr) => `• ${sdr.name} — ${sdr.pendingLeads} lead(s) na fila`).join('\n'),
    data: formatDayInTimeZone(input.now, input.timeZone),
    hora: formatTimeInTimeZone(input.now, input.timeZone),
    portal: input.portalUrl ? input.portalUrl.replace(/\/+$/, '') : '',
  };

  return template.replaceAll(/\{(sdrs|data|hora|portal)\}/g, (_match, key: string) => values[key] ?? '').trim();
}
