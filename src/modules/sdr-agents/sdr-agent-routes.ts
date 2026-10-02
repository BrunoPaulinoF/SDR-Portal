import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SdrAgent } from '../../db/schema.js';
import { allReasoningEffortValues, providerDefaultEffort } from '../ai/reasoning-effort.js';
import { DEFAULT_SDR_PLAYBOOK, SDR_PLAYBOOKS } from '../ai/sdr-playbooks.js';
import { AUDIO_REPLY_MODES, DEFAULT_AUDIO_REPLY_MODE, DEFAULT_ELEVENLABS_MODEL } from '../audio/audio-reply.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { requireUser } from '../auth/access.js';
import type { CompanyRepository } from '../companies/company-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { ChannelLimitsRepository } from '../monitoring/channel-limits.js';
import type { ConnectionMonitorRepository } from '../monitoring/connection-monitor-repository.js';
import { decryptSecret, encryptSecret } from '../security/secrets.js';
import { startOfDayInTimeZone } from '../timezone.js';
import { configureInstanceWebhook, deleteInstance, isInstanceProvisioningEnabled, provisionInstance } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import { diffAgentConfig, type SdrConfigChangeRepository } from './config-history.js';
import { findPromptDrift, type PromptDrift } from './prompt-bundle.js';
import type { SdrAgentInput, SdrAgentRepository } from './sdr-agent-repository.js';
import {
  isEditableSdrTab,
  mergeTabBody,
  renderNewSdrAgentPage,
  renderSdrAgentNotFoundPage,
  renderSdrAgentsListPage,
  renderSdrAgentTabPage,
  resolveSdrTab,
  type SdrListCard,
  type SdrSummary,
} from './sdr-agent-pages.js';
import { dailyInitialLimit } from './warmup.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const tabParamsSchema = z.object({
  id: z.string().uuid(),
  aba: z.string().refine(isEditableSdrTab),
});

const editQuerySchema = z.object({ aba: z.string().optional() });

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
  // Nao esta mais no formulario (a primeira mensagem vive na tela Msg inicial):
  // quando ausente, preserva o valor ja salvo em vez de apagar.
  firstMessagePrompt: z.string().trim().optional(),
  leadQualificationPrompt: z.string().trim().optional().default(''),
  followupPrompt: z.string().trim().optional().default(''),
  bumpPrompt: z.string().trim().optional().default(''),
  playbook: z.enum(SDR_PLAYBOOKS).default(DEFAULT_SDR_PLAYBOOK),
  aiProvider: z.enum(['deepseek', 'openai', 'openrouter']).default('deepseek'),
  aiModel: z.string().trim().min(1),
  aiTemperature: z.coerce.number().min(0).max(2),
  aiMaxOutputTokens: z.coerce.number().int().positive(),
  aiReasoningEffort: z.string().trim().refine((value) => allReasoningEffortValues().includes(value)).default(providerDefaultEffort),
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
  warmupActive: checkbox.default(false),
  dailyFollowupSendLimit: z.coerce.number().int().positive(),
  // Ausente em formulario antigo: 1 e o comportamento de sempre.
  followupMaxTouches: z.coerce.number().int().min(1).max(5).optional().default(1),
  responseDelayBaseMs: z.coerce.number().int().nonnegative(),
  responseDelayPerCharMs: z.coerce.number().int().nonnegative(),
  responseDelayMaxMs: z.coerce.number().int().nonnegative(),
  messageSplitMaxChars: z.coerce.number().int().positive(),
  handoffName: z.string().trim().optional().default(''),
  handoffPhone: z.string().trim().optional().default(''),
  handoffMessageTemplate: z.string().trim().optional().default(''),
  demoContactName: z.string().trim().optional().default(''),
  demoContactPhone: z.string().trim().optional().default(''),
  audioReplyMode: z.enum(AUDIO_REPLY_MODES).default(DEFAULT_AUDIO_REPLY_MODE),
  elevenlabsApiKeyEncrypted: z.string().trim().optional().default(''),
  elevenlabsVoiceId: z.string().trim().optional().default(''),
  elevenlabsModel: z.string().trim().optional().default(''),
}).refine((data) => data.responseDelayMaxMs >= data.responseDelayBaseMs, {
  // Teto abaixo do piso nao e detalhe: com base 15000 e maximo 12000 toda parte da resposta
  // esperava exatamente 12s e os campos base e por caractere paravam de fazer efeito, sem
  // nenhum aviso na tela (docs/analises/francielly-2026-08-28.md).
  message: 'O delay maximo por parte precisa ser maior ou igual ao delay base.',
  path: ['responseDelayMaxMs'],
});

function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function secretOrCurrent(value: string, currentValue?: string | null): string | null {
  return value.length > 0 ? encryptSecret(value) : (currentValue ?? null);
}

