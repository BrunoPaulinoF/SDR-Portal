import { describe, expect, it } from 'vitest';

import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryFirstMessageVariantRepository } from '../src/modules/first-message-variants/first-message-variant-repository.js';
import { createMemoryJobLogRepository } from '../src/modules/jobs/job-log-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import type { LeadResearchService } from '../src/modules/leads/lead-research-service.js';
import { createInitialOutreachService } from '../src/modules/scheduler/initial-outreach.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { Lead } from '../src/db/schema.js';

// Quinta-feira 11:00 em America/Sao_Paulo: dentro da janela de envio padrao.
const NOW = new Date('2026-07-23T14:00:00.000Z');

function ok(body: unknown = {}): UazapiResult {
  return { status: 200, ok: true, body };
}

/** `rejectNumbers` reproduz o caso real: a instancia envia, menos para um numero. */
function fakeUazapi(rejectNumbers: string[] = []): UazapiClient & { sent: SendTextInput[] } {
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
      if (rejectNumbers.includes(input.number)) return { status: 500, ok: false, body: { error: 'internal' } };
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
        outputText: JSON.stringify({ qualified: true, reason: 'ok', mensagem_usuario: 'Oi!' }),
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        promptCacheHitTokens: null,
      };
    },
  };
}

function leadRow(id: string, companyName: string, whatsappNumber: string, createdAt: Date): Lead {
  return {
    id,
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber,
    whatsappJid: null,
    whatsappLid: null,
    cnpj: null,
    companyName,
    tradeName: null,
    segment: 'Restaurante',
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
    createdAt,
    updatedAt: createdAt,
  };
}

async function build(rejectNumbers: string[]) {
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const agent = await sdrAgentRepository.create({
    companyId: 'company-1',
    name: 'Francielly',
    displayName: 'Francielly',
    isActive: true,
    productName: 'Insumo Smart',
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
  const stored = { ...agent, id: 'sdr-1' };
  const leads = createMemoryLeadRepository([
    leadRow('lead-ruim', 'Divino Sabor', '5519996782890', new Date('2026-07-01T00:00:00.000Z')),
    leadRow('lead-bom', 'Marmitaria Delivery', '5512996808655', new Date('2026-07-02T00:00:00.000Z')),
  ]);
  const uazapi = fakeUazapi(rejectNumbers);
  const research: LeadResearchService = { async researchLead() { return null; } };
  const service = createInitialOutreachService({
    aiClient: fakeAi(),
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: createMemoryConversationRepository(),
    firstMessageVariantRepository: createMemoryFirstMessageVariantRepository(),
    jobLogRepository: createMemoryJobLogRepository(),
    leadResearchService: research,
    leadRepository: leads,
    sdrAgentRepository: createMemorySdrAgentRepository([stored]),
    uazapiClient: uazapi,
  });
  return { leads, service, uazapi };
}

/**
 * `findNextPendingForSdr` devolve sempre o lead mais antigo, entao um numero que a UAZAPI
 * recusa vira eterno primeiro colocado. Em 27/08 o lead "Divino Sabor" acumulou 17 chamadas
 * de IA sem sair do lugar, com 536 leads atras dele que jamais seriam alcancados.
 */
describe('lead que a UAZAPI recusa nao trava a fila', () => {
  it('passa para o proximo lead depois de recusas seguidas', async () => {
    const { service, uazapi } = await build(['5519996782890']);

    for (let tick = 0; tick < 4; tick += 1) {
      await service.runOnce(new Date(NOW.getTime() + tick * 10 * 60 * 1000));
    }

    expect(uazapi.sent.map((message) => message.number)).toEqual(['5512996808655']);
  });

  it('nao tira da fila um lead que enviou normalmente', async () => {
    const { service, uazapi } = await build([]);

    await service.runOnce(NOW);

    expect(uazapi.sent).toHaveLength(1);
    expect(uazapi.sent[0]?.number).toBe('5519996782890');
  });
});
