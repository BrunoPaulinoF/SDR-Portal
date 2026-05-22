export function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function whatsappNumberVariants(value: string): string[] {
  const digits = digitsOnly(value);
  const variants = new Set<string>();
  if (digits) variants.add(digits);

  if (digits.startsWith('55') && digits.length === 13) {
    const countryAndArea = digits.slice(0, 4);
    const subscriber = digits.slice(4);
    if (subscriber.startsWith('9')) variants.add(`${countryAndArea}${subscriber.slice(1)}`);
  }

  if (digits.startsWith('55') && digits.length === 12) {
    const countryAndArea = digits.slice(0, 4);
    const subscriber = digits.slice(4);
    variants.add(`${countryAndArea}9${subscriber}`);
  }

  return [...variants];
}

export function whatsappNumberFromJid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const [number] = value.split('@');
  const digits = digitsOnly(number);
  return digits.length >= 10 ? digits : null;
}

export function normalizeWhatsappJid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes('@g.us')) return null;
  if (trimmed.includes('@s.whatsapp.net') || trimmed.includes('@c.us') || trimmed.includes('@lid')) return trimmed;
  return null;
}

export function whatsappIdentityFromUazapiSendResult(body: unknown): { jid: string | null; lid: string | null } {
  if (!body || typeof body !== 'object') return { jid: null, lid: null };
  const record = body as Record<string, unknown>;
  const jid = normalizeWhatsappJid(record.chatid) ?? normalizeWhatsappJid(record.jid);
  const lid = normalizeWhatsappJid(record.chatlid) ?? normalizeWhatsappJid(record.lid);
  return { jid: jid?.includes('@lid') ? null : jid, lid: lid?.includes('@lid') ? lid : null };
}

export function whatsappNumberFromUazapiSendResult(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  return whatsappNumberFromJid(record.chatid) ?? whatsappNumberFromJid(record.jid) ?? fallback;
}
