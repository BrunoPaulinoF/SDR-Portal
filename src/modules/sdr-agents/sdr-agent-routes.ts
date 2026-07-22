import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthRepository } from '../auth/auth-repository.js';
import { requireUser } from '../auth/access.js';
import type { CompanyRepository } from '../companies/company-repository.js';
import { encryptSecret } from '../security/secrets.js';
import type { SdrAgentInput, SdrAgentRepository } from './sdr-agent-repository.js';
import {
  renderEditSdrAgentPage,
  renderNewSdrAgentPage,
  renderSdrAgentNotFoundPage,
  renderSdrAgentsListPage,
} from './sdr-agent-pages.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const checkbox = z.preprocess((value) => value === 'on' || value === 'true', z.boolean());

const sdrAgentFormSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  isActive: checkbox.default(false),
  productName: z.string().trim().optional().default(''),
  productDescription: z.string().trim().optional().default(''),
  offerDescription: z.string().trim().optional().default(''),
  prompt: z.string().trim().optional().default(''),
  firstMessagePrompt: z.string().trim().optional().default(''),
  leadQualificationPrompt: z.string().trim().optional().default(''),
  followupPrompt: z.string().trim().optional().default(''),
  aiProvider: z.enum(['deepseek', 'openai', 'openrouter']).default('deepseek'),
  aiModel: z.string().trim().min(1),
  aiTemperature: z.coerce.number().min(0).max(2),
  aiMaxOutputTokens: z.coerce.number().int().positive(),
  openaiApiKeyEncrypted: z.string().trim().optional().default(''),
  openrouterApiKeyEncrypted: z.string().trim().optional().default(''),
  deepseekApiKeyEncrypted: z.string().trim().optional().default(''),
  uazapiBaseUrl: z.string().trim().optional().default(''),
  uazapiInstanceId: z.string().trim().optional().default(''),
  uazapiInstanceTokenEncrypted: z.string().trim().optional().default(''),
  uazapiAdminTokenEncrypted: z.string().trim().optional().default(''),
  whatsappNumber: z.string().trim().optional().default(''),
  timezone: z.string().trim().min(1),
  sendWindowStart: z.string().trim().min(1),
  sendWindowEnd: z.string().trim().min(1),
  sendDaysOfWeek: z.string().trim().min(1),
  initialCooldownMinMinutes: z.coerce.number().int().nonnegative(),
  initialCooldownMaxMinutes: z.coerce.number().int().nonnegative(),
  followupEnabled: checkbox.default(false),
  followupAfterHours: z.coerce.number().int().nonnegative(),
  followupCooldownMinMinutes: z.coerce.number().int().nonnegative(),
  followupCooldownMaxMinutes: z.coerce.number().int().nonnegative(),
  dailyInitialSendLimit: z.coerce.number().int().positive(),
  dailyFollowupSendLimit: z.coerce.number().int().positive(),
  responseDelayBaseMs: z.coerce.number().int().nonnegative(),
  responseDelayPerCharMs: z.coerce.number().int().nonnegative(),
  responseDelayMaxMs: z.coerce.number().int().nonnegative(),
  messageSplitMaxChars: z.coerce.number().int().positive(),
  humanPauseHours: z.coerce.number().int().positive(),
  handoffName: z.string().trim().optional().default(''),
  handoffPhone: z.string().trim().optional().default(''),
  handoffMessageTemplate: z.string().trim().optional().default(''),
});

function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function secretOrCurrent(value: string, currentValue?: string | null): string | null {
  return value.length > 0 ? encryptSecret(value) : (currentValue ?? null);
}

