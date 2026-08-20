import { describe, expect, it } from 'vitest';

import { createInboundResponseBuffer } from '../src/modules/ai/inbound-response-buffer.js';
import { stripEmoji } from '../src/modules/ai/message-text.js';
import { buildResponseParts } from '../src/modules/ai/response-buffer.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

const SPLIT_CONFIG = { baseDelayMs: 0, maxDelayMs: 0, maxPartChars: 450, perCharDelayMs: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('mensagem enviada ao lead', () => {
  it('nunca leva emoji para o WhatsApp', () => {
    expect(stripEmoji('Boa! 😊 Já pedi pro Fernando te chamar 🚀')).toBe('Boa! Já pedi pro Fernando te chamar');
    expect(stripEmoji('Top demais 👍🏽')).toBe('Top demais');
    expect(stripEmoji('Sem emoji aqui.')).toBe('Sem emoji aqui.');
  });

  it('nao transforma o emoji final em uma mensagem separada', () => {
    // A IA fechava a mensagem com uma carinha em paragrafo proprio e o split por
    // paragrafo mandava a carinha sozinha, num balao so dela.
    const parts = buildResponseParts('Sou a Franciely, da Insumo Smart. Pode ser?\n\n😊', SPLIT_CONFIG);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toBe('Sou a Franciely, da Insumo Smart. Pode ser?');
  });

  it('mantem a quebra em partes quando os dois paragrafos tem texto', () => {
    const parts = buildResponseParts('Primeira ideia aqui.\n\nSegunda ideia aqui.', SPLIT_CONFIG);

    expect(parts.map((part) => part.text)).toEqual(['Primeira ideia aqui.', 'Segunda ideia aqui.']);
  });

  it('nao manda pontuacao solta como mensagem', () => {
    const parts = buildResponseParts('Fechou entao.\n\n...', SPLIT_CONFIG);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toBe('Fechou entao. ...');
  });
});

describe('buffer de resposta ao lead', () => {
  it('nao responde duas vezes a mesma conversa em paralelo', async () => {
    const agents = createMemorySdrAgentRepository();
    const agent = await agents.create({
      companyId: 'company-1',
      name: 'Franciely',
      displayName: 'Franciely',
      isActive: true,
    });
    const leads = createMemoryLeadRepository();
    const lead = await leads.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      companyName: 'Mangiare',
      cnpj: null,
      tradeName: null,
      segment: null,
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'in_conversation',
      source: 'manual',
    });
    const conversations = createMemoryConversationRepository();
    const conversation = await conversations.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      leadId: lead.id,
      whatsappNumber: lead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });

    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const buffer = createInboundResponseBuffer({
      aiResponseService: {
        async respondToInbound() {
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          // Gerar + enviar leva bem mais que o debounce: e nessa janela que a segunda
          // mensagem do lead abria uma resposta concorrente e o lead recebia duas.
          await sleep(60);
          active -= 1;
        },
      },
      conversationRepository: conversations,
      delayMs: 10,
      leadRepository: leads,
    });

    await buffer.respondToInbound({ agent, conversation, lead });
    await sleep(30);
    await buffer.respondToInbound({ agent, conversation, lead });
    await sleep(200);
    buffer.close();

    expect(maxActive).toBe(1);
    expect(calls).toBe(2);
  });

  it('agrupa mensagens seguidas do lead numa resposta so', async () => {
    const agents = createMemorySdrAgentRepository();
    const agent = await agents.create({
      companyId: 'company-1',
      name: 'Franciely',
      displayName: 'Franciely',
      isActive: true,
    });
    const leads = createMemoryLeadRepository();
    const lead = await leads.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      whatsappNumber: '5534999969911',
      companyName: 'Mangiare',
      cnpj: null,
      tradeName: null,
      segment: null,
      city: null,
      state: null,
      contactName: null,
      extraData: null,
      status: 'in_conversation',
      source: 'manual',
    });
    const conversations = createMemoryConversationRepository();
    const conversation = await conversations.create({
      companyId: 'company-1',
      sdrAgentId: agent.id,
      leadId: lead.id,
      whatsappNumber: lead.whatsappNumber,
      status: 'open',
      lastMessageAt: new Date(),
    });

    let calls = 0;
    const buffer = createInboundResponseBuffer({
      aiResponseService: {
        async respondToInbound() {
          calls += 1;
        },
      },
      conversationRepository: conversations,
      delayMs: 40,
      leadRepository: leads,
    });

    await buffer.respondToInbound({ agent, conversation, lead });
    await buffer.respondToInbound({ agent, conversation, lead });
    await sleep(150);
    buffer.close();

    expect(calls).toBe(1);
  });
});