/** Erro mostrado quando o formulario nao passa: o especifico primeiro, o generico como piso. */
const GENERIC_FORM_ERROR = 'Confira os campos obrigatorios do SDR.';

function formErrorMessage(error: z.ZodError): string {
  const specific = error.issues.find((issue) => issue.code === 'custom')?.message;
  return specific ?? GENERIC_FORM_ERROR;
}

function parseSdrAgentInput(body: unknown, current?: SdrAgentInput): { input: SdrAgentInput } | { message: string } {
  const parsedBody = sdrAgentFormSchema.safeParse(body);

  if (!parsedBody.success) {
    return { message: formErrorMessage(parsedBody.error) };
  }

  const data = parsedBody.data;

  return {
    input: {
      companyId: data.companyId,
      name: data.name,
      displayName: data.displayName,
      isActive: data.isActive,
      productName: emptyToNull(data.productName),
      productDescription: emptyToNull(data.productDescription),
      offerDescription: emptyToNull(data.offerDescription),
      prompt: emptyToNull(data.prompt),
      firstMessagePrompt: data.firstMessagePrompt === undefined ? (current?.firstMessagePrompt ?? null) : emptyToNull(data.firstMessagePrompt),
      leadQualificationPrompt: emptyToNull(data.leadQualificationPrompt),
      followupPrompt: emptyToNull(data.followupPrompt),
      bumpPrompt: emptyToNull(data.bumpPrompt),
      // A segunda mensagem da abordagem tambem vive na tela Msg inicial: o formulario do SDR
      // nao a envia, entao salvar esta tela nao pode apaga-la.
      secondMessage: current?.secondMessage ?? null,
      playbook: data.playbook,
      aiProvider: data.aiProvider,
      aiModel: data.aiModel,
      aiTemperature: data.aiTemperature,
      aiMaxOutputTokens: data.aiMaxOutputTokens,
      aiReasoningEffort: data.aiReasoningEffort,
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
      // Marcado mantem a data de inicio que ja existe: salvar o formulario nao reinicia a rampa.
      warmupStartedAt: data.warmupActive ? (current?.warmupStartedAt ?? new Date()) : null,
      dailyFollowupSendLimit: data.dailyFollowupSendLimit,
      followupMaxTouches: data.followupMaxTouches,
      responseDelayBaseMs: data.responseDelayBaseMs,
      responseDelayPerCharMs: data.responseDelayPerCharMs,
      responseDelayMaxMs: data.responseDelayMaxMs,
      messageSplitMaxChars: data.messageSplitMaxChars,
      // coluna legada: a pausa da IA deixou de expirar por tempo, so o portal libera
      humanPauseHours: current?.humanPauseHours,
      handoffName: emptyToNull(data.handoffName),
      handoffPhone: emptyToNull(data.handoffPhone),
      handoffMessageTemplate: emptyToNull(data.handoffMessageTemplate),
      demoContactName: emptyToNull(data.demoContactName),
      demoContactPhone: emptyToNull(data.demoContactPhone),
      audioReplyMode: data.audioReplyMode,
      elevenlabsApiKeyEncrypted: secretOrCurrent(data.elevenlabsApiKeyEncrypted, current?.elevenlabsApiKeyEncrypted),
      elevenlabsVoiceId: emptyToNull(data.elevenlabsVoiceId),
      elevenlabsModel: data.elevenlabsModel || DEFAULT_ELEVENLABS_MODEL,
    },
  };
}

/** De onde vem o que a lista de SDRs e a aba Resumo mostram. */
export interface SdrScreenSources {
  leadRepository: LeadRepository;
  connectionMonitorRepository: ConnectionMonitorRepository;
  channelLimitsRepository: ChannelLimitsRepository;
  jobLogRepository: JobLogRepository;
}

const LAST_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

function connectionOf(state: { status: string; lastConnectedAt: Date | null; disconnectedAt: Date | null; disconnectReason: string | null } | null): SdrSummary['connection'] {
  if (!state) return null;
  const connected = state.status === 'connected';
  return { status: state.status, since: connected ? state.lastConnectedAt : state.disconnectedAt, reason: connected ? null : state.disconnectReason };
}

function activeBlock(limits: { blockedUntil: Date | null } | null, now: Date): Date | null {
  return limits?.blockedUntil && limits.blockedUntil.getTime() > now.getTime() ? limits.blockedUntil : null;
}

