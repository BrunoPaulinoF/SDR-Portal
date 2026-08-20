import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { SdrAgent } from '../../db/schema.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { renderSdrAgentNotFoundPage } from '../sdr-agents/sdr-agent-pages.js';
import {
  renderPublicConnectPage,
  renderQrPanel,
  renderSdrConnectPage,
  renderShareLinkInvalidPage,
} from './instance-connect-pages.js';
import {
  generateShareToken,
  hashShareToken,
  isShareLinkUsable,
  shareLinkExpiresAt,
  type InstanceShareLinkRepository,
} from './instance-share-link-repository.js';
import {
  auditInstanceCredential,
  configureInstanceWebhook,
  isInstanceProvisioningEnabled,
  provisionInstance,
  readConnectionStatus,
  requestConnectionQr,
} from './instance-provisioning.js';
import { encryptSecret } from '../security/secrets.js';
import type { UazapiClient } from './uazapi-client.js';

const agentParamsSchema = z.object({ id: z.string().uuid() });
// base64url de 32 bytes: 43 caracteres. Aceita a faixa para nao travar em variacoes de padding.
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;
const tokenParamsSchema = z.object({ token: z.string().regex(tokenPattern) });
const connectQuerySchema = z.object({ link: z.string().regex(tokenPattern).optional() });

function credentialsOf(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

function minutesUntil(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 60000));
}

