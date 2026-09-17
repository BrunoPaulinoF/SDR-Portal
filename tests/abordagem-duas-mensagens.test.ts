import { describe, expect, it } from 'vitest';

import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import type { ConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import type { JobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import type { LeadResearchService } from '../src/modules/leads/lead-research-service.js';
import { createInitialOutreachService } from '../src/modules/scheduler/initial-outreach.js';
import { readPromptBundle } from '../src/modules/sdr-agents/prompt-bundle.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { Lead } from '../src/db/schema.js';

const MARIANA_DIR = 'docs/prompts/mariana';

// Quinta-feira 11:00 em America/Sao_Paulo: dentro da janela de envio.
const NOW = new Date('2026-07-23T14:00:00.000Z');

function ok(body: unknown = {}): UazapiResult {
  return { status: 200, ok: true, body };
}

/** `failTrackSources` recusa so o envio marcado com aquela origem (a segunda mensagem, por exemplo). */
function fakeUazapi(failTrackSources: string[] = []): UazapiClient & { sent: SendTextInput[] } {
  const sent: SendTextInput[] = [];
  const client = {
    sent,
    async checkChats() {
      return ok([{ isInWhatsapp: true, jid: '5519999999999@s.whatsapp.net' }]);
    },
    async configureWebhook() { return ok(); },
    async connectInstance() { return ok(); },
    async createInstance() { return ok(); },
    async deleteInstance() { return ok(); },
    async downloadMessage() { return ok(); },
    async getInstanceStatus() { return ok({ instance: { status: 'connected' } }); },
    async listInstances() { return ok([]); },
    async sendContact() { return ok(); },
    async sendPresence() { return ok(); },
    async sendText(input: SendTextInput) {
      if (input.trackSource && failTrackSources.includes(input.trackSource)) {
        return { status: 500, ok: false, body: { error: 'internal' } };
      }
      sent.push(input);
      return ok({ messageid: 'msg-1' });
    },
  };
  return client as unknown as UazapiClient & { sent: SendTextInput[] };
}

function fakeAi(): AiClient {
  return {
    async generate() {
      return {
        outputText: JSON.stringify({ qualified: true, reason: 'ok', mensagem_usuario: 'oi, tudo bem? aqui é a Mariana, da KyberFood.' }),
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        promptCacheHitTokens: null,
      };
    },
  };
}

function leadRow(): Lead {
  return {
    id: 'lead-1',
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber: '5519999999999',
    whatsappJid: null,
    whatsappLid: null,
    cnpj: null,
    companyName: 'Pizzaria do Bairro',
    tradeName: null,
    segment: 'Pizzaria',
    city: 'Pirassununga',
    state: 'SP',
    contactName: null,
    extraData: null,
    status: 'pending',
    conversationStage: 'permission',
    source: 'manual',
    firstMessageVariantId: null,
    firstMessageSentAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    followupDueAt: null,
    followupSentAt: null,
    followupDisabledAt: null,
    followupAttempts: 0,
    humanPausedUntil: null,
    aiPausedAt: null,
    aiPauseReason: null,
    handoffRequestedAt: null,
    handoffSummary: null,
    notInterestedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

async function build(secondMessage: string | null, failTrackSources: string[] = []): Promise<{
  conversations: ConversationRepository;
  jobLogs: JobLogRepository;
  leads: ReturnType<typeof createMemoryLeadRepository>;
  service: ReturnType<typeof createInitialOutreachService>;
  uazapi: UazapiClient & { sent: SendTextInput[] };
}> {
  const seedRepository = createMemorySdrAgentRepository();
  const agent = await seedRepository.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    productName: 'KyberFood',
    prompt: 'Aborde o delivery.',
    secondMessage,
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
  const leads = createMemoryLeadRepository([leadRow()]);
  const conversations = createMemoryConversationRepository();
  const jobLogs = createMemoryJobLogRepository();
  const uazapi = fakeUazapi(failTrackSources);
  const research: LeadResearchService = { async researchLead() { return null; } };
  const service = createInitialOutreachService({
    aiClient: fakeAi(),
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: conversations,
    firstMessageVariantRepository: createMemoryFirstMessageVariantRepository(),
    jobLogRepository: jobLogs,
    leadResearchService: research,
    leadRepository: leads,
    sdrAgentRepository: createMemorySdrAgentRepository([{ ...agent, id: 'sdr-1' }]),
    uazapiClient: uazapi,
  });
  return { conversations, jobLogs, leads, service, uazapi };
}

/**
 * A abordagem alinhada pela equipe sao duas mensagens: a apresentacao curta e, logo depois,
 * a explicacao do sistema com o teste gratis. As duas saem no mesmo disparo, sem esperar o
 * lead responder — juntar as duas numa mensagem so e o textao que o dono arquiva sem ler.
 */
describe('abordagem em duas mensagens', () => {
  it('envia a segunda mensagem logo depois da primeira e guarda as duas na conversa', async () => {
    const { conversations, service, uazapi } = await build('3 dias de teste gratis. posso te contar como funciona?');

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(2);
    expect(uazapi.sent[0]?.trackSource).toBe('sdr-portal-initial');
    expect(uazapi.sent[1]?.trackSource).toBe('sdr-portal-initial-second');
    expect(uazapi.sent[1]?.text).toBe('3 dias de teste gratis. posso te contar como funciona?');

    const messages = await conversations.listAllMessages();
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.direction === 'outbound')).toBe(true);
    expect(messages.map((message) => message.text)).toContain('3 dias de teste gratis. posso te contar como funciona?');
  });

  it('sem segunda mensagem cadastrada, a abordagem continua sendo uma so', async () => {
    const { conversations, service, uazapi } = await build(null);

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(1);
    expect(await conversations.listAllMessages()).toHaveLength(1);
  });

  it('falha na segunda mensagem nao devolve o lead para a fila nem reenvia a primeira', async () => {
    const { jobLogs, leads, service, uazapi } = await build('explicacao', ['sdr-portal-initial-second']);

    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 60 * 60 * 1000));

    // A primeira saiu uma vez so: reabrir o ciclo mandaria a apresentacao de novo.
    expect(uazapi.sent).toHaveLength(1);
    expect((await leads.findById('lead-1'))?.status).toBe('initial_sent');

    const logs = await jobLogs.list();
    const falha = logs.find((log) => log.jobKey === 'initial-second-lead-1');
    expect(falha?.status).toBe('failed');
  });
});

