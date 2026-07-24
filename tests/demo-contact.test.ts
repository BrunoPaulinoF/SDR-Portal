import { describe, expect, it } from 'vitest';

import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import type { SendContactInput, SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import type { SdrAgent } from '../src/db/schema.js';

const okResult = (body: unknown = { response: 'ok' }): UazapiResult => ({ status: 200, ok: true, body });

function fakeUazapiClient(contactOk = true): UazapiClient & { texts: SendTextInput[]; contacts: SendContactInput[] } {
  const texts: SendTextInput[] = [];
  const contacts: SendContactInput[] = [];
  return {
    texts,
    contacts,
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
    async sendContact(input) {
      contacts.push(input);
      return contactOk ? okResult() : { status: 400, ok: false, body: { error: 'invalid contact' } };
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

function fakeAiClient(outputText: string): AiClient {
  return {
    async generate() {
      return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
    },
  };
}

const replyWithContactAction = JSON.stringify({
  mensagem_usuario: 'Perfeito! Vou te mandar o contato aqui, e so chamar.',
  nao_responder: false,
  status_sugerido: 'in_conversation',
  stage_sugerido: 'solution',
  actions: [{ type: 'send_demo_contact' }],
});

async function buildScenario(options: { contactOk?: boolean; agent?: Partial<SdrAgent>; aiOutput?: string } = {}) {
  const agentRepo = createMemorySdrAgentRepository();
  const baseAgent = await agentRepo.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    uazapiBaseUrl: 'https://fake.uazapi.com',
    // O client UAZAPI e falso, mas o servico so segue em frente com token e chave preenchidos.
    uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
    openaiApiKeyEncrypted: encryptSecret('sk-fake'),
  });
  const agent: SdrAgent = {
    ...baseAgent,
    aiProvider: 'openai',
    demoContactName: 'KyberFood - Pizzaria de teste',
    demoContactPhone: '19997353221',
    responseDelayBaseMs: 0,
    responseDelayPerCharMs: 0,
    responseDelayMaxMs: 0,
    ...options.agent,
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

  const uazapi = fakeUazapiClient(options.contactOk ?? true);
  const service = createAiResponseService({
    aiClient: fakeAiClient(options.aiOutput ?? replyWithContactAction),
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository: conversationRepo,
    leadRepository: leadRepo,
    uazapiClient: uazapi,
  });

  return { agent, conversation, conversationRepo, lead, service, uazapi };
}

describe('contato de demonstracao', () => {
  it('envia o cartao de contato numa mensagem separada, depois da resposta da IA', async () => {
    const s = await buildScenario();
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.texts).toHaveLength(1);
    expect(s.uazapi.texts[0]!.text).toContain('Vou te mandar o contato');
    expect(s.uazapi.contacts).toHaveLength(1);
    expect(s.uazapi.contacts[0]).toMatchObject({
      number: '5519999999999',
      fullName: 'KyberFood - Pizzaria de teste',
      phoneNumber: '5519997353221',
    });

    const messages = await s.conversationRepo.listMessages(s.conversation.id);
    expect(messages.map((m) => m.messageType)).toEqual(['conversation', 'contact']);
  });

  it('nao envia o cartao quando a IA nao pede', async () => {
    const s = await buildScenario({
      aiOutput: JSON.stringify({ mensagem_usuario: 'Oi, tudo bem?', nao_responder: false, actions: [] }),
    });
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.contacts).toHaveLength(0);
  });

  it('ignora a acao quando o SDR nao tem contato de demonstracao configurado', async () => {
    const s = await buildScenario({ agent: { demoContactName: null, demoContactPhone: null } });
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.contacts).toHaveLength(0);
    expect(s.uazapi.texts).toHaveLength(1);
  });

  it('nao repete o cartao se ja enviou nesta conversa', async () => {
    const s = await buildScenario();
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.contacts).toHaveLength(1);
  });

  it('cai para o link wa.me quando a UAZAPI recusa o cartao', async () => {
    const s = await buildScenario({ contactOk: false });
    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.contacts).toHaveLength(1);
    expect(s.uazapi.texts).toHaveLength(2);
    expect(s.uazapi.texts[1]!.text).toBe('Segue o contato pra você chamar: wa.me/5519997353221');
  });
});
