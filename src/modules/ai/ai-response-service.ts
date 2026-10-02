import { env } from '../../config/env.js';
import type { Conversation, Lead, Message, SdrAgent } from '../../db/schema.js';
import { speakableText, voiceConfigOf, wantsAudioReply } from '../audio/audio-reply.js';
import type { TextToSpeechClient } from '../audio/text-to-speech-client.js';
import { aiHistoryText } from '../conversations/conversation-history.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import { isAiPaused } from '../leads/ai-pause.js';
import {
  contactDisplayName,
  leadStartedTheConversation,
  ownerPersonName,
  tradeBusinessName,
} from '../leads/lead-display-name.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { whatsappDestination } from '../phone/whatsapp-number.js';
import { decryptSecret } from '../security/secrets.js';
import { describeNowInTimeZone } from '../timezone.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { AiChatMessage, AiClient } from './ai-client.js';
import { resolveReasoningEffort } from './reasoning-effort.js';
import type { AiRunRepository } from './ai-run-repository.js';
import { parseAiResponse, type ParsedAiResponse } from './ai-response.js';
import { resolveAiApiKey } from './resolve-api-key.js';
import { buildResponseParts, waitBeforeSending } from './response-buffer.js';
import { buildSdrSystemPrompt } from './sdr-base-prompt.js';

/** Resolve o nivel salvo para a escala do provider deste SDR; `null` omite o parametro. */
function reasoningEffortOf(agent: Pick<SdrAgent, 'aiProvider' | 'aiReasoningEffort'>): string | null {
  return resolveReasoningEffort(agent.aiProvider, agent.aiReasoningEffort);
}


interface AiResponseDependencies {
  aiClient: AiClient;
  aiRunRepository: AiRunRepository;
  conversationRepository: ConversationRepository;
  /** Onde o aviso de handoff deixa rastro (enviado ou nao). Sem ele, a falha so vai para o log do processo. */
  jobLogRepository?: JobLogRepository;
  leadRepository: LeadRepository;
  textToSpeechClient: TextToSpeechClient;
  uazapiClient: UazapiClient;
}

interface RespondInput {
  agent: SdrAgent;
  conversation: Conversation;
  lead: Lead;
}

type AiAction = ParsedAiResponse['actions'][number];

