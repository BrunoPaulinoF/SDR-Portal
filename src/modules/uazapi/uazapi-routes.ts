import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { requireUser } from '../auth/access.js';
import { MAX_AUDIO_REPLY_CHARS, voiceConfigOf } from '../audio/audio-reply.js';
import type { TextToSpeechClient } from '../audio/text-to-speech-client.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiClient, UazapiCredentials, UazapiResult } from './uazapi-client.js';
import {
  erroredAction,
  failedAction,
  summarizeUazapiAction,
  type UazapiActionKind,
  type UazapiActionOutcome,
} from './action-summary.js';
import { renderUazapiResultPage } from './uazapi-pages.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const sendTestSchema = z.object({
  number: z.string().trim().min(10),
  text: z.string().trim().min(1),
});

const sendAudioTestSchema = z.object({
  number: z.string().trim().min(10),
  text: z.string().trim().min(1).max(MAX_AUDIO_REPLY_CHARS),
});

function getWebhookUrl(agentId: string): string | null {
  if (!env.APP_URL) {
    return null;
  }

  const url = new URL(`/webhooks/uazapi/${agentId}`, env.APP_URL);

  if (env.WEBHOOK_SHARED_SECRET) {
    url.searchParams.set('secret', env.WEBHOOK_SHARED_SECRET);
  }

  return url.toString();
}

function getCredentials(agent: SdrAgent): UazapiCredentials | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) {
    return null;
  }

  return {
    baseUrl: agent.uazapiBaseUrl,
    token: decryptSecret(agent.uazapiInstanceTokenEncrypted),
  };
}

async function findAgentOrReply(
  requestParams: unknown,
  sdrAgentRepository: SdrAgentRepository,
): Promise<SdrAgent | null> {
  const params = paramsSchema.safeParse(requestParams);

  if (!params.success) {
    return null;
  }

  return sdrAgentRepository.findById(params.data.id);
}

function wantsJson(request: FastifyRequest): boolean {
  return (request.headers.accept ?? '').includes('application/json');
}

/** O mesmo resultado vai em JSON para o `/app.js` (fica na tela do SDR) ou como pagina de reserva. */
function respond(request: FastifyRequest, reply: FastifyReply, agent: SdrAgent, outcome: UazapiActionOutcome) {
  if (wantsJson(request)) return reply.type('application/json').send(outcome);
  return reply.type('text/html').send(renderUazapiResultPage(agent, outcome));
}

async function runUazapiAction(
  agent: SdrAgent,
  kind: UazapiActionKind,
  action: (credentials: UazapiCredentials) => Promise<UazapiResult>,
  number?: string,
): Promise<UazapiActionOutcome> {
  const credentials = getCredentials(agent);
  if (!credentials) {
    return failedAction(kind, 'Este SDR ainda nao tem a URL da UAZAPI e o token da instancia.', 'Preencha a secao WhatsApp e salve antes de testar.');
  }

  try {
    return summarizeUazapiAction(kind, await action(credentials), { agent, number });
  } catch (error) {
    return erroredAction(kind, error);
  }
}

export function registerUazapiRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  uazapiClient: UazapiClient,
  textToSpeechClient: TextToSpeechClient,
): void {
  app.post('/sdr-agents/:id/uazapi/status', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const agent = await findAgentOrReply(request.params, sdrAgentRepository);

    if (!agent) {
      return reply.status(404).send('SDR nao encontrado');
    }

    return respond(request, reply, agent, await runUazapiAction(agent, 'status', (credentials) => uazapiClient.getInstanceStatus(credentials)));
  });

  // O que o WhatsApp diz sobre a conta iniciar conversas novas: bloqueio temporario e cota.
  app.post('/sdr-agents/:id/uazapi/limites', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const agent = await findAgentOrReply(request.params, sdrAgentRepository);

    if (!agent) {
      return reply.status(404).send('SDR nao encontrado');
    }

    return respond(request, reply, agent, await runUazapiAction(agent, 'limites', (credentials) => uazapiClient.getMessageLimits(credentials)));
  });

  app.post('/sdr-agents/:id/uazapi/configure-webhook', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const agent = await findAgentOrReply(request.params, sdrAgentRepository);

    if (!agent) {
      return reply.status(404).send('SDR nao encontrado');
    }

    const webhookUrl = getWebhookUrl(agent.id);

    if (!webhookUrl) {
      return respond(
        request,
        reply,
        agent,
        failedAction('webhook', 'O portal nao sabe o proprio endereco publico (APP_URL vazio no ambiente).', 'Preencha APP_URL nas variaveis do servico no EasyPanel e faca um Deploy.'),
      );
    }

    return respond(
      request,
      reply,
      agent,
      await runUazapiAction(agent, 'webhook', (credentials) =>
        uazapiClient.configureWebhook({
          ...credentials,
          url: webhookUrl,
          events: ['messages', 'connection'],
          excludeMessages: ['wasSentByApi', 'isGroupYes'],
        }),
      ),
    );
  });

  app.post('/sdr-agents/:id/uazapi/send-test', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const agent = await findAgentOrReply(request.params, sdrAgentRepository);
    if (!agent) {
      return reply.status(404).send('SDR nao encontrado');
    }

    const body = sendTestSchema.safeParse(request.body);
    if (!body.success) {
      return respond(request, reply, agent, failedAction('mensagem', 'Informe o numero (com DDD) e o texto da mensagem.'));
    }

    return respond(
      request,
      reply,
      agent,
      await runUazapiAction(
        agent,
        'mensagem',
        async (credentials) => {
        await uazapiClient.sendPresence({ ...credentials, number: body.data.number, presence: 'composing', delay: 1000 });
        return uazapiClient.sendText({
          ...credentials,
          number: body.data.number,
          text: body.data.text,
          readchat: true,
          trackSource: 'sdr-portal-test',
          trackId: `test-${agent.id}`,
        });
        },
        body.data.number,
      ),
    );
  });

  app.post('/sdr-agents/:id/uazapi/send-audio-test', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const agent = await findAgentOrReply(request.params, sdrAgentRepository);
    if (!agent) {
      return reply.status(404).send('SDR nao encontrado');
    }

    const body = sendAudioTestSchema.safeParse(request.body);
    if (!body.success) {
      return respond(request, reply, agent, failedAction('audio', `Informe o numero (com DDD) e um texto de ate ${MAX_AUDIO_REPLY_CHARS} caracteres.`));
    }

    const voice = voiceConfigOf(agent);
    if (!voice) {
      return respond(
        request,
        reply,
        agent,
        failedAction('audio', 'Falta a voz: salve o ID da voz e a chave da ElevenLabs na secao "Resposta em audio" antes de testar.'),
      );
    }

    // O teste nao cai para texto como a resposta da IA: aqui o objetivo e justamente ver o erro.
    return respond(
      request,
      reply,
      agent,
      await runUazapiAction(
        agent,
        'audio',
        async (credentials) => {
        const speech = await textToSpeechClient.synthesize({ ...voice, text: body.data.text });
        await uazapiClient.sendPresence({ ...credentials, number: body.data.number, presence: 'recording', delay: 1000 });
        return uazapiClient.sendMedia({
          ...credentials,
          number: body.data.number,
          type: 'ptt',
          file: `data:${speech.mimeType};base64,${speech.audio.toString('base64')}`,
          mimetype: speech.mimeType,
          readchat: true,
          trackSource: 'sdr-portal-test',
          trackId: `test-audio-${agent.id}`,
        });
        },
        body.data.number,
      ),
    );
  });
}
