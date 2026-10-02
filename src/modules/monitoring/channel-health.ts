import type { SdrConnectionEvent } from '../../db/schema.js';

/**
 * Quanto do horario de envio o WhatsApp de um SDR ficou no ar. Mede o que importa para o
 * resultado: queda de madrugada nao custa abordagem nenhuma, queda as 16h de uma terca custa o
 * dia. A meta do plano de 02/10 e 95%; em setembro a Mariana ficou perto de 65%.
 */
export const CHANNEL_HEALTH_TARGET_PERCENT = 95;
/** Resolucao da conta: o monitor le a instancia de 5 em 5 minutos, mais fino que isso e ruido. */
const STEP_MINUTES = 5;

export interface ChannelHealth {
  /** Primeiro instante coberto pelo historico (pode ser depois de `from`, enquanto ele se forma). */
  coveredFrom: Date | null;
  /** Minutos de horario de envio dentro do periodo coberto. */
  windowMinutes: number;
  /** Desses, quantos com o WhatsApp conectado. */
  connectedMinutes: number;
  /** `null` sem historico ou sem horario de envio no periodo. */
  percent: number | null;
  /** Quedas que comecaram no periodo. */
  drops: number;
  /** Media entre cair e voltar, das quedas que ja voltaram. */
  averageReconnectMinutes: number | null;
  /** Fora do ar agora ha quanto tempo (`null` se conectado ou sem dados). */
  downForMinutes: number | null;
}

/**
 * `events` sao as transicoes deste SDR em ordem cronologica (o monitor so grava mudanca, entao
 * elas se alternam). Antes do primeiro evento nao ha o que medir: o historico comeca nele.
 */
export function computeChannelHealth(input: {
  events: Pick<SdrConnectionEvent, 'occurredAt' | 'status'>[];
  from: Date;
  to: Date;
  isInsideWindow: (at: Date) => boolean;
}): ChannelHealth {
  const events = [...input.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const first = events[0];
  const empty: ChannelHealth = {
    coveredFrom: null,
    windowMinutes: 0,
    connectedMinutes: 0,
    percent: null,
    drops: 0,
    averageReconnectMinutes: null,
    downForMinutes: null,
  };
  if (!first) return empty;

  const start = Math.max(input.from.getTime(), first.occurredAt.getTime());
  const end = input.to.getTime();
  let index = 0;
  let status = first.status;
  let windowMinutes = 0;
  let connectedMinutes = 0;

  for (let at = start; at < end; at += STEP_MINUTES * 60000) {
    while (index < events.length && (events[index]?.occurredAt.getTime() ?? Infinity) <= at) {
      status = events[index]?.status ?? status;
      index += 1;
    }
    if (!input.isInsideWindow(new Date(at))) continue;
    windowMinutes += STEP_MINUTES;
    if (status === 'connected') connectedMinutes += STEP_MINUTES;
  }

  const reconnects: number[] = [];
  let drops = 0;
  let downSince: number | null = null;
  for (const event of events) {
    const time = event.occurredAt.getTime();
    if (event.status === 'disconnected') {
      if (time >= input.from.getTime()) drops += 1;
      downSince = time;
    } else if (downSince !== null) {
      if (time >= input.from.getTime()) reconnects.push((time - downSince) / 60000);
      downSince = null;
    }
  }
  const last = events[events.length - 1];

  return {
    coveredFrom: new Date(start),
    windowMinutes,
    connectedMinutes,
    percent: windowMinutes > 0 ? Math.round((connectedMinutes / windowMinutes) * 100) : null,
    drops,
    averageReconnectMinutes: reconnects.length > 0 ? Math.round(reconnects.reduce((sum, value) => sum + value, 0) / reconnects.length) : null,
    downForMinutes: last?.status === 'disconnected' ? Math.round((end - last.occurredAt.getTime()) / 60000) : null,
  };
}
