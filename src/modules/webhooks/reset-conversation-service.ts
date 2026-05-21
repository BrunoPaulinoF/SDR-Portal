import type { AiClient } from '../ai/ai-client.js';
import type { AiRunRepository } from '../ai/ai-run-repository.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadResearchService } from '../leads/lead-research-service.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { buildFirstMessage, followupDueAt } from '../scheduler/initial-outreach.js';
import { decryptSecret } from '../security/secrets.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';
import type { Lead, SdrAgent } from '../../db/schema.js';

interface ResetConversationDependencies {
  aiClient: AiClient;
  aiRunRepository: AiRunRepository;
  conversationRepository: ConversationRepository;
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
      const lead = await deps.leadRepository.create({
        companyId: input.agent.companyId,
        sdrAgentId: input.agent.id,
        whatsappNumber: input.whatsappNumber,
        cnpj: input.previousLead?.cnpj ?? null,
        companyName: input.previousLead?.companyName ?? input.whatsappNumber,
        tradeName: input.previousLead?.tradeName ?? null,
        segment: input.previousLead?.segment ?? null,
        city: input.previousLead?.city ?? null,
        state: input.previousLead?.state ?? null,
        contactName: input.previousLead?.contactName ?? null,
        extraData: input.previousLead?.extraData ?? null,
        status: 'pending',
        source: 'reset_command',
      });
      const conversation = await deps.conversationRepository.create({
        companyId: lead.companyId,
        sdrAgentId: lead.sdrAgentId,
        leadId: lead.id,
        whatsappNumber: lead.whatsappNumber,
        status: 'open',
        lastMessageAt: now,
      });

      const research = await deps.leadResearchService.researchLead({ agent: input.agent, lead });
      const text = await buildFirstMessage(deps, input.agent, lead, research);

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
      await deps.conversationRepository.touch(conversation.id, new Date());
      await deps.leadRepository.markInitialSent(lead.id, now, followupDueAt(input.agent, now));
      await deps.leadRepository.updateStage(lead.id, 'permission', now);
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
