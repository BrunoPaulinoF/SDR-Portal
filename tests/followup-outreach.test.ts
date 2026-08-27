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

function fakeUazapiClient(instanceStatus: UazapiResult = okResult()): UazapiClient & { sent: SendTextInput[] } {
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
      return instanceStatus;
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
    followupAttempts: 0,
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
  jobLogs: ReturnType<typeof createMemoryJobLogRepository>;
  uazapi: ReturnType<typeof fakeUazapiClient>;
  service: ReturnType<typeof createFollowupOutreachService>;
}

async function buildHarness(
  seedLeads: Lead[],
  aiClient: AiClient,
  agentOverrides: Partial<SdrAgent> = {},
  instanceStatus?: UazapiResult,
): Promise<Harness> {
  const agent = await makeAgent({ id: 'sdr-1', ...agentOverrides });
  const leads = createMemoryLeadRepository(seedLeads);
  const conversations = createMemoryConversationRepository();
  const uazapi = fakeUazapiClient(instanceStatus);
  const jobLogs = createMemoryJobLogRepository();
  const service = createFollowupOutreachService({
    aiClient,
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: conversations,
    jobLogRepository: jobLogs,
    leadRepository: leads,
    sdrAgentRepository: createMemorySdrAgentRepository([agent]),
    uazapiClient: uazapi,
  });

  return { agent, jobLogs, leads, conversations, uazapi, service };
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

describe('segundo toque em quem nunca respondeu', () => {
  /** Lead abordado que ficou mudo: status parado em initial_sent e nenhum inbound. */
  function makeSilentLead(overrides: Partial<Lead> = {}): Lead {
    return makeLead({
      status: 'initial_sent',
      lastInboundAt: null,
      lastOutboundAt: new Date(NOW.getTime() - 30 * HOUR),
      ...overrides,
    });
  }

  it('envia segundo toque para o lead que nunca respondeu — ele ficava fora da fila', async () => {
    const ai = fakeAiClient(aiReply('Eu trabalho com um atendente de IA que responde o zap do delivery. Quem responde as mensagens aí?'));
    const { service, leads, uazapi } = await buildHarness([makeSilentLead()], ai);

    const result = await service.runOnce(NOW);

    expect(result.sent).toBe(1);
    expect(uazapi.sent).toHaveLength(1);
    expect((await leads.findById('lead-1'))?.status).toBe('followup_sent');
  });

  it('usa o roteiro de segundo toque, nao o de retomada', async () => {
    const ai = fakeAiClient(aiReply('segundo toque'));
    const { service } = await buildHarness([makeSilentLead()], ai);

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Este lead NUNCA respondeu');
    expect(system).not.toContain('retome o ultimo assunto real');
    expect(ai.calls[0]?.messages[1]?.content).toContain('o lead nunca respondeu a sua primeira mensagem');
  });

  it('usa o bumpPrompt do SDR quando ele existe', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai, {
      bumpPrompt: 'Diga em uma frase o que e e pergunte quem responde o zap.',
    });

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Diga em uma frase o que e e pergunte quem responde o zap.');
    expect(system).not.toContain('Retome a conversa de forma leve');
  });

  it('cai no followupPrompt quando o SDR nao tem bumpPrompt', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai);

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    // O roteiro de segundo toque continua sendo o do modo bump; so a instrucao do SDR e emprestada.
    expect(system).toContain('Retome a conversa de forma leve');
    expect(system).toContain('Este lead NUNCA respondeu');
  });

  it('continua tratando quem respondeu e esfriou como retomada', async () => {
    const ai = fakeAiClient(aiReply('retomada'));
    const { service } = await buildHarness([makeLead()], ai);

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('retome o ultimo assunto real');
    expect(system).not.toContain('Este lead NUNCA respondeu');
  });
});

