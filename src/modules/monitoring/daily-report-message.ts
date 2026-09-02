import type { SdrDailyActivity } from '../leads/lead-repository.js';
import { formatDayInTimeZone, formatTimeInTimeZone } from '../timezone.js';

export interface DailyReportLine extends SdrDailyActivity {
  name: string;
}

export interface DailyReportInput {
  /** Texto salvo na tela do monitor. Vazio: usa o padrao. */
  template: string | null;
  sdrs: DailyReportLine[];
  now: Date;
  timeZone: string;
  portalUrl: string | null;
}

export function defaultDailyReportTemplate(): string {
  return '📊 Relatorio do dia — {data}\n\n{sdrs}\n\n{totais}';
}

function describeSdr(sdr: DailyReportLine): string {
  return [
    `*${sdr.name}*`,
    `• Prospectados: ${sdr.prospected}`,
    `• Responderam: ${sdr.responded}`,
    `• Possiveis clientes: ${sdr.handoffs}`,
  ].join('\n');
}

function describeTotals(sdrs: DailyReportLine[]): string {
  const soma = (pegar: (sdr: DailyReportLine) => number): number => sdrs.reduce((total, sdr) => total + pegar(sdr), 0);
  const prospected = soma((sdr) => sdr.prospected);
  const responded = soma((sdr) => sdr.responded);
  const handoffs = soma((sdr) => sdr.handoffs);

  if (sdrs.length < 2) {
    return `${prospected} prospectado(s), ${responded} responderam, ${handoffs} possivel(is) cliente(s).`;
  }

  return `Total: ${prospected} prospectado(s), ${responded} responderam, ${handoffs} possivel(is) cliente(s).`;
}

export function buildDailyReport(input: DailyReportInput): string {
  const template = input.template?.trim() || defaultDailyReportTemplate();
  const values: Record<string, string> = {
    sdrs: input.sdrs.length > 0 ? input.sdrs.map(describeSdr).join('\n\n') : 'Nenhum SDR ativo hoje.',
    totais: input.sdrs.length > 0 ? describeTotals(input.sdrs) : '',
    data: formatDayInTimeZone(input.now, input.timeZone),
    hora: formatTimeInTimeZone(input.now, input.timeZone),
    portal: input.portalUrl ? input.portalUrl.replace(/\/+$/, '') : '',
  };

  return template.replaceAll(/\{(sdrs|totais|data|hora|portal)\}/g, (_match, key: string) => values[key] ?? '').trim();
}
