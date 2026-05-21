import type { Lead, SdrAgent } from '../../db/schema.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadResearchResult, LeadResearchService } from '../leads/lead-research-service.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';

export interface InitialOutreachResult {
  sent: number;
  skipped: number;
  errors: number;
  details: string[];
}

interface InitialOutreachDependencies {
  jobLogRepository: JobLogRepository;
  leadResearchService: LeadResearchService;
  leadRepository: LeadRepository;
  sdrAgentRepository: SdrAgentRepository;
  uazapiClient: UazapiClient;
}

function nowParts(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return { day: dayMap[weekday] ?? 0, minutes: hour * 60 + minute };
}

function timeToMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function isInsideSendWindow(agent: SdrAgent, now: Date): boolean {
  const days = new Set(agent.sendDaysOfWeek.split(',').map((day) => Number(day.trim())));
  const current = nowParts(now, agent.timezone);
  const start = timeToMinutes(agent.sendWindowStart);
  const end = timeToMinutes(agent.sendWindowEnd);

  if (!days.has(current.day)) {
    return false;
  }

  if (start <= end) {
    return current.minutes >= start && current.minutes <= end;
  }

  return current.minutes >= start || current.minutes <= end;
}

function startOfDayInLocalApprox(now: Date): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function randomCooldownMinutes(agent: SdrAgent): number {
  const min = Math.min(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  const max = Math.max(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function summarizeForMessage(summary: string): string {
  return summary.length > 180 ? `${summary.slice(0, 177).trim()}...` : summary;
}

function interpolate(template: string, agent: SdrAgent, lead: Lead, research: LeadResearchResult | null): string {
  const replacements: Record<string, string> = {
    companyName: lead.companyName,
    company_name: lead.companyName,
    researchSources: research?.sources.join(', ') ?? '',
    researchSummary: research?.summary ?? '',
    segment: lead.segment ?? '',
    whatsappNumber: lead.whatsappNumber,
    sdrName: agent.displayName,
    productName: agent.productName ?? '',
  };

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? '');
}

function buildFirstMessage(agent: SdrAgent, lead: Lead, research: LeadResearchResult | null): string {
  if (agent.firstMessagePrompt) {
    return interpolate(agent.firstMessagePrompt, agent, lead, research).trim();
  }

  const segment = lead.segment ? ` do setor de ${lead.segment}` : '';
  const product = agent.productName ? ` sobre ${agent.productName}` : '';
  if (research?.summary) {
    return `Olá, tudo bem? Aqui é ${agent.displayName}. Vi que ${summarizeForMessage(research.summary)}. Queria entender um pouco melhor a operação da ${lead.companyName}${product}. Posso te fazer uma pergunta rápida?`;
  }

  return `Olá, tudo bem? Aqui é ${agent.displayName}. Estava olhando empresas${segment} e queria entender um pouco melhor a operação da ${lead.companyName}${product}. Posso te fazer uma pergunta rápida?`;
}

function followupDueAt(agent: SdrAgent, sentAt: Date): Date | null {
  if (!agent.followupEnabled) return null;
  return new Date(sentAt.getTime() + agent.followupAfterHours * 60 * 60 * 1000);
}

function getCredentials(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) {
    return null;
  }

  return {
    baseUrl: agent.uazapiBaseUrl,
    token: decryptSecret(agent.uazapiInstanceTokenEncrypted),
  };
}

export function createInitialOutreachService(deps: InitialOutreachDependencies) {
  async function processAgent(agent: SdrAgent, now: Date, details: string[]): Promise<'sent' | 'skipped' | 'error'> {
    const startedAt = new Date();

    if (!agent.isActive) {
      details.push(`${agent.name}: SDR inativo.`);
      return 'skipped';
    }

    if (!isInsideSendWindow(agent, now)) {
      details.push(`${agent.name}: fora da janela de envio.`);
      return 'skipped';
    }

    const sentToday = await deps.leadRepository.countInitialSentForSdrSince(agent.id, startOfDayInLocalApprox(now));
    if (sentToday >= agent.dailyInitialSendLimit) {
      details.push(`${agent.name}: limite diario atingido.`);
      return 'skipped';
    }

    const lastSent = await deps.leadRepository.findLastInitialSentForSdr(agent.id);
    if (lastSent?.firstMessageSentAt) {
      const elapsedMinutes = (now.getTime() - lastSent.firstMessageSentAt.getTime()) / 60000;
      const cooldownMinutes = randomCooldownMinutes(agent);
      if (elapsedMinutes < cooldownMinutes) {
        details.push(`${agent.name}: aguardando cooldown.`);
        return 'skipped';
      }
    }

    const lead = await deps.leadRepository.findNextPendingForSdr(agent.id);
    if (!lead) {
      details.push(`${agent.name}: nenhum lead pendente.`);
      return 'skipped';
    }

    try {
      const credentials = getCredentials(agent);
      if (!credentials) {
        throw new Error('SDR sem URL/token UAZAPI configurado.');
      }

      const research = await deps.leadResearchService.researchLead({ agent, lead });
      const text = buildFirstMessage(agent, lead, research);
      await deps.uazapiClient.sendPresence({ ...credentials, number: lead.whatsappNumber, presence: 'composing', delay: 1000 });
      const result = await deps.uazapiClient.sendText({
        ...credentials,
        number: lead.whatsappNumber,
        text,
        readchat: true,
        trackSource: 'sdr-portal-initial',
        trackId: `initial-${lead.id}`,
      });

      if (!result.ok) {
        throw new Error(`UAZAPI returned HTTP ${result.status}`);
      }

      await deps.leadRepository.markInitialSent(lead.id, now, followupDueAt(agent, now));
      await deps.jobLogRepository.create({
        jobName: 'initial-outreach',
        jobKey: `initial-${lead.id}`,
        sdrAgentId: agent.id,
        leadId: lead.id,
        status: 'completed',
        attempt: 1,
        payload: JSON.stringify({ number: lead.whatsappNumber, text }),
        result: JSON.stringify(result.body),
        error: null,
        startedAt,
        finishedAt: new Date(),
      });
      details.push(`${agent.name}: mensagem enviada para ${lead.companyName}.`);
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      await deps.jobLogRepository.create({
        jobName: 'initial-outreach',
        jobKey: `agent-${agent.id}`,
        sdrAgentId: agent.id,
        leadId: null,
        status: 'failed',
        attempt: 1,
        payload: JSON.stringify({ agentId: agent.id }),
        result: null,
        error: message,
        startedAt,
        finishedAt: new Date(),
      });
      details.push(`${agent.name}: erro ${message}`);
      return 'error';
    }
  }

  return {
    async runOnce(now = new Date()): Promise<InitialOutreachResult> {
      const agents = await deps.sdrAgentRepository.list();
      const result: InitialOutreachResult = { sent: 0, skipped: 0, errors: 0, details: [] };

      for (const agent of agents) {
        const status = await processAgent(agent, now, result.details);
        if (status === 'sent') result.sent += 1;
        if (status === 'skipped') result.skipped += 1;
        if (status === 'error') result.errors += 1;
      }

      return result;
    },
  };
}
