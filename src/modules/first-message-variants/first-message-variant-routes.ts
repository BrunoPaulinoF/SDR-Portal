import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { renderSdrAgentNotFoundPage } from '../sdr-agents/sdr-agent-pages.js';
import { diffAgentConfig, type SdrConfigChangeRepository } from '../sdr-agents/config-history.js';
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

/** Campo unico: vazio significa abordagem de uma mensagem so, entao nao ha minimo. */
const secondMessageSchema = z.object({ secondMessage: z.string().trim().optional().default('') });

export function registerFirstMessageVariantRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  firstMessageVariantRepository: FirstMessageVariantRepository,
  configChanges: SdrConfigChangeRepository,
): void {
  /** Uma linha por variante mexida: o texto (ou "ativa"/"pausada") de antes e de depois. */
  const recordVariant = (sdrAgentId: string, label: string, before: string | null, after: string | null, email: string) =>
    configChanges.record([{ sdrAgentId, field: `variante:${label}`, before, after, changedBy: `portal:${email}` }]);
  const describeVariant = (variant: { body: string; isActive: boolean }) => `${variant.isActive ? '[ativa]' : '[pausada]'} ${variant.body}`;

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
    await recordVariant(params.data.id, parsed.data.label, null, describeVariant(parsed.data), user.email);
    return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
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

    const current = await firstMessageVariantRepository.findById(params.data.variantId);
    await firstMessageVariantRepository.update(params.data.variantId, {
      label: parsed.data.label,
      body: parsed.data.body,
      isActive: parsed.data.isActive,
    });
    if (current && describeVariant(current) !== describeVariant(parsed.data)) {
      await recordVariant(params.data.id, parsed.data.label, describeVariant(current), describeVariant(parsed.data), user.email);
    }
    return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
  });

  app.post('/sdr-agents/:id/first-messages/:variantId/toggle', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = variantParamsSchema.safeParse(request.params);
    if (params.success) {
      const variant = await firstMessageVariantRepository.findById(params.data.variantId);
      if (variant) {
        await firstMessageVariantRepository.setActive(variant.id, !variant.isActive);
        await recordVariant(params.data.id, variant.label, describeVariant(variant), describeVariant({ ...variant, isActive: !variant.isActive }), user.email);
      }
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });

  app.post('/sdr-agents/:id/first-messages/:variantId/delete', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = variantParamsSchema.safeParse(request.params);
    if (params.success) {
      const variant = await firstMessageVariantRepository.findById(params.data.variantId);
      await firstMessageVariantRepository.delete(params.data.variantId);
      if (variant) await recordVariant(params.data.id, variant.label, describeVariant(variant), null, user.email);
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });

  app.post('/sdr-agents/:id/second-message', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const parsed = secondMessageSchema.safeParse(request.body);
    if (params.success && parsed.success) {
      const text = parsed.data.secondMessage;
      const agent = await sdrAgentRepository.findById(params.data.id);
      await sdrAgentRepository.setSecondMessage(params.data.id, text.length > 0 ? text : null);
      if (agent) await configChanges.record(diffAgentConfig(agent, { secondMessage: text.length > 0 ? text : null }, `portal:${user.email}`));
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });

  app.post('/sdr-agents/:id/first-message-mode', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const params = agentParamsSchema.safeParse(request.params);
    const parsed = modeSchema.safeParse(request.body);
    if (params.success && parsed.success) {
      const agent = await sdrAgentRepository.findById(params.data.id);
      await sdrAgentRepository.setFirstMessageMode(params.data.id, parsed.data.mode);
      if (agent) await configChanges.record(diffAgentConfig(agent, { firstMessageMode: parsed.data.mode }, `portal:${user.email}`));
      return reply.redirect(`/sdr-agents/${params.data.id}/first-messages?salvo=1`);
    }
    return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
  });
}