describe('prompts da Mariana com a abordagem de duas mensagens', () => {
  it('traz a segunda mensagem versionada, com sistema, teste gratis e WhatsApp nativo', async () => {
    const bundle = await readPromptBundle(MARIANA_DIR);
    const second = bundle.fields.secondMessage ?? '';

    expect(bundle.missing).toEqual([]);
    expect(second).toContain('3 dias de teste grátis');
    expect(second).toContain('dentro do próprio WhatsApp');
    // Sem textao: a explicacao inteira cabe em poucas linhas.
    expect(second.length).toBeLessThan(600);
    // O que continua proibido em toda mensagem da Mariana.
    expect(second).not.toMatch(/R\$|mensalidade|https?:\/\//);
  });

  it('a Mariana nao se apresenta mais como "do comercial"', async () => {
    const bundle = await readPromptBundle(MARIANA_DIR);

    expect(bundle.fields.prompt).toContain('sou a Mariana, da KyberFood');
    expect(bundle.fields.prompt).not.toContain('Você é a Mariana, do comercial da KyberFood');
    expect(bundle.fields.firstMessagePrompt).toContain('nunca "sou do comercial da KyberFood"');
  });

  it('avisa a IA de que o lead ja leu as duas mensagens da abordagem', async () => {
    const bundle = await readPromptBundle(MARIANA_DIR);
    const prompt = bundle.fields.prompt ?? '';

    // Sem isso a ETAPA 1 reapresenta o que a segunda mensagem acabou de dizer.
    expect(prompt).toContain('=== O QUE O LEAD JÁ LEU ANTES DE VOCÊ ===');
    expect(prompt).toContain('teste grátis de 3 dias');
    // A regra de uma mensagem por vez continua de pe para a IA.
    expect(prompt).toContain('UMA MENSAGEM POR VEZ');
  });

  it('a Insumo Smart continua com bundle completo sem ter segunda mensagem', async () => {
    const bundle = await readPromptBundle('docs/prompts/insumosmart');

    expect(bundle.missing).toEqual([]);
    expect(bundle.fields.secondMessage).toBeUndefined();
  });
});
