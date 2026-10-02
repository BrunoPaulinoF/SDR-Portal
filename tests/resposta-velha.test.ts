import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService, SUPERSEDED_REPLY_ERROR } from '../src/modules/ai/ai-response-service.js';
import { createInboundResponseBuffer } from '../src/modules/ai/inbound-response-buffer.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const ok: UazapiResult = { status: 200, ok: true, body: {} };

function fakeUazapi(): UazapiClient & { texts: SendTextInput[] } {
  const texts: SendTextInput[] = [];
  return {
    texts,
    checkChats: async () => ok,
    configureWebhook: async () => ok,
    downloadMessage: async () => ok,
    getInstanceStatus: async () => ok,
    sendContact: async () => ok,
    sendPresence: async () => ok,
    async sendText(input) {
      texts.push(input);
      return ok;
    },
  };
}

const resposta = (texto: string) => JSON.stringify({ mensagem_usuario: texto, nao_responder: false, actions: [] });

async function buildScenario() {
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
  const agent: SdrAgent = { ...baseAgent, aiProvider: 'openai', responseDelayBaseMs: 0, responseDelayPerCharMs: 0, responseDelayMaxMs: 0 };

  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5519999999999',
    companyName: 'Serginho Lanches',
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
  const leadSays = (text: string | null, messageType = 'conversation') =>
    conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: lead.id,
      sdrAgentId: agent.id,
      direction: 'inbound',
      senderType: 'lead',
      messageType,
      text,
    });

  return { agent, conversation, conversationRepository, lead, leadRepository, leadSays };
}

describe('resposta que ficou velha durante a geracao', () => {
  it('nao envia quando o lead escreveu de novo enquanto a IA pensava', async () => {
    const s = await buildScenario();
    await s.leadSays('quem fala?');
    const uazapi = fakeUazapi();
    const aiRuns = createMemoryAiRunRepository();
    const aiClient: AiClient = {
      async generate() {
        // a segunda mensagem chega no meio da geracao
        await s.leadSays('e o que voces vendem?');
        return { outputText: resposta('Oi! Aqui e a Mariana.'), promptTokens: 1, completionTokens: 1, totalTokens: 2, promptCacheHitTokens: null };
      },
    };
    const service = createAiResponseService({
      aiClient,
      aiRunRepository: aiRuns,
      conversationRepository: s.conversationRepository,
      leadRepository: s.leadRepository,
      textToSpeechClient: { synthesize: async () => Promise.reject(new Error('sem audio')) },
      uazapiClient: uazapi,
    });

    await service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(uazapi.texts).toHaveLength(0);
    const runs = await aiRuns.list();
    expect(runs[0]?.error).toBe(SUPERSEDED_REPLY_ERROR);
  });

  it('figurinha no meio da geracao nao derruba a resposta', async () => {
    const s = await buildScenario();
    await s.leadSays('quem fala?');
    const uazapi = fakeUazapi();
    const aiClient: AiClient = {
      async generate() {
        await s.leadSays(null, 'sticker');
        return { outputText: resposta('Oi! Aqui e a Mariana.'), promptTokens: 1, completionTokens: 1, totalTokens: 2, promptCacheHitTokens: null };
      },
    };
    const service = createAiResponseService({
      aiClient,
      aiRunRepository: createMemoryAiRunRepository(),
      conversationRepository: s.conversationRepository,
      leadRepository: s.leadRepository,
      textToSpeechClient: { synthesize: async () => Promise.reject(new Error('sem audio')) },
      uazapiClient: uazapi,
    });

    await service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(uazapi.texts.map((text) => text.text)).toEqual(['Oi! Aqui e a Mariana.']);
  });

  it('erro dentro do buffer nao vira rejeicao solta', async () => {
    const s = await buildScenario();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const buffer = createInboundResponseBuffer({
      aiResponseService: {
        async respondToInbound() {
          throw new Error('banco fora do ar');
        },
      },
      conversationRepository: s.conversationRepository,
      delayMs: 5,
      leadRepository: s.leadRepository,
    });
    await buffer.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off('unhandledRejection', onUnhandled);

    expect(unhandled).toHaveLength(0);
  });
});