function uazapiCredentials(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

function systemPrompt(agent: SdrAgent, lead: Lead, replyAsAudio: boolean): string {
  return buildSdrSystemPrompt({
    customPrompt: agent.prompt,
    conversationStage: lead.conversationStage,
    demoContactName: agent.demoContactName,
    handoffName: agent.handoffName,
    leadInitiated: leadStartedTheConversation(lead),
    localTime: describeNowInTimeZone(new Date(), agent.timezone),
    leadName: tradeBusinessName(lead) || null,
    leadSegment: lead.segment,
    leadWhatsapp: lead.whatsappNumber,
    offerDescription: agent.offerDescription,
    ownerName: ownerPersonName(lead) || contactDisplayName(lead),
    playbook: agent.playbook,
    productName: agent.productName,
    replyAsAudio,
    sdrName: agent.displayName,
  });
}

function actionType(action: AiAction): string {
  return typeof action === 'string' ? action : action.type;
}

function actionString(action: AiAction, key: string): string | null {
  if (typeof action === 'string') return null;
  const value = action[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasNotifyHandoff(parsed: ParsedAiResponse): boolean {
  return parsed.actions.some((action) => actionType(action) === 'notify_handoff');
}

function handoffSummary(parsed: ParsedAiResponse, lead: Lead, history: AiChatMessage[]): string {
  for (const action of parsed.actions) {
    if (actionType(action) === 'notify_handoff') {
      const summary = actionString(action, 'summary');
      if (summary) return summary;
    }
  }

  if (parsed.mensagem_usuario.trim()) return parsed.mensagem_usuario.trim();

  const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')?.content ?? 'Sem ultima mensagem registrada.';
  return `Lead ${lead.companyName} (${lead.whatsappNumber}) precisa de atendimento humano. Ultima mensagem: ${lastUserMessage}`;
}

/**
 * O cadastro da Receita traz "62.701.245 FULANA DE TAL" em companyName, e o humano que recebe
 * o aviso no WhatsApp nao precisa do documento colado no nome.
 */
function cleanLeadName(lead: Lead): string {
  return tradeBusinessName(lead) || ownerPersonName(lead) || lead.companyName;
}

/**
 * Contato que o lead oferece (o amigo dono de outra casa, o antigo socio) e lead novo de graca:
 * a IA registra com notify_referral e o time recebe os dados aqui. Diferente do handoff, a
 * conversa atual NAO vira transferida — quem indicou continua sendo quem e para o funil.
 */
function referralSummary(parsed: ParsedAiResponse, history: AiChatMessage[]): string | null {
  for (const action of parsed.actions) {
    if (actionType(action) === 'notify_referral') {
      const summary = actionString(action, 'summary');
      if (summary) return summary;
    }
  }

  // Sem resumo da IA os dados ainda estao na ultima mensagem do lead: melhor mandar cru do que perder.
  const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')?.content?.trim();
  return lastUserMessage ? `(sem resumo da IA) ultima mensagem do lead: ${lastUserMessage}` : null;
}

async function notifyReferral(
  deps: AiResponseDependencies,
  agent: SdrAgent,
  lead: Lead,
  credentials: { baseUrl: string; token: string },
  summary: string,
): Promise<void> {
  if (!agent.handoffPhone) return;

  const text = [
    `Indicacao recebida pela ${agent.displayName}.`,
    `Quem indicou: ${cleanLeadName(lead)} (${lead.whatsappNumber})`,
    `Contato indicado: ${summary}`,
  ].join('\n');

  const result = await deps.uazapiClient.sendText({
    ...credentials,
    number: whatsappDestination(agent.handoffPhone),
    text,
    readchat: true,
    trackSource: 'sdr-portal-referral',
    trackId: `referral-${lead.id}`,
  });
  if (!result.ok) throw new Error(`UAZAPI returned HTTP ${result.status}`);
}

/** Tela do lead no portal, onde se marca o desfecho. `null` sem `APP_URL` configurada. */
function leadUrl(lead: Lead): string | null {
  return env.APP_URL ? `${env.APP_URL.replace(/\/+$/, '')}/leads/${lead.id}` : null;
}

function interpolateHandoffTemplate(template: string, agent: SdrAgent, lead: Lead, summary: string): string {
  const cleanName = cleanLeadName(lead);
  const replacements: Record<string, string> = {
    companyName: cleanName,
    company_name: cleanName,
    rawCompanyName: lead.companyName,
    tradeName: tradeBusinessName(lead),
    ownerName: ownerPersonName(lead),
    contactName: contactDisplayName(lead),
    segment: lead.segment ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    handoffName: agent.handoffName ?? '',
    leadUrl: leadUrl(lead) ?? '',
    leadWhatsapp: lead.whatsappNumber,
    productName: agent.productName ?? '',
    sdrName: agent.displayName,
    summary,
    whatsappNumber: lead.whatsappNumber,
  };

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? '');
}

async function notifyHandoff(
  deps: AiResponseDependencies,
  agent: SdrAgent,
  lead: Lead,
  credentials: { baseUrl: string; token: string },
  summary: string,
): Promise<void> {
  if (!agent.handoffPhone) return;

  const defaultMessage = `Novo handoff solicitado.\nLead: ${lead.companyName}\nWhatsApp: ${lead.whatsappNumber}\nResumo: ${summary}`;
  const body = agent.handoffMessageTemplate
    ? interpolateHandoffTemplate(agent.handoffMessageTemplate, agent, lead, summary).trim()
    : defaultMessage;
  // Quem recebe o aviso e quem sabe o que aconteceu depois: o link leva direto para marcar
  // reuniao, teste, cliente ou perdido. Vai ate no texto proprio do SDR, a nao ser que ele ja
  // traga o link pelo {{leadUrl}}.
  const url = leadUrl(lead);
  const text = url && !body.includes(url) ? `${body}\n\nDepois, marque o que aconteceu: ${url}` : body;

  const result = await deps.uazapiClient.sendText({
    ...credentials,
    number: whatsappDestination(agent.handoffPhone),
    text,
    readchat: true,
    trackSource: 'sdr-portal-handoff',
    trackId: `handoff-${lead.id}`,
  });
  if (!result.ok) throw new Error(`UAZAPI returned HTTP ${result.status}`);
}

export const HANDOFF_NOTICE_JOB = 'handoff-notify';
const HANDOFF_NOTICE_ATTEMPTS = 3;
const HANDOFF_NOTICE_RETRY_MS = 5000;

/**
 * Leva o aviso de handoff ate quem vai atender. Quando isto roda o lead ja leu "vou pedir pro X
 * te chamar", entao o aviso e o unico resultado que o portal registra: tenta de novo antes de
 * desistir e, ate quando desiste, deixa uma linha no /job-logs com o resumo da conversa.
 *
 * Ate 02/10 o aviso saia antes de marcar o lead, e qualquer recusa da UAZAPI estourava ali: o
 * lead nao virava `transferred`, nada tentava de novo e a falha so aparecia como erro de IA no
 * /ai-runs. Com o WhatsApp de handoff em branco era pior — nao saia nada e nada dizia isso.
 */
async function deliverHandoffNotice(
  deps: AiResponseDependencies,
  input: RespondInput,
  credentials: { baseUrl: string; token: string },
  summary: string,
): Promise<void> {
  const startedAt = new Date();
  let attempts = 0;
  let error: string | null = 'SDR sem WhatsApp de handoff cadastrado: o aviso nao tem para quem ir';

  if (input.agent.handoffPhone?.trim()) {
    error = null;
    while (attempts < HANDOFF_NOTICE_ATTEMPTS) {
      attempts += 1;
      try {
        await notifyHandoff(deps, input.agent, input.lead, credentials, summary);
        error = null;
        break;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Erro desconhecido ao avisar o handoff';
        if (attempts < HANDOFF_NOTICE_ATTEMPTS) await waitBeforeSending(HANDOFF_NOTICE_RETRY_MS);
      }
    }
  }

  await deps.jobLogRepository?.create({
    jobName: HANDOFF_NOTICE_JOB,
    jobKey: `handoff-${input.lead.id}`,
    sdrAgentId: input.agent.id,
    leadId: input.lead.id,
    status: error ? 'failed' : 'completed',
    attempt: Math.max(attempts, 1),
    payload: JSON.stringify({ leadWhatsapp: input.lead.whatsappNumber, summary }),
    result: error ? null : JSON.stringify({ notified: input.agent.handoffPhone }),
    error,
    startedAt,
    finishedAt: new Date(),
  });
}

/**
 * Envia o cartao de contato configurado no SDR como mensagem separada, logo depois
 * da resposta da IA. Se a UAZAPI recusar o cartao, cai para o link wa.me em texto
 * para o lead nao ficar sem o proximo passo.
 */
async function sendDemoContact(
  deps: AiResponseDependencies,
  input: RespondInput,
  credentials: { baseUrl: string; token: string },
): Promise<void> {
  const { agent, conversation, lead } = input;
  const fullName = agent.demoContactName?.trim();
  const phone = agent.demoContactPhone ? whatsappDestination(agent.demoContactPhone) : '';
  if (!fullName || !phone) return;

  const alreadySent = (await deps.conversationRepository.listMessages(conversation.id)).some(
    (message) => message.messageType === 'contact' && message.direction === 'outbound',
  );
  if (alreadySent) return;

  const result = await deps.uazapiClient.sendContact({
    ...credentials,
    number: lead.whatsappNumber,
    fullName,
    phoneNumber: phone,
    readchat: true,
    trackSource: 'sdr-portal-demo-contact',
    trackId: `demo-contact-${lead.id}`,
  });

  if (result.ok) {
    await deps.conversationRepository.createMessage({
      conversationId: conversation.id,
      leadId: lead.id,
      sdrAgentId: agent.id,
      direction: 'outbound',
      senderType: 'ai',
      whatsappMessageId: null,
      messageType: 'contact',
      text: `Contato enviado: ${fullName} (${phone})`,
      transcription: null,
      mediaUrl: null,
      rawPayload: JSON.stringify(result.body),
      sentByApi: true,
      fromMe: true,
    });
    await deps.conversationRepository.touch(conversation.id, new Date());
    return;
  }

  const fallbackText = `Segue o contato pra você chamar: wa.me/${phone}`;
  const fallback = await deps.uazapiClient.sendText({
    ...credentials,
    number: lead.whatsappNumber,
    text: fallbackText,
    readchat: true,
    trackSource: 'sdr-portal-demo-contact-fallback',
    trackId: `demo-contact-link-${lead.id}`,
  });
  if (!fallback.ok) throw new Error(`UAZAPI returned HTTP ${result.status} on contact and ${fallback.status} on fallback link`);

  await deps.conversationRepository.createMessage({
    conversationId: conversation.id,
    leadId: lead.id,
    sdrAgentId: agent.id,
    direction: 'outbound',
    senderType: 'ai',
    whatsappMessageId: null,
    messageType: 'contact',
    text: fallbackText,
    transcription: null,
    mediaUrl: null,
    rawPayload: JSON.stringify(fallback.body),
    sentByApi: true,
    fromMe: true,
  });
  await deps.conversationRepository.touch(conversation.id, new Date());
}

async function sendTextReply(
  deps: AiResponseDependencies,
  input: RespondInput,
  credentials: { baseUrl: string; token: string },
  message: string,
): Promise<void> {
  const parts = buildResponseParts(message, {
    baseDelayMs: input.agent.responseDelayBaseMs,
    maxDelayMs: input.agent.responseDelayMaxMs,
    maxPartChars: input.agent.messageSplitMaxChars,
    perCharDelayMs: input.agent.responseDelayPerCharMs,
  });

  for (const [index, part] of parts.entries()) {
    await deps.uazapiClient.sendPresence({
      ...credentials,
      number: input.lead.whatsappNumber,
      presence: 'composing',
      delay: part.delayMs,
    });
    await waitBeforeSending(part.delayMs);
    const sendResult = await deps.uazapiClient.sendText({
      ...credentials,
      number: input.lead.whatsappNumber,
      text: part.text,
      readchat: true,
      trackSource: 'sdr-portal-ai',
      trackId: `ai-${input.conversation.id}-${index + 1}`,
    });
    if (!sendResult.ok) throw new Error(`UAZAPI returned HTTP ${sendResult.status}`);
    await deps.conversationRepository.createMessage({
      conversationId: input.conversation.id,
      leadId: input.lead.id,
      sdrAgentId: input.agent.id,
      direction: 'outbound',
      senderType: 'ai',
      whatsappMessageId: null,
      messageType: 'conversation',
      text: part.text,
      transcription: null,
      mediaUrl: null,
      rawPayload: JSON.stringify(sendResult.body),
      sentByApi: true,
      fromMe: true,
    });
    await deps.conversationRepository.touch(input.conversation.id, new Date());
  }
}

/**
 * Fala a resposta com a voz do SDR e manda como audio de voz. Devolve `false` quando nao deu
 * (ElevenLabs sem credito, conta bloqueada, UAZAPI recusou o arquivo): quem chama manda a
 * mesma resposta em texto, porque lead esperando resposta vale mais do que o formato.
 * Cada tentativa fica no /ai-runs como `audio_generation`, com o motivo quando falha.
 */
async function sendAudioReply(
  deps: AiResponseDependencies,
  input: RespondInput,
  credentials: { baseUrl: string; token: string },
  text: string,
): Promise<boolean> {
  const voice = voiceConfigOf(input.agent);
  if (!voice) return false;

  const startedAt = Date.now();
  const logRun = (outputText: string | null, error: string | null) =>
    deps.aiRunRepository.create({
      sdrAgentId: input.agent.id,
      leadId: input.lead.id,
      conversationId: input.conversation.id,
      provider: 'elevenlabs',
      model: voice.model,
      purpose: 'audio_generation',
      inputMessages: JSON.stringify({ voiceId: voice.voiceId, text }),
      outputText,
      parsedJson: null,
      error,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptCacheHitTokens: null,
      latencyMs: Date.now() - startedAt,
    });

  let sendResult: Awaited<ReturnType<UazapiClient['sendMedia']>>;
  let audioBytes: number;
  try {
    const speech = await deps.textToSpeechClient.synthesize({ ...voice, text });
    audioBytes = speech.audio.length;
    // Mesmo calculo do delay de digitacao, com "gravando audio..." no lugar de "digitando...".
    const delayMs = Math.min(
      input.agent.responseDelayMaxMs,
      input.agent.responseDelayBaseMs + text.length * input.agent.responseDelayPerCharMs,
    );
    await deps.uazapiClient.sendPresence({
      ...credentials,
      number: input.lead.whatsappNumber,
      presence: 'recording',
      delay: delayMs,
    });
    await waitBeforeSending(delayMs);
    sendResult = await deps.uazapiClient.sendMedia({
      ...credentials,
      number: input.lead.whatsappNumber,
      type: 'ptt',
      file: `data:${speech.mimeType};base64,${speech.audio.toString('base64')}`,
      mimetype: speech.mimeType,
      readchat: true,
      trackSource: 'sdr-portal-ai-audio',
      trackId: `ai-audio-${input.conversation.id}`,
    });
    if (!sendResult.ok) throw new Error(`UAZAPI recusou o audio: HTTP ${sendResult.status} ${JSON.stringify(sendResult.body)}`);
  } catch (error) {
    await logRun(null, error instanceof Error ? error.message : 'Erro desconhecido ao gerar o audio');
    return false;
  }

  // Daqui para baixo o audio ja chegou ao lead: um erro aqui nao pode virar fallback em
  // texto, senao o lead recebe a mesma resposta duas vezes.
  await logRun(`audio enviado: ${text.length} caracteres, ${audioBytes} bytes`, null);
  await deps.conversationRepository.createMessage({
    conversationId: input.conversation.id,
    leadId: input.lead.id,
    sdrAgentId: input.agent.id,
    direction: 'outbound',
    senderType: 'ai',
    whatsappMessageId: null,
    messageType: 'ptt',
    // O que foi falado fica como transcricao, igual ao audio que chega do lead: e isso que a
    // tela de conversas mostra e que a IA le no historico da proxima resposta.
    text: null,
    transcription: text,
    mediaUrl: null,
    rawPayload: JSON.stringify(sendResult.body),
    sentByApi: true,
    fromMe: true,
  });
  await deps.conversationRepository.touch(input.conversation.id, new Date());
  return true;
}

const MAX_GENERATE_ATTEMPTS = 3;

/** Texto gravado no /ai-runs quando a resposta pronta e jogada fora por ter ficado velha. */
export const SUPERSEDED_REPLY_ERROR = 'Descartada: o lead mandou mensagem nova enquanto a IA gerava. A proxima resposta cobre as duas.';

/**
 * O lead escreveu de novo (gente, nao automatica) depois do historico que a IA leu? Entao a
 * resposta pronta ja nasceu velha.
 *
 * Mensagem que chega durante a geracao (modelo com raciocinio leva 10-30s) abria uma segunda
 * geracao em paralelo, e o lead recebia duas respostas para a mesma conversa, um minuto uma da
 * outra — "No pico de sexta, quem fica no zap?" seguido de "Nesses dias, quem fica atendendo?"
 * (Serginho Lanches, `docs/analises/mariana-2026-08-28.md`). Descartando a velha, sai so a que
 * leu tudo.
 */
function hasNewerLeadMessage(seen: Message[], latest: Message[]): boolean {
  const seenIds = new Set(seen.map((message) => message.id));
  // So conta mensagem que vai chamar outra geracao: figurinha ou midia sem texto nao chamam, e
  // descartar por causa delas deixaria o lead sem resposta nenhuma.
  return latest.some(
    (message) =>
      !seenIds.has(message.id) &&
      message.direction === 'inbound' &&
      !message.autoReply &&
      Boolean(message.text?.trim() || message.transcription?.trim()),
  );
}

/**
 * Resposta sem texto, sem acao e sem "nao_responder" nao e uma decisao de ficar quieto: e
 * geracao perdida. Ate esta checagem existir, ela passava como resposta valida e o lead
 * ficava falando sozinho.
 */
function isUsableReply(parsed: ParsedAiResponse): boolean {
  return parsed.nao_responder || Boolean(parsed.mensagem_usuario.trim()) || parsed.actions.length > 0;
}

/**
 * O provider (deepseek-v4-pro) as vezes devolve JSON vazio/cortado (gasta o
 * orcamento de tokens em raciocinio antes do conteudo final). Sem retry, isso
 * deixava o lead sem resposta nenhuma. Tenta de novo antes de desistir — inclusive
 * quando o JSON veio bem formado mas sem nada dentro.
 */
async function generateAndParseWithRetry(
  deps: AiResponseDependencies,
  input: {
    apiKey: string;
    maxTokens: number;
    messages: AiChatMessage[];
    model: string;
    provider: string;
    reasoningEffort: string | null;
    temperature: number;
  },
): Promise<{ aiResult: Awaited<ReturnType<AiResponseDependencies['aiClient']['generate']>>; parsed: ParsedAiResponse }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt += 1) {
    try {
      const aiResult = await deps.aiClient.generate(input);
      const parsed = parseAiResponse(aiResult.outputText);
      if (!isUsableReply(parsed) && attempt < MAX_GENERATE_ATTEMPTS) continue;
      return { aiResult, parsed };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeStage(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const allowed = new Set(['permission', 'discovery', 'solution', 'handoff_offer', 'handoff_done', 'not_interested']);
  return allowed.has(normalized) ? normalized : null;
}

async function applyLeadActions(
  deps: AiResponseDependencies,
  parsed: ParsedAiResponse,
  input: RespondInput,
  credentials: { baseUrl: string; token: string },
  history: AiChatMessage[],
): Promise<void> {
  const now = new Date();
  const hasAction = (type: string): boolean => parsed.actions.some((action) => actionType(action) === type);
  const setStageAction = parsed.actions.find((action) => actionType(action) === 'set_stage');
  const requestedStage = normalizeStage(actionString(setStageAction ?? '', 'stage') ?? parsed.stage_sugerido);
  const shouldMarkNotInterested =
    hasAction('mark_not_interested') || parsed.status_sugerido === 'not_interested' || requestedStage === 'not_interested';
  const shouldDisableFollowup = hasAction('disable_followup') || shouldMarkNotInterested;
  const shouldNotifyHandoff = hasNotifyHandoff(parsed) && !input.lead.handoffRequestedAt;

  if (requestedStage && requestedStage !== input.lead.conversationStage) {
    await deps.leadRepository.updateStage(input.lead.id, requestedStage, now);
  }

  if (shouldDisableFollowup) {
    await deps.leadRepository.disableFollowup(input.lead.id, now);
  }

  if (shouldMarkNotInterested) {
    await deps.leadRepository.markNotInterested(input.lead.id, now);
  }

  if (shouldNotifyHandoff) {
    const summary = handoffSummary(parsed, input.lead, history);
    // Marca primeiro: o lead ja ouviu que alguem vai chamar, e isso nao pode depender do aviso sair.
    await deps.leadRepository.markTransferred(input.lead.id, now, summary);
    await deliverHandoffNotice(deps, input, credentials, summary);
  }

  // Por ultimo: aviso externo que nao pode impedir as marcacoes do lead se a UAZAPI falhar.
  if (hasAction('notify_referral')) {
    const referral = referralSummary(parsed, history);
    if (referral) await notifyReferral(deps, input.agent, input.lead, credentials, referral);
  }
}

export function createAiResponseService(deps: AiResponseDependencies) {
  return {
    async respondToInbound(input: RespondInput): Promise<void> {
      if (!input.agent.isActive) return;
      // pausa da conversa: so o botao "Liberar IA" do portal devolve a resposta automatica
      if (isAiPaused(input.lead, new Date())) return;

      const apiKey = resolveAiApiKey(input.agent);
      const credentials = uazapiCredentials(input.agent);
      if (!apiKey || !credentials) return;

      const history = await deps.conversationRepository.listMessages(input.conversation.id);
      const replyAsAudio = wantsAudioReply(input.agent, history);
      const messages: AiChatMessage[] = [
        { role: 'system', content: systemPrompt(input.agent, input.lead, replyAsAudio) },
        ...history.slice(-20).map((message): AiChatMessage => ({
          role: message.direction === 'inbound' ? 'user' : 'assistant',
          content: aiHistoryText(message),
        })),
      ];
      const startedAt = Date.now();

      try {
        const { aiResult, parsed } = await generateAndParseWithRetry(deps, {
          apiKey,
          maxTokens: input.agent.aiMaxOutputTokens,
          messages,
          model: input.agent.aiModel,
          provider: input.agent.aiProvider,
          reasoningEffort: reasoningEffortOf(input.agent),
          temperature: input.agent.aiTemperature,
        });
        const superseded = hasNewerLeadMessage(history, await deps.conversationRepository.listMessages(input.conversation.id));
        await deps.aiRunRepository.create({
          sdrAgentId: input.agent.id,
          leadId: input.lead.id,
          conversationId: input.conversation.id,
          provider: input.agent.aiProvider,
          model: input.agent.aiModel,
          purpose: 'reply_generation',
          inputMessages: JSON.stringify(messages),
          outputText: aiResult.outputText,
          parsedJson: JSON.stringify(parsed),
          error: superseded ? SUPERSEDED_REPLY_ERROR : null,
          promptTokens: aiResult.promptTokens,
          completionTokens: aiResult.completionTokens,
          totalTokens: aiResult.totalTokens,
          promptCacheHitTokens: aiResult.promptCacheHitTokens,
          latencyMs: Date.now() - startedAt,
        });
        // Nada desta geracao vale: nem a mensagem, nem as acoes. A mensagem nova do lead ja
        // chamou outra geracao (webhook -> buffer), e e ela que decide com o historico inteiro.
        if (superseded) return;

        if (parsed.nao_responder || !parsed.mensagem_usuario.trim()) {
          await applyLeadActions(deps, parsed, input, credentials, messages);
          return;
        }

        const spoken = replyAsAudio ? speakableText(parsed.mensagem_usuario) : null;
        const sentAsAudio = spoken ? await sendAudioReply(deps, input, credentials, spoken) : false;
        if (!sentAsAudio) await sendTextReply(deps, input, credentials, parsed.mensagem_usuario);

        if (parsed.actions.some((action) => actionType(action) === 'send_demo_contact')) {
          await sendDemoContact(deps, input, credentials);
        }

        await applyLeadActions(deps, parsed, input, credentials, messages);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown AI response error';
        await deps.aiRunRepository.create({
          sdrAgentId: input.agent.id,
          leadId: input.lead.id,
          conversationId: input.conversation.id,
          provider: input.agent.aiProvider,
          model: input.agent.aiModel,
          purpose: 'reply_generation',
          inputMessages: JSON.stringify(messages),
          outputText: null,
          parsedJson: null,
          error: message,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          promptCacheHitTokens: null,
          latencyMs: Date.now() - startedAt,
        });
      }
    },
  };
}
