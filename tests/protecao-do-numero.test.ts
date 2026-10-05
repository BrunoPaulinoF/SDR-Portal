import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { buildDashboardViewModel } from '../src/modules/dashboard/dashboard-view-model.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import type { LeadResearchService } from '../src/modules/leads/lead-research-service.js';
import {
  createChannelLimitsGate,
  createMemoryChannelLimitsRepository,
  readMessageLimits,
  restrictionFromSendRefusal,
} from '../src/modules/monitoring/channel-limits.js';
import { buildDailyReport } from '../src/modules/monitoring/daily-report-message.js';
import { createInitialOutreachService } from '../src/modules/scheduler/initial-outreach.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { dailyInitialLimit, describeWarmup } from '../src/modules/sdr-agents/warmup.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

// Quinta-feira 11:00 em America/Sao_Paulo.
const NOW = new Date('2026-10-01T14:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Exemplo "restricted" da documentacao da UAZAPI para GET /instance/wa_messages_limits.
const RESTRICTED = {
  provider: 'whatsapp',
  reachable: true,
  can_send_new_messages: false,
  error_key: 'WHATSAPP_REACHOUT_TIMELOCK',
  provider_message_ptbr: 'O WhatsApp informou que a conta atualmente conectada está sob uma restrição temporária.',
  new_chat_message_capping: { available: true, status: 'ACTIVE', used_quota: 4, total_quota: 10 },
  reachout_timelock: { available: true, active: true, until: '2026-10-02T09:00:00.000Z', enforcement_type: 'BIZ_QUALITY' },
};

const FREE = {
  provider: 'whatsapp',
  reachable: true,
  can_send_new_messages: true,
  new_chat_message_capping: { available: true, status: 'ACTIVE', used_quota: 3, total_quota: 10 },
  reachout_timelock: { available: true, active: false },
};

function ok(body: unknown = {}): UazapiResult {
  return { status: 200, ok: true, body };
}

interface FakeOptions {
  limits?: UazapiResult | (() => Promise<UazapiResult>);
  sendResult?: UazapiResult;
}

function fakeUazapi(options: FakeOptions = {}) {
  const sent: SendTextInput[] = [];
  const calls = { limits: 0 };
  const client = {
    sent,
    calls,
    async checkChats() {
      return ok([{ isInWhatsapp: true, jid: '5519999999999@s.whatsapp.net' }]);
    },
    async getInstanceStatus() {
      return ok({ instance: { status: 'connected' } });
    },
    async getMessageLimits() {
      calls.limits += 1;
      const limits = options.limits ?? ok(FREE);
      return typeof limits === 'function' ? limits() : limits;
    },
    async sendPresence() {
      return ok();
    },
    async sendText(input: SendTextInput) {
      if (options.sendResult && !options.sendResult.ok) return options.sendResult;
      sent.push(input);
      return ok({ messageid: 'msg-1' });
    },
  };
  return client as unknown as UazapiClient & { sent: SendTextInput[]; calls: { limits: number } };
}

function fakeAi(): AiClient {
  return {
    async generate() {
      return {
        outputText: JSON.stringify({ qualified: true, reason: 'ok', mensagem_usuario: 'Oi!' }),
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        promptCacheHitTokens: null,
      };
    },
  };
}

async function buildOutreach(options: FakeOptions & { agent?: Partial<SdrAgent>; sentToday?: number; gate?: boolean } = {}) {
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const created = await sdrAgentRepository.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    prompt: 'Aborde a empresa.',
    deepseekApiKeyEncrypted: encryptSecret('sk-test'),
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
    timezone: 'America/Sao_Paulo',
    sendWindowStart: '00:00',
    sendWindowEnd: '23:59',
    sendDaysOfWeek: '0,1,2,3,4,5,6',
    initialCooldownMinMinutes: 0,
    initialCooldownMaxMinutes: 0,
    dailyInitialSendLimit: 40,
  });
  const agent = { ...created, ...options.agent };
  const leads = createMemoryLeadRepository();
  for (let index = 0; index < (options.sentToday ?? 0); index += 1) {
    const sent = await leads.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: `55199900000${String(index).padStart(2, '0')}`,
      companyName: `Ja abordado ${index}`,
      status: 'pending',
      source: 'manual',
    });
    await leads.markInitialSent(sent.id, new Date(NOW.getTime() - (index + 1) * MINUTE), null);
  }
  const lead = await leads.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5512996808655',
    companyName: 'Marmitaria Delivery',
    status: 'pending',
    source: 'manual',
  });
  const uazapi = fakeUazapi(options);
  const jobLogs = createMemoryJobLogRepository();
  const channelRows = createMemoryChannelLimitsRepository();
  const research: LeadResearchService = {
    async researchLead() {
      return null;
    },
  };
  const service = createInitialOutreachService({
    aiClient: fakeAi(),
    aiRunRepository: createMemoryAiRunRepository(),
    channelLimits: options.gate === false ? undefined : createChannelLimitsGate({ jobLogRepository: jobLogs, repository: channelRows, uazapiClient: uazapi }),
    conversationRepository: createMemoryConversationRepository(),
    firstMessageVariantRepository: createMemoryFirstMessageVariantRepository(),
    jobLogRepository: jobLogs,
    leadResearchService: research,
    leadRepository: leads,
    sdrAgentRepository: createMemorySdrAgentRepository([agent]),
    uazapiClient: uazapi,
  });
  return { agent, channelRows, jobLogs, lead, leads, service, uazapi };
}

