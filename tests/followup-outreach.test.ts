import { describe, expect, it } from 'vitest';

import type { AiClient, AiGenerateInput } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import type { LeadResearchService } from '../src/modules/leads/lead-research-service.js';
import { createFollowupOutreachService } from '../src/modules/scheduler/followup-outreach.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import { createResetConversationService } from '../src/modules/webhooks/reset-conversation-service.js';
import type { Lead, SdrAgent } from '../src/db/schema.js';

// Quinta-feira 11:00 em America/Sao_Paulo: dentro da janela de envio padrao (08:00-18:00, dias 1-5).
const NOW = new Date('2026-07-23T14:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function okResult(): UazapiResult {
  return { status: 200, ok: true, body: { messageid: 'msg-1' } };
}

function fakeUazapiClient(): UazapiClient & { sent: SendTextInput[] } {
  const sent: SendTextInput[] = [];
  return {
    sent,
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
      sent.push(input);
      return okResult();
    },
  };
}

function fakeAiClient(outputText: string): AiClient & { calls: AiGenerateInput[] } {
  const calls: AiGenerateInput[] = [];
  return {
    calls,
    async generate(input) {
      calls.push(input);
      return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
    },
  };
}

function failingAiClient(): AiClient {
  return {
    async generate() {
      throw new Error('Unexpected end of JSON input');
    },
  };
}

function aiReply(message: string, naoResponder = false): string {
  return JSON.stringify({
    mensagem_usuario: message,
    nao_responder: naoResponder,
    status_sugerido: 'followup_sent',
    stage_sugerido: 'permission',
    actions: [],
  });
}

async function makeAgent(overrides: Partial<SdrAgent> = {}): Promise<SdrAgent> {
  const repo = createMemorySdrAgentRepository();
  const agent = await repo.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    productName: 'KyberFood',
    followupPrompt: 'Retome a conversa de forma leve e termine com uma pergunta.',
    deepseekApiKeyEncrypted: encryptSecret('sk-test'),
    uazapiBaseUrl: 'https://uazapi.test',
    uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
  });
  return { ...agent, ...overrides };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber: '5534999969911',
    whatsappJid: '553499969911@s.whatsapp.net',
    whatsappLid: null,
    cnpj: null,
    companyName: 'Leley Gelato',
    tradeName: null,
    segment: 'gelateria',
    city: 'Leme',
    state: 'SP',
    contactName: 'Bruno',
    extraData: null,
    status: 'in_conversation',
    conversationStage: 'permission',
    source: 'manual',
    firstMessageVariantId: null,
    firstMessageSentAt: new Date(NOW.getTime() - 48 * HOUR),
    lastInboundAt: new Date(NOW.getTime() - 30 * HOUR),
    lastOutboundAt: new Date(NOW.getTime() - 30 * HOUR),
    followupDueAt: new Date(NOW.getTime() - HOUR),
    followupSentAt: null,
    followupDisabledAt: null,
    humanPausedUntil: null,
    aiPausedAt: null,
    aiPauseReason: null,
    handoffRequestedAt: null,
    handoffSummary: null,
    notInterestedAt: null,
    createdAt: new Date(NOW.getTime() - 48 * HOUR),
    updatedAt: new Date(NOW.getTime() - 30 * HOUR),
    ...overrides,
  };
}

interface Harness {
  agent: SdrAgent;
  leads: ReturnType<typeof createMemoryLeadRepository>;
  conversations: ReturnType<typeof createMemoryConversationRepository>;
  uazapi: ReturnType<typeof fakeUazapiClient>;
  service: ReturnType<typeof createFollowupOutreachService>;
}

async function buildHarness(seedLeads: Lead[], aiClient: AiClient, agentOverrides: Partial<SdrAgent> = {}): Promise<Harness> {
  const agent = await makeAgent({ id: 'sdr-1', ...agentOverrides });
  const leads = createMemoryLeadRepository(seedLeads);
  const conversations = createMemoryConversationRepository();
  const uazapi = fakeUazapiClient();
  const service = createFollowupOutreachService({
    aiClient,
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: conversations,
    jobLogRepository: createMemoryJobLogRepository(),
    leadRepository: leads,
    sdrAgentRepository: createMemorySdrAgentRepository([agent]),
    uazapiClient: uazapi,
  });

  return { agent, leads, conversations, uazapi, service };
}

