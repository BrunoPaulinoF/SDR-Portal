import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { renderSdrAgentNotFoundPage } from '../sdr-agents/sdr-agent-pages.js';
import { renderPublicConnectPage, renderSdrConnectPage, renderShareLinkInvalidPage } from './instance-connect-pages.js';
import {
  generateShareToken,
  hashShareToken,
  isShareLinkUsable,
  shareLinkExpiresAt,
  type InstanceShareLinkRepository,
} from './instance-share-link-repository.js';
import { readConnectionState } from './instance-provisioning.js';
import type { UazapiClient } from './uazapi-client.js';

const agentParamsSchema = z.object({ id: z.string().uuid() });
// base64url de 32 bytes: 43 caracteres. Aceita a faixa para nao travar em variacoes de padding.
const tokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,120}$/) });

function credentialsOf(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

function minutesUntil(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 60000));
}

export function registerInstanceConnectRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  shareLinkRepository: InstanceShareLinkRepository,
  uazapiClient: UazapiClient,
): void {
  app.get('/sdr-agents/:id/conectar', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const agent = params.success ? await sdrAgentRepository.findById(params.data.id) : null;
    if (!agent) return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());

    const credentials = credentialsOf(agent);
    if (!credentials) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderShareLinkInvalidPage('Este SDR ainda nao tem instancia UAZAPI configurada.'));
    }

    const state = await readConnectionState(uazapiClient, credentials);
    return reply.type('text/html').send(renderSdrConnectPage(agent, state, null));
  });

  app.post('/sdr-agents/:id/conectar/compartilhar', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const agent = params.success ? await sdrAgentRepository.findById(params.data.id) : null;
    if (!agent) return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());

    const credentials = credentialsOf(agent);
    if (!credentials) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderShareLinkInvalidPage('Este SDR ainda nao tem instancia UAZAPI configurada.'));
    }

    const now = new Date();
    // Um link ativo por vez: gerar um novo invalida o anterior, para nao ficar link solto.
    await shareLinkRepository.revokeActiveForAgent(agent.id, now);
    const token = generateShareToken();
    await shareLinkRepository.create({
      sdrAgentId: agent.id,
      createdByUserId: user.id,
      expiresAt: shareLinkExpiresAt(now),
      tokenHash: hashShareToken(token),
    });

    const shareUrl = new URL(`/conectar/${token}`, env.APP_URL ?? 'http://localhost:3000').toString();
    const state = await readConnectionState(uazapiClient, credentials);
    return reply.type('text/html').send(renderSdrConnectPage(agent, state, shareUrl));
  });

  // Rota publica: quem tem o link consegue parear o WhatsApp, entao ela nunca revela
  // nada alem do nome do SDR e do QR, e some assim que o link expira.
  app.get('/conectar/:token', async (request, reply) => {
    const params = tokenParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Link invalido.'));
    }

    const link = await shareLinkRepository.findByTokenHash(hashShareToken(params.data.token));
    const now = new Date();
    if (!link || !isShareLinkUsable(link, now)) {
      return reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Este link expirou ou foi cancelado.'));
    }

    const agent = await sdrAgentRepository.findById(link.sdrAgentId);
    const credentials = agent ? credentialsOf(agent) : null;
    if (!agent || !credentials) {
      return reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Este link nao esta mais disponivel.'));
    }

    const state = await readConnectionState(uazapiClient, credentials);
    if (state.connected && !link.connectedAt) await shareLinkRepository.markConnected(link.id, now);

    return reply.type('text/html').send(renderPublicConnectPage(agent.name, state, minutesUntil(link.expiresAt, now)));
  });
}
