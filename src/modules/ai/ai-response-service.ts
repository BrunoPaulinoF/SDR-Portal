import type { Conversation, Lead, SdrAgent } from '../../db/schema.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { AiChatMessage, AiClient } from './ai-client.js';
import type { AiRunRepository } from './ai-run-repository.js';
import { parseAiResponse, type ParsedAiResponse } from './ai-response.js';
import { resolveAiApiKey } from './resolve-api-key.js';
import { buildResponseParts, waitBeforeSending } from './response-buffer.js';
import { buildSdrSystemPrompt } from './sdr-base-prompt.js';

interface AiResponseDependencies {
  aiClient: AiClient;
  aiRunRepository: AiRunRepository;
  conversationRepository: ConversationRepository;
  leadRepository: LeadRepository;
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

function systemPrompt(agent: SdrAgent, lead: Lead): string {
  return buildSdrSystemPrompt({
    customPrompt: agent.prompt,
    conversationStage: lead.conversationStage,
    leadName: lead.companyName,
    leadSegment: lead.segment,
    leadWhatsapp: lead.whatsappNumber,
    offerDescription: agent.offerDescription,
    productName: agent.productName,
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

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
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

function interpolateHandoffTemplate(template: string, agent: SdrAgent, lead: Lead, summary: string): string {
  const replacements: Record<string, string> = {
    companyName: lead.companyName,
    company_name: lead.companyName,
    handoffName: agent.handoffName ?? '',
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
  const text = agent.handoffMessageTemplate
    ? interpolateHandoffTemplate(agent.handoffMessageTemplate, agent, lead, summary).trim()
    : defaultMessage;

  const result = await deps.uazapiClient.sendText({
    ...credentials,
    number: normalizePhone(agent.handoffPhone),
    text,
    readchat: true,
    trackSource: 'sdr-portal-handoff',
    trackId: `handoff-${lead.id}`,
  });
  if (!result.ok) throw new Error(`UAZAPI returned HTTP ${result.status}`);
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
    await notifyHandoff(deps, input.agent, input.lead, credentials, summary);
    await deps.leadRepository.markTransferred(input.lead.id, now, summary);
  }
}

export function createAiResponseService(deps: AiResponseDependencies) {
  return {
    async respondToInbound(input: RespondInput): Promise<void> {
      if (!input.agent.isActive) return;
      if (input.lead.humanPausedUntil && input.lead.humanPausedUntil > new Date()) return;

      const apiKey = resolveAiApiKey(input.agent);
      const credentials = uazapiCredentials(input.agent);
      if (!apiKey || !credentials) return;

      const history = await deps.conversationRepository.listMessages(input.conversation.id);
      const messages: AiChatMessage[] = [
        { role: 'system', content: systemPrompt(input.agent, input.lead) },
        ...history.slice(-20).map((message): AiChatMessage => ({
          role: message.direction === 'inbound' ? 'user' : 'assistant',
          content: message.text ?? message.transcription ?? '[mensagem sem texto]',
        })),
      ];
      const startedAt = Date.now();

      try {
        const aiResult = await deps.aiClient.generate({
          apiKey,
          maxTokens: input.agent.aiMaxOutputTokens,
          messages,
          model: input.agent.aiModel,
          provider: input.agent.aiProvider,
          temperature: input.agent.aiTemperature,
        });
        const parsed = parseAiResponse(aiResult.outputText);
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
          error: null,
          promptTokens: aiResult.promptTokens,
          completionTokens: aiResult.completionTokens,
          totalTokens: aiResult.totalTokens,
          promptCacheHitTokens: aiResult.promptCacheHitTokens,
          latencyMs: Date.now() - startedAt,
        });

        if (parsed.nao_responder || !parsed.mensagem_usuario.trim()) {
          await applyLeadActions(deps, parsed, input, credentials, messages);
          return;
        }

        const parts = buildResponseParts(parsed.mensagem_usuario, {
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
