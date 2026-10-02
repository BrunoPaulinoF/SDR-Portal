import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AiClient, AiGenerateInput } from '../src/modules/ai/ai-client.js';
import { createMemoryAiRunRepository } from '../src/modules/ai/ai-run-repository.js';
import { createAiResponseService } from '../src/modules/ai/ai-response-service.js';
import { MAX_AUDIO_REPLY_CHARS, speakableText, wantsAudioReply } from '../src/modules/audio/audio-reply.js';
import type { SynthesizeSpeechInput, TextToSpeechClient } from '../src/modules/audio/text-to-speech-client.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryCompanyRepository } from '../src/modules/companies/company-repository.js';
import { createMemoryConversationRepository } from '../src/modules/conversations/conversation-repository.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';
import { decryptSecret, encryptSecret } from '../src/modules/security/secrets.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import type {
  SendMediaInput,
  SendPresenceInput,
  SendTextInput,
  UazapiClient,
  UazapiResult,
} from '../src/modules/uazapi/uazapi-client.js';
import type { Message, SdrAgent } from '../src/db/schema.js';

const okResult = (body: unknown = { response: 'ok' }): UazapiResult => ({ status: 200, ok: true, body });

function fakeUazapiClient(options: { mediaOk?: boolean } = {}) {
  const texts: SendTextInput[] = [];
  const medias: SendMediaInput[] = [];
  const presences: SendPresenceInput[] = [];
  const client: UazapiClient = {
    checkChats: async () => okResult(),
    configureWebhook: async () => okResult(),
    connectInstance: async () => okResult(),
    createInstance: async () => okResult(),
    deleteInstance: async () => okResult(),
    downloadMessage: async () => okResult(),
    getInstanceStatus: async () => okResult(),
    listInstances: async () => okResult(),
    sendContact: async () => okResult(),
    async sendMedia(input) {
      medias.push(input);
      return options.mediaOk === false ? { status: 400, ok: false, body: { error: 'invalid file' } } : okResult({ id: 'audio-1' });
    },
    async sendPresence(input) {
      presences.push(input);
      return okResult();
    },
    async sendText(input) {
      texts.push(input);
      return okResult();
    },
  };
  return { client, medias, presences, texts };
}

function fakeTextToSpeech(options: { fail?: string } = {}) {
  const calls: SynthesizeSpeechInput[] = [];
  const client: TextToSpeechClient = {
    async synthesize(input) {
      calls.push(input);
      if (options.fail) throw new Error(options.fail);
      return { audio: Buffer.from('mp3-falso'), mimeType: 'audio/mpeg' };
    },
  };
  return { calls, client };
}

function fakeAiClient(mensagem: string) {
  const inputs: AiGenerateInput[] = [];
  const client: AiClient = {
    async generate(input) {
      inputs.push(input);
      return {
        outputText: JSON.stringify({ mensagem_usuario: mensagem, nao_responder: false, status_sugerido: 'in_conversation', actions: [] }),
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        promptCacheHitTokens: null,
      };
    },
  };
  return { client, inputs };
}

async function buildScenario(
  options: {
    agent?: Partial<SdrAgent>;
    inboundType?: string;
    mediaOk?: boolean;
    reply?: string;
    ttsFail?: string;
  } = {},
) {
  const agentRepo = createMemorySdrAgentRepository();
  const baseAgent = await agentRepo.create({
    companyId: 'company-1',
    name: 'Mariana',
    displayName: 'Mariana',
    isActive: true,
    aiProvider: 'openai',
    uazapiBaseUrl: 'https://fake.uazapi.com',
    uazapiInstanceTokenEncrypted: encryptSecret('token-uazapi-fake'),
    openaiApiKeyEncrypted: encryptSecret('sk-fake'),
    audioReplyMode: 'when_lead_sends_audio',
    elevenlabsApiKeyEncrypted: encryptSecret('xi-fake'),
    elevenlabsVoiceId: 'voz-mariana',
  });
  const agent: SdrAgent = {
    ...baseAgent,
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
    companyName: 'Pizzaria Teste',
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
    direction: 'inbound',
    senderType: 'lead',
    whatsappMessageId: 'msg-1',
    messageType: options.inboundType ?? 'ptt',
    text: null,
    transcription: 'Oi, me explica melhor como funciona?',
    mediaUrl: null,
    rawPayload: '{}',
    sentByApi: false,
    fromMe: false,
  });

  const uazapi = fakeUazapiClient({ mediaOk: options.mediaOk });
  const tts = fakeTextToSpeech({ fail: options.ttsFail });
  const ai = fakeAiClient(options.reply ?? 'Claro! 😊 E um sistema de pedidos.\n\nQuer que eu te mostre como fica?');
  const aiRuns = createMemoryAiRunRepository();
  const service = createAiResponseService({
    aiClient: ai.client,
    aiRunRepository: aiRuns,
    conversationRepository: conversationRepo,
    leadRepository: leadRepo,
    textToSpeechClient: tts.client,
    uazapiClient: uazapi.client,
  });

  const respond = () => service.respondToInbound({ agent, conversation, lead });
  return { ai, aiRuns, conversation, conversationRepo, respond, tts, uazapi };
}

