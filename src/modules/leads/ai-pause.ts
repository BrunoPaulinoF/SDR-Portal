import type { Lead } from '../../db/schema.js';
import type { LeadMediaKind } from '../webhooks/uazapi-normalizer.js';

/**
 * Pausa da IA numa conversa. Desde que o portal ganhou o botao de liberar, a pausa NAO
 * expira sozinha: `aiPausedAt` preenchido significa "so volta quando alguem liberar".
 * `humanPausedUntil` continua lido para nao ressuscitar a IA em leads pausados antes
 * dessa mudanca, mas nada novo escreve nessa coluna.
 */
export const AI_PAUSE_REASONS = {
  /** O lead mandou foto, video ou arquivo: a IA nao abre nenhum, entao quem responde e um humano. */
  leadImage: 'lead_image_message',
  leadVideo: 'lead_video_message',
  leadDocument: 'lead_document_message',
  /** Alguem respondeu pelo proprio WhatsApp do SDR (`fromMe` sem passar pela API). */
  manualWhatsapp: 'manual_whatsapp_message',
  /** Pausa pedida no botao da caixa de conversas. */
  portal: 'portal_manual',
} as const;

const LEAD_MEDIA_REASONS: Record<LeadMediaKind, string> = {
  image: AI_PAUSE_REASONS.leadImage,
  video: AI_PAUSE_REASONS.leadVideo,
  document: AI_PAUSE_REASONS.leadDocument,
};

const REASON_LABELS: Record<string, string> = {
  [AI_PAUSE_REASONS.leadImage]: 'o lead enviou uma imagem',
  [AI_PAUSE_REASONS.leadVideo]: 'o lead enviou um video',
  [AI_PAUSE_REASONS.leadDocument]: 'o lead enviou um documento',
  [AI_PAUSE_REASONS.manualWhatsapp]: 'alguem respondeu pelo WhatsApp do SDR',
  [AI_PAUSE_REASONS.portal]: 'a pausa foi feita aqui no portal',
};

export function leadMediaPauseReason(kind: LeadMediaKind): string {
  return LEAD_MEDIA_REASONS[kind];
}

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