describe('limites do WhatsApp: leitura', () => {
  it('timelock ativo segura o disparo ate o until que o WhatsApp deu', () => {
    const reading = readMessageLimits(RESTRICTED, NOW);

    expect(reading.canStartConversations).toBe(false);
    expect(reading.blockedUntil?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect(reading.blockReason).toContain('BIZ_QUALITY');
    expect(reading.quotaUsed).toBe(4);
    expect(reading.quotaTotal).toBe(10);
  });

  it('cota esgotada segura ate o fim do ciclo', () => {
    const reading = readMessageLimits(
      {
        can_send_new_messages: false,
        new_chat_message_capping: { available: true, status: 'CAPPED', used_quota: 10, total_quota: 10, cycle_end: '2026-10-03T00:00:00.000Z' },
        reachout_timelock: { available: true, active: false },
      },
      NOW,
    );

    expect(reading.blockedUntil?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(reading.blockReason).toContain('cota de conversas novas esgotada (10/10)');
  });

  it('conta liberada guarda a cota e nao bloqueia', () => {
    const reading = readMessageLimits(FREE, NOW);

    expect(reading.canStartConversations).toBe(true);
    expect(reading.blockedUntil).toBeNull();
    expect(reading.quotaUsed).toBe(3);
  });

  it('"nao pode" sem data vale ate a proxima consulta', () => {
    const reading = readMessageLimits({ can_send_new_messages: false }, NOW);

    expect(reading.blockedUntil?.getTime()).toBe(NOW.getTime() + 15 * MINUTE);
  });

  it('so o 463 do WhatsApp conta como bloqueio de conta no envio recusado', () => {
    const refused = restrictionFromSendRefusal(
      {
        error_source: 'whatsapp_server',
        provider_code: 463,
        error_key: 'WHATSAPP_REACHOUT_TIMELOCK',
        details: { reachout_timelock: { active: true, until: '2026-10-02T09:00:00.000Z' } },
      },
      NOW,
    );

    expect(refused?.blockedUntil?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect(restrictionFromSendRefusal({ error: 'internal' }, NOW)).toBeNull();
  });
});

describe('limites do WhatsApp: a trava do disparo', () => {
  it('nao envia com o numero bloqueado e guarda o bloqueio no banco', async () => {
    const { channelRows, jobLogs, lead, leads, service, uazapi, agent } = await buildOutreach({ limits: ok(RESTRICTED) });

    const result = await service.runOnce(NOW);

    expect(result.sent).toBe(0);
    expect(uazapi.sent).toEqual([]);
    expect(result.details.join(' ')).toContain('BIZ_QUALITY');
    expect((await leads.findById(lead.id))?.status).toBe('pending');
    expect((await channelRows.find(agent.id))?.blockedUntil?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect((await jobLogs.list()).filter((log) => log.jobName === 'channel-limits')).toHaveLength(1);
  });

  it('bloqueio guardado nao consulta de novo nem gera outra linha de log', async () => {
    const { jobLogs, service, uazapi } = await buildOutreach({ limits: ok(RESTRICTED) });

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 30 * MINUTE));

    expect(uazapi.calls.limits).toBe(1);
    expect((await jobLogs.list()).filter((log) => log.jobName === 'channel-limits')).toHaveLength(1);
  });

  it('com a conta liberada envia e so volta a consultar depois de 15 minutos', async () => {
    const { service, uazapi } = await buildOutreach();

    await service.runOnce(NOW);
    expect(uazapi.sent).toHaveLength(1);

    await service.runOnce(new Date(NOW.getTime() + 5 * MINUTE));
    expect(uazapi.calls.limits).toBe(1);
  });

  it('consulta que falha nao para o disparo', async () => {
    const { service, uazapi } = await buildOutreach({
      limits: async () => {
        throw new Error('timeout');
      },
    });

    const result = await service.runOnce(NOW);

    expect(result.sent).toBe(1);
    expect(uazapi.sent).toHaveLength(1);
  });

  it('envio recusado com timelock grava o bloqueio, e o proximo tick nem tenta', async () => {
    const { agent, channelRows, service, uazapi } = await buildOutreach({
      sendResult: {
        status: 500,
        ok: false,
        body: {
          provider_code: 463,
          error_key: 'WHATSAPP_REACHOUT_TIMELOCK',
          details: { reachout_timelock: { active: true, until: '2026-10-02T09:00:00.000Z' } },
        },
      },
    });

    await service.runOnce(NOW);
    const stored = await channelRows.find(agent.id);
    expect(stored?.source).toBe('envio');
    expect(stored?.blockedUntil?.toISOString()).toBe('2026-10-02T09:00:00.000Z');

    // Outro processo (restart): o recuo em memoria nao existe, o banco segura.
    const later = await service.runOnce(new Date(NOW.getTime() + 20 * MINUTE));
    expect(later.details.join(' ')).toContain('o disparo volta em 2026-10-02T09:00:00.000Z');
    expect(uazapi.calls.limits).toBe(1);
  });
});

describe('aquecimento de numero novo', () => {
  it('sobe o limite em degraus e nunca passa do cadastrado', () => {
    const startedAt = new Date('2026-10-01T12:00:00.000Z');
    const agent = { dailyInitialSendLimit: 40, warmupStartedAt: startedAt };
    const at = (days: number) => new Date(startedAt.getTime() + days * DAY + MINUTE);

    expect(dailyInitialLimit(agent, at(0))).toEqual({ limit: 10, warmupDay: 1 });
    expect(dailyInitialLimit(agent, at(4)).limit).toBe(20);
    expect(dailyInitialLimit(agent, at(10)).limit).toBe(30);
    expect(dailyInitialLimit(agent, at(14))).toEqual({ limit: 40, warmupDay: null });
    expect(dailyInitialLimit({ dailyInitialSendLimit: 8, warmupStartedAt: startedAt }, at(0)).limit).toBe(8);
    expect(dailyInitialLimit({ dailyInitialSendLimit: 40, warmupStartedAt: null }, at(0))).toEqual({ limit: 40, warmupDay: null });
    expect(describeWarmup(agent, at(4))).toBe('dia 5 de 14, ate 20 por dia');
  });

  it('o disparo para no limite do dia do aquecimento', async () => {
    const { service, uazapi } = await buildOutreach({
      agent: { warmupStartedAt: new Date(NOW.getTime() - 2 * 60 * MINUTE) },
      sentToday: 10,
      gate: false,
    });

    const result = await service.runOnce(NOW);

    expect(uazapi.sent).toEqual([]);
    expect(result.details.join(' ')).toContain('limite do aquecimento atingido (dia 1, 10 por dia)');
  });
});

describe('limites e aquecimento na tela e no relatorio', () => {
  it('painel mostra o SDR bloqueado pelo WhatsApp, com alerta', async () => {
    const { agent } = await buildOutreach({ gate: false });
    const model = buildDashboardViewModel({
      aiRuns: [],
      channelLimits: [
        {
          sdrAgentId: agent.id,
          canStartConversations: false,
          blockedUntil: new Date('2026-10-02T09:00:00.000Z'),
          blockReason: 'WhatsApp bloqueou novas conversas (BIZ_QUALITY)',
          quotaUsed: 4,
          quotaTotal: 10,
          quotaResetsAt: null,
          source: 'consulta',
          checkedAt: NOW,
        },
      ],
      companies: [{ id: 'company-1', name: 'KyberFood', segment: null, createdAt: NOW, updatedAt: NOW } as never],
      conversations: [],
      filters: { companyId: '', leadStatus: '', period: '7d', sdrAgentId: '' } as never,
      jobLogs: [],
      leads: [],
      messages: [],
      now: NOW,
      sdrAgents: [agent],
      userLabel: 'teste',
    });

    const action = model.actions.find((item) => item.title.startsWith('WhatsApp proibindo conversa nova: Mariana ate 02/10'));
    expect(action?.href).toBe(`/sdr-agents/${agent.id}/edit?aba=envio`);
    expect(model.channelRows[0]?.newChatsLabel).toContain('Bloqueado ate 02/10');
  });

  it('relatorio diz ate quando o WhatsApp segura e o dia do aquecimento', () => {
    const text = buildDailyReport({
      template: null,
      now: NOW,
      timeZone: 'America/Sao_Paulo',
      portalUrl: null,
      sdrs: [
        {
          name: 'Mariana',
          prospected: 0,
          responded: 1,
          handoffs: 0,
          meetings: 0,
          won: 0,
          blockedUntil: new Date('2026-10-02T09:00:00.000Z'),
          blockReason: 'WhatsApp bloqueou novas conversas (BIZ_QUALITY)',
          warmup: 'dia 5 de 14, ate 20 por dia',
        },
      ],
    });

    expect(text).toContain('⛔ WhatsApp nao deixa iniciar conversas novas ate 02/10');
    expect(text).toContain('🌱 Numero em aquecimento: dia 5 de 14, ate 20 por dia.');
  });
});

describe('aquecimento no formulario do SDR', () => {
  it('marcar grava o inicio, salvar de novo nao reinicia, desmarcar desliga', async () => {
    const { buildApp } = await import('../src/app.js');
    const { createMemoryAuthRepository } = await import('../src/modules/auth/auth-repository.js');
    const { hashPassword } = await import('../src/modules/auth/password.js');
    const { createMemoryCompanyRepository } = await import('../src/modules/companies/company-repository.js');
    const { createMemorySdrConfigChangeRepository } = await import('../src/modules/sdr-agents/config-history.js');
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({
      name: 'KyberFood',
      legalName: null,
      cnpj: null,
      segment: null,
      description: null,
      websiteUrl: null,
      defaultHandoffName: null,
      defaultHandoffPhone: null,
    });
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Mariana', displayName: 'Mariana', isActive: true });
    const configChangeRepository = createMemorySdrConfigChangeRepository();
    const app = buildApp({ authRepository, companyRepository, configChangeRepository, sdrAgentRepository });
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
    const form = (extra: Record<string, string>) =>
      new URLSearchParams({
        companyId: company.id,
        name: 'Mariana',
        displayName: 'Mariana',
        aiProvider: 'deepseek',
        aiModel: 'deepseek-v4-flash',
        aiTemperature: '0.5',
        aiMaxOutputTokens: '900',
        timezone: 'America/Sao_Paulo',
        sendWindowStart: '09:00',
        sendWindowEnd: '17:00',
        sendDaysOfWeek: '1,2,3,4,5',
        initialCooldownMinMinutes: '6',
        initialCooldownMaxMinutes: '16',
        followupAfterHours: '36',
        followupCooldownMinMinutes: '11',
        followupCooldownMaxMinutes: '31',
        dailyInitialSendLimit: '40',
        dailyFollowupSendLimit: '20',
        responseDelayBaseMs: '1300',
        responseDelayPerCharMs: '40',
        responseDelayMaxMs: '13000',
        messageSplitMaxChars: '400',
        ...extra,
      }).toString();
    const save = (extra: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: `/sdr-agents/${agent.id}/aba/envio`,
        payload: form(extra),
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      });

    expect((await save({ warmupActive: 'on' })).statusCode).toBe(302);
    const startedAt = (await sdrAgentRepository.findById(agent.id))?.warmupStartedAt;
    expect(startedAt).toBeInstanceOf(Date);

    await save({ warmupActive: 'on' });
    expect((await sdrAgentRepository.findById(agent.id))?.warmupStartedAt?.getTime()).toBe(startedAt?.getTime());

    await save({});
    expect((await sdrAgentRepository.findById(agent.id))?.warmupStartedAt).toBeNull();

    const history = await configChangeRepository.listForAgent(agent.id, 20);
    // Liga e desliga entram no historico (a ordem dentro do mesmo milissegundo nao importa aqui).
    const warmupChanges = history.filter((change) => change.field === 'warmupStartedAt');
    expect(warmupChanges.map((change) => change.after === null).sort()).toEqual([false, true]);
  });
});
