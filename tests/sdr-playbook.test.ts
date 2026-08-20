import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { SdrAgent } from '../src/db/schema.js';
import type { AiChatMessage, AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { buildSdrSystemPrompt, lockedBasePromptPreview } from '../src/modules/ai/sdr-base-prompt.js';
import { resolveSdrPlaybook } from '../src/modules/ai/sdr-playbooks.js';
import { createMemoryAuthRepository, type AuthUser } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { resolveFirstMessage } from '../src/modules/scheduler/initial-outreach.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const okResult = (body: unknown = { response: 'ok' }): UazapiResult => ({ status: 200, ok: true, body });

/** Regra do playbook consultivo que o playbook convite precisa NAO herdar. */
const REGRA_ANTI_CURIOSIDADE = 'Nunca peca ao lead que aceite ouvir uma oferta sem antes dizer do que se trata';

function fakeUazapiClient(): UazapiClient & { texts: SendTextInput[] } {
  const texts: SendTextInput[] = [];
  return {
    texts,
    async checkChats() {
      return okResult();
    },
    async configureWebhook() {
      return okResult();
    },
    async downloadMessage() {
      return okResult();
    },
    async getInstanceStatus() {
      return okResult();
    },
    async sendContact() {
      return okResult();
    },
    async sendPresence() {
      return okResult();
    },
    async sendText(input) {
      texts.push(input);
      return okResult();
    },
  };
}

function recordingAiClient(outputText: string): AiClient & { prompts: AiChatMessage[][] } {
  const prompts: AiChatMessage[][] = [];
  return {
    prompts,
    async generate(input) {
      prompts.push(input.messages);
      return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
    },
  };
}

const aceiteComHandoff = JSON.stringify({
  mensagem_usuario: 'Boa! Ja pedi pro Fernando entrar em contato com voce aqui.',
  nao_responder: false,
  status_sugerido: 'transferred',
  stage_sugerido: 'handoff_offer',
  actions: [{ type: 'notify_handoff', summary: 'Dono da Cantina Sao Jorge topou conhecer o projeto.' }],
});

async function buildScenario(agentOverrides: Partial<SdrAgent> = {}, aiOutput = aceiteComHandoff) {
  const agentRepo = createMemorySdrAgentRepository();
  const baseAgent = await agentRepo.create({
    companyId: 'company-1',
    name: 'sdr-insumo-smart',
    displayName: 'Franciely',
    isActive: true,
    uazapiBaseUrl: 'https://fake.uazapi.com',
    uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
    openaiApiKeyEncrypted: encryptSecret('sk-fake'),
  });
  const agent: SdrAgent = {
    ...baseAgent,
    aiProvider: 'openai',
    playbook: 'convite',
    handoffName: 'Fernando',
    handoffPhone: '11988887777',
    handoffMessageTemplate: 'Lead topou conhecer o projeto.\nLead: {{companyName}}\nWhatsApp: {{whatsappNumber}}\nO que rolou: {{summary}}',
    responseDelayBaseMs: 0,
    responseDelayPerCharMs: 0,
    responseDelayMaxMs: 0,
    ...agentOverrides,
  };

  const leadRepo = createMemoryLeadRepository();
  const lead = await leadRepo.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5519999999999',
    companyName: 'Cantina Sao Jorge',
    status: 'in_conversation',
    source: 'manual',
  });

  const conversationRepo = createMemoryConversationRepository();
  const conversation = await conversationRepo.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    leadId: lead.id,
    whatsappNumber: lead.whatsappNumber,
    status: 'open',
    lastMessageAt: new Date(),
  });

  const uazapi = fakeUazapiClient();
  const aiClient = recordingAiClient(aiOutput);
  const service = createAiResponseService({
    aiClient,
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: conversationRepo,
    leadRepository: leadRepo,
    uazapiClient: uazapi,
  });

  return { agent, aiClient, conversation, lead, leadRepo, service, uazapi };
}

