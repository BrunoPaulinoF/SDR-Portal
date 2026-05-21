import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { decryptSecret } from '../security/secrets.js';
import type { UazapiClient, UazapiCredentials } from '../uazapi/uazapi-client.js';

interface AudioTranscriptionDependencies {
  uazapiClient: UazapiClient;
}

interface TranscribeInput {
  agent: SdrAgent;
  messageId: string | null;
}

interface DownloadBody {
  transcription?: string;
  transcribedText?: string;
  text?: string;
  fileURL?: string;
  fileUrl?: string;
  url?: string;
}

export interface AudioTranscriptionResult {
  transcription: string | null;
  mediaUrl: string | null;
  source: 'uazapi' | 'openai' | 'none';
}

function credentialsFor(agent: SdrAgent): UazapiCredentials | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

function openAiKeyFor(agent: SdrAgent): string | null {
  return agent.openaiApiKeyEncrypted ? decryptSecret(agent.openaiApiKeyEncrypted) : (env.OPENAI_API_KEY ?? null);
}

function asDownloadBody(value: unknown): DownloadBody {
  return value && typeof value === 'object' ? (value as DownloadBody) : {};
}

function getMediaUrl(body: DownloadBody): string | null {
  return body.fileURL ?? body.fileUrl ?? body.url ?? null;
}

function getTranscription(body: DownloadBody): string | null {
  return body.transcription ?? body.transcribedText ?? body.text ?? null;
}

async function transcribeWithOpenAi(fileUrl: string, apiKey: string): Promise<string | null> {
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) return null;

  const arrayBuffer = await fileResponse.arrayBuffer();
  const form = new FormData();
  form.set('model', 'whisper-1');
  form.set('file', new Blob([arrayBuffer], { type: fileResponse.headers.get('content-type') ?? 'audio/mpeg' }), 'audio.mp3');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) return null;
  const body = (await response.json()) as { text?: string };
  return body.text ?? null;
}

export function createAudioTranscriptionService(deps: AudioTranscriptionDependencies) {
  return {
    async transcribe(input: TranscribeInput): Promise<AudioTranscriptionResult> {
      if (!input.messageId) return { transcription: null, mediaUrl: null, source: 'none' };

      const credentials = credentialsFor(input.agent);
      if (!credentials) return { transcription: null, mediaUrl: null, source: 'none' };

      const openaiApiKey = openAiKeyFor(input.agent) ?? undefined;
      const result = await deps.uazapiClient.downloadMessage({
        ...credentials,
        id: input.messageId,
        transcribe: true,
        returnLink: true,
        generateMp3: true,
        openaiApiKey,
      });
      const body = asDownloadBody(result.body);
      let mediaUrl = getMediaUrl(body);
      const transcription = getTranscription(body);

      if (transcription) return { transcription, mediaUrl, source: 'uazapi' };

      if (!mediaUrl) {
        const downloadOnly = await deps.uazapiClient.downloadMessage({
          ...credentials,
          id: input.messageId,
          transcribe: false,
          returnLink: true,
          generateMp3: true,
        });
        mediaUrl = getMediaUrl(asDownloadBody(downloadOnly.body));
      }

      if (mediaUrl && openaiApiKey) {
        const fallback = await transcribeWithOpenAi(mediaUrl, openaiApiKey);
        if (fallback) return { transcription: fallback, mediaUrl, source: 'openai' };
      }

      return { transcription: null, mediaUrl, source: 'none' };
    },
  };
}
