import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import type { AiClient, AiGenerateResult } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { isStoreAutoReply } from '../src/modules/conversations/store-auto-reply.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { encryptSecret } from '../src/modules/security/secrets.js';
import type { UazapiClient, UazapiResult } from '../src/modules/uazapi/uazapi-client.js';
import { createMemoryWebhookEventRepository } from '../src/modules/webhooks/webhook-event-repository.js';

let app: AppInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function recordingAiClient(calls: string[], outputText: string): AiClient {
  return {
    async generate(input) {
      calls.push(input.messages.map((message) => message.content).join('\n---\n'));
      return { outputText, promptTokens: 10, completionTokens: 5, totalTokens: 15 } satisfies AiGenerateResult;
    },
  };
}

function recordingUazapiClient(calls: string[]): UazapiClient {
  const ok = (body: unknown): UazapiResult => ({ status: 200, ok: true, body });

  return {
    async checkChats(input) {
      return ok(input.numbers.map((number) => ({ query: number, jid: `${number}@s.whatsapp.net`, isInWhatsapp: true })));
    },
    async configureWebhook() {
      return ok({ response: 'webhook configured' });
    },
    async downloadMessage() {
      return ok({ fileURL: 'https://api.uazapi.com/files/audio.mp3', transcription: 'Texto transcrito do audio' });
    },
    async getInstanceStatus() {
      return ok({ connected: true, loggedIn: true });
    },
    async sendContact() {
      return ok({ response: 'contact sent' });
    },
    async sendPresence() {
      return ok({ response: 'presence sent' });
    },
    async sendText(input) {
      calls.push(`text:${input.number}:${input.text}`);
      return ok({ chatid: `${input.number}@s.whatsapp.net`, response: 'message sent' });
    },
  };
}

/** Uma loja abordada, ja com a primeira mensagem enviada e ainda sem resposta de gente. */
async function buildScenario() {
  const aiCalls: string[] = [];
  const uazapiCalls: string[] = [];
  const companyRepository = createMemoryCompanyRepository();
  const sdrAgentRepository = createMemorySdrAgentRepository();
  const leadRepository = createMemoryLeadRepository();
  const conversationRepository = createMemoryConversationRepository();
  const webhookEventRepository = createMemoryWebhookEventRepository();

  const company = await companyRepository.create({
    name: 'Kybernan',
    legalName: null,
    cnpj: null,
    segment: 'Gastronomia',
    description: null,
    websiteUrl: null,
    defaultHandoffName: null,
    defaultHandoffPhone: null,
  });
  const agent = await sdrAgentRepository.create({
    companyId: company.id,
    name: 'sdr-kyberfood',
    displayName: 'Mariana',
    isActive: true,
    aiProvider: 'openai',
    openaiApiKeyEncrypted: encryptSecret('openai-key'),
    uazapiBaseUrl: 'https://api.uazapi.com',
    uazapiInstanceTokenEncrypted: encryptSecret('instance-token'),
  });
  const lead = await leadRepository.create({
    companyId: company.id,
    sdrAgentId: agent.id,
    whatsappNumber: '5511999999999',
    companyName: 'Pizzaria Florida',
    cnpj: null,
    tradeName: null,
    segment: 'Gastronomia',
    city: null,
    state: null,
    contactName: null,
    extraData: null,
    status: 'initial_sent',
    source: 'manual',
  });

  app = buildApp({
    aiClient: recordingAiClient(
      aiCalls,
      JSON.stringify({ mensagem_usuario: 'Oi! Sou a Mariana, da KyberFood.', nao_responder: false, actions: [] }),
    ),
    aiRunRepository: createMemoryAiRunRepository(),
    companyRepository,
    conversationRepository,
    leadRepository,
    sdrAgentRepository,
    uazapiClient: recordingUazapiClient(uazapiCalls),
    webhookEventRepository,
  });

  const receive = async (id: string, text: string): Promise<void> => {
    await app?.inject({
      method: 'POST',
      url: `/webhooks/uazapi/${agent.id}`,
      payload: {
        event: 'messages',
        data: { id, from: '5511999999999@s.whatsapp.net', fromMe: false, type: 'conversation', text },
      },
    });
  };

  const messages = async () => {
    const conversations = await conversationRepository.list();
    return conversations[0] ? conversationRepository.listMessages(conversations[0].id) : [];
  };

  return { aiCalls, conversationRepository, lead, leadRepository, messages, receive, uazapiCalls };
}

