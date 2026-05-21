import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiClient, UazapiCredentials, UazapiResult } from './uazapi-client.js';
import { renderUazapiResultPage } from './uazapi-pages.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const sendTestSchema = z.object({
  number: z.string().trim().min(10),
  text: z.string().trim().min(1),
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

function renderMissingConfig(agent: SdrAgent, title: string): string {
  return renderUazapiResultPage(agent, title, null, 'Configure URL base da UAZAPI e token da instancia antes de usar esta acao.');
}

async function runUazapiAction(
  agent: SdrAgent,
  title: string,
  action: (credentials: UazapiCredentials) => Promise<UazapiResult>,
): Promise<string> {
  try {
    const credentials = getCredentials(agent);

    if (!credentials) {
      return renderMissingConfig(agent, title);
    }

    const result = await action(credentials);
    return renderUazapiResultPage(agent, title, result, result.ok ? undefined : 'A UAZAPI retornou erro. Veja o payload abaixo.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao chamar UAZAPI.';
    return renderUazapiResultPage(agent, title, null, message);
  }
}

export function registerUazapiRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  uazapiClient: UazapiClient,
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

    return reply.type('text/html').send(await runUazapiAction(agent, 'Status UAZAPI', (credentials) => uazapiClient.getInstanceStatus(credentials)));
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
      return reply
        .type('text/html')
        .send(renderUazapiResultPage(agent, 'Configurar webhook', null, 'Configure APP_URL no ambiente para gerar a URL publica do webhook.'));
    }

    return reply.type('text/html').send(
      await runUazapiAction(agent, 'Configurar webhook', (credentials) =>
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
      return reply.type('text/html').send(renderUazapiResultPage(agent, 'Enviar teste UAZAPI', null, 'Informe numero e texto para envio.'));
    }

    return reply.type('text/html').send(
      await runUazapiAction(agent, 'Enviar teste UAZAPI', async (credentials) => {
        await uazapiClient.sendPresence({ ...credentials, number: body.data.number, presence: 'composing', delay: 1000 });
        return uazapiClient.sendText({
          ...credentials,
          number: body.data.number,
          text: body.data.text,
          readchat: true,
          trackSource: 'sdr-portal-test',
          trackId: `test-${agent.id}`,
        });
      }),
    );
  });
}
