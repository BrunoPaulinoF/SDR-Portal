import type { SdrAgent } from '../../db/schema.js';

/**
 * Rampa de aquecimento de numero novo: quantas conversas novas por dia o disparo pode abrir em
 * cada trecho do aquecimento. Numero recem-pareado que comeca com o limite cheio e o que o
 * WhatsApp le como disparo em massa — foi com 40/dia que a Francielly levou
 * `WHATSAPP_REACHOUT_TIMELOCK` em 27/08 (`docs/analises/francielly-2026-08-28.md`).
 *
 * O limite cadastrado continua sendo o teto: a rampa so segura, nunca solta mais do que ele.
 */
export const WARMUP_RAMP = [
  { untilDay: 3, limit: 10 },
  { untilDay: 7, limit: 20 },
  { untilDay: 14, limit: 30 },
] as const;

export const WARMUP_DAYS = WARMUP_RAMP[WARMUP_RAMP.length - 1]?.untilDay ?? 0;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyInitialLimit {
  limit: number;
  /** Dia do aquecimento (1 = primeiras 24h), ou `null` fora do aquecimento. */
  warmupDay: number | null;
}

/** Dia corrente do aquecimento contado em blocos de 24h desde o inicio; 1 no primeiro. */
export function warmupDay(startedAt: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS) + 1);
}

/** Limite de abordagens de hoje: o cadastrado, ou o da rampa enquanto o numero aquece. */
export function dailyInitialLimit(agent: Pick<SdrAgent, 'dailyInitialSendLimit' | 'warmupStartedAt'>, now: Date): DailyInitialLimit {
  if (!agent.warmupStartedAt) return { limit: agent.dailyInitialSendLimit, warmupDay: null };

  const day = warmupDay(agent.warmupStartedAt, now);
  const step = WARMUP_RAMP.find((entry) => day <= entry.untilDay);
  if (!step) return { limit: agent.dailyInitialSendLimit, warmupDay: null };

  return { limit: Math.min(step.limit, agent.dailyInitialSendLimit), warmupDay: day };
}

/** Texto curto para tela e relatorio: "dia 5 de 14, ate 20 por dia". */
export function describeWarmup(agent: Pick<SdrAgent, 'dailyInitialSendLimit' | 'warmupStartedAt'>, now: Date): string | null {
  const today = dailyInitialLimit(agent, now);
  if (today.warmupDay === null) return null;
  return `dia ${today.warmupDay} de ${WARMUP_DAYS}, ate ${today.limit} por dia`;
}