describe('resposta automatica da loja', () => {
  it('reconhece o autoatendimento da loja e nao confunde com gente', () => {
    const auto = [
      'Boa noite! Seja bem-vindo(a) a Pizzaria Florida! Faça o seu pedido pelo nosso cardápio: http://pizzaria-florida.pedindo.app',
      'Agradecemos sua mensagem. Nosso atendimento do whatsapp é das 9:00 as 17:00.',
      'Olá, Mariana! Tudo bem? 😊 Sou a atendente virtual do Kammy Sushi.',
      'Opção inválida. Digite um número do menu.',
      'Vou transferir você para o nosso atendente! Só um momentinho 😊',
      'Horário de funcionamento: Sexta-feira: das 18h30 às 23h',
    ];
    for (const text of auto) {
      expect(isStoreAutoReply({ messageType: 'conversation', text, transcription: null }), text).toBe(true);
    }

    // Na duvida e gente: ficar calado com uma pessoa esperando e o pior erro possivel aqui.
    const gente = [
      'Hambúrgueria fenster boa noite🍔',
      'Boa noite no momento não',
      'Vou t passar o número do responsável',
      'Hoje já trabalhamos com a Saipos e Glutoes',
      'O responsável está viajando, retorna quinta feira',
      'Como funciona a atendente de IA ?',
      'Estamos abertos.',
      'Sim',
    ];
    for (const text of gente) {
      expect(isStoreAutoReply({ messageType: 'conversation', text, transcription: null }), text).toBe(false);
    }
  });

  it('nunca trata audio como automatico', () => {
    expect(
      isStoreAutoReply({
        messageType: 'audioMessage',
        text: null,
        transcription: 'oi, é sobre o quê? faça seu pedido pelo cardápio',
      }),
    ).toBe(false);
  });

  it('guarda a automatica da loja sem chamar a IA e sem mover o lead no funil', async () => {
    const scenario = await buildScenario();

    await scenario.receive(
      'AUTO-1',
      'Boa noite! Seja bem-vindo(a) a Pizzaria Florida! Faça o seu pedido pelo nosso cardápio: http://pizzaria-florida.pedindo.app',
    );

    const messages = await scenario.messages();
    const lead = await scenario.leadRepository.findById(scenario.lead.id);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.autoReply).toBe(true);
    // nenhuma resposta gerada nem enviada: o segundo toque e do follow-up, no dia seguinte
    expect(scenario.aiCalls).toHaveLength(0);
    expect(scenario.uazapiCalls).toHaveLength(0);
    // o robo da loja nao promove o lead nem reancora o follow-up
    expect(lead?.status).toBe('initial_sent');
    expect(lead?.lastInboundAt).toBeNull();
  });

  it('responde quando a pessoa assume o WhatsApp depois das automaticas', async () => {
    const scenario = await buildScenario();

    await scenario.receive('AUTO-1', 'Olá! Confira nosso cardápio digital: https://app.anota.ai/m/abc');
    await scenario.receive('AUTO-2', 'Estamos fechados agora. Horário de atendimento: 18h às 23h.');
    await scenario.receive('GENTE-1', 'oi, boa noite, sobre o que seria?');

    const messages = await scenario.messages();
    const lead = await scenario.leadRepository.findById(scenario.lead.id);

    // uma unica chamada de IA na conversa inteira: a da mensagem de gente
    expect(scenario.aiCalls).toHaveLength(1);
    expect(scenario.uazapiCalls).toContain('text:5511999999999:Oi! Sou a Mariana, da KyberFood.');
    expect(lead?.status).toBe('in_conversation');
    expect(lead?.lastInboundAt).toBeInstanceOf(Date);
    expect(messages.filter((message) => message.autoReply)).toHaveLength(2);
    // a IA ve as automaticas no historico, mas etiquetadas como cenario e nao como fala do lead
    expect(scenario.aiCalls[0]).toContain('[resposta automatica da loja, nao e a pessoa]');
    expect(scenario.aiCalls[0]).toContain('oi, boa noite, sobre o que seria?');
  });
});