describe('followup outreach guards', () => {
  it('nao envia follow-up quando um /reset criou uma thread mais nova no mesmo WhatsApp', async () => {
    const orphan = makeLead({ id: 'lead-antigo' });
    const newer = makeLead({
      id: 'lead-novo',
      status: 'initial_sent',
      createdAt: new Date(NOW.getTime() - HOUR),
      firstMessageSentAt: new Date(NOW.getTime() - HOUR),
      lastInboundAt: null,
      lastOutboundAt: new Date(NOW.getTime() - HOUR),
      followupDueAt: new Date(NOW.getTime() + 23 * HOUR),
    });
    const { service, uazapi } = await buildHarness([orphan, newer], fakeAiClient(aiReply('nao deveria sair')));

    const result = await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(result.details.join(' ')).toContain('nenhum follow-up vencido');
  });

  it('nao envia follow-up quando o chat teve mensagem dentro da janela de silencio', async () => {
    const warm = makeLead({ lastInboundAt: new Date(NOW.getTime() - 2 * HOUR) });
    const { service, uazapi } = await buildHarness([warm], fakeAiClient(aiReply('nao deveria sair')));

    const result = await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
  });

  it('nao envia follow-up quando outro lead do mesmo numero foi transferido agora', async () => {
    const cold = makeLead({ id: 'lead-frio' });
    const handedOff = makeLead({
      id: 'lead-transferido',
      status: 'transferred',
      conversationStage: 'handoff_done',
      createdAt: new Date(NOW.getTime() - 47 * HOUR),
      lastInboundAt: new Date(NOW.getTime() - 2 * HOUR),
      lastOutboundAt: new Date(NOW.getTime() - 2 * HOUR),
      followupDisabledAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    const { service, uazapi } = await buildHarness([cold, handedOff], fakeAiClient(aiReply('nao deveria sair')));

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
  });

  it('envia follow-up para conversa fria, manda o historico no prompt e grava a mensagem na thread', async () => {
    const cold = makeLead();
    const ai = fakeAiClient(aiReply('E aquele teste do atendimento, conseguiu dar uma olhada?'));
    const { service, conversations, leads, uazapi } = await buildHarness([cold], ai);
    const conversation = await conversations.create({
      companyId: cold.companyId,
      sdrAgentId: cold.sdrAgentId,
      leadId: cold.id,
      whatsappNumber: cold.whatsappNumber,
      status: 'open',
      lastMessageAt: cold.lastInboundAt,
    });
    await conversations.createMessage({
      conversationId: conversation.id,
      leadId: cold.id,
      sdrAgentId: cold.sdrAgentId,
      direction: 'inbound',
      senderType: 'lead',
      whatsappMessageId: null,
      messageType: 'text',
      text: 'Temos uma atendente que responde',
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: false,
      fromMe: false,
    });

    const result = await service.runOnce(NOW);

    expect(result.sent).toBe(1);
    expect(uazapi.sent).toHaveLength(1);
    expect(uazapi.sent[0]?.text).toBe('E aquele teste do atendimento, conseguiu dar uma olhada?');

    const userPrompt = ai.calls[0]?.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('Temos uma atendente que responde');
    expect(ai.calls[0]?.messages[0]?.content).toContain('Retome a conversa de forma leve');

    const stored = await conversations.listMessages(conversation.id);
    expect(stored).toHaveLength(2);
    expect(stored[1]?.direction).toBe('outbound');
    expect(stored[1]?.text).toBe('E aquele teste do atendimento, conseguiu dar uma olhada?');
    expect((await leads.findById(cold.id))?.status).toBe('followup_sent');
  });

  it('nao manda mensagem generica quando a geracao pela IA falha e reagenda o follow-up', async () => {
    const cold = makeLead();
    const { service, leads, uazapi } = await buildHarness([cold], failingAiClient());

    const result = await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    const updated = await leads.findById(cold.id);
    expect(updated?.followupSentAt).toBeNull();
    expect(updated?.status).toBe('in_conversation');
    expect(updated?.followupDueAt?.getTime()).toBe(NOW.getTime() + HOUR);
  });

  it('respeita nao_responder do modelo e nao envia nada', async () => {
    const cold = makeLead();
    const { service, uazapi } = await buildHarness([cold], fakeAiClient(aiReply('', true)));

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
  });

  it('nao envia quando o SDR nao tem followup_prompt configurado', async () => {
    const cold = makeLead();
    const { service, uazapi } = await buildHarness([cold], fakeAiClient(aiReply('nao deveria sair')), { followupPrompt: null });

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(0);
  });
});

describe('follow-up e a pausa da IA', () => {
  it('conversa pausada nao recebe follow-up, e liberar devolve o envio', async () => {
    const cold = makeLead();
    const { leads, service, uazapi } = await buildHarness([cold], fakeAiClient(aiReply('Passando para saber se seguimos.')));

    await leads.pauseAi(cold.id, new Date(NOW.getTime() - 2 * HOUR), 'lead_image_message');
    const pausado = await service.runOnce(NOW);
    const durante = await leads.findById(cold.id);

    expect(pausado.sent).toBe(0);
    expect(uazapi.sent).toHaveLength(0);
    // a pausa segura o follow-up pelo status; nao desliga o follow-up de vez
    expect(durante?.followupDisabledAt).toBeNull();

    await leads.resumeAi(cold.id, new Date(NOW.getTime() - HOUR));
    const liberado = await service.runOnce(NOW);

    expect(liberado.sent).toBe(1);
    expect(uazapi.sent).toHaveLength(1);
  });

  it('liberar nao ressuscita o follow-up que ja tinha sido desligado por outro motivo', async () => {
    const semInteresse = makeLead({ followupDisabledAt: new Date(NOW.getTime() - 10 * HOUR) });
    const { leads, service, uazapi } = await buildHarness([semInteresse], fakeAiClient(aiReply('nao deveria sair')));

    await leads.pauseAi(semInteresse.id, new Date(NOW.getTime() - 2 * HOUR), 'portal_manual');
    await leads.resumeAi(semInteresse.id, new Date(NOW.getTime() - HOUR));
    const result = await service.runOnce(NOW);
    const lead = await leads.findById(semInteresse.id);

    expect(lead?.followupDisabledAt).toEqual(new Date(NOW.getTime() - 10 * HOUR));
    expect(result.sent).toBe(0);
    expect(uazapi.sent).toHaveLength(0);
  });
});

describe('reset conversation', () => {
  it('encerra o lead anterior para o agendador nao disparar follow-up na thread antiga', async () => {
    const agent = await makeAgent({ id: 'sdr-1', firstMessageMode: 'ab_test' });
    const previous = makeLead();
    const leads = createMemoryLeadRepository([previous]);
    const variants = createMemoryFirstMessageVariantRepository();
    await variants.create({ sdrAgentId: agent.id, label: 'A', body: 'Oi, sou a Mariana da KyberFood.' });
    const researchThatMustNotRun: LeadResearchService = {
      async researchLead() {
        throw new Error('research should not run in ab_test mode');
      },
    };

    const service = createResetConversationService({
      aiClient: fakeAiClient(aiReply('nao usado')),
      aiRunRepository: createMemoryAiRunRepository(),
      conversationRepository: createMemoryConversationRepository(),
      firstMessageVariantRepository: variants,
      jobLogRepository: createMemoryJobLogRepository(),
      leadResearchService: researchThatMustNotRun,
      leadRepository: leads,
      uazapiClient: fakeUazapiClient(),
    });

    await service.reset({ agent, previousLead: previous, whatsappNumber: previous.whatsappNumber });

    const old = await leads.findById(previous.id);
    expect(old?.status).toBe('discarded');
    expect(old?.followupDisabledAt).not.toBeNull();

    const all = await leads.list();
    expect(all).toHaveLength(2);
  });
});