function parseSdrAgentInput(body: unknown, current?: SdrAgentInput): SdrAgentInput | null {
  const parsedBody = sdrAgentFormSchema.safeParse(body);

  if (!parsedBody.success) {
    return null;
  }

  const data = parsedBody.data;

  return {
    companyId: data.companyId,
    name: data.name,
    displayName: data.displayName,
    isActive: data.isActive,
    productName: emptyToNull(data.productName),
    productDescription: emptyToNull(data.productDescription),
    offerDescription: emptyToNull(data.offerDescription),
    prompt: emptyToNull(data.prompt),
    firstMessagePrompt: emptyToNull(data.firstMessagePrompt),
    leadQualificationPrompt: emptyToNull(data.leadQualificationPrompt),
    followupPrompt: emptyToNull(data.followupPrompt),
    aiProvider: data.aiProvider,
    aiModel: data.aiModel,
    aiTemperature: data.aiTemperature,
    aiMaxOutputTokens: data.aiMaxOutputTokens,
    openaiApiKeyEncrypted: secretOrCurrent(data.openaiApiKeyEncrypted, current?.openaiApiKeyEncrypted),
    openrouterApiKeyEncrypted: secretOrCurrent(data.openrouterApiKeyEncrypted, current?.openrouterApiKeyEncrypted),
    deepseekApiKeyEncrypted: secretOrCurrent(data.deepseekApiKeyEncrypted, current?.deepseekApiKeyEncrypted),
    uazapiBaseUrl: emptyToNull(data.uazapiBaseUrl),
    uazapiInstanceId: emptyToNull(data.uazapiInstanceId),
    uazapiInstanceTokenEncrypted: secretOrCurrent(data.uazapiInstanceTokenEncrypted, current?.uazapiInstanceTokenEncrypted),
    uazapiAdminTokenEncrypted: secretOrCurrent(data.uazapiAdminTokenEncrypted, current?.uazapiAdminTokenEncrypted),
    whatsappNumber: emptyToNull(data.whatsappNumber),
    timezone: data.timezone,
    sendWindowStart: data.sendWindowStart,
    sendWindowEnd: data.sendWindowEnd,
    sendDaysOfWeek: data.sendDaysOfWeek,
    initialCooldownMinMinutes: data.initialCooldownMinMinutes,
    initialCooldownMaxMinutes: data.initialCooldownMaxMinutes,
    followupEnabled: data.followupEnabled,
    followupAfterHours: data.followupAfterHours,
    followupCooldownMinMinutes: data.followupCooldownMinMinutes,
    followupCooldownMaxMinutes: data.followupCooldownMaxMinutes,
    dailyInitialSendLimit: data.dailyInitialSendLimit,
    dailyFollowupSendLimit: data.dailyFollowupSendLimit,
    responseDelayBaseMs: data.responseDelayBaseMs,
    responseDelayPerCharMs: data.responseDelayPerCharMs,
    responseDelayMaxMs: data.responseDelayMaxMs,
    messageSplitMaxChars: data.messageSplitMaxChars,
    humanPauseHours: data.humanPauseHours,
    handoffName: emptyToNull(data.handoffName),
    handoffPhone: emptyToNull(data.handoffPhone),
    handoffMessageTemplate: emptyToNull(data.handoffMessageTemplate),
  };
}

export function registerSdrAgentRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  companyRepository: CompanyRepository,
  sdrAgentRepository: SdrAgentRepository,
): void {
  app.get('/sdr-agents', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const [agents, companies] = await Promise.all([sdrAgentRepository.list(), companyRepository.list()]);
    return reply.type('text/html').send(renderSdrAgentsListPage(agents, companies));
  });

  app.get('/sdr-agents/new', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const companies = await companyRepository.list();
    return reply.type('text/html').send(renderNewSdrAgentPage(companies));
  });

  app.post('/sdr-agents', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const companies = await companyRepository.list();
    const input = parseSdrAgentInput(request.body);
    const companyExists = input ? await companyRepository.findById(input.companyId) : null;

    if (!input || !companyExists) {
      return reply.status(400).type('text/html').send(renderNewSdrAgentPage(companies, 'Confira os campos obrigatorios do SDR.'));
    }

    await sdrAgentRepository.create(input);
    return reply.redirect('/sdr-agents');
  });

  app.get('/sdr-agents/:id/edit', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const [agent, companies] = await Promise.all([sdrAgentRepository.findById(params.data.id), companyRepository.list()]);

    if (!agent) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    return reply.type('text/html').send(renderEditSdrAgentPage(agent, companies));
  });

  app.post('/sdr-agents/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const [agent, companies] = await Promise.all([sdrAgentRepository.findById(params.data.id), companyRepository.list()]);

    if (!agent) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const input = parseSdrAgentInput(request.body, agent);
    const companyExists = input ? await companyRepository.findById(input.companyId) : null;

    if (!input || !companyExists) {
      return reply.status(400).type('text/html').send(renderEditSdrAgentPage(agent, companies, 'Confira os campos obrigatorios do SDR.'));
    }

    await sdrAgentRepository.update(params.data.id, input);
    return reply.redirect('/sdr-agents');
  });

  app.post('/sdr-agents/:id/toggle', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = paramsSchema.safeParse(request.params);

    if (params.success) {
      const agent = await sdrAgentRepository.findById(params.data.id);

      if (agent) {
        await sdrAgentRepository.setActive(agent.id, !agent.isActive);
      }
    }

    return reply.redirect('/sdr-agents');
  });

  app.post('/sdr-agents/:id/delete', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = paramsSchema.safeParse(request.params);

    if (params.success) {
      await sdrAgentRepository.delete(params.data.id);
    }

    return reply.redirect('/sdr-agents');
  });
}
