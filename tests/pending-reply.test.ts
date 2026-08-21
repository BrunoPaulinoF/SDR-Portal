import { describe, expect, it } from 'vitest';

import type { Conversation, Lead, Message, SdrAgent } from '../src/db/schema.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { AI_PAUSE_REASONS } from '../src/modules/leads/ai-pause.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createPendingReplyService } from '../src/modules/scheduler/pending-reply.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

const MINUTE = 60 * 1000;

interface ScenarioOptions {
  agentOverrides?: Partial<SdrAgent>;
  lastMessage?: Partial<Message>;
  minutesAgo?: number;
}

/** Conversa cuja ultima mensagem e do lead — o estado que a rede de seguranca procura. */
async function buildScenario(options: ScenarioOptions = {}) {
  const minutesAgo = options.minutesAgo ?? 5;
  const messageAt = new Date(Date.now() - minutesAgo * MINUTE);

  const sdrAgentRepository = createMemorySdrAgentRepository();
  const baseAgent = await sdrAgentRepository.create({
    companyId: 'company-1',
    name: 'sdr-insumo-smart',
    displayName: 'Francielly',
    isActive: true,
  });
  const agent = { ...baseAgent, ...options.agentOverrides };
  await sdrAgentRepository.setActive(agent.id, agent.isActive);

  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5517997243506',
    companyName: 'Pazzi Per Gelato',
    status: 'in_conversation',
    source: 'manual',
  });

  const conversation: Conversation = {
    id: 'conversation-1',
    companyId: 'company-1',
    sdrAgentId: agent.id,
    leadId: lead.id,
    whatsappNumber: lead.whatsappNumber,
    status: 'open',
    lastMessageAt: messageAt,
    createdAt: new Date(Date.now() - 60 * MINUTE),
    updatedAt: messageAt,
  };
  const lastMessage: Message = {
    id: 'message-1',
    conversationId: conversation.id,
    leadId: lead.id,
    sdrAgentId: agent.id,
    direction: 'inbound',
    senderType: 'lead',
    whatsappMessageId: 'wamid-1',
    messageType: 'conversation',
    text: 'Pode ser',
    transcription: null,
    mediaUrl: null,
    rawPayload: null,
    sentByApi: false,
    fromMe: false,
    createdAt: messageAt,
    ...options.lastMessage,
  };

  const conversationRepository = createMemoryConversationRepository([conversation], [lastMessage]);
  const aiRunRepository = createMemoryAiRunRepository();
  const answered: { agent: SdrAgent; conversation: Conversation; lead: Lead }[] = [];

  const service = createPendingReplyService({
    aiResponseService: {
      async respondToInbound(input) {
        answered.push(input);
      },
    },
    aiRunRepository,
    conversationRepository,
    jobLogRepository: createMemoryJobLogRepository(),
    leadRepository,
    sdrAgentRepository: {
      ...sdrAgentRepository,
      async findById(id) {
        return id === agent.id ? agent : null;
      },
    },
  });

  return { agent, aiRunRepository, answered, conversation, lastMessage, lead, leadRepository, service };
}

async function logReplyRun(aiRunRepository: ReturnType<typeof createMemoryAiRunRepository>, conversationId: string) {
  await aiRunRepository.create({
    sdrAgentId: null,
    leadId: null,
    conversationId,
    provider: 'openai',
    model: 'gpt-test',
    purpose: 'reply_generation',
    inputMessages: null,
    outputText: null,
    parsedJson: null,
    error: 'boom',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    promptCacheHitTokens: null,
    latencyMs: 10,
  });
}

