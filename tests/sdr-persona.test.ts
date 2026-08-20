import { describe, expect, it } from 'vitest';

import type { AiChatMessage, AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { buildSdrSystemPrompt, SDR_BASE_PROMPT } from '../src/modules/ai/sdr-base-prompt.js';
import { aiHistoryText } from '../src/modules/conversations/conversation-history.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { Message, SdrAgent } from '../src/db/schema.js';

const DEMO_PHONE = '5519997353221';

function contactMessage(overrides: Partial<Message> = {}): Pick<Message, 'messageType' | 'text' | 'transcription'> {
  return {
    messageType: 'contact',
    text: `Contato enviado: KyberFood - Pizzaria Demonstracao (${DEMO_PHONE})`,
    transcription: null,
    ...overrides,
  };
}

describe('a SDR e do comercial, nao e o produto', () => {
  it('a regra vale para qualquer SDR: fica no prompt base, fora do prompt editavel', () => {
    expect(SDR_BASE_PROMPT).toContain('nunca o produto que voce vende');
    expect(SDR_BASE_PROMPT).toContain('testar voce');
    expect(SDR_BASE_PROMPT).toContain('eu mesma te mostro');
  });

  it('a regra chega nos dois playbooks mesmo com o prompt editavel vazio', () => {
    for (const playbook of ['consultivo', 'convite'] as const) {
      const prompt = buildSdrSystemPrompt({ sdrName: 'Mariana', playbook, customPrompt: null });
      expect(prompt).toContain('nunca o produto que voce vende');
    }
  });
});

describe('historico do cartao de demonstracao lido pela IA', () => {
  it('o registro do cartao nao devolve numero de telefone como turno da SDR', () => {
    const rendered = aiHistoryText(contactMessage());

    expect(rendered).not.toContain(DEMO_PHONE);
    expect(rendered).toContain('cartao de contato de demonstracao');
  });

  it('o fallback wa.me tambem nao volta como link escrito pela SDR', () => {
    const rendered = aiHistoryText(contactMessage({ text: `Segue o contato pra você chamar: wa.me/${DEMO_PHONE}` }));

    expect(rendered).not.toContain('wa.me');
  });

  it('mensagem normal continua chegando como esta, e audio cai na transcricao', () => {
    expect(aiHistoryText({ messageType: 'conversation', text: 'oi, tudo bem?', transcription: null })).toBe('oi, tudo bem?');
    expect(aiHistoryText({ messageType: 'audioMessage', text: null, transcription: 'quero uma pizza' })).toBe('quero uma pizza');
  });

  it('a proxima chamada da IA nao ve o numero do contato no historico da conversa', async () => {
    const captured: AiChatMessage[][] = [];
    const aiClient: AiClient = {
      async generate(input) {
        captured.push(input.messages);
        return {
          outputText: JSON.stringify({ mensagem_usuario: 'combinado!', nao_responder: false, actions: [] }),
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          promptCacheHitTokens: null,
        };
      },
    };
    const uazapi: UazapiClient = {
      async checkChats() { return ok(); },
      async configureWebhook() { return ok(); },
      async downloadMessage() { return ok(); },
      async getInstanceStatus() { return ok(); },
      async sendContact() { return ok(); },
      async sendPresence() { return ok(); },
      async sendText() { return ok(); },
    };

    const agentRepo = createMemorySdrAgentRepository();
    const created = await agentRepo.create({
      companyId: 'company-1',
      name: 'Mariana',
      displayName: 'Mariana',
      isActive: true,
      uazapiBaseUrl: 'https://fake.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
      openaiApiKeyEncrypted: encryptSecret('sk-fake'),
    });
    const agent: SdrAgent = {
      ...created,
      aiProvider: 'openai',
      demoContactName: 'KyberFood - Pizzaria Demonstracao',
      demoContactPhone: '19997353221',
      responseDelayBaseMs: 0,
      responseDelayPerCharMs: 0,
      responseDelayMaxMs: 0,
    };

    const leadRepo = createMemoryLeadRepository();
    const lead = await leadRepo.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: '5519999999999',
      companyName: 'Pizzaria Teste LTDA',
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
    await conversationRepo.createMessage({
      conversationId: conversation.id,
      leadId: lead.id,
      sdrAgentId: agent.id,
      direction: 'outbound',
      senderType: 'ai',
      whatsappMessageId: null,
      messageType: 'contact',
      text: `Contato enviado: KyberFood - Pizzaria Demonstracao (${DEMO_PHONE})`,
      transcription: null,
      mediaUrl: null,
      rawPayload: null,
      sentByApi: true,
      fromMe: true,
    });

    const service = createAiResponseService({
      aiClient,
      aiRunRepository: createMemoryAiRunRepository(),
      conversationRepository: conversationRepo,
      leadRepository: leadRepo,
      uazapiClient: uazapi,
    });
    await service.respondToInbound({ agent, conversation, lead });

    const history = captured[0]!.filter((message) => message.role !== 'system');
    expect(history).toHaveLength(1);
    expect(history[0]!.content).not.toContain(DEMO_PHONE);
  });
});

function ok(body: unknown = { response: 'ok' }): UazapiResult {
  return { status: 200, ok: true, body };
}