describe('playbook do SDR', () => {
  it('mantem o funil consultivo como padrao', () => {
    expect(resolveSdrPlaybook(null)).toBe('consultivo');
    expect(resolveSdrPlaybook('playbook-que-nao-existe')).toBe('consultivo');

    const prompt = buildSdrSystemPrompt({ sdrName: 'Mariana' });
    expect(prompt).toContain('playbook consultivo');
    expect(prompt).toContain(REGRA_ANTI_CURIOSIDADE);
  });

  it('troca o funil quando o SDR usa o playbook convite', () => {
    const prompt = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Franciely' });

    expect(prompt).toContain('playbook convite');
    expect(prompt).toContain('Como reconhecer o sim');
    // A regra do funil consultivo proibia exatamente a abordagem por curiosidade.
    expect(prompt).not.toContain(REGRA_ANTI_CURIOSIDADE);
  });

  it('proibe emoji e trava a pergunta do convite no funil do convite', () => {
    const prompt = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Franciely' });

    expect(prompt).toContain('NUNCA use emoji');
    expect(prompt).toContain('Responda SEMPRE o que o lead acabou de dizer');
    expect(prompt).toContain('termina em pergunta ou gancho');
    // A IA reescrevendo o convite com outras palavras foi o erro relatado pelo cliente.
    expect(prompt).toContain('A pergunta do convite e a que estiver escrita no prompt configurado deste SDR');
  });

  it('proibe emoji e manda seguir o roteiro na primeira mensagem do convite', async () => {
    const s = await buildScenario({ firstMessageMode: 'ai', firstMessagePrompt: 'Roteiro configurado do Fernando' });

    await resolveFirstMessage(
      {
        aiClient: s.aiClient,
        aiRunRepository: createMemoryAiRunRepository(),
        firstMessageVariantRepository: createMemoryFirstMessageVariantRepository(),
      },
      s.agent,
      s.lead,
      null,
    );

    const systemPrompt = s.aiClient.prompts[0]?.[0]?.content ?? '';
    expect(systemPrompt).toContain('sem emoji');
    expect(systemPrompt).toContain('siga a estrutura e as palavras dele');
  });

  it('leva o nome do humano do handoff para o contexto estavel', () => {
    const comNome = buildSdrSystemPrompt({ handoffName: ' Fernando ', playbook: 'convite', sdrName: 'Franciely' });
    expect(comNome).toContain('Pessoa do time para handoff: Fernando —');

    const semNome = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Franciely' });
    expect(semNome).toContain('nao configurada');
    expect(semNome).toContain('nunca invente um nome');
  });

  it('mantem a ordem estavel -> volatil do prompt para nao quebrar o cache', () => {
    const prompt = buildSdrSystemPrompt({
      customPrompt: 'PROMPT EDITAVEL DO SDR',
      leadName: 'Cantina Sao Jorge',
      playbook: 'convite',
      sdrName: 'Franciely',
    });

    const funil = prompt.indexOf('playbook convite');
    const editavel = prompt.indexOf('PROMPT EDITAVEL DO SDR');
    const volatil = prompt.indexOf('Cantina Sao Jorge');

    expect(funil).toBeGreaterThan(-1);
    expect(editavel).toBeGreaterThan(funil);
    expect(volatil).toBeGreaterThan(editavel);
  });

  it('mostra na tela o bloco fixo do playbook escolhido', () => {
    expect(lockedBasePromptPreview('convite')).toContain('playbook convite');
    expect(lockedBasePromptPreview('convite')).not.toContain(REGRA_ANTI_CURIOSIDADE);
    expect(lockedBasePromptPreview(undefined)).toContain('playbook consultivo');
  });

  it('envia o funil do convite e o nome do humano para a IA na resposta ao lead', async () => {
    const s = await buildScenario();
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    const systemPrompt = s.aiClient.prompts[0]?.[0]?.content ?? '';
    expect(systemPrompt).toContain('playbook convite');
    expect(systemPrompt).toContain('Pessoa do time para handoff: Fernando —');
    expect(systemPrompt).not.toContain(REGRA_ANTI_CURIOSIDADE);
  });

  it('avisa o humano e marca o lead como transferido quando o convite e aceito', async () => {
    const s = await buildScenario();
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    const paraOLead = s.uazapi.texts.find((text) => text.number === '5519999999999');
    expect(paraOLead?.text).toContain('Fernando');

    const paraOHumano = s.uazapi.texts.find((text) => text.number === '5511988887777');
    expect(paraOHumano?.text).toContain('Cantina Sao Jorge');
    expect(paraOHumano?.text).toContain('topou conhecer o projeto');

    const atualizado = await s.leadRepo.findById(s.lead.id);
    expect(atualizado?.status).toBe('transferred');
    expect(atualizado?.conversationStage).toBe('handoff_done');
  });
});

describe('playbook no formulario do SDR', () => {
  it('salva o playbook escolhido e mostra o funil correspondente na tela de edicao', async () => {
    const user: AuthUser = {
      id: '8bfcf9a6-38f9-4a0d-8f4d-7818adf99680',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('password123'),
      role: 'admin',
    };
    const companyRepository = createMemoryCompanyRepository();
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const company = await companyRepository.create({
      name: 'Insumo Smart',
      legalName: null,
      cnpj: null,
      segment: 'Gastronomia',
      city: null,
      state: null,
      defaultHandoffName: 'Fernando',
      defaultHandoffPhone: null,
    });

    const app = buildApp({
      authRepository: createMemoryAuthRepository([user]),
      companyRepository,
      sdrAgentRepository,
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/login',
      payload: 'email=admin%40example.com&password=password123',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const sessionCookie = loginResponse.cookies[0]?.value ?? '';

    const createResponse = await app.inject({
      method: 'POST',
      url: '/sdr-agents',
      payload: new URLSearchParams({
        companyId: company.id,
        name: 'sdr-insumo-smart',
        displayName: 'Franciely',
        playbook: 'convite',
        aiProvider: 'openai',
        aiModel: 'gpt-4o-mini',
        aiTemperature: '0.4',
        aiMaxOutputTokens: '1500',
        timezone: 'America/Sao_Paulo',
        sendWindowStart: '08:00',
        sendWindowEnd: '18:00',
        sendDaysOfWeek: '1,2,3,4,5',
        initialCooldownMinMinutes: '5',
        initialCooldownMaxMinutes: '15',
        followupEnabled: 'on',
        followupAfterHours: '24',
        followupCooldownMinMinutes: '10',
        followupCooldownMaxMinutes: '30',
        dailyInitialSendLimit: '50',
        dailyFollowupSendLimit: '50',
        responseDelayBaseMs: '1200',
        responseDelayPerCharMs: '35',
        responseDelayMaxMs: '12000',
        messageSplitMaxChars: '450',
        humanPauseHours: '24',
        handoffName: 'Fernando',
        handoffPhone: '5511999999999',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sdr_portal_session=${sessionCookie}` },
    });

    expect(createResponse.statusCode).toBe(302);

    const [created] = await sdrAgentRepository.list();
    expect(created?.playbook).toBe('convite');

    const editResponse = await app.inject({
      method: 'GET',
      url: `/sdr-agents/${created?.id}/edit`,
      headers: { cookie: `sdr_portal_session=${sessionCookie}` },
    });

    expect(editResponse.statusCode).toBe(200);
    expect(editResponse.body).toContain('<option value="convite" selected>');
    expect(editResponse.body).toContain('playbook convite');

    await app.close();
  });
});