const message = (direction: 'inbound' | 'outbound', messageType: string, autoReply = false) =>
  ({ direction, messageType, autoReply }) as Pick<Message, 'autoReply' | 'direction' | 'messageType'>;

const audioAgent = {
  audioReplyMode: 'when_lead_sends_audio',
  elevenlabsApiKeyEncrypted: encryptSecret('xi-fake'),
  elevenlabsModel: 'eleven_multilingual_v2',
  elevenlabsVoiceId: 'voz-1',
};

describe('quando responder em audio', () => {
  it('no modo "quando o lead mandar audio", olha o bloco de mensagens depois da nossa ultima', () => {
    expect(wantsAudioReply(audioAgent, [message('outbound', 'conversation'), message('inbound', 'ptt')])).toBe(true);
    // audio seguido de texto no mesmo bloco ainda e o lead falando por audio
    expect(wantsAudioReply(audioAgent, [message('inbound', 'ptt'), message('inbound', 'conversation')])).toBe(true);
    // o audio ja foi respondido; agora ele escreveu
    expect(wantsAudioReply(audioAgent, [message('inbound', 'ptt'), message('outbound', 'conversation'), message('inbound', 'conversation')])).toBe(false);
    // audio de robo da loja nao conta
    expect(wantsAudioReply(audioAgent, [message('inbound', 'ptt', true)])).toBe(false);
  });

  it('desligado, sem voz ou sem chave, nunca responde em audio', () => {
    const history = [message('inbound', 'ptt')];
    expect(wantsAudioReply({ ...audioAgent, audioReplyMode: 'off' }, history)).toBe(false);
    expect(wantsAudioReply({ ...audioAgent, elevenlabsVoiceId: null }, history)).toBe(false);
    expect(wantsAudioReply({ ...audioAgent, elevenlabsApiKeyEncrypted: null }, history)).toBe(false);
  });

  it('no modo "sempre", responde em audio mesmo quando o lead escreveu', () => {
    expect(wantsAudioReply({ ...audioAgent, audioReplyMode: 'always' }, [message('inbound', 'conversation')])).toBe(true);
  });
});

describe('texto falado', () => {
  it('tira emoji e marcacao e junta os paragrafos como frases', () => {
    expect(speakableText('Oi! 😊 Tudo *bem*?\n\nSou a Mariana')).toBe('Oi! Tudo bem? Sou a Mariana.');
  });

  it('link, telefone, e-mail ou texto longo vao escritos', () => {
    expect(speakableText('Da uma olhada: https://kyberfood.com')).toBeNull();
    expect(speakableText('Me chama no (19) 99735-3221')).toBeNull();
    expect(speakableText('Manda pro contato@kyberfood.com')).toBeNull();
    expect(speakableText('a'.repeat(MAX_AUDIO_REPLY_CHARS + 1))).toBeNull();
    expect(speakableText('Custa R$ 1.500,00 por mes')).toBe('Custa R$ 1.500,00 por mes.');
  });
});

