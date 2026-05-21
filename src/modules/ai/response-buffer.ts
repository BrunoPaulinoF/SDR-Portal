export interface ResponsePart {
  delayMs: number;
  text: string;
}

export interface ResponseBufferConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  maxPartChars: number;
  perCharDelayMs: number;
}

function splitLongText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks;
}

function splitParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [paragraph];
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) parts.push(current);
    if (sentence.length > maxChars) {
      parts.push(...splitLongText(sentence, maxChars));
      current = '';
    } else {
      current = sentence;
    }
  }

  if (current) parts.push(current);
  return parts;
}

export function buildResponseParts(message: string, config: ResponseBufferConfig): ResponsePart[] {
  const maxChars = Math.max(1, config.maxPartChars);
  const rawParts = message
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => splitParagraph(part, maxChars));

  return rawParts.map((text) => ({
    text,
    delayMs: Math.min(config.maxDelayMs, config.baseDelayMs + text.length * config.perCharDelayMs),
  }));
}

export async function waitBeforeSending(delayMs: number): Promise<void> {
  if (delayMs <= 0 || process.env.NODE_ENV === 'test') return;
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
