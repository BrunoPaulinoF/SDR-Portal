import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { SDR_BASE_PROMPT } from '../src/modules/ai/sdr-base-prompt.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryContactBlockRepository } from '../src/modules/leads/contact-block-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { SendTextInput, UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';

const okResult = (body: unknown = { response: 'ok' }): UazapiResult => ({ status: 200, ok: true, body });

function fakeUazapi(): UazapiClient & { texts: SendTextInput[] } {
  const texts: SendTextInput[] = [];
  const client = {
    texts,
    async sendPresence() {
      return okResult();
    },
    async sendText(input: SendTextInput) {
      texts.push(input);
      return okResult();
    },
  };
  return client as unknown as UazapiClient & { texts: SendTextInput[] };
}

function fixedAi(output: unknown): AiClient {
  return {
    async generate() {
      return { outputText: JSON.stringify(output), promptTokens: 10, completionTokens: 5, totalTokens: 15, promptCacheHitTokens: null };
    },
  };
}

async function respond(output: unknown, inbound: string) {
  const agentRepo = createMemorySdrAgentRepository();
  const base = await agentRepo.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    uazapiBaseUrl: 'https://fake.uazapi.com',
    uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
    openaiApiKeyEncrypted: encryptSecret('sk-fake'),
  });
  const agent: SdrAgent = { ...base, aiProvider: 'openai', responseDelayBaseMs: 0, responseDelayPerCharMs: 0, responseDelayMaxMs: 0 };
  const leadRepository = createMemoryLeadRepository();
  const lead = await leadRepository.create({
    companyId: 'company-1',
    sdrAgentId: agent.id,
    whatsappNumber: '5519999999999',
    companyName: 'Pizzaria Bella',
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
    text: inbound,
  });
  const blocks = createMemoryContactBlockRepository();
  const uazapi = fakeUazapi();
  const service = createAiResponseService({
    aiClient: fixedAi(output),
    aiRunRepository: createMemoryAiRunRepository(),
    contactBlockRepository: blocks,
    conversationRepository,
    leadRepository,
    uazapiClient: uazapi,
  } as unknown as Parameters<typeof createAiResponseService>[0]);

  await service.respondToInbound({ agent, conversation, lead });

  return { blocks, lead: await leadRepository.findById(lead.id), uazapi };
}

describe('opt-out pedido pelo lead', () => {
  it('poe o numero na lista de nao contatar de todos os SDRs e encerra o lead', async () => {
    const { blocks, lead, uazapi } = await respond(
      {
        mensagem_usuario: 'Desculpa o incomodo! Nao te chamo mais.',
        nao_responder: false,
        status_sugerido: 'not_interested',
        stage_sugerido: 'not_interested',
        actions: [{ type: 'opt_out', reason: 'para de me mandar mensagem' }, { type: 'mark_not_interested' }, { type: 'disable_followup' }],
      },
      'para de me mandar mensagem',
    );

    const block = await blocks.findBlocked('5519999999999');
    expect(block?.reason).toBe('para de me mandar mensagem');
    expect(block?.source).toBe('ia:Mariana');
    expect(lead?.status).toBe('not_interested');
    expect(lead?.followupDisabledAt).not.toBeNull();
    expect(uazapi.texts.map((text) => text.text).join(' ')).toContain('Desculpa o incomodo');
  });

  it('opt_out sozinho ja encerra o lead, mesmo sem as outras acoes', async () => {
    const { blocks, lead } = await respond(
      { mensagem_usuario: '', nao_responder: true, status_sugerido: 'in_conversation', actions: ['opt_out'] },
      'tira meu numero da lista',
    );

    expect((await blocks.findBlocked('5519999999999'))?.reason).toBe('pediu para nao receber mais mensagens');
    expect(lead?.status).toBe('not_interested');
  });

  it('recusa comum nao bloqueia o numero', async () => {
    const { blocks, lead } = await respond(
      {
        mensagem_usuario: 'Tranquilo, obrigada!',
        nao_responder: false,
        status_sugerido: 'not_interested',
        stage_sugerido: 'not_interested',
        actions: [{ type: 'mark_not_interested' }, { type: 'disable_followup' }],
      },
      'nao tenho interesse',
    );

    expect(await blocks.findBlocked('5519999999999')).toBeNull();
    expect(lead?.status).toBe('not_interested');
  });

  it('o prompt base separa pedido para sair de recusa comum', () => {
    expect(SDR_BASE_PROMPT).toContain('{"type":"opt_out","reason":"o que ele disse"}');
    expect(SDR_BASE_PROMPT).toContain('"Nao tenho interesse" sozinho NAO e opt_out');
  });
});