describe('resposta da IA em audio', () => {
  it('lead mandou audio: a resposta sai como audio de voz, sem texto', async () => {
    const s = await buildScenario();
    await s.respond();

    expect(s.uazapi.texts).toHaveLength(0);
    expect(s.uazapi.medias).toHaveLength(1);
    expect(s.uazapi.medias[0]).toMatchObject({ number: '5519999999999', type: 'ptt', mimetype: 'audio/mpeg' });
    expect(s.uazapi.medias[0]!.file).toBe(`data:audio/mpeg;base64,${Buffer.from('mp3-falso').toString('base64')}`);
    expect(s.uazapi.presences.map((p) => p.presence)).toEqual(['recording']);
    expect(s.tts.calls[0]).toMatchObject({
      apiKey: 'xi-fake',
      voiceId: 'voz-mariana',
      model: 'eleven_multilingual_v2',
      text: 'Claro! E um sistema de pedidos. Quer que eu te mostre como fica?',
    });

    const saved = (await s.conversationRepo.listMessages(s.conversation.id)).at(-1)!;
    expect(saved).toMatchObject({ direction: 'outbound', messageType: 'ptt', text: null, transcription: s.tts.calls[0]!.text });

    const runs = await s.aiRuns.list();
    expect(runs.find((run) => run.purpose === 'audio_generation')).toMatchObject({ provider: 'elevenlabs', error: null });
  });

  it('avisa a IA que a resposta vai virar audio', async () => {
    const s = await buildScenario();
    await s.respond();
    expect(s.ai.inputs[0]!.messages[0]!.content).toContain('o sistema vai transformar "mensagem_usuario" em AUDIO');

    const texto = await buildScenario({ inboundType: 'conversation' });
    await texto.respond();
    expect(texto.ai.inputs[0]!.messages[0]!.content).not.toContain('AUDIO de voz');
  });

  it('lead escreveu: responde em texto, sem gastar credito da ElevenLabs', async () => {
    const s = await buildScenario({ inboundType: 'conversation' });
    await s.respond();
    expect(s.tts.calls).toHaveLength(0);
    expect(s.uazapi.medias).toHaveLength(0);
    expect(s.uazapi.texts.length).toBeGreaterThan(0);
  });

  it('com o audio desligado, nao chama a ElevenLabs', async () => {
    const s = await buildScenario({ agent: { audioReplyMode: 'off' } });
    await s.respond();
    expect(s.tts.calls).toHaveLength(0);
    expect(s.uazapi.texts.length).toBeGreaterThan(0);
  });

  it('resposta com link vai em texto', async () => {
    const s = await buildScenario({ reply: 'Olha o cardapio de exemplo: https://kyberfood.com/demo' });
    await s.respond();
    expect(s.tts.calls).toHaveLength(0);
    expect(s.uazapi.texts[0]!.text).toContain('https://kyberfood.com/demo');
  });

  it('se a ElevenLabs falhar, manda em texto e registra o motivo', async () => {
    const s = await buildScenario({ ttsFail: 'ElevenLabs HTTP 401 - quota_exceeded' });
    await s.respond();

    expect(s.uazapi.medias).toHaveLength(0);
    expect(s.uazapi.texts.map((t) => t.text).join(' ')).toContain('sistema de pedidos');
    const runs = await s.aiRuns.list();
    expect(runs.find((run) => run.purpose === 'audio_generation')?.error).toContain('quota_exceeded');
  });

  it('se a UAZAPI recusar o audio, manda em texto', async () => {
    const s = await buildScenario({ mediaOk: false });
    await s.respond();

    expect(s.uazapi.medias).toHaveLength(1);
    expect(s.uazapi.texts.length).toBeGreaterThan(0);
    const saved = await s.conversationRepo.listMessages(s.conversation.id);
    expect(saved.filter((m) => m.direction === 'outbound').every((m) => m.messageType === 'conversation')).toBe(true);
  });
});