describe('resposta pendente: lead que respondeu e ficou sem resposta', () => {
  it('manda a conversa de volta para a IA quando a ultima palavra e do lead', async () => {
    const s = await buildScenario();

    const result = await s.service.runOnce();

    expect(result.retried).toBe(1);
    expect(result.errors).toBe(0);
    expect(s.answered).toHaveLength(1);
    expect(s.answered[0]?.lead.id).toBe(s.lead.id);
    expect(s.answered[0]?.conversation.id).toBe(s.conversation.id);
  });

  it('nao mexe na conversa em que a SDR ja respondeu por ultimo', async () => {
    const s = await buildScenario({ lastMessage: { direction: 'outbound', senderType: 'ai', fromMe: true, text: 'bora?' } });

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(s.answered).toHaveLength(0);
  });

  it('espera o silencio passar do limite antes de tentar de novo', async () => {
    const s = await buildScenario({ minutesAgo: 1 });

    const result = await s.service.runOnce();

    // Um minuto ainda cabe no buffer de rajada: responder agora seria atropelar a resposta normal.
    expect(result.retried).toBe(0);
    expect(s.answered).toHaveLength(0);
  });

  it('nao ressuscita conversa velha demais', async () => {
    const s = await buildScenario({ minutesAgo: 60 * 30 });

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(s.answered).toHaveLength(0);
  });

  it('desiste depois de duas geracoes de resposta para a mesma mensagem', async () => {
    const s = await buildScenario();
    await logReplyRun(s.aiRunRepository, s.conversation.id);
    await logReplyRun(s.aiRunRepository, s.conversation.id);

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.details.join(' ')).toContain('ja tentou 2x');
  });

  it('tenta de novo quando existe apenas a geracao que falhou', async () => {
    const s = await buildScenario();
    await logReplyRun(s.aiRunRepository, s.conversation.id);

    const result = await s.service.runOnce();

    expect(result.retried).toBe(1);
    expect(s.answered).toHaveLength(1);
  });

  it('respeita a IA pausada no lead', async () => {
    const s = await buildScenario();
    // A pausa nao expira sozinha desde o botao "Liberar IA": quem decide e isAiPaused.
    await s.leadRepository.pauseAi(s.lead.id, new Date(), AI_PAUSE_REASONS.manualWhatsapp);

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(result.details.join(' ')).toContain('IA pausada');
  });

  it('nao responde SDR desligado', async () => {
    const s = await buildScenario({ agentOverrides: { isActive: false } });

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(result.details.join(' ')).toContain('SDR inativo');
  });

  it('ignora midia sem texto, igual ao webhook', async () => {
    const s = await buildScenario({ lastMessage: { text: null, transcription: null, messageType: 'image' } });

    const result = await s.service.runOnce();

    expect(result.retried).toBe(0);
    expect(result.details.join(' ')).toContain('midia sem texto');
  });

  it('conta erro quando a nova tentativa tambem falha', async () => {
    const s = await buildScenario();
    const service = createPendingReplyService({
      aiResponseService: {
        async respondToInbound() {
          throw new Error('UAZAPI returned HTTP 500');
        },
      },
      aiRunRepository: s.aiRunRepository,
      conversationRepository: createMemoryConversationRepository([s.conversation], [s.lastMessage]),
      jobLogRepository: createMemoryJobLogRepository(),
      leadRepository: s.leadRepository,
      sdrAgentRepository: {
        ...createMemorySdrAgentRepository(),
        async findById() {
          return s.agent;
        },
      },
    });

    const result = await service.runOnce();

    expect(result.errors).toBe(1);
    expect(result.details.join(' ')).toContain('UAZAPI returned HTTP 500');
  });
});

describe('resposta vazia da IA', () => {
  const vazia = JSON.stringify({ mensagem_usuario: '', nao_responder: false, actions: [] });
  const resposta = JSON.stringify({
    mensagem_usuario: 'Boa! Entao me conta: bora trocar uma ideia?',
    nao_responder: false,
    stage_sugerido: 'discovery',
    actions: [],
  });

  it('gera de novo em vez de deixar o lead falando sozinho', async () => {
    const { createAiResponseService } = await import('../src/modules/ai/ai-response-service.js');
    const { encryptSecret } = await import('../src/modules/security/secrets.js');

    const sdrAgentRepository = createMemorySdrAgentRepository();
    const baseAgent = await sdrAgentRepository.create({
      companyId: 'company-1',
      name: 'sdr-insumo-smart',
      displayName: 'Francielly',
      isActive: true,
      uazapiBaseUrl: 'https://fake.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
      openaiApiKeyEncrypted: encryptSecret('sk-fake'),
    });
    const agent: SdrAgent = {
      ...baseAgent,
      aiProvider: 'openai',
      responseDelayBaseMs: 0,
      responseDelayPerCharMs: 0,
      responseDelayMaxMs: 0,
    };

    const leadRepository = createMemoryLeadRepository();
    const lead = await leadRepository.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: '5517997243506',
      companyName: 'Pazzi Per Gelato',
      status: 'in_conversation',
      source: 'manual',
    });

    const conversationRepository = createMemoryConversationRepository();
    const conversation = await conversationRepository.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      leadId: lead.id,
      whatsappNumber: lead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });
    await conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: lead.id,
      sdrAgentId: agent.id,
      direction: 'inbound',
      senderType: 'lead',
      messageType: 'conversation',
      text: 'Pode ser',
    });

    const outputs = [vazia, resposta];
    const sent: string[] = [];
    const service = createAiResponseService({
      aiClient: {
        async generate() {
          const outputText = outputs.shift() ?? resposta;
          return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
        },
      },
      aiRunRepository: createMemoryAiRunRepository(),
      conversationRepository,
      leadRepository,
      uazapiClient: {
        async checkChats() {
          return { status: 200, ok: true, body: {} };
        },
        async configureWebhook() {
          return { status: 200, ok: true, body: {} };
        },
        async downloadMessage() {
          return { status: 200, ok: true, body: {} };
        },
        async getInstanceStatus() {
          return { status: 200, ok: true, body: {} };
        },
        async sendContact() {
          return { status: 200, ok: true, body: {} };
        },
        async sendPresence() {
          return { status: 200, ok: true, body: {} };
        },
        async sendText(input) {
          sent.push(input.text);
          return { status: 200, ok: true, body: {} };
        },
      },
    });

    await service.respondToInbound({ agent, conversation, lead });

    expect(sent.join(' ')).toContain('bora trocar uma ideia');
  });

  it('o prompt base so autoriza silencio onde ele existe de verdade', async () => {
    const { buildSdrSystemPrompt } = await import('../src/modules/ai/sdr-base-prompt.js');
    const prompt = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Francielly' });

    expect(prompt).toContain('Ficar em silencio e excecao');
    expect(prompt).toContain('Nunca fique calado depois de uma pergunta sua');
    // "certo" + "pode ser" nao podem ser lidos como mensagem repetida de automacao.
    expect(prompt).toContain('sao uma pessoa falando em duas linhas');
  });
});
