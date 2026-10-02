import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService, HANDOFF_NOTICE_JOB } from '../src/modules/ai/ai-response-service.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const HANDOFF_NUMBER = '5519988887777';
const LEAD_NUMBER = '5519999999999';

const result = (ok: boolean): UazapiResult => ({ status: ok ? 200 : 503, ok, body: {} });

/** UAZAPI que recusa os primeiros `failuresToHandoff` envios para o numero do handoff. */
function fakeUazapi(failuresToHandoff: number): UazapiClient & { texts: SendTextInput[] } {
  const texts: SendTextInput[] = [];
  let failures = failuresToHandoff;
  return {
    texts,
    async checkChats() {
      return result(true);
    },
    async configureWebhook() {
      return result(true);
    },
    async downloadMessage() {
      return result(true);
    },
    async getInstanceStatus() {
      return result(true);
    },
    async sendContact() {
      return result(true);
    },
    async sendPresence() {
      return result(true);
    },
    async sendText(input) {
      texts.push(input);
      if (input.number === HANDOFF_NUMBER && failures > 0) {
        failures -= 1;
        return result(false);
      }
      return result(true);
    },
  };
}

const pedeHandoff = JSON.stringify({
  mensagem_usuario: 'Combinado! Vou pedir pro Igor te chamar aqui no zap.',
  nao_responder: false,
  stage_sugerido: 'handoff_done',
  actions: [{ type: 'notify_handoff', summary: 'Dono quer o teste de 3 dias, atende sexta a noite' }],
});

const aiClient: AiClient = {
  async generate() {
    return { outputText: pedeHandoff, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
  },
};

async function buildScenario(options: { failuresToHandoff?: number; handoffPhone?: string | null } = {}) {
  const agentRepo = createMemorySdrAgentRepository();
  const baseAgent = await agentRepo.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    uazapiBaseUrl: 'https://fake.uazapi.com',
    uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
    openaiApiKeyEncrypted: encryptSecret('sk-fake'),
  });
  const agent: SdrAgent = {
    ...baseAgent,
    aiProvider: 'openai',
    handoffName: 'Igor',
    handoffPhone: options.handoffPhone === undefined ? '19988887777' : options.handoffPhone,
    responseDelayBaseMs: 0,
    responseDelayPerCharMs: 0,
    responseDelayMaxMs: 0,
  };

  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: LEAD_NUMBER,
    companyName: 'Fit013 Marmitas',
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
    text: 'Tenho interesse',
  });

  const uazapi = fakeUazapi(options.failuresToHandoff ?? 0);
  const jobLogRepository = createMemoryJobLogRepository();
  const service = createAiResponseService({
    aiClient,
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository,
    jobLogRepository,
    leadRepository,
    textToSpeechClient: {
      async synthesize() {
        throw new Error('sem audio neste teste');
      },
    },
    uazapiClient: uazapi,
  });

  await service.respondToInbound({ agent, conversation, lead });

  const handoffNotices = uazapi.texts.filter((text) => text.number === HANDOFF_NUMBER);
  const logs = (await jobLogRepository.list()).filter((log) => log.jobName === HANDOFF_NOTICE_JOB);
  const savedLead = await leadRepository.findById(lead.id);
  return { handoffNotices, logs, savedLead, uazapi };
}

describe('aviso de handoff', () => {
  it('avisa quem atende e deixa o rastro no /job-logs', async () => {
    const s = await buildScenario();

    expect(s.savedLead?.status).toBe('transferred');
    expect(s.handoffNotices).toHaveLength(1);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]?.status).toBe('completed');
    // Quem recebe o aviso e quem sabe o que aconteceu depois: o link leva para marcar o desfecho.
    expect(s.handoffNotices[0]?.text).toContain(`Depois, marque o que aconteceu: https://portal.test/leads/${s.savedLead?.id}`);
  });

  it('tenta de novo quando a UAZAPI recusa o aviso', async () => {
    const s = await buildScenario({ failuresToHandoff: 2 });

    expect(s.handoffNotices).toHaveLength(3);
    expect(s.logs[0]?.status).toBe('completed');
    expect(s.logs[0]?.attempt).toBe(3);
  });

  it('marca o lead mesmo quando o aviso nao sai, e registra a falha com o resumo', async () => {
    const s = await buildScenario({ failuresToHandoff: 10 });

    // O lead ja leu "vou pedir pro Igor te chamar": ele nao pode voltar para a fila da IA.
    expect(s.savedLead?.status).toBe('transferred');
    expect(s.savedLead?.handoffRequestedAt).not.toBeNull();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]?.status).toBe('failed');
    expect(s.logs[0]?.error).toContain('HTTP 503');
    expect(s.logs[0]?.payload).toContain('teste de 3 dias');
  });

  it('SDR sem WhatsApp de handoff nao some em silencio', async () => {
    const s = await buildScenario({ handoffPhone: null });

    expect(s.savedLead?.status).toBe('transferred');
    expect(s.handoffNotices).toHaveLength(0);
    expect(s.logs[0]?.status).toBe('failed');
    expect(s.logs[0]?.error).toContain('sem WhatsApp de handoff');
  });

  it('a resposta ao lead sai uma vez so, mesmo com o aviso falhando', async () => {
    const s = await buildScenario({ failuresToHandoff: 10 });

    const toLead = s.uazapi.texts.filter((text) => text.number === LEAD_NUMBER);
    expect(toLead).toHaveLength(1);
  });
});