async function buildListCards(agents: SdrAgent[], sources: SdrScreenSources, now: Date): Promise<SdrListCard[]> {
  const [states, limits] = await Promise.all([sources.connectionMonitorRepository.listStates(), sources.channelLimitsRepository.list()]);
  const stateByAgent = new Map(states.map((state) => [state.sdrAgentId, state]));
  const limitsByAgent = new Map(limits.map((row) => [row.sdrAgentId, row]));
  return Promise.all(
    agents.map(async (agent) => {
      const [sentToday, pending] = await Promise.all([
        sources.leadRepository.countInitialSentForSdrSince(agent.id, startOfDayInTimeZone(now, agent.timezone)),
        sources.leadRepository.countPendingForSdr(agent.id),
      ]);
      return {
        agent,
        connection: connectionOf(stateByAgent.get(agent.id) ?? null),
        blockedUntil: activeBlock(limitsByAgent.get(agent.id) ?? null, now),
        sentToday,
        todayLimit: dailyInitialLimit(agent, now),
        pending,
      };
    }),
  );
}

async function buildSummary(agent: SdrAgent, sources: SdrScreenSources, now: Date): Promise<SdrSummary> {
  const today = startOfDayInTimeZone(now, agent.timezone);
  const [state, limits, sentToday, followupsToday, pending, logs] = await Promise.all([
    sources.connectionMonitorRepository.findState(agent.id),
    sources.channelLimitsRepository.find(agent.id),
    sources.leadRepository.countInitialSentForSdrSince(agent.id, today),
    sources.leadRepository.countFollowupSentForSdrSince(agent.id, today),
    sources.leadRepository.countPendingForSdr(agent.id),
    sources.jobLogRepository.listStats(new Date(now.getTime() - LAST_ERROR_WINDOW_MS)),
  ]);
  const lastFailed = logs
    .filter((log) => log.sdrAgentId === agent.id && log.status === 'failed')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    connection: connectionOf(state),
    limits,
    sentToday,
    todayLimit: dailyInitialLimit(agent, now),
    followupsToday,
    pending,
    lastError: lastFailed ? { at: lastFailed.createdAt, message: lastFailed.error ?? `${lastFailed.jobName} falhou` } : null,
  };
}

