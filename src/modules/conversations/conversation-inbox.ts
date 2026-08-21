import type { Conversation, Lead, Message } from '../../db/schema.js';
import { aiPauseReasonLabel, isAiPaused } from '../leads/ai-pause.js';
import { contactDisplayName, leadNameForPrompt, tradeBusinessName } from '../leads/lead-display-name.js';
import { digitsOnly, formatWhatsappNumber } from '../phone/whatsapp-number.js';
import { dayKeyInTimeZone, formatDayInTimeZone, formatTimeInTimeZone } from '../timezone.js';
import { isAudioMessageType } from '../webhooks/uazapi-normalizer.js';

/**
 * Modelo de visao da caixa de conversas (o "WhatsApp web" do portal): logica pura,
 * sem HTML e sem banco, para a pagina so montar as tags e os testes cobrirem as regras.
 */

/** Chats carregados de uma vez. Acima disso a lista pede a busca em vez de crescer sem fim. */
export const inboxChatLimit = 200;
/** Mensagens exibidas por conversa: historico antigo inteiro nao cabe numa pagina. */
export const inboxMessageLimit = 300;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  initial_sent: 'Abordado',
  in_conversation: 'Em conversa',
  followup_sent: 'Follow-up enviado',
  human_paused: 'Pausado por humano',
  transferred: 'Handoff feito',
  not_interested: 'Sem interesse',
  discarded: 'Descartado',
  invalid_phone: 'Telefone inexistente',
};

const STAGE_LABELS: Record<string, string> = {
  permission: 'Permissao',
  discovery: 'Descoberta',
  solution: 'Solucao',
  handoff_offer: 'Oferta de handoff',
  handoff_done: 'Handoff feito',
  not_interested: 'Sem interesse',
  discarded: 'Descartado',
};

const MESSAGE_KIND_LABELS: Record<string, string> = {
  audio: 'Audio',
  contact: 'Contato',
  document: 'Documento',
  image: 'Imagem',
  location: 'Localizacao',
  ptt: 'Audio',
  sticker: 'Figurinha',
  video: 'Video',
};

export interface InboxChat {
  conversationId: string;
  leadId: string;
  title: string;
  initials: string;
  numberLabel: string;
  preview: string;
  timeLabel: string;
  /** Ultima mensagem foi do lead: ninguem respondeu ainda. */
  awaitingReply: boolean;
  /** IA parada nesta conversa ate alguem liberar no portal. */
  aiPaused: boolean;
  /** Texto normalizado (sem acento, minusculo) que a busca — do servidor e do navegador — compara. */
  searchText: string;
}

export interface InboxMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  /** Quem mandou do lado do SDR: "IA" ou "Manual". Vazio nas mensagens do lead. */
  authorLabel: string;
  /** Tipo quando nao e texto puro ("Audio transcrito", "Imagem"). */
  kindLabel: string;
  body: string;
  timeLabel: string;
}

export interface InboxDay {
  label: string;
  messages: InboxMessage[];
}

export interface InboxThread {
  conversationId: string;
  leadId: string;
  title: string;
  initials: string;
  numberLabel: string;
  contactLabel: string;
  statusLabel: string;
  stageLabel: string;
  /** IA parada nesta conversa ate alguem liberar no portal. */
  aiPaused: boolean;
  /** Motivo da pausa em texto ("o lead enviou uma imagem"); vazio com a IA ativa. */
  aiPauseLabel: string;
  /** Quando a pausa comecou, ja no fuso do SDR; vazio com a IA ativa. */
  aiPausedAtLabel: string;
  days: InboxDay[];
  totalMessages: number;
  /** Mensagens antigas que ficaram de fora do limite da pagina. */
  hiddenMessages: number;
}

export interface InboxChatsInput {
  conversations: Conversation[];
  lastMessages: Message[];
  leads: Lead[];
  now: Date;
  search?: string | null;
  timeZone: string;
}

export interface InboxChatsResult {
  chats: InboxChat[];
  /** Chats que atendem a busca, antes do corte de `inboxChatLimit`. */
  total: number;
  hidden: number;
}

