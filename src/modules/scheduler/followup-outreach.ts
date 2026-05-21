import type { Lead, SdrAgent } from '../../db/schema.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import { decryptSecret } from '../security/secrets.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';

export interface FollowupOutreachResult {
  sent: number;
  skipped: number;
  errors: number;
  details: string[];
}

interface FollowupOutreachDependencies {
  jobLogRepository: JobLogRepository;
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

  if (!days.has(current.day)) return false;
  if (start <= end) return current.minutes >= start && current.minutes <= end;
  return current.minutes >= start || current.minutes <= end;
}

function startOfDayInLocalApprox(now: Date): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function randomCooldownMinutes(agent: SdrAgent): number {
  const min = Math.min(agent.followupCooldownMinMinutes, agent.followupCooldownMaxMinutes);
  const max = Math.max(agent.followupCooldownMinMinutes, agent.followupCooldownMaxMinutes);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function interpolate(template: string, agent: SdrAgent, lead: Lead): string {
  const replacements: Record<string, string> = {
    companyName: lead.companyName,
    company_name: lead.companyName,
    segment: lead.segment ?? '',
    whatsappNumber: lead.whatsappNumber,
    sdrName: agent.displayName,
    productName: agent.productName ?? '',
  };

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? '');
}

function buildFollowupMessage(agent: SdrAgent, lead: Lead): string {
  if (agent.followupPrompt) return interpolate(agent.followupPrompt, agent, lead).trim();

  const product = agent.productName ? ` sobre ${agent.productName}` : '';
  return `Oi, passando rapidinho para retomar minha mensagem anterior${product}. Faz sentido eu te explicar em 1 minuto?`;
}

function getCredentials(agent: SdrAgent): { baseUrl: string; token: string } | null {
  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) return null;
  return { baseUrl: agent.uazapiBaseUrl, token: decryptSecret(agent.uazapiInstanceTokenEncrypted) };
}

export function createFollowupOutreachService(deps: FollowupOutreachDependencies) {
  async function processAgent(agent: SdrAgent, now: Date, details: string[]): Promise<'sent' | 'skipped' | 'error'> {
    const startedAt = new Date();

    if (!agent.isActive) {
      details.push(`${agent.name}: SDR inativo.`);
      return 'skipped';
    }

    if (!agent.followupEnabled) {
      details.push(`${agent.name}: follow-up desativado.`);
      return 'skipped';
    }

    if (!isInsideSendWindow(agent, now)) {
      details.push(`${agent.name}: fora da janela de envio.`);
      return 'skipped';
    }

    const sentToday = await deps.leadRepository.countFollowupSentForSdrSince(agent.id, startOfDayInLocalApprox(now));
    if (sentToday >= agent.dailyFollowupSendLimit) {
      details.push(`${agent.name}: limite diario de follow-ups atingido.`);
      return 'skipped';
    }

    const lastSent = await deps.leadRepository.findLastFollowupSentForSdr(agent.id);
    if (lastSent?.followupSentAt) {
      const elapsedMinutes = (now.getTime() - lastSent.followupSentAt.getTime()) / 60000;
      const cooldownMinutes = randomCooldownMinutes(agent);
      if (elapsedMinutes < cooldownMinutes) {
        details.push(`${agent.name}: aguardando cooldown de follow-up.`);
        return 'skipped';
      }
    }

    const lead = await deps.leadRepository.findNextFollowupDueForSdr(agent.id, now);
    if (!lead) {
      details.push(`${agent.name}: nenhum follow-up vencido.`);
      return 'skipped';
    }

    try {
      const credentials = getCredentials(agent);
      if (!credentials) throw new Error('SDR sem URL/token UAZAPI configurado.');

      const text = buildFollowupMessage(agent, lead);
      await deps.uazapiClient.sendPresence({ ...credentials, number: lead.whatsappNumber, presence: 'composing', delay: 1000 });
      const result = await deps.uazapiClient.sendText({
        ...credentials,
        number: lead.whatsappNumber,
        text,
        readchat: true,
        trackSource: 'sdr-portal-followup',
        trackId: `followup-${lead.id}`,
      });

      if (!result.ok) throw new Error(`UAZAPI returned HTTP ${result.status}`);

      await deps.leadRepository.markFollowupSent(lead.id, now);
      await deps.jobLogRepository.create({
        jobName: 'followup-outreach',
        jobKey: `followup-${lead.id}`,
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
      details.push(`${agent.name}: follow-up enviado para ${lead.companyName}.`);
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido.';
      await deps.jobLogRepository.create({
        jobName: 'followup-outreach',
        jobKey: `agent-${agent.id}`,
        sdrAgentId: agent.id,
        leadId: lead.id,
        status: 'failed',
        attempt: 1,
        payload: JSON.stringify({ agentId: agent.id, leadId: lead.id }),
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
    async runOnce(now = new Date()): Promise<FollowupOutreachResult> {
      const agents = await deps.sdrAgentRepository.list();
      const result: FollowupOutreachResult = { sent: 0, skipped: 0, errors: 0, details: [] };

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
