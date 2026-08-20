import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { Conversation, Lead } from '../../db/schema.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { whatsappNumberVariants } from '../phone/whatsapp-number.js';
import { followupDueAt } from '../scheduler/initial-outreach.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { createAiResponseService } from '../ai/ai-response-service.js';
import type { createAudioTranscriptionService } from '../audio/audio-transcription-service.js';
import type { ResetConversationService } from './reset-conversation-service.js';
import { isAudioMessageType, isGroupWebhook, normalizeUazapiWebhook } from './uazapi-normalizer.js';
import type { WebhookEventRepository } from './webhook-event-repository.js';

const paramsSchema = z.object({ sdrAgentId: z.string().uuid() });
type AiResponseService = ReturnType<typeof createAiResponseService>;
type AudioTranscriptionService = ReturnType<typeof createAudioTranscriptionService>;

function headersToJson(headers: Record<string, unknown>): string {
  const safeHeaders: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    safeHeaders[key] = key.toLowerCase().includes('token') || key.toLowerCase().includes('authorization') ? '[redacted]' : value;
  }
  return JSON.stringify(safeHeaders);
}

function humanPausedUntil(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function hasReplyableContent(text: string | null, transcription: string | null): boolean {
  return Boolean(text?.trim() || transcription?.trim());
}

function isResetCommand(text: string | null): boolean {
  return text?.trim().toLowerCase() === '!reset';
}

function leadMatchScore(lead: Lead | null): number {
  if (!lead) return 0;
  let score = 1;
  if (lead.source !== 'inbound_unknown') score += 4;
  if (lead.firstMessageSentAt) score += 4;
  if (lead.status !== 'in_conversation' || lead.source !== 'inbound_unknown') score += 1;
  return score;
}

async function findLeadByWhatsappIdentity(
  leadRepository: LeadRepository,
  sdrAgentId: string,
  identity: { jid?: string | null; lid?: string | null },
): Promise<Lead | null> {
  if (!identity.jid && !identity.lid) return null;
  return leadRepository.findBySdrAndWhatsappIdentity(sdrAgentId, identity);
}

async function findLeadByWhatsappVariants(
  leadRepository: LeadRepository,
  sdrAgentId: string,
  whatsappNumber: string,
): Promise<Lead | null> {
  const matches: Lead[] = [];
  for (const candidate of whatsappNumberVariants(whatsappNumber)) {
    const lead = await leadRepository.findBySdrAndWhatsapp(sdrAgentId, candidate);
    if (lead) matches.push(lead);
  }

  return matches.sort((a, b) => leadMatchScore(b) - leadMatchScore(a) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

async function findConversationByWhatsappVariants(
  conversationRepository: ConversationRepository,
  leadRepository: LeadRepository,
  sdrAgentId: string,
  whatsappNumber: string,
): Promise<{ conversation: Conversation; lead: Lead } | null> {
  const matches: Array<{ conversation: Conversation; lead: Lead }> = [];
  for (const candidate of whatsappNumberVariants(whatsappNumber)) {
    const conversation = await conversationRepository.findBySdrAndWhatsapp(sdrAgentId, candidate);
    const lead = conversation ? await leadRepository.findById(conversation.leadId) : null;
    if (conversation && lead) matches.push({ conversation, lead });
  }

  return matches.sort((a, b) => {
    const scoreDiff = leadMatchScore(b.lead) - leadMatchScore(a.lead);
    return scoreDiff || b.conversation.createdAt.getTime() - a.conversation.createdAt.getTime();
  })[0] ?? null;
}

export function registerUazapiWebhookRoutes(
  app: FastifyInstance,
  sdrAgentRepository: SdrAgentRepository,
  leadRepository: LeadRepository,
  conversationRepository: ConversationRepository,
  webhookEventRepository: WebhookEventRepository,
  aiResponseService: AiResponseService,
  audioTranscriptionService: AudioTranscriptionService,
  resetConversationService: ResetConversationService,
): void {
  app.post('/webhooks/uazapi/:sdrAgentId', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).send({ ok: false });

    if (env.WEBHOOK_SHARED_SECRET && request.query && typeof request.query === 'object') {
      const query = request.query as { secret?: string };
      if (query.secret !== env.WEBHOOK_SHARED_SECRET) {
        return reply.status(401).send({ ok: false });
      }
    }

    const rawBody = JSON.stringify(request.body ?? {});
    const event = await webhookEventRepository.create({
      sdrAgentId: params.data.sdrAgentId,
      rawHeaders: headersToJson(request.headers),
      rawBody,
      processingStatus: 'received',
    });

    try {
      const agent = await sdrAgentRepository.findById(params.data.sdrAgentId);
      if (!agent) throw new Error('SDR not found');

      // Grupo nao e lead: ignorar antes de resolver lead, sem marcar o evento como falha.
      if (isGroupWebhook(request.body)) {
        await webhookEventRepository.updateProcessing(event.id, {
          processingStatus: 'ignored',
          processingError: 'Mensagem de grupo: grupo nao e lead.',
        });
        return reply.send({ ok: true, ignored: 'group' });
      }

      const normalized = normalizeUazapiWebhook(request.body);
      if (!normalized) throw new Error('Unsupported or invalid webhook payload');
      const whatsappNumber = normalized.whatsappNumber;
      if (!whatsappNumber) throw new Error('Webhook without valid WhatsApp number');
      const now = new Date();

      if (!normalized.fromMe && isResetCommand(normalized.text)) {
        const previousLead =
          (await findLeadByWhatsappIdentity(leadRepository, agent.id, {
            jid: normalized.whatsappJid,
            lid: normalized.whatsappLid,
          })) ?? (await findLeadByWhatsappVariants(leadRepository, agent.id, whatsappNumber));
        await resetConversationService.reset({ agent, previousLead, whatsappNumber });
        await webhookEventRepository.updateProcessing(event.id, {
          eventType: normalized.eventType,
          messageType: normalized.messageType,
          instanceId: normalized.instanceId,
          whatsappMessageId: normalized.whatsappMessageId,
          fromNumber: normalized.whatsappNumber,
          toNumber: normalized.toNumber,
          fromMe: normalized.fromMe,
          wasSentByApi: normalized.sentByApi,
          normalizedBody: JSON.stringify({ ...normalized, command: 'reset' }),
          processingStatus: 'processed',
          processingError: null,
        });
        return reply.send({ ok: true, command: 'reset' });
      }

      let lead = await findLeadByWhatsappIdentity(leadRepository, agent.id, {
        jid: normalized.whatsappJid,
        lid: normalized.whatsappLid,
      });
      lead = lead ?? (await findLeadByWhatsappVariants(leadRepository, agent.id, whatsappNumber));
      let conversation = lead ? await conversationRepository.findByLeadId(lead.id) : null;

      const existing = !lead && !conversation
        ? await findConversationByWhatsappVariants(conversationRepository, leadRepository, agent.id, whatsappNumber)
        : null;
      conversation = conversation ?? existing?.conversation ?? null;
      lead = lead ?? existing?.lead ?? null;

      if (!lead) {
        lead = await leadRepository.create({
          companyId: agent.companyId,
          sdrAgentId: agent.id,
          whatsappNumber,
          companyName: whatsappNumber,
          cnpj: null,
          tradeName: null,
          segment: null,
          city: null,
          state: null,
          contactName: null,
          extraData: null,
          status: 'in_conversation',
          source: 'inbound_unknown',
        });
      }

      if (!conversation || conversation.leadId !== lead.id) {
        conversation = await conversationRepository.create({
          companyId: agent.companyId,
          sdrAgentId: agent.id,
          leadId: lead.id,
          whatsappNumber,
          status: 'open',
          lastMessageAt: now,
        });
      }

      const direction = normalized.fromMe ? 'outbound' : 'inbound';
      const senderType = normalized.fromMe ? (normalized.sentByApi ? 'ai' : 'human') : 'lead';
      let transcription = normalized.transcription;
      let mediaUrl = normalized.mediaUrl;

      if (!normalized.fromMe && isAudioMessageType(normalized.messageType) && !transcription) {
        const audio = await audioTranscriptionService.transcribe({ agent, messageId: normalized.whatsappMessageId });
        transcription = audio.transcription;
        mediaUrl = mediaUrl ?? audio.mediaUrl;
      }

      await conversationRepository.createMessage({
        conversationId: conversation.id,
        leadId: lead.id,
        sdrAgentId: agent.id,
        direction,
        senderType,
        whatsappMessageId: normalized.whatsappMessageId,
        messageType: normalized.messageType,
        text: normalized.text,
        transcription,
        mediaUrl,
        rawPayload: JSON.stringify(normalized.rawMessage),
        sentByApi: normalized.sentByApi,
        fromMe: normalized.fromMe,
      });
      await conversationRepository.touch(conversation.id, now);

      if (!normalized.fromMe) {
        await leadRepository.updateWhatsappIdentity(lead.id, { jid: normalized.whatsappJid, lid: normalized.whatsappLid }, now);
        // o follow-up conta a partir desta resposta, nao da primeira mensagem enviada ao lead
        await leadRepository.markInboundReceived(lead.id, now, followupDueAt(agent, now));
        if (hasReplyableContent(normalized.text, transcription)) {
          await aiResponseService.respondToInbound({ agent, conversation, lead });
        }
      } else if (!normalized.sentByApi) {
        await leadRepository.markHumanPaused(lead.id, now, humanPausedUntil(now, agent.humanPauseHours), 'manual_whatsapp_message');
      } else {
        // resposta da IA confirmada pelo gateway: o chat nao esta em silencio
        await leadRepository.markOutboundSent(lead.id, now);
      }

      await webhookEventRepository.updateProcessing(event.id, {
        eventType: normalized.eventType,
        messageType: normalized.messageType,
        instanceId: normalized.instanceId,
        whatsappMessageId: normalized.whatsappMessageId,
        fromNumber: normalized.whatsappNumber,
        toNumber: normalized.toNumber,
        fromMe: normalized.fromMe,
        wasSentByApi: normalized.sentByApi,
        normalizedBody: JSON.stringify({ ...normalized, mediaUrl, transcription }),
        processingStatus: 'processed',
        processingError: null,
      });

      return reply.send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown webhook error';
      await webhookEventRepository.updateProcessing(event.id, { processingStatus: 'failed', processingError: message });
      request.log.error({ error }, 'Failed to process UAZAPI webhook');
      return reply.status(202).send({ ok: false, error: message });
    }
  });
}