/** Compara so o host: barra final ou http/https nao mudam de servidor. */
function sameHost(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function shareUrlFor(token: string): string {
  return new URL(`/conectar/${token}`, env.APP_URL ?? 'http://localhost:3000').toString();
}

export function registerInstanceConnectRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  shareLinkRepository: InstanceShareLinkRepository,
  uazapiClient: UazapiClient,
): void {
  /** Resolve o SDR da rota autenticada, ja respondendo os erros de tela. */
  async function loadAgentForUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ agent: SdrAgent; credentials: { baseUrl: string; token: string } } | null> {
    const params = agentParamsSchema.safeParse(request.params);
    const agent = params.success ? await sdrAgentRepository.findById(params.data.id) : null;
    if (!agent) {
      await reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
      return null;
    }

    const credentials = credentialsOf(agent);
    if (!credentials) {
      await reply
        .status(400)
        .type('text/html')
        .send(renderShareLinkInvalidPage('Este SDR ainda nao tem instancia UAZAPI configurada.'));
      return null;
    }

    return { agent, credentials };
  }

  app.get('/sdr-agents/:id/conectar', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const found = params.success ? await sdrAgentRepository.findById(params.data.id) : null;
    if (!found) return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());

    // Sem instancia nenhuma a tela ainda abre, contanto que dê para criar uma por aqui:
    // e justamente o SDR que precisa do botao.
    if (!credentialsOf(found)) {
      if (!isInstanceProvisioningEnabled()) {
        return reply
          .status(400)
          .type('text/html')
          .send(renderShareLinkInvalidPage('Este SDR ainda nao tem instancia UAZAPI configurada.'));
      }

      return reply.type('text/html').send(
        renderSdrConnectPage(
          found,
          {
            qrCodeSvg: null,
            pairCode: null,
            connected: false,
            status: null,
            detail: 'Este SDR ainda nao tem instancia UAZAPI configurada.',
            httpStatus: null,
            rawBody: null,
          },
          null,
          true,
          null,
        ),
      );
    }

    const loaded = await loadAgentForUser(request, reply);
    if (!loaded) return undefined;

    // O token do link recem-criado volta pela query (padrao POST-redirect-GET), entao
    // atualizar a pagina nao reenvia o formulario nem cancela o link ja compartilhado.
    const query = connectQuerySchema.safeParse(request.query);
    const shareToken = query.success ? query.data.link : undefined;

    const state = await readConnectionStatus(uazapiClient, loaded.credentials);
    if (state.detail) request.log.warn({ sdrAgentId: loaded.agent.id, status: state.status, detail: state.detail }, 'instancia uazapi indisponivel');

    // So confere com o admintoken quando ha o que investigar e quando o SDR aponta para
    // o mesmo servidor do ambiente — admintoken de um servidor nao vale em outro.
    const audit =
      state.detail && env.UAZAPI_ADMIN_TOKEN && sameHost(env.UAZAPI_BASE_URL, loaded.agent.uazapiBaseUrl)
        ? await auditInstanceCredential(
            uazapiClient,
            { baseUrl: loaded.agent.uazapiBaseUrl ?? '', adminToken: env.UAZAPI_ADMIN_TOKEN },
            { instanceId: loaded.agent.uazapiInstanceId, token: loaded.credentials.token },
          ).catch(() => null)
        : null;

    return reply
      .type('text/html')
      .send(
        renderSdrConnectPage(loaded.agent, state, shareToken ? shareUrlFor(shareToken) : null, isInstanceProvisioningEnabled(), audit),
      );
  });

  // Fragmento HTML: so aqui o QR e realmente pedido a UAZAPI, quando alguem clica no botao.
  app.get('/sdr-agents/:id/conectar/qr', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const loaded = await loadAgentForUser(request, reply);
    if (!loaded) return undefined;

    const state = await requestConnectionQr(uazapiClient, loaded.credentials);
    if (state.detail) request.log.warn({ sdrAgentId: loaded.agent.id, status: state.status, detail: state.detail }, 'qr indisponivel');
    return reply.type('text/html').send(renderQrPanel(state));
  });

  app.post('/sdr-agents/:id/conectar/compartilhar', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const loaded = await loadAgentForUser(request, reply);
    if (!loaded) return undefined;

    const now = new Date();
    // Um link ativo por vez: gerar um novo invalida o anterior, para nao ficar link solto.
    await shareLinkRepository.revokeActiveForAgent(loaded.agent.id, now);
    const token = generateShareToken();
    await shareLinkRepository.create({
      sdrAgentId: loaded.agent.id,
      createdByUserId: user.id,
      expiresAt: shareLinkExpiresAt(now),
      tokenHash: hashShareToken(token),
    });

    return reply.redirect(`/sdr-agents/${loaded.agent.id}/conectar?link=${token}`, 303);
  });

  /**
   * Cria uma instancia nova na UAZAPI e grava as credenciais no SDR. So aceita quando a
   * instancia atual esta mesmo quebrada: trocar a credencial de um SDR que responde
   * derrubaria um WhatsApp que estava funcionando.
   */
  app.post('/sdr-agents/:id/conectar/instancia', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const agent = params.success ? await sdrAgentRepository.findById(params.data.id) : null;
    if (!agent) return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());

    if (!isInstanceProvisioningEnabled()) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderShareLinkInvalidPage('Defina UAZAPI_BASE_URL e UAZAPI_ADMIN_TOKEN no ambiente para criar instancias pelo portal.'));
    }

    const current = credentialsOf(agent);
    if (current) {
      const state = await readConnectionStatus(uazapiClient, current);
      if (!state.detail) {
        return reply
          .status(409)
          .type('text/html')
          .send(renderShareLinkInvalidPage('A instancia atual esta respondendo — criar outra so e permitido quando a atual falha.'));
      }
    }

    try {
      const instance = await provisionInstance(uazapiClient, agent.name);
      await sdrAgentRepository.setUazapiInstance(agent.id, {
        baseUrl: instance.baseUrl,
        instanceId: instance.instanceId,
        tokenEncrypted: encryptSecret(instance.token),
      });

      // Webhook falhando nao invalida a instancia nova: da para reconfigurar pela tela.
      const configured = await configureInstanceWebhook(uazapiClient, { baseUrl: instance.baseUrl, token: instance.token }, agent.id).catch(
        () => false,
      );
      if (!configured) request.log.warn({ sdrAgentId: agent.id }, 'Instancia criada mas webhook nao configurado');
    } catch (error) {
      request.log.error({ error, sdrAgentId: agent.id }, 'Falha ao criar instancia UAZAPI');
      const message = error instanceof Error ? error.message : 'Erro desconhecido ao criar a instancia.';
      return reply.status(502).type('text/html').send(renderShareLinkInvalidPage(`Instancia nao criada: ${message}`));
    }

    return reply.redirect(`/sdr-agents/${agent.id}/conectar`, 303);
  });

  /** Valida o token publico e devolve o link + SDR, ou null (ja tendo respondido 404). */
  async function loadShareLink(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ agentName: string; credentials: { baseUrl: string; token: string }; linkId: string; expiresAt: Date; connectedAt: Date | null } | null> {
    const params = tokenParamsSchema.safeParse(request.params);
    if (!params.success) {
      await reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Link invalido.'));
      return null;
    }

    const link = await shareLinkRepository.findByTokenHash(hashShareToken(params.data.token));
    if (!link || !isShareLinkUsable(link, new Date())) {
      await reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Este link expirou ou foi cancelado.'));
      return null;
    }

    const agent = await sdrAgentRepository.findById(link.sdrAgentId);
    const credentials = agent ? credentialsOf(agent) : null;
    if (!agent || !credentials) {
      await reply.status(404).type('text/html').send(renderShareLinkInvalidPage('Este link nao esta mais disponivel.'));
      return null;
    }

    return { agentName: agent.name, credentials, linkId: link.id, expiresAt: link.expiresAt, connectedAt: link.connectedAt };
  }

  // Rota publica: quem tem o link consegue parear o WhatsApp, entao ela nunca revela
  // nada alem do nome do SDR e do QR, e some assim que o link expira.
  app.get('/conectar/:token', async (request, reply) => {
    const link = await loadShareLink(request, reply);
    if (!link) return undefined;

    const now = new Date();
    const state = await readConnectionStatus(uazapiClient, link.credentials);
    if (state.connected && !link.connectedAt) await shareLinkRepository.markConnected(link.linkId, now);

    const token = (request.params as { token: string }).token;
    return reply
      .type('text/html')
      .send(renderPublicConnectPage(link.agentName, state, minutesUntil(link.expiresAt, now), `/conectar/${token}/qr`));
  });

  app.get('/conectar/:token/qr', async (request, reply) => {
    const link = await loadShareLink(request, reply);
    if (!link) return undefined;

    const state = await requestConnectionQr(uazapiClient, link.credentials);
    if (state.detail) request.log.warn({ shareLinkId: link.linkId, status: state.status, detail: state.detail }, 'qr indisponivel');
    if (state.connected && !link.connectedAt) await shareLinkRepository.markConnected(link.linkId, new Date());

    return reply.type('text/html').send(renderQrPanel(state));
  });
}
