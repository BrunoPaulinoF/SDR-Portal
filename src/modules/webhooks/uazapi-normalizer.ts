interface RecordValue {
  [key: string]: unknown;
}

export interface NormalizedWebhookMessage {
  eventType: string;
  fromMe: boolean;
  instanceId: string | null;
  mediaUrl: string | null;
  messageType: string;
  rawMessage: unknown;
  sentByApi: boolean;
  text: string | null;
  toNumber: string | null;
  transcription: string | null;
  whatsappMessageId: string | null;
  whatsappJid: string | null;
  whatsappLid: string | null;
  whatsappNumber: string | null;
}

export function isAudioMessageType(messageType: string): boolean {
  const normalized = messageType.toLowerCase();
  return normalized.includes('audio') || normalized.includes('ogg') || normalized.includes('opus') || normalized.includes('ptt') || normalized.includes('voice');
}

/**
 * Foto/print mandado pelo lead. A IA nao enxerga a imagem, entao a conversa e pausada para
 * um humano olhar — ver `AI_PAUSE_REASONS.leadImage`. Figurinha nao conta: e reacao, nao conteudo.
 */
export function isImageMessageType(messageType: string): boolean {
  const normalized = messageType.toLowerCase();
  if (normalized.includes('sticker')) return false;
  return (
    normalized.includes('image') ||
    normalized.includes('photo') ||
    normalized.includes('jpeg') ||
    normalized.includes('jpg') ||
    normalized.includes('png')
  );
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

function getPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => asRecord(current)[key], value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
  }
  return false;
}

function normalizeNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.includes('@g.us')) return null;
  const withoutSuffix = value.replace(/@s\.whatsapp\.net|@c\.us|@lid/g, '');
  const digits = withoutSuffix.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

function normalizeJid(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('@g.us')) return null;
  return normalized.includes('@s.whatsapp.net') || normalized.includes('@c.us') || normalized.includes('@lid') ? normalized : null;
}

function firstJid(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeJid(firstString(value));
    if (normalized) return normalized;
  }
  return null;
}

function firstNormalizedNumber(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeNumber(firstString(value));
    if (normalized) return normalized;
  }
  return null;
}

function isAudioPayload(messageType: string | null, content: RecordValue): boolean {
  return (
    isAudioMessageType(messageType ?? '') ||
    firstBoolean(content.PTT, content.ptt) ||
    isAudioMessageType(firstString(content.mimetype, content.mimeType, content.type) ?? '')
  );
}

/**
 * Alem do proprio tipo, o mimetype (`image/jpeg`) denuncia foto em payload generico
 * (`type: "media"`). A figurinha viaja como `image/webp`, entao o nome do tipo tem de ser
 * lido junto: sem isso toda figurinha viraria foto e pausaria a conversa.
 */
function isImagePayload(declaredType: string | null, rawMessageType: string | null, content: RecordValue): boolean {
  const hints = [declaredType, rawMessageType, firstString(content.mimetype, content.mimeType, content.type)]
    .filter((hint): hint is string => Boolean(hint))
    .join(' ');
  return isImageMessageType(hints);
}

/**
 * Mensagem de grupo. A UAZAPI entrega grupo pelo mesmo webhook das conversas 1:1, e no
 * grupo o remetente vem so como LID — que casa com o LID de um lead que ja conversou pelo
 * privado. Foi assim que o grupo interno "Kybernan - Projeto Insumo Smart" entrou no chat
 * de um lead e a SDR respondeu ao time dentro da conversa dele. Grupo nunca e lead.
 *
 * Nao da para confiar so no `isGroup`: ele vem em lugares diferentes conforme o evento, e
 * `false` num campo nao desmente `@g.us` no outro. Por isso qualquer sinal basta.
 */
export function isGroupWebhook(body: unknown): boolean {
  const root = asRecord(body);
  const data = asRecord(root.data ?? root.message ?? root);
  const key = asRecord(data.key ?? getPath(data, ['message', 'key']));
  const chat = asRecord(root.chat ?? data.chat);
  const event = asRecord(root.event);

  const flags = [data.isGroup, data.isgroup, chat.wa_isGroup, chat.isGroup, root.isGroup, event.IsGroup];
  if (flags.some((value) => value === true || (typeof value === 'string' && value.toLowerCase() === 'true'))) return true;

  const jids = [key.remoteJid, data.chatid, data.chatId, data.from, data.remoteJid, root.from, chat.wa_chatid, event.Chat, event.chatid];
  return jids.some((value) => typeof value === 'string' && value.includes('@g.us'));
}

export function normalizeUazapiWebhook(body: unknown): NormalizedWebhookMessage | null {
  if (isGroupWebhook(body)) return null;

  const root = asRecord(body);
  const data = asRecord(root.data ?? root.message ?? root);
  const key = asRecord(data.key ?? getPath(data, ['message', 'key']));
  const message = asRecord(data.message ?? root.message ?? data);
  const content = asRecord(data.content);
  const eventType = firstString(root.event, data.event, root.type, 'messages') ?? 'messages';
  const remoteJid = firstString(key.remoteJid, data.chatid, data.chatId, data.from, data.remoteJid, root.from);
  const participant = firstString(key.participant, data.sender, data.participant);
  const fromMe = firstBoolean(data.fromMe, key.fromMe, root.fromMe);
  const whatsappJid = firstJid(data.sender_pn, data.senderPn, data.senderPhone, data.chatid, data.chatId, remoteJid);
  const whatsappLid = firstJid(data.chatlid, data.chatLid, data.sender_lid, data.senderLid, data.lid, participant);
  const whatsappNumber = fromMe
    ? firstNormalizedNumber(remoteJid, data.chatid, data.chatId)
    : firstNormalizedNumber(data.sender_pn, data.senderPn, data.senderPhone, data.chatid, data.chatId, remoteJid, participant);

  if (!whatsappNumber) return null;

  const rawMessageType =
    firstString(data.messageType, root.messageType, data.mediaType, data.type) ??
    (typeof message.conversation === 'string' ? 'conversation' : 'unknown');
  const declaredType = firstString(data.type, rawMessageType) ?? 'unknown';
  const messageType = isAudioPayload(rawMessageType, content)
    ? 'audio'
    : isImagePayload(declaredType, rawMessageType, content)
      ? 'image'
      : declaredType;
  const text = firstString(
    data.text,
    data.body,
    data.caption,
    data.content,
    message.conversation,
    getPath(message, ['extendedTextMessage', 'text']),
    getPath(message, ['imageMessage', 'caption']),
    getPath(message, ['videoMessage', 'caption']),
  );

  return {
    eventType,
    fromMe,
    instanceId: firstString(root.instance, data.instance, data.instanceId, root.instanceId),
    mediaUrl: firstString(
      data.mediaUrl,
      data.fileURL,
      data.fileUrl,
      data.url,
      content.URL,
      content.url,
      content.fileURL,
      content.fileUrl,
      getPath(message, ['audioMessage', 'url']),
    ),
    messageType,
    rawMessage: data,
    sentByApi: firstBoolean(data.wasSentByApi, data.sentByApi, root.wasSentByApi),
    text,
    toNumber: normalizeNumber(firstString(data.to, data.toNumber, root.to)),
    transcription: firstString(data.transcription, data.transcribedText),
    whatsappMessageId: firstString(data.id, data.messageId, data.messageid, key.id),
    whatsappJid: whatsappJid?.includes('@lid') ? null : whatsappJid,
    whatsappLid: whatsappLid?.includes('@lid') ? whatsappLid : null,
    whatsappNumber,
  };
}
