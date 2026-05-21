import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { createAiResponseService } from '../ai/ai-response-service.js';
import type { createAudioTranscriptionService } from '../audio/audio-transcription-service.js';
import { isAudioMessageType, normalizeUazapiWebhook } from './uazapi-normalizer.js';
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

export function registerUazapiWebhookRoutes(
  app: FastifyInstance,
  sdrAgentRepository: SdrAgentRepository,
  leadRepository: LeadRepository,
  conversationRepository: ConversationRepository,
  webhookEventRepository: WebhookEventRepository,
  aiResponseService: AiResponseService,
  audioTranscriptionService: AudioTranscriptionService,
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

      const normalized = normalizeUazapiWebhook(request.body);
      if (!normalized) throw new Error('Unsupported or invalid webhook payload');
      const whatsappNumber = normalized.whatsappNumber;
      if (!whatsappNumber) throw new Error('Webhook without valid WhatsApp number');

      let lead = await leadRepository.findBySdrAndWhatsapp(agent.id, whatsappNumber);
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

      let conversation = await conversationRepository.findBySdrAndWhatsapp(agent.id, whatsappNumber);
      const now = new Date();
      if (!conversation) {
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
        await leadRepository.markInboundReceived(lead.id, now);
        await aiResponseService.respondToInbound({ agent, conversation, lead });
      } else if (!normalized.sentByApi) {
        await leadRepository.markHumanPaused(lead.id, now, humanPausedUntil(now, agent.humanPauseHours), 'manual_whatsapp_message');
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
