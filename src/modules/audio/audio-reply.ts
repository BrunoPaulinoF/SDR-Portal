import { env } from '../../config/env.js';
import type { Message, SdrAgent } from '../../db/schema.js';
import { decryptSecret } from '../security/secrets.js';
import { isAudioMessageType } from '../webhooks/uazapi-normalizer.js';

/**
 * Quando o SDR responde em audio (voz da ElevenLabs) em vez de texto. So vale para a resposta
 * da IA a quem escreveu: a primeira mensagem e o follow-up continuam em texto, porque audio de
 * numero desconhecido incomoda mais e denuncia derruba o canal.
 */
export const AUDIO_REPLY_MODES = ['off', 'when_lead_sends_audio', 'always'] as const;
export type AudioReplyMode = (typeof AUDIO_REPLY_MODES)[number];
export const DEFAULT_AUDIO_REPLY_MODE: AudioReplyMode = 'off';

export const AUDIO_REPLY_MODE_LABELS: Record<AudioReplyMode, string> = {
  off: 'Desligado (responde so em texto)',
  when_lead_sends_audio: 'Responder em audio quando o lead mandar audio',
  always: 'Responder sempre em audio',
};

export const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/**
 * Acima disso a resposta vai em texto: ~40s de fala. Audio longo ninguem ouve ate o fim, e
 * cada caractere gasta credito da ElevenLabs.
 */
export const MAX_AUDIO_REPLY_CHARS = 600;

export function resolveAudioReplyMode(value: unknown): AudioReplyMode {
  return AUDIO_REPLY_MODES.includes(value as AudioReplyMode) ? (value as AudioReplyMode) : DEFAULT_AUDIO_REPLY_MODE;
}

export function resolveElevenLabsApiKey(agent: Pick<SdrAgent, 'elevenlabsApiKeyEncrypted'>): string | null {
  return agent.elevenlabsApiKeyEncrypted ? decryptSecret(agent.elevenlabsApiKeyEncrypted) : (env.ELEVENLABS_API_KEY ?? null);
}

export interface VoiceConfig {
  apiKey: string;
  model: string;
  voiceId: string;
}

/** Chave + voz prontas para falar, ou `null` se falta alguma coisa. Nao olha o modo. */
export function voiceConfigOf(
  agent: Pick<SdrAgent, 'elevenlabsApiKeyEncrypted' | 'elevenlabsModel' | 'elevenlabsVoiceId'>,
): VoiceConfig | null {
  const voiceId = agent.elevenlabsVoiceId?.trim();
  const apiKey = resolveElevenLabsApiKey(agent);
  if (!voiceId || !apiKey) return null;
  return { apiKey, model: agent.elevenlabsModel?.trim() || DEFAULT_ELEVENLABS_MODEL, voiceId };
}

/**
 * O lead mandou audio no bloco de mensagens que esta sendo respondido (tudo depois da nossa
 * ultima mensagem). Olhar so a ultima erraria o caso comum "audio + ?" escrito logo depois.
 */
function leadJustSentAudio(history: Array<Pick<Message, 'autoReply' | 'direction' | 'messageType'>>): boolean {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message || message.direction !== 'inbound') return false;
    if (!message.autoReply && isAudioMessageType(message.messageType)) return true;
  }
  return false;
}

/** A proxima resposta deste SDR deve sair em audio? */
export function wantsAudioReply(
  agent: Pick<SdrAgent, 'audioReplyMode' | 'elevenlabsApiKeyEncrypted' | 'elevenlabsModel' | 'elevenlabsVoiceId'>,
  history: Array<Pick<Message, 'autoReply' | 'direction' | 'messageType'>>,
): boolean {
  const mode = resolveAudioReplyMode(agent.audioReplyMode);
  if (mode === 'off' || !voiceConfigOf(agent)) return false;
  return mode === 'always' || leadJustSentAudio(history);
}

// Alternativas, nao uma classe so: os modificadores (VS16, ZWJ, keycap) dentro de [] o lint
// trata como caractere combinado.
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;
const LINK_OR_EMAIL = /https?:\/\/|www\.|wa\.me\/|\S+@\S+\.\S+/i;

/**
 * Texto que a voz vai falar, ou `null` quando a resposta tem que ir escrita: link, e-mail ou
 * telefone lidos em voz alta nao servem para nada (o lead precisa clicar ou copiar), e texto
 * longo demais vira audio que ninguem escuta.
 */
export function speakableText(message: string): string | null {
  if (LINK_OR_EMAIL.test(message)) return null;
  if (/\d{8,}/.test(message.replace(/[\s().-]/g, ''))) return null;

  const text = message
    .replace(EMOJI, '')
    .replace(/[*_~`]/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // Cada paragrafo vira uma frase: sem ponto no fim, a voz emenda um no outro sem pausa.
    .map((line) => (/[.!?…:;,]$/.test(line) ? line : `${line}.`))
    .join(' ');

  if (!text || text.length > MAX_AUDIO_REPLY_CHARS) return null;
  return text;
}