export function registerSdrAgentRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  companyRepository: CompanyRepository,
  sdrAgentRepository: SdrAgentRepository,
  uazapiClient: UazapiClient,
  configChanges: SdrConfigChangeRepository,
  sources: SdrScreenSources,
): void {
  app.get('/sdr-agents', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const [agents, companies] = await Promise.all([sdrAgentRepository.list(), companyRepository.list()]);
    const cards = await buildListCards(agents, sources, new Date());
    return reply.type('text/html').send(renderSdrAgentsListPage(cards, companies));
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
    const parsed = parseSdrAgentInput(request.body);
    const input = 'input' in parsed ? parsed.input : null;
    const companyExists = input ? await companyRepository.findById(input.companyId) : null;

    if (!input || !companyExists) {
      const message = 'message' in parsed ? parsed.message : GENERIC_FORM_ERROR;
      return reply.status(400).type('text/html').send(renderNewSdrAgentPage(companies, message));
    }

    // Sem instancia informada na mao e com servidor UAZAPI configurado, provisiona uma
    // ja apontando o webhook pra ca — o usuario so precisa ler o QR code depois.
    const shouldProvision = isInstanceProvisioningEnabled() && !input.uazapiBaseUrl && !input.uazapiInstanceTokenEncrypted;
    let provisioned = input;

    if (shouldProvision) {
      try {
        const instance = await provisionInstance(uazapiClient, input.name);
        provisioned = {
          ...input,
          isActive: true,
          uazapiBaseUrl: instance.baseUrl,
          uazapiInstanceId: instance.instanceId,
          uazapiInstanceTokenEncrypted: encryptSecret(instance.token),
        };
      } catch (error) {
        request.log.error({ error }, 'Failed to provision UAZAPI instance');
        const message = error instanceof Error ? error.message : 'Erro desconhecido ao criar a instancia.';
        return reply
          .status(502)
          .type('text/html')
          .send(renderNewSdrAgentPage(companies, `SDR nao criado: ${message} Cadastre a instancia manualmente ou tente de novo.`));
      }
    }

    const agent = await sdrAgentRepository.create(provisioned);

    if (shouldProvision && provisioned.uazapiBaseUrl && provisioned.uazapiInstanceTokenEncrypted) {
      // Webhook e o unico passo que pode falhar sem invalidar o SDR: ele ja existe e a
      // tela de conexao permite reconfigurar. So registramos e seguimos.
      const configured = await configureInstanceWebhook(
        uazapiClient,
        { baseUrl: provisioned.uazapiBaseUrl, token: decryptSecret(provisioned.uazapiInstanceTokenEncrypted) },
        agent.id,
      ).catch(() => false);
      if (!configured) request.log.warn({ sdrAgentId: agent.id }, 'Instance created but webhook was not configured');

      return reply.redirect(`/sdr-agents/${agent.id}/conectar`);
    }

    return reply.redirect(`/sdr-agents/${agent.id}/edit?criado=1`);
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

    const query = editQuerySchema.safeParse(request.query);
    const tab = resolveSdrTab(query.success ? query.data.aba : undefined);
    // A aba Abordagem e a tela da Msg inicial, que tem rotas proprias.
    if (tab === 'abordagem') return reply.redirect(`/sdr-agents/${agent.id}/first-messages`);

    // Comparar com os arquivos nao pode derrubar a tela: sem diretorio ou sem permissao, segue sem aviso.
    let drift: PromptDrift | null = null;
    if (tab === 'resumo' || tab === 'conversa') {
      try {
        drift = await findPromptDrift(agent);
      } catch (error) {
        request.log.warn({ sdrAgentId: agent.id, error }, 'Prompt drift check failed');
      }
    }

    const history = tab === 'historico' ? await configChanges.listForAgent(agent.id, 40) : [];
    const summary = tab === 'resumo' ? await buildSummary(agent, sources, new Date()) : undefined;
    return reply.type('text/html').send(renderSdrAgentTabPage({ agent, companies, tab, drift, history, summary }));
  });

  // Cada aba salva so os campos dela; o resto vai com o valor gravado (`mergeTabBody`).
  app.post('/sdr-agents/:id/aba/:aba', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = tabParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const [agent, companies] = await Promise.all([sdrAgentRepository.findById(params.data.id), companyRepository.list()]);

    if (!agent || !isEditableSdrTab(params.data.aba)) {
      return reply.status(404).type('text/html').send(renderSdrAgentNotFoundPage());
    }

    const tab = params.data.aba;
    const submitted = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const merged = mergeTabBody(agent, tab, submitted);
    const parsed = parseSdrAgentInput(merged, agent);
    const input = 'input' in parsed ? parsed.input : null;
    const companyExists = input ? await companyRepository.findById(input.companyId) : null;

    if (!input || !companyExists) {
      const message = 'message' in parsed ? parsed.message : GENERIC_FORM_ERROR;
      return reply.status(400).type('text/html').send(renderSdrAgentTabPage({ agent, companies, tab, error: message, submitted: merged }));
    }

    await configChanges.record(diffAgentConfig(agent, input, `portal:${user.email}`));
    await sdrAgentRepository.update(agent.id, input);
    // Fica na mesma aba: voltar para a lista obrigava a achar o SDR e abrir de novo a cada ajuste.
    return reply.redirect(`/sdr-agents/${agent.id}/edit?aba=${tab}&salvo=1`);
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
        await configChanges.record(diffAgentConfig(agent, { isActive: !agent.isActive }, `portal:${user.email}`));
        // O botao da aba Resumo volta para ela; o da lista, para a lista.
        if ((request.body as { voltar?: string } | undefined)?.voltar === 'resumo') {
          return reply.redirect(`/sdr-agents/${agent.id}/edit?salvo=1`);
        }
        return reply.redirect('/sdr-agents?salvo=1');
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

    if (!params.success) {
      return reply.redirect('/sdr-agents');
    }

    const agent = await sdrAgentRepository.findById(params.data.id);
    const credentials = agent?.uazapiBaseUrl && agent.uazapiInstanceTokenEncrypted
      ? { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) }
      : null;
    // Apagar o SDR primeiro perderia o token para sempre, e a instancia ficaria orfa sem
    // ninguem conseguindo remove-la. Por isso a instancia sai antes, e um erro aqui para
    // a exclusao — a menos que o usuario peca explicitamente para manter a instancia.
    const keepInstance = (request.body as { manterInstancia?: string } | undefined)?.manterInstancia === '1';

    if (credentials && !keepInstance) {
      const result = await deleteInstance(uazapiClient, credentials).catch(() => ({ removed: false, status: 0 }));

      if (!result.removed) {
        const agents = await sdrAgentRepository.list();
        const companies = await companyRepository.list();
        const cards = await buildListCards(agents, sources, new Date());
        const detail = result.status ? `HTTP ${result.status}` : 'sem resposta';
        return reply
          .status(502)
          .type('text/html')
          .send(
            renderSdrAgentsListPage(
              cards,
              companies,
              `Nao foi possivel apagar a instancia de ${agent?.name ?? 'este SDR'} na UAZAPI (${detail}). O SDR foi mantido para o token nao ser perdido. Tente de novo, ou use "Excluir sem apagar a instancia" se preferir remove-la depois no painel da UAZAPI.`,
              params.data.id,
            ),
          );
      }
    }

    await sdrAgentRepository.delete(params.data.id);
    return reply.redirect('/sdr-agents');
  });
}