describe('segundo toque no playbook convite', () => {
  /** Lead abordado que ficou mudo: status parado em initial_sent e nenhum inbound. */
  function makeSilentLead(overrides: Partial<Lead> = {}): Lead {
    return makeLead({
      status: 'initial_sent',
      lastInboundAt: null,
      lastOutboundAt: new Date(NOW.getTime() - 30 * HOUR),
      ...overrides,
    });
  }

  it('nao manda explicar do que se trata — no convite a primeira mensagem cala de proposito', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai, { playbook: 'convite' });

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('NAO diga do que se trata');
    expect(system).not.toContain('Diga em UMA frase concreta do que se trata');
  });

  /**
   * O nome do produto era a unica pista de conteudo no prompt do segundo toque, e o modelo
   * usava: "trabalho com um software de gestao para restaurantes, ja usam algum sistema ai?".
   */
  it('nao entrega o nome do produto ao modelo', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai, { playbook: 'convite' });

    await service.runOnce(NOW);

    expect(ai.calls[0]?.messages[0]?.content ?? '').not.toContain('KyberFood');
  });

  it('nao empresta o roteiro de retomada quando falta o bumpPrompt', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai, { playbook: 'convite' });

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    // A retomada assume que o lead ja sabe do que se trata; quem nunca respondeu nao sabe.
    expect(system).not.toContain('Retome a conversa de forma leve');
    expect(system).toContain('sem dizer do que se trata');
  });

  it('usa o bumpPrompt do SDR quando ele existe', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai, {
      playbook: 'convite',
      bumpPrompt: 'Opa! Aqui e a Francielly, tambem sou do ramo. Queria te fazer uma proposta, pode ser?',
    });

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Queria te fazer uma proposta, pode ser?');
    expect(system).toContain('NAO diga do que se trata');
  });

  it('mantem a retomada de quem respondeu e esfriou, sem o nome do produto', async () => {
    const ai = fakeAiClient(aiReply('retomada'));
    const { service } = await buildHarness([makeLead()], ai, { playbook: 'convite' });

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('retome o ultimo assunto real');
    expect(system).toContain('Retome a conversa de forma leve');
    expect(system).not.toContain('KyberFood');
  });

  it('nao muda o segundo toque do playbook consultivo', async () => {
    const ai = fakeAiClient(aiReply('ok'));
    const { service } = await buildHarness([makeSilentLead()], ai);

    await service.runOnce(NOW);

    const system = ai.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Diga em UMA frase concreta do que se trata');
    expect(system).toContain('KyberFood');
  });
});

