import type { Lead } from '../../db/schema.js';

/**
 * Pausa da IA numa conversa. Desde que o portal ganhou o botao de liberar, a pausa NAO
 * expira sozinha: `aiPausedAt` preenchido significa "so volta quando alguem liberar".
 * `humanPausedUntil` continua lido para nao ressuscitar a IA em leads pausados antes
 * dessa mudanca, mas nada novo escreve nessa coluna.
 */
export const AI_PAUSE_REASONS = {
  /** O lead mandou uma imagem: a IA nao enxerga a foto, entao quem responde e um humano. */
  leadImage: 'lead_image_message',
  /** O lead mandou um audio que nao deu para transcrever: a IA nao ouve, entao quem responde e um humano. */
  leadAudio: 'lead_audio_no_transcription',
  /** Alguem respondeu pelo proprio WhatsApp do SDR (`fromMe` sem passar pela API). */
  manualWhatsapp: 'manual_whatsapp_message',
  /** Pausa pedida no botao da caixa de conversas. */
  portal: 'portal_manual',
} as const;

const REASON_LABELS: Record<string, string> = {
  [AI_PAUSE_REASONS.leadImage]: 'o lead enviou uma imagem',
  [AI_PAUSE_REASONS.leadAudio]: 'o lead enviou um audio que nao deu para transcrever',
  [AI_PAUSE_REASONS.manualWhatsapp]: 'alguem respondeu pelo WhatsApp do SDR',
  [AI_PAUSE_REASONS.portal]: 'a pausa foi feita aqui no portal',
};

type PauseFields = Pick<Lead, 'aiPausedAt' | 'humanPausedUntil'>;

export function isAiPaused(lead: PauseFields, now: Date): boolean {
  if (lead.aiPausedAt) return true;
  return lead.humanPausedUntil !== null && lead.humanPausedUntil > now;
}

export function aiPauseReasonLabel(reason: string | null): string {
  if (!reason) return 'a IA esta pausada nesta conversa';
  return REASON_LABELS[reason] ?? reason;
}

/**
 * Status para onde o lead volta quando a IA e liberada. `pending` so sobra para quem nunca
 * recebeu nem mandou nada — assim liberar nao joga de volta na fila de primeira mensagem
 * um lead que ja foi abordado na mao.
 */
export function statusAfterAiResume(lead: Lead): string {
  if (lead.status !== 'human_paused') return lead.status;
  if (lead.handoffRequestedAt) return 'transferred';
  if (lead.notInterestedAt) return 'not_interested';
  if (lead.lastInboundAt) return 'in_conversation';
  if (lead.firstMessageSentAt || lead.lastOutboundAt) return 'initial_sent';
  return 'pending';
}
