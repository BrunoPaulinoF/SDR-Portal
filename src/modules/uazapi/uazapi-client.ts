export interface UazapiCredentials {
  baseUrl: string;
  token: string;
}

export interface SendTextInput extends UazapiCredentials {
  number: string;
  text: string;
  delay?: number;
  readchat?: boolean;
  trackId?: string;
  trackSource?: string;
}

export interface SendContactInput extends UazapiCredentials {
  /** WhatsApp que vai receber o cartao de contato. */
  number: string;
  /** Nome que aparece no cartao. */
  fullName: string;
  /** Numero do contato que vai dentro do cartao. */
  phoneNumber: string;
  delay?: number;
  readchat?: boolean;
  trackId?: string;
  trackSource?: string;
}

export interface SendPresenceInput extends UazapiCredentials {
  number: string;
  presence: 'composing' | 'recording' | 'paused';
  delay?: number;
}

export interface ConfigureWebhookInput extends UazapiCredentials {
  url: string;
  events: string[];
  excludeMessages: string[];
}

export interface DownloadMessageInput extends UazapiCredentials {
  id: string;
  transcribe?: boolean;
  returnBase64?: boolean;
  returnLink?: boolean;
  generateMp3?: boolean;
  openaiApiKey?: string;
}

export interface CheckChatsInput extends UazapiCredentials {
  numbers: string[];
}

export interface UazapiResult {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface UazapiClient {
  checkChats(input: CheckChatsInput): Promise<UazapiResult>;
  configureWebhook(input: ConfigureWebhookInput): Promise<UazapiResult>;
  downloadMessage(input: DownloadMessageInput): Promise<UazapiResult>;
  getInstanceStatus(input: UazapiCredentials): Promise<UazapiResult>;
  sendContact(input: SendContactInput): Promise<UazapiResult>;
  sendPresence(input: SendPresenceInput): Promise<UazapiResult>;
  sendText(input: SendTextInput): Promise<UazapiResult>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request(path: string, credentials: UazapiCredentials, init: RequestInit = {}): Promise<UazapiResult> {
  const response = await fetch(`${normalizeBaseUrl(credentials.baseUrl)}${path}`, {
    ...init,
    headers: {
      token: credentials.token,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  return {
    status: response.status,
    ok: response.ok,
    body: await parseBody(response),
  };
}

export function createHttpUazapiClient(): UazapiClient {
  return {
    checkChats(input) {
      return request('/chat/check', input, {
        method: 'POST',
        body: JSON.stringify({ numbers: input.numbers }),
      });
    },

    configureWebhook(input) {
      return request('/webhook', input, {
        method: 'POST',
        body: JSON.stringify({
          enabled: true,
          url: input.url,
          events: input.events,
          excludeMessages: input.excludeMessages,
        }),
      });
    },

    downloadMessage(input) {
      return request('/message/download', input, {
        method: 'POST',
        body: JSON.stringify({
          id: input.id,
          transcribe: input.transcribe,
          return_base64: input.returnBase64,
          return_link: input.returnLink,
          generate_mp3: input.generateMp3,
          openai_apikey: input.openaiApiKey,
        }),
      });
    },

    getInstanceStatus(input) {
      return request('/instance/status', input, { method: 'GET' });
    },

    sendContact(input) {
      return request('/send/contact', input, {
        method: 'POST',
        body: JSON.stringify({
          number: input.number,
          fullName: input.fullName,
          phoneNumber: input.phoneNumber,
          delay: input.delay,
          readchat: input.readchat,
          track_id: input.trackId,
          track_source: input.trackSource,
        }),
      });
    },

    sendPresence(input) {
      return request('/message/presence', input, {
        method: 'POST',
        body: JSON.stringify({
          number: input.number,
          presence: input.presence,
          delay: input.delay,
        }),
      });
    },

    sendText(input) {
      return request('/send/text', input, {
        method: 'POST',
        body: JSON.stringify({
          number: input.number,
          text: input.text,
          delay: input.delay,
          readchat: input.readchat,
          track_id: input.trackId,
          track_source: input.trackSource,
        }),
      });
    },
  };
}