describe('recusa do modelo x falha tecnica', () => {
  it('encerra o follow-up quando o modelo recusa, em vez de perguntar de hora em hora', async () => {
    const { service, leads, uazapi } = await buildHarness([makeLead()], fakeAiClient(aiReply('', true)));

    await service.runOnce(NOW);

    const updated = await leads.findById('lead-1');
    expect(uazapi.sent).toHaveLength(0);
    expect(updated?.followupDisabledAt).not.toBeNull();
    // Recusa nao e tentativa perdida: o lead sai da fila, nao volta reagendado.
    expect(updated?.followupDueAt?.getTime()).toBe(NOW.getTime() - HOUR);
    expect(updated?.followupAttempts).toBe(0);
  });

  it('reagenda e conta a tentativa quando a geracao falha por erro tecnico', async () => {
    const { service, leads } = await buildHarness([makeLead()], failingAiClient());

    await service.runOnce(NOW);

    const updated = await leads.findById('lead-1');
    expect(updated?.followupDueAt?.getTime()).toBe(NOW.getTime() + HOUR);
    expect(updated?.followupAttempts).toBe(1);
    expect(updated?.followupDisabledAt).toBeNull();
  });

  it('desiste do lead depois de tres falhas tecnicas, em vez de tentar para sempre', async () => {
    const { service, leads } = await buildHarness([makeLead({ followupAttempts: 2 })], failingAiClient());

    await service.runOnce(NOW);

    const updated = await leads.findById('lead-1');
    expect(updated?.followupDisabledAt).not.toBeNull();
    expect(updated?.followupSentAt).toBeNull();
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

/**
 * Em 25/08 a instancia da Insumo Smart deslogou do WhatsApp ("401: logged out from another
 * device") e o follow-up passou dois dias assim: gerava a mensagem no modelo, levava HTTP 503
 * no envio e devolvia o lead intacto para a fila. Como a falha de envio nunca reagendou nada,
 * o mesmo lead voltava a cada tick — 168 geracoes pagas, 61 delas para um unico lead.
 */
describe('canal do WhatsApp fora do ar', () => {
  const disconnected: UazapiResult = { status: 200, ok: true, body: { instance: { status: 'disconnected' } } };

  it('nao gasta geracao de IA quando a instancia esta deslogada', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, uazapi } = await buildHarness([makeLead()], ai, {}, disconnected);

    const result = await service.runOnce(NOW);

    expect(ai.calls).toHaveLength(0);
    expect(uazapi.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.details.join('\n')).toContain('WhatsApp desconectado');
  });

  it('nao queima tentativa nem desabilita o follow-up do lead', async () => {
    const lead = makeLead();
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, leads } = await buildHarness([lead], ai, {}, disconnected);

    await service.runOnce(NOW);

    const stored = await leads.findById(lead.id);
    expect(stored?.followupAttempts).toBe(0);
    expect(stored?.followupDisabledAt).toBeNull();
    expect(stored?.followupDueAt).toEqual(lead.followupDueAt);
  });

  it('volta a enviar sozinho assim que a instancia reconecta', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, uazapi } = await buildHarness([makeLead()], ai, {}, okResult());

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(1);
  });

  // Payload sem `status` nao e prova de nada: a UAZAPI varia o corpo e um parse frustrado
  // nao pode calar o disparo inteiro em silencio.
  it('segue enviando quando a UAZAPI nao devolve status', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const semStatus: UazapiResult = { status: 200, ok: true, body: { instance: {} } };
    const { service, uazapi } = await buildHarness([makeLead()], ai, {}, semStatus);

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(1);
  });
});

/**
 * A primeira versao da guarda calou `/job-logs` por completo: canal fora deixou de escrever
 * qualquer linha. Quem abriu a tela em 27/08 viu a tabela parada no ultimo envio e leu isso
 * como scheduler morto — os dois SDRs "pararam", sendo que um so estava fora da janela.
 */
describe('canal fora aparece no job-logs sem inundar', () => {
  const disconnected: UazapiResult = { status: 200, ok: true, body: { instance: { status: 'disconnected' } } };
  const MINUTE = 60 * 1000;

  it('registra o motivo uma vez, e nao a cada tick', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, jobLogs } = await buildHarness([makeLead()], ai, {}, disconnected);

    for (let tick = 0; tick < 6; tick += 1) {
      await service.runOnce(new Date(NOW.getTime() + tick * 5 * MINUTE));
    }

    const logs = await jobLogs.list();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('skipped');
    expect(logs[0]?.error).toContain('WhatsApp desconectado');
    expect(logs[0]?.leadId).toBeNull();
  });

  it('volta a registrar depois da janela de silencio', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, jobLogs } = await buildHarness([makeLead()], ai, {}, disconnected);

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 31 * MINUTE));

    expect(await jobLogs.list()).toHaveLength(2);
  });

  it('nao escreve nada quando o canal esta de pe', async () => {
    const ai = fakeAiClient(aiReply('Oi, posso retomar?'));
    const { service, jobLogs } = await buildHarness([makeLead()], ai, {}, okResult());

    await service.runOnce(NOW);

    const logs = await jobLogs.list();
    expect(logs.every((log) => log.jobKey?.startsWith('channel-down') !== true)).toBe(true);
  });
});
