import type { Lead } from '../../db/schema.js';

/**
 * O que acontece com o lead depois do handoff, marcado por quem atende. E o pedaco do funil que
 * faltava: ate 02/10 a medicao parava em "passou para o humano" e nao dava para saber se alguma
 * mudanca de abordagem, prompt ou modelo trazia cliente.
 */
export const LEAD_MILESTONES = ['meeting', 'trial', 'won', 'lost'] as const;
export type LeadMilestone = (typeof LEAD_MILESTONES)[number];

export const MILESTONE_LABELS: Record<LeadMilestone, string> = {
  meeting: 'Reuniao marcada',
  trial: 'Teste comecou',
  won: 'Virou cliente',
  lost: 'Perdido',
};

export type LeadOutcome = Pick<Lead, 'meetingAt' | 'trialStartedAt' | 'wonAt' | 'lostAt' | 'lostReason'>;

export function isLeadMilestone(value: unknown): value is LeadMilestone {
  return typeof value === 'string' && (LEAD_MILESTONES as readonly string[]).includes(value);
}

export function milestoneDate(outcome: LeadOutcome, milestone: LeadMilestone): Date | null {
  if (milestone === 'meeting') return outcome.meetingAt ?? null;
  if (milestone === 'trial') return outcome.trialStartedAt ?? null;
  if (milestone === 'won') return outcome.wonAt ?? null;
  return outcome.lostAt ?? null;
}

/** Algum desfecho marcado? Handoff sem nenhum e o que o painel cobra. */
export function hasOutcome(outcome: LeadOutcome): boolean {
  return LEAD_MILESTONES.some((milestone) => milestoneDate(outcome, milestone) !== null);
}

/**
 * Marca um desfecho. Marcar de novo nao muda a data: a primeira vez e a que vale para o painel.
 * Cliente e perdido se excluem — marcar um desfaz o outro, porque o lead que voltou atras ou o
 * clique errado precisam ser corrigiveis sem mexer no banco.
 */
export function markMilestone(outcome: LeadOutcome, milestone: LeadMilestone, at: Date, reason: string | null = null): LeadOutcome {
  const next: LeadOutcome = {
    meetingAt: outcome.meetingAt ?? null,
    trialStartedAt: outcome.trialStartedAt ?? null,
    wonAt: outcome.wonAt ?? null,
    lostAt: outcome.lostAt ?? null,
    lostReason: outcome.lostReason ?? null,
  };
  if (milestone === 'meeting') next.meetingAt = next.meetingAt ?? at;
  if (milestone === 'trial') next.trialStartedAt = next.trialStartedAt ?? at;
  if (milestone === 'won') {
    next.wonAt = next.wonAt ?? at;
    next.lostAt = null;
    next.lostReason = null;
  }
  if (milestone === 'lost') {
    next.lostAt = next.lostAt ?? at;
    next.lostReason = reason?.trim() || next.lostReason;
    next.wonAt = null;
  }
  return next;
}

/** Desfaz um desfecho marcado por engano. */
export function clearMilestone(outcome: LeadOutcome, milestone: LeadMilestone): LeadOutcome {
  return {
    meetingAt: milestone === 'meeting' ? null : (outcome.meetingAt ?? null),
    trialStartedAt: milestone === 'trial' ? null : (outcome.trialStartedAt ?? null),
    wonAt: milestone === 'won' ? null : (outcome.wonAt ?? null),
    lostAt: milestone === 'lost' ? null : (outcome.lostAt ?? null),
    lostReason: milestone === 'lost' ? null : (outcome.lostReason ?? null),
  };
}
