import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../src/app.js';
import type { AiClient, AiGenerateResult } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { isRepeatedBroadcast, isStoreAutoReply, isStoreImage } from '../src/modules/conversations/store-auto-reply.js';
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
      // atendente de IA da propria loja (Pastel do Tuiuiu e La Kasa, 24/09)
      'Desculpe, *não consegui te entender.*',
      'Desculpe, eu não sou capaz de compreender frases muito longas. Você poderia tentar me explicar de forma mais concisa?',
      'Vamos encaminhar sua mensagem ao setor responsável.',
      'Horário de funcionamento: Sexta-feira: das 18h30 às 23h',
      // menu numerado continua robo mesmo terminando em pergunta sobre o nome
      'Seja bem-vindo! Digite 1 para pedidos ou 2 para falar com atendente. Qual o seu nome?',
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
      // saudacao que termina perguntando quem fala: pode ser robo, mas quem espera pode ser gente
      'Olá, ótima tarde! Seja bem-vindo(a) ao Retrô House🧡 Tudo bem? Com quem falo?',
      'Oi, bom dia! Qual o seu nome?',
      // frases de gente que pareciam de robo ate 02/10
      'Obrigado pelo contato, mas não temos interesse',
      'Agradeço o contato, mas não precisamos no momento',
      'vou encaminhar pro meu sócio',
      'Só um momento, estou atendendo',
      'Um momento que vou chamar o dono',
      'Hoje estamos fechados, amanhã pode chamar o responsável',
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

describe('foto da loja', () => {
  const createdAt = new Date('2026-09-24T12:00:00.000Z');
  const pessoa = { autoReply: false, createdAt, direction: 'inbound', text: 'oi, quem fala?', transcription: null };
  const robo = { autoReply: true, createdAt, direction: 'inbound', text: 'Seja bem-vindo! Faca seu pedido', transcription: null };
  const nossa = { autoReply: false, createdAt, direction: 'outbound', text: 'oi, aqui e a Mariana', transcription: null };

  it('foto sem legenda antes de alguem falar e conteudo da loja', () => {
    expect(isStoreImage({ text: null, history: [] })).toBe(true);
    expect(isStoreImage({ text: '', history: [nossa, robo] })).toBe(true);
  });

  it('foto com legenda digitada e de gente', () => {
    expect(isStoreImage({ text: 'olha o meu cardapio', history: [nossa] })).toBe(false);
  });

  it('foto depois de uma pessoa ter falado e de gente', () => {
    expect(isStoreImage({ text: null, history: [nossa, robo, pessoa] })).toBe(false);
  });

  it('audio da pessoa tambem conta como alguem falando', () => {
    expect(isStoreImage({ text: null, history: [{ ...pessoa, text: null, transcription: 'oi tudo bem' }] })).toBe(false);
  });
});

describe('transmissao diaria da loja', () => {
  const now = new Date('2026-09-24T12:44:00.000Z');
  const bomDia = (iso: string) => ({ autoReply: false, createdAt: new Date(iso), direction: 'inbound', text: 'Bom dia', transcription: null });

  it('o mesmo texto em dois outros dias e transmissao', () => {
    const history = [bomDia('2026-09-22T12:48:00.000Z'), bomDia('2026-09-23T12:50:00.000Z')];

    expect(isRepeatedBroadcast({ text: 'Bom dia!! ☀️', now, history })).toBe(true);
  });

  it('no segundo dia ainda e gente', () => {
    expect(isRepeatedBroadcast({ text: 'Bom dia', now, history: [bomDia('2026-09-23T12:50:00.000Z')] })).toBe(false);
  });

  it('repetir no mesmo dia nao conta como dia a mais', () => {
    const history = [bomDia('2026-09-24T12:40:00.000Z'), bomDia('2026-09-23T12:50:00.000Z')];

    expect(isRepeatedBroadcast({ text: 'Bom dia', now, history })).toBe(false);
  });

  it('resposta curta repetida nao vira transmissao', () => {
    const sim = (iso: string) => ({ ...bomDia(iso), text: 'sim' });
    const history = [sim('2026-09-20T12:00:00.000Z'), sim('2026-09-22T12:00:00.000Z')];

    expect(isRepeatedBroadcast({ text: 'sim', now, history })).toBe(false);
  });

  it('o webhook guarda o terceiro bom-dia como automatica, sem IA', async () => {
    const scenario = await buildScenario();
    await scenario.receive('BOM-DIA-1', 'Bom dia');
    await scenario.receive('BOM-DIA-2', 'Bom dia');
    const conversation = (await scenario.conversationRepository.list())[0];
    // Os dois primeiros chegaram em dias anteriores.
    const stored = conversation ? await scenario.conversationRepository.listMessages(conversation.id) : [];
    const inbound = stored.filter((message) => message.direction === 'inbound');
    if (inbound[0]) inbound[0].createdAt = new Date(Date.now() - 2 * 24 * 60 * 60000);
    if (inbound[1]) inbound[1].createdAt = new Date(Date.now() - 24 * 60 * 60000);
    const callsBefore = scenario.aiCalls.length;

    await scenario.receive('BOM-DIA-3', 'Bom dia');

    const last = (await scenario.messages()).filter((message) => message.direction === 'inbound').at(-1);
    expect(last?.autoReply).toBe(true);
    expect(scenario.aiCalls.length).toBe(callsBefore);
  });
});
