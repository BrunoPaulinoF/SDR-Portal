import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import type { AiChatMessage, AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { buildSdrSystemPrompt } from '../src/modules/ai/sdr-base-prompt.js';
import { SDR_PLAYBOOKS } from '../src/modules/ai/sdr-playbooks.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const HANDOFF_NUMBER = '5511988887777';

const okResult = (body: unknown = { response: 'ok' }): UazapiResult => ({ status: 200, ok: true, body });

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

function fixedAiClient(outputText: string): AiClient & { prompts: AiChatMessage[][] } {
  const prompts: AiChatMessage[][] = [];
  return {
    prompts,
    async generate(input) {
      prompts.push(input.messages);
      return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
    },
  };
}

/** Conversa com um lead que ja disse que saiu do ramo e ofereceu o contato de outra casa. */
async function buildScenario(aiOutput: string, lastInboundText = 'nao trabalho mais com isso, mas tenho o contato de um amigo') {
  const agentRepo = createMemorySdrAgentRepository();
  const baseAgent = await agentRepo.create({
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
    playbook: 'convite',
    handoffName: 'Fernando',
    handoffPhone: '11988887777',
    responseDelayBaseMs: 0,
    responseDelayPerCharMs: 0,
    responseDelayMaxMs: 0,
  };

  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5519999999999',
    companyName: 'Cantina Sao Jorge',
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
    text: lastInboundText,
  });

  const uazapi = fakeUazapiClient();
  const service = createAiResponseService({
    aiClient: fixedAiClient(aiOutput),
    aiRunRepository: createMemoryAiRunRepository(),
    conversationRepository,
    leadRepository,
    uazapiClient: uazapi,
  });

  return { agent, conversation, lead, leadRepository, service, uazapi };
}

function textSentTo(uazapi: { texts: SendTextInput[] }, number: string): string | undefined {
  return uazapi.texts.find((text) => text.number === number)?.text;
}

describe('indicacao e cordialidade no prompt', () => {
  it('valem para qualquer playbook: ficam nas regras fixas, nao no prompt editavel', () => {
    for (const playbook of SDR_PLAYBOOKS) {
      const prompt = buildSdrSystemPrompt({ playbook, sdrName: 'Francielly' });

      expect(prompt).toContain('seco e grosseiro, nunca');
      expect(prompt).toContain('Nunca descarte o que o lead oferece');
      expect(prompt).toContain('Contato oferecido nunca se recusa');
      expect(prompt).toContain('notify_referral');
    }
  });

  it('manda pedir indicacao a quem esta fora do perfil antes de encerrar', () => {
    const prompt = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Francielly' });

    expect(prompt).toContain('Fora do perfil');
    expect(prompt).toContain('pergunta da indicacao');
    // Encerrar sem argumentar continua valendo; encerrar seco, nao.
    expect(prompt).toContain('agradeca o tempo dele e deseje o melhor');
  });

  it('separa indicacao de contato da propria casa, que continua sendo handoff', () => {
    const prompt = buildSdrSystemPrompt({ playbook: 'convite', sdrName: 'Francielly' });

    expect(prompt).toContain('socio, gerente, dono');
    expect(prompt).toContain('e notify_handoff');
  });
});

describe('acao notify_referral', () => {
  const indicacao = JSON.stringify({
    mensagem_usuario: 'Obrigada mesmo! Vou encaminhar para o Fernando, dono da Insumo Smart, ele fala com ele.',
    nao_responder: false,
    status_sugerido: 'not_interested',
    stage_sugerido: 'not_interested',
    actions: [
      { type: 'notify_referral', summary: 'Joao da Pizzaria Bella, Campinas, 19988887777 - indicado pela Cantina Sao Jorge' },
      { type: 'mark_not_interested' },
    ],
  });

  it('avisa o handoff com os dados do contato indicado', async () => {
    const s = await buildScenario(indicacao);

    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    const aviso = textSentTo(s.uazapi, HANDOFF_NUMBER);
    expect(aviso).toContain('Indicacao recebida pela Francielly');
    expect(aviso).toContain('Quem indicou: Cantina Sao Jorge (5519999999999)');
    expect(aviso).toContain('Joao da Pizzaria Bella');
    // O numero indicado vai para o Fernando, nunca de volta para o lead.
    expect(textSentTo(s.uazapi, s.lead.whatsappNumber)).not.toContain('19988887777');
  });

  it('nao transforma quem indicou em lead transferido', async () => {
    const s = await buildScenario(indicacao);

    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    const lead = await s.leadRepository.findById(s.lead.id);
    expect(lead?.status).toBe('not_interested');
    expect(lead?.handoffRequestedAt).toBeNull();
    expect(lead?.followupDisabledAt).not.toBeNull();
  });

  it('sem resumo da IA, manda a ultima mensagem do lead em vez de perder o contato', async () => {
    const semResumo = JSON.stringify({
      mensagem_usuario: 'Obrigada! Ja anotei aqui.',
      nao_responder: false,
      actions: [{ type: 'notify_referral' }],
    });
    const s = await buildScenario(semResumo, 'anota ai: Pizzaria Bella, falar com o Joao, 19988887777');

    await s.service.respondToInbound({ agent: s.agent, conversation: s.conversation, lead: s.lead });

    const aviso = textSentTo(s.uazapi, HANDOFF_NUMBER);
    expect(aviso).toContain('sem resumo da IA');
    expect(aviso).toContain('Pizzaria Bella, falar com o Joao, 19988887777');
  });

  it('sem numero de handoff configurado, nao tenta avisar ninguem', async () => {
    const s = await buildScenario(indicacao);
    const agent: SdrAgent = { ...s.agent, handoffPhone: null };

    await s.service.respondToInbound({ agent, conversation: s.conversation, lead: s.lead });

    expect(s.uazapi.texts.every((text) => text.number !== HANDOFF_NUMBER)).toBe(true);
  });
});
