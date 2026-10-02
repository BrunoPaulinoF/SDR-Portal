import { env } from '../../config/env.js';

export interface SynthesizeSpeechInput {
  apiKey: string;
  model: string;
  text: string;
  voiceId: string;
}

export interface SynthesizedSpeech {
  /** Audio pronto para ir ao WhatsApp. */
  audio: Buffer;
  mimeType: string;
}

export interface TextToSpeechClient {
  synthesize(input: SynthesizeSpeechInput): Promise<SynthesizedSpeech>;
}

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
// MP3 e o formato que a UAZAPI aceita para audio de voz (ptt). 64 kbps sobra para fala e
// deixa o base64 de um audio de 30s na casa de 300 KB.
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_64';

/**
 * A ElevenLabs devolve o motivo em `detail.status`/`detail.message` (cota estourada, conta
 * gratuita bloqueada por "atividade incomum", voz que exige plano pago). E esse texto que
 * aparece no /ai-runs — sem ele, o erro seria so "HTTP 401" e ninguem saberia o que fazer.
 */
async function errorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  try {
    const body = JSON.parse(raw) as { detail?: { status?: string; message?: string } | string };
    if (typeof body.detail === 'string') return body.detail;
    if (body.detail) return [body.detail.status, body.detail.message].filter(Boolean).join(': ');
  } catch {
    // corpo nao era JSON: segue com o texto cru
  }
  return raw.slice(0, 300);
}

export function createElevenLabsTextToSpeechClient(): TextToSpeechClient {
  return {
    async synthesize(input) {
      const url = new URL(`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`, ELEVENLABS_BASE_URL);
      url.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT);

      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
        headers: {
          accept: 'audio/mpeg',
          'content-type': 'application/json',
          'xi-api-key': input.apiKey,
        },
        body: JSON.stringify({ text: input.text, model_id: input.model }),
      });

      if (!response.ok) {
        const detail = await errorDetail(response);
        throw new Error(`ElevenLabs HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) throw new Error('ElevenLabs devolveu audio vazio');
      return { audio, mimeType: 'audio/mpeg' };
    },
  };
}
