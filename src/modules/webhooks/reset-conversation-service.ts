import type { AiClient } from '../ai/ai-client.js';
import type { AiRunRepository } from '../ai/ai-run-repository.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { FirstMessageVariantRepository } from '../first-message-variants/first-message-variant-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadResearchService } from '../leads/lead-research-service.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { whatsappIdentityFromUazapiSendResult, whatsappNumberFromUazapiSendResult } from '../phone/whatsapp-number.js';
import { followupDueAt, resolveFirstMessage } from '../scheduler/initial-outreach.js';
import { decryptSecret } from '../security/secrets.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { Lead, SdrAgent } from '../../db/schema.js';

interface ResetConversationDependencies {
  aiClient: AiClient;
  aiRunRepository: AiRunRepository;
  conversationRepository: ConversationRepository;
  firstMessageVariantRepository: FirstMessageVariantRepository;
  jobLogRepository: JobLogRepository;
  leadResearchService: LeadResearchService;
  leadRepository: LeadRepository;
  uazapiClient: UazapiClient;
}

interface ResetInput {
  agent: SdrAgent;
  previousLead: Lead | null;
  whatsappNumber: string;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function hasLetters(value: string): boolean {
  return /[A-Za-z\u00C0-\u00FF]/.test(value);
}

function resetCompanyName(previousLead: Lead | null, whatsappNumber: string): string {
  const companyName = previousLead?.companyName.trim();
  if (!companyName) return 'Lead sem cadastro';

  const digits = onlyDigits(companyName);
  if ((!hasLetters(companyName) && digits.length >= 8) || digits === onlyDigits(whatsappNumber)) {
    return 'Lead sem cadastro';
  }

  return companyName;
}

/** Status em que o lead ainda pode receber envios automaticos e por isso precisa ser encerrado no reset. */
const ACTIVE_LEAD_STATUSES = new Set(['pending', 'initial_sent', 'in_conversation', 'followup_sent', 'human_paused']);

function uazapiCredentials(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

export function createResetConversationService(deps: ResetConversationDependencies) {
  return {
    async reset(input: ResetInput): Promise<void> {
      const credentials = uazapiCredentials(input.agent);
      if (!credentials) throw new Error('SDR sem URL/token UAZAPI configurado.');

      const now = new Date();
      // A thread antiga fica orfa depois do reset: desarma o follow-up dela antes de criar a nova,
      // senao o agendador ainda dispara uma mensagem nesse mesmo WhatsApp horas depois.
      if (input.previousLead) {
        if (ACTIVE_LEAD_STATUSES.has(input.previousLead.status)) {
          await deps.leadRepository.markDiscarded(input.previousLead.id, now);
        } else {
          await deps.leadRepository.disableFollowup(input.previousLead.id, now);
        }
      }

      const lead = await deps.leadRepository.create({
        companyId: input.agent.companyId,
        sdrAgentId: input.agent.id,
        whatsappNumber: input.whatsappNumber,
        whatsappJid: input.previousLead?.whatsappJid ?? null,
        whatsappLid: input.previousLead?.whatsappLid ?? null,
        cnpj: input.previousLead?.cnpj ?? null,
        companyName: resetCompanyName(input.previousLead, input.whatsappNumber),
        tradeName: input.previousLead?.tradeName ?? null,
        segment: input.previousLead?.segment ?? null,
        city: input.previousLead?.city ?? null,
        state: input.previousLead?.state ?? null,
        contactName: input.previousLead?.contactName ?? null,
        extraData: input.previousLead?.extraData ?? null,
        status: 'pending',
        source: 'reset_command',
      });
      // Em modo teste A/B a mensagem e fixa: nao precisa pesquisar (zero token).
      const research =
        input.agent.firstMessageMode === 'ab_test'
          ? null
          : await deps.leadResearchService.researchLead({ agent: input.agent, lead });
      const { text, variantId } = await resolveFirstMessage(deps, input.agent, lead, research);

      await deps.uazapiClient.sendPresence({ ...credentials, number: lead.whatsappNumber, presence: 'composing', delay: 1000 });
      const result = await deps.uazapiClient.sendText({
        ...credentials,
        number: lead.whatsappNumber,
        text,
        readchat: true,
        trackSource: 'sdr-portal-reset',
        trackId: `reset-${lead.id}`,
      });
      if (!result.ok) throw new Error(`UAZAPI returned HTTP ${result.status}`);

      const sentAt = new Date();
      const identity = whatsappIdentityFromUazapiSendResult(result.body);
      await deps.leadRepository.updateWhatsappIdentity(lead.id, identity, sentAt);
      const conversationWhatsappNumber = whatsappNumberFromUazapiSendResult(result.body, lead.whatsappNumber);
      const conversation = await deps.conversationRepository.create({
        companyId: lead.companyId,
        sdrAgentId: lead.sdrAgentId,
        leadId: lead.id,
        whatsappNumber: conversationWhatsappNumber,
        status: 'open',
        lastMessageAt: sentAt,
      });

      await deps.conversationRepository.createMessage({
        conversationId: conversation.id,
        leadId: lead.id,
        sdrAgentId: input.agent.id,
        direction: 'outbound',
        senderType: 'ai',
        whatsappMessageId: null,
        messageType: 'conversation',
        text,
        transcription: null,
        mediaUrl: null,
        rawPayload: JSON.stringify(result.body),
        sentByApi: true,
        fromMe: true,
      });
      await deps.leadRepository.markInitialSent(lead.id, sentAt, followupDueAt(input.agent, sentAt));
      if (variantId) {
        await deps.leadRepository.setFirstMessageVariant(lead.id, variantId);
      }
      await deps.leadRepository.updateStage(lead.id, 'permission', sentAt);
      await deps.jobLogRepository.create({
        jobName: 'reset-conversation',
        jobKey: `reset-${lead.id}`,
        sdrAgentId: input.agent.id,
        leadId: lead.id,
        status: 'completed',
        attempt: 1,
        payload: JSON.stringify({ number: lead.whatsappNumber, text }),
        result: JSON.stringify(result.body),
        error: null,
        startedAt: now,
        finishedAt: new Date(),
      });
    },
  };
}

export type ResetConversationService = ReturnType<typeof createResetConversationService>;
