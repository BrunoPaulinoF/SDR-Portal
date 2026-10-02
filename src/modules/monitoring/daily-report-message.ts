import type { SdrDailyActivity } from '../leads/lead-repository.js';
import { formatDateTimeInTimeZone, formatDayInTimeZone, formatTimeInTimeZone } from '../timezone.js';

export interface DailyReportLine extends SdrDailyActivity {
  name: string;
  /**
   * WhatsApp fora do ar na ultima leitura do monitor, desde quando. So existe quando caiu: e o
   * que separa "dia fraco" de "SDR morto" num relatorio que mostra zero.
   */
  disconnectedSince?: Date;
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

/** "ha 40 min", "ha 5 h", "ha 30 dias": quanto tempo o WhatsApp esta fora. */
export function describeDowntime(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60000));
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ha 1 dia' : `ha ${days} dias`;
}

/**
 * Ate 02/10 o relatorio mostrava "Prospectados: 0" para um SDR desconectado sem dizer por que,
 * e foi assim que a Francielly passou 30 dias fora do ar com relatorio saindo todo dia: para
 * quem lia, era dia fraco.
 */
function describeSdr(sdr: DailyReportLine, now: Date, timeZone: string): string {
  const lines = [`*${sdr.name}*`];
  if (sdr.disconnectedSince) {
    lines.push(
      `⚠️ WhatsApp DESCONECTADO desde ${formatDateTimeInTimeZone(sdr.disconnectedSince, timeZone)} (${describeDowntime(sdr.disconnectedSince, now)}). Nada sai ate reconectar no portal.`,
    );
  }
  lines.push(
    `• Prospectados: ${sdr.prospected}`,
    `• Responderam: ${sdr.responded}`,
    `• Passados para o time: ${sdr.handoffs}`,
    `• Reunioes marcadas: ${sdr.meetings}`,
    `• Viraram cliente: ${sdr.won}`,
  );
  return lines.join('\n');
}

function describeTotals(sdrs: DailyReportLine[]): string {
  const soma = (pegar: (sdr: DailyReportLine) => number): number => sdrs.reduce((total, sdr) => total + pegar(sdr), 0);
  const prospected = soma((sdr) => sdr.prospected);
  const responded = soma((sdr) => sdr.responded);
  const handoffs = soma((sdr) => sdr.handoffs);
  const won = soma((sdr) => sdr.won);
  const resumo = `${prospected} prospectado(s), ${responded} responderam, ${handoffs} passado(s) para o time, ${won} cliente(s).`;

  return sdrs.length < 2 ? resumo : `Total: ${resumo}`;
}

export function buildDailyReport(input: DailyReportInput): string {
  const template = input.template?.trim() || defaultDailyReportTemplate();
  const values: Record<string, string> = {
    sdrs: input.sdrs.length > 0 ? input.sdrs.map((sdr) => describeSdr(sdr, input.now, input.timeZone)).join('\n\n') : 'Nenhum SDR ativo hoje.',
    totais: input.sdrs.length > 0 ? describeTotals(input.sdrs) : '',
    data: formatDayInTimeZone(input.now, input.timeZone),
    hora: formatTimeInTimeZone(input.now, input.timeZone),
    portal: input.portalUrl ? input.portalUrl.replace(/\/+$/, '') : '',
  };

  return template.replaceAll(/\{(sdrs|totais|data|hora|portal)\}/g, (_match, key: string) => values[key] ?? '').trim();
}
