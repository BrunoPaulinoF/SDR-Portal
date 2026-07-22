import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { renderSdrAgentNotFoundPage } from '../sdr-agents/sdr-agent-pages.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { FirstMessageVariantRepository } from './first-message-variant-repository.js';
import { renderFirstMessageVariantsPage } from './first-message-variant-pages.js';

const agentParamsSchema = z.object({ id: z.string().uuid() });
const variantParamsSchema = z.object({ id: z.string().uuid(), variantId: z.string().uuid() });
const checkbox = z.preprocess((value) => value === 'on' || value === 'true', z.boolean());

const variantFormSchema = z.object({
  label: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1),
  isActive: checkbox.default(false),
});

const modeSchema = z.object({ mode: z.enum(['ai', 'ab_test']) });

export function registerFirstMessageVariantRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  firstMessageVariantRepository: FirstMessageVariantRepository,
): void {
  async function loadPage(agentId: string, error?: string): Promise<string | null> {
    const agent = await sdrAgentRepository.findById(agentId);
    if (!agent) return null;
    const metrics = await firstMessageVariantRepository.metricsForAgent(agentId);
    return renderFirstMessageVariantsPage(agent, metrics, error);
  }

  app.get('/sdr-agents/:id/first-messages', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const page = await loadPage(params.data.id);
    if (!page) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }
    return reply.type('text/html').send(page);
  });

  app.post('/sdr-agents/:id/first-messages', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const agent = await sdrAgentRepository.findById(params.data.id);
    if (!agent) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const parsed = variantFormSchema.safeParse(request.body);
    if (!parsed.success) {
      const page = await loadPage(params.data.id, 'Preencha rotulo e mensagem da variante.');
      return reply.status(400).type('text/html').send(page ?? renderSdrAgentNotFoundPage());
    }

    await firstMessageVariantRepository.create({
      sdrAgentId: params.data.id,
      label: parsed.data.label,
      body: parsed.data.body,
      isActive: parsed.data.isActive,
    });
    return reply.redirect(`/sdr-agents/${params.data.id}/first-messages`);
  });

  app.post('/sdr-agents/:id/first-messages/:variantId', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = variantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const parsed = variantFormSchema.safeParse(request.body);
    if (!parsed.success) {
      const page = await loadPage(params.data.id, 'Preencha rotulo e mensagem da variante.');
      return reply.status(400).type('text/html').send(page ?? renderSdrAgentNotFoundPage());
    }

    await firstMessageVariantRepository.update(params.data.variantId, {
      label: parsed.data.label,
      body: parsed.data.body,
      isActive: parsed.data.isActive,
    });
    return reply.redirect(`/sdr-agents/${params.data.id}/first-messages`);
  });

  app.post('/sdr-agents/:id/first-messages/:variantId/toggle', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = variantParamsSchema.safeParse(request.params);
    if (params.success) {
      const variant = await firstMessageVariantRepository.findById(params.data.variantId);
      if (variant) {
        await firstMessageVariantRepository.setActive(variant.id, !variant.isActive);
      }
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });

  app.post('/sdr-agents/:id/first-messages/:variantId/delete', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = variantParamsSchema.safeParse(request.params);
    if (params.success) {
      await firstMessageVariantRepository.delete(params.data.variantId);
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });

  app.post('/sdr-agents/:id/first-message-mode', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const parsed = modeSchema.safeParse(request.body);
    if (params.success && parsed.success) {
      await sdrAgentRepository.setFirstMessageMode(params.data.id, parsed.data.mode);
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });
}