export interface InboxThreadInput {
  conversation: Conversation;
  lead: Lead | null;
  /** Mensagens da conversa em ordem cronologica. */
  messages: Message[];
  now: Date;
  timeZone: string;
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}...` : value;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Como o chat aparece na lista: nome do negocio, senao o contato, senao o proprio numero. */
export function chatTitle(lead: Lead | null, whatsappNumber: string): string {
  const fallback = formatWhatsappNumber(whatsappNumber) || whatsappNumber;
  if (!lead) return fallback;

  return tradeBusinessName(lead) || contactDisplayName(lead) || formatWhatsappNumber(lead.whatsappNumber) || fallback;
}

/** Iniciais do avatar redondo. Numero puro vira os dois ultimos digitos, que e o que distingue. */
export function chatInitials(title: string): string {
  const words = collapseSpaces(title).split(' ').filter((word) => /\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '').join('');
  if (letters) return letters.toUpperCase();

  const digits = digitsOnly(title);
  return digits ? digits.slice(-2) : '#';
}

/** Texto e tipo de uma mensagem para o balao e para a previa da lista. */
export function describeMessage(message: Message): { body: string; kindLabel: string } {
  const text = collapseSpaces(message.text ?? '');
  const transcription = collapseSpaces(message.transcription ?? '');

  if (isAudioMessageType(message.messageType)) {
    return transcription ? { body: transcription, kindLabel: 'Audio transcrito' } : { body: '', kindLabel: 'Audio sem transcricao' };
  }

  const kindLabel = MESSAGE_KIND_LABELS[normalizeText(message.messageType).replace(/message$/, '')] ?? '';
  const body = text || transcription;
  if (body) return { body, kindLabel };

  return { body: '', kindLabel: kindLabel || 'Mensagem sem texto' };
}

/** "IA" ou "Manual" nas mensagens enviadas pelo numero do SDR; vazio no que veio do lead. */
export function messageAuthorLabel(message: Message): string {
  if (message.direction !== 'outbound') return '';
  if (message.senderType === 'human') return 'Manual';
  return message.senderType === 'ai' ? 'IA' : 'SDR';
}

export function chatPreview(message: Message | null): string {
  if (!message) return 'Sem mensagens';

  const { body, kindLabel } = describeMessage(message);
  const author = messageAuthorLabel(message);
  const prefix = author ? `${author}: ` : '';
  const content = body || kindLabel;

  return truncate(`${prefix}${content}`, 90);
}

function isSameDay(value: Date, reference: Date, timeZone: string): boolean {
  return dayKeyInTimeZone(value, timeZone) === dayKeyInTimeZone(reference, timeZone);
}

function dayLabel(value: Date, now: Date, timeZone: string): string {
  if (isSameDay(value, now, timeZone)) return 'Hoje';
  if (isSameDay(value, new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone)) return 'Ontem';
  return formatDayInTimeZone(value, timeZone);
}

/** Na lista de chats o horario vira data assim que sai do dia de hoje, como no WhatsApp. */
function chatTimeLabel(value: Date | null, now: Date, timeZone: string): string {
  if (!value) return '';
  if (isSameDay(value, now, timeZone)) return formatTimeInTimeZone(value, timeZone);
  return dayLabel(value, now, timeZone);
}

function chatActivityAt(conversation: Conversation, lastMessage: Message | null): Date {
  return lastMessage?.createdAt ?? conversation.lastMessageAt ?? conversation.createdAt;
}

function searchHaystack(chat: InboxChat, lead: Lead | null): string {
  const leadNames = lead ? [lead.companyName, lead.tradeName ?? '', lead.contactName ?? '', lead.whatsappNumber] : [];
  return normalizeText([chat.title, chat.numberLabel, chat.preview, ...leadNames].join(' '));
}

/** Mesma normalizacao da busca do servidor, exportada para o filtro instantaneo da pagina. */
export function normalizeSearchTerm(value: string): string {
  return normalizeText(collapseSpaces(value));
}

export function buildInboxChats(input: InboxChatsInput): InboxChatsResult {
  const leadsById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const lastByConversation = new Map(input.lastMessages.map((message) => [message.conversationId, message]));

  const ranked = input.conversations
    .map((conversation) => {
      const lead = leadsById.get(conversation.leadId) ?? null;
      const lastMessage = lastByConversation.get(conversation.id) ?? null;
      const activityAt = chatActivityAt(conversation, lastMessage);
      const chat: InboxChat = {
        conversationId: conversation.id,
        leadId: conversation.leadId,
        title: chatTitle(lead, conversation.whatsappNumber),
        initials: '',
        numberLabel: formatWhatsappNumber(conversation.whatsappNumber) || conversation.whatsappNumber,
        preview: chatPreview(lastMessage),
        timeLabel: chatTimeLabel(activityAt, input.now, input.timeZone),
        awaitingReply: lastMessage?.direction === 'inbound',
        aiPaused: lead ? isAiPaused(lead, input.now) : false,
        searchText: '',
      };
      chat.initials = chatInitials(chat.title);
      chat.searchText = searchHaystack(chat, lead);

      return { chat, activityAt: activityAt.getTime() };
    })
    .sort((a, b) => b.activityAt - a.activityAt);

  const term = normalizeSearchTerm(input.search ?? '');
  const termDigits = digitsOnly(term);
  const matched = term
    ? ranked.filter((item) => {
        if (item.chat.searchText.includes(term)) return true;
        // Numero digitado com espaco, parenteses ou traco tem de achar o chat do mesmo jeito.
        return termDigits.length >= 3 && digitsOnly(item.chat.numberLabel).includes(termDigits);
      })
    : ranked;

  return {
    chats: matched.slice(0, inboxChatLimit).map((item) => item.chat),
    total: matched.length,
    hidden: Math.max(0, matched.length - inboxChatLimit),
  };
}

export function buildInboxThread(input: InboxThreadInput): InboxThread {
  const visible = input.messages.slice(-inboxMessageLimit);
  const days: InboxDay[] = [];

  for (const message of visible) {
    const { body, kindLabel } = describeMessage(message);
    const item: InboxMessage = {
      id: message.id,
      direction: message.direction === 'inbound' ? 'inbound' : 'outbound',
      authorLabel: messageAuthorLabel(message),
      kindLabel,
      body,
      timeLabel: formatTimeInTimeZone(message.createdAt, input.timeZone),
    };
    const label = dayLabel(message.createdAt, input.now, input.timeZone);
    const current = days[days.length - 1];

    if (current && current.label === label) current.messages.push(item);
    else days.push({ label, messages: [item] });
  }

  const lead = input.lead;
  const title = chatTitle(lead, input.conversation.whatsappNumber);
  const contactName = lead ? leadNameForPrompt(lead, lead.contactName) : '';
  const aiPaused = lead ? isAiPaused(lead, input.now) : false;

  return {
    conversationId: input.conversation.id,
    leadId: input.conversation.leadId,
    title,
    initials: chatInitials(title),
    numberLabel: formatWhatsappNumber(input.conversation.whatsappNumber) || input.conversation.whatsappNumber,
    contactLabel: contactName,
    statusLabel: statusLabel(lead?.status ?? input.conversation.status),
    stageLabel: lead ? stageLabel(lead.conversationStage) : '',
    aiPaused,
    aiPauseLabel: aiPaused ? aiPauseReasonLabel(lead?.aiPauseReason ?? null) : '',
    // minusculo porque o texto entra depois de "desde": "desde hoje as 08:57"
    aiPausedAtLabel:
      aiPaused && lead?.aiPausedAt
        ? `${dayLabel(lead.aiPausedAt, input.now, input.timeZone).toLowerCase()} as ${formatTimeInTimeZone(lead.aiPausedAt, input.timeZone)}`
        : '',
    days,
    totalMessages: input.messages.length,
    hiddenMessages: Math.max(0, input.messages.length - visible.length),
  };
}
