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
  whatsappNumber: string | null;
}

export function isAudioMessageType(messageType: string): boolean {
  const normalized = messageType.toLowerCase();
  return normalized.includes('audio') || normalized.includes('ptt') || normalized.includes('voice');
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

export function normalizeUazapiWebhook(body: unknown): NormalizedWebhookMessage | null {
  const root = asRecord(body);
  const data = asRecord(root.data ?? root.message ?? root);
  const key = asRecord(data.key ?? getPath(data, ['message', 'key']));
  const message = asRecord(data.message ?? root.message ?? data);
  const eventType = firstString(root.event, data.event, root.type, 'messages') ?? 'messages';
  const remoteJid = firstString(key.remoteJid, data.chatid, data.chatId, data.from, data.remoteJid, root.from);
  const participant = firstString(key.participant, data.sender, data.participant);
  const fromMe = firstBoolean(data.fromMe, key.fromMe, root.fromMe);
  const whatsappNumber = normalizeNumber(fromMe ? remoteJid : (participant ?? remoteJid));

  if (!whatsappNumber) return null;

  const messageType =
    firstString(data.type, data.messageType, root.messageType, data.mediaType) ??
    (typeof message.conversation === 'string' ? 'conversation' : 'unknown');
  const text = firstString(
    data.text,
    data.body,
    data.caption,
    message.conversation,
    getPath(message, ['extendedTextMessage', 'text']),
    getPath(message, ['imageMessage', 'caption']),
    getPath(message, ['videoMessage', 'caption']),
  );

  return {
    eventType,
    fromMe,
    instanceId: firstString(root.instance, data.instance, data.instanceId, root.instanceId),
    mediaUrl: firstString(data.mediaUrl, data.fileURL, data.url, getPath(message, ['audioMessage', 'url'])),
    messageType,
    rawMessage: data,
    sentByApi: firstBoolean(data.wasSentByApi, data.sentByApi, root.wasSentByApi),
    text,
    toNumber: normalizeNumber(firstString(data.to, data.toNumber, root.to)),
    transcription: firstString(data.transcription, data.transcribedText),
    whatsappMessageId: firstString(data.id, data.messageId, data.messageid, key.id),
    whatsappNumber,
  };
}