describe('tela do SDR', () => {
  async function loggedInApp(options: Parameters<typeof buildApp>[0] = {}) {
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const app = buildApp({ authRepository, ...options });
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = login.cookies[0];
    return { app, cookie: `${cookie?.name}=${cookie?.value}` };
  }

  const formBase = {
    name: 'Mariana',
    displayName: 'Mariana',
    aiModel: 'deepseek-v4-pro',
    aiTemperature: '0.4',
    aiMaxOutputTokens: '1500',
    aiReasoningEffort: 'low',
    timezone: 'America/Sao_Paulo',
    sendWindowStart: '08:00',
    sendWindowEnd: '18:00',
    sendDaysOfWeek: '1,2,3,4,5',
    initialCooldownMinMinutes: '10',
    initialCooldownMaxMinutes: '30',
    followupAfterHours: '24',
    followupCooldownMinMinutes: '10',
    followupCooldownMaxMinutes: '30',
    dailyInitialSendLimit: '40',
    dailyFollowupSendLimit: '50',
    responseDelayBaseMs: '1200',
    responseDelayPerCharMs: '35',
    responseDelayMaxMs: '12000',
    messageSplitMaxChars: '450',
  };

  it('liga o audio e guarda a chave criptografada; salvar de novo sem a chave mantem a salva', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const companyRepository = createMemoryCompanyRepository();
    const company = await companyRepository.create({ name: 'KyberFood' });
    const agent = await sdrAgentRepository.create({ companyId: company.id, name: 'Mariana', displayName: 'Mariana' });
    expect(agent.audioReplyMode).toBe('off');

    const { app, cookie } = await loggedInApp({ sdrAgentRepository, companyRepository });
    const edit = await app.inject({ method: 'GET', url: `/sdr-agents/${agent.id}/edit`, headers: { cookie } });
    expect(edit.body).toContain('Resposta em audio (ElevenLabs)');
    expect(edit.body).toContain('send-audio-test');

    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}`,
      headers: { cookie },
      payload: {
        ...formBase,
        companyId: company.id,
        audioReplyMode: 'when_lead_sends_audio',
        elevenlabsVoiceId: 'voz-mariana',
        elevenlabsModel: '',
        elevenlabsApiKeyEncrypted: 'xi-chave',
      },
    });
    const saved = (await sdrAgentRepository.findById(agent.id))!;
    expect(saved).toMatchObject({ audioReplyMode: 'when_lead_sends_audio', elevenlabsVoiceId: 'voz-mariana', elevenlabsModel: 'eleven_multilingual_v2' });
    expect(saved.elevenlabsApiKeyEncrypted).not.toBe('xi-chave');
    expect(decryptSecret(saved.elevenlabsApiKeyEncrypted!)).toBe('xi-chave');

    await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}`,
      headers: { cookie },
      payload: { ...formBase, companyId: company.id, audioReplyMode: 'off', elevenlabsVoiceId: 'voz-mariana', elevenlabsApiKeyEncrypted: '' },
    });
    const again = (await sdrAgentRepository.findById(agent.id))!;
    expect(again.audioReplyMode).toBe('off');
    expect(decryptSecret(again.elevenlabsApiKeyEncrypted!)).toBe('xi-chave');
    await app.close();
  });

  it('o audio teste gera a voz e envia como audio de voz', async () => {
    const sdrAgentRepository = createMemorySdrAgentRepository();
    const agent = await sdrAgentRepository.create({
      companyId: 'company-1',
      name: 'Mariana',
      displayName: 'Mariana',
      uazapiBaseUrl: 'https://fake.uazapi.com',
      uazapiInstanceTokenEncrypted: encryptSecret('token'),
      elevenlabsApiKeyEncrypted: encryptSecret('xi-fake'),
      elevenlabsVoiceId: 'voz-mariana',
    });
    const uazapi = fakeUazapiClient();
    const tts = fakeTextToSpeech();
    const { app, cookie } = await loggedInApp({ sdrAgentRepository, textToSpeechClient: tts.client, uazapiClient: uazapi.client });

    const response = await app.inject({
      method: 'POST',
      url: `/sdr-agents/${agent.id}/uazapi/send-audio-test`,
      headers: { cookie },
      payload: { number: '5519999999999', text: 'Oi, audio de teste.' },
    });

    expect(response.statusCode).toBe(200);
    expect(tts.calls[0]).toMatchObject({ text: 'Oi, audio de teste.', voiceId: 'voz-mariana' });
    expect(uazapi.medias[0]).toMatchObject({ number: '5519999999999', type: 'ptt' });
    await app.close();
  });
});
