import type { AiRun, Company, Conversation, JobLog, Lead, Message, SdrAgent, SdrConnectionEvent } from '../../db/schema.js';
import { hasOutcome } from '../leads/lead-outcome.js';
import { CHANNEL_HEALTH_TARGET_PERCENT, computeChannelHealth } from '../monitoring/channel-health.js';
import { formatDateTimeInTimeZone, startOfDayInTimeZone } from '../timezone.js';

export type DashboardPeriod = 'today' | '7d' | '30d' | 'all';

export const pendingLeadLowThreshold = 100;

/**
 * Piso de tempo sem enviar que ja denuncia um SDR travado. Folgado de proposito: uma pausa de
 * uma ou duas horas ainda cabe em jitter de cooldown e de tick, e o alarme so vale se ninguem
 * aprender a ignora-lo. O corte real leva o cooldown do proprio SDR junto (ver
 * `stalledAfterMinutes`), senao um cooldown longo viraria alarme falso sozinho.
 */
export const stalledDispatchMinutes = 180;

/**
 * Lead em "Oferta de handoff" parado ha mais que isto precisa de um humano agora: ele ja
 * disse que tem interesse e esta esperando alguem. Foi o caso da Fit013 Marmitas ("Tenho
 * interesse", 29/09 16:05), que ficou ali quando o WhatsApp da Mariana caiu duas horas depois.
 */
export const stalledHandoffOfferMinutes = 120;
/** Depois disso o lead some do alerta: aviso que nunca sai da tela vira paisagem. */
const stalledHandoffOfferMaxDays = 14;

/**
 * Handoff sem desfecho marcado depois deste prazo vira cobranca no painel: sem a marcacao o
 * funil para no handoff de novo. Mais velho que o teto, sai da lista.
 */
export const handoffOutcomeDueDays = 3;
const handoffOutcomeMaxDays = 30;

/** Mesmo nome de job que `ai-response-service` grava no aviso de handoff. */
const HANDOFF_NOTICE_JOB = 'handoff-notify';

function lastActivityAt(lead: Lead): Date {
  const times = [lead.lastInboundAt, lead.lastOutboundAt].filter((value): value is Date => value instanceof Date);
  return times.length > 0 ? new Date(Math.max(...times.map((value) => value.getTime()))) : lead.updatedAt;
}

function namesPreview(names: string[], max = 4): string {
  return names.length > max ? `${names.slice(0, max).join(', ')} e mais ${names.length - max}` : names.join(', ');
}

/** Um SDR liberado para enviar e parado por mais que isto nao esta esperando: esta preso. */
function stalledAfterMinutes(maxCooldownMinutes: number): number {
  return Math.max(stalledDispatchMinutes, maxCooldownMinutes * 2);
}

export interface DashboardFilters {
  activeOnly: boolean;
  companyId: string;
  period: DashboardPeriod;
  sdrAgentId: string;
  stage: string;
  status: string;
}

export interface DashboardMetric {
  help: string;
  label: string;
  value: string;
}

export interface DashboardDispatchRow {
  companyName: string;
  detail: string;
  etaLabel: string;
  followupsDue: number;
  followupsSentToday: number;
  lastSentLabel: string;
  nextLeadId: string | null;
  nextLeadName: string;
  pendingCount: number;
  sentToday: number;
  status: 'ready' | 'warning' | 'blocked' | 'muted';
  statusLabel: string;
  sdrName: string;
  sendLimitLabel: string;
}

export interface DashboardFunnelRow {
  count: number;
  label: string;
  percent: number;
}

/** Um degrau do funil da safra: quantos dos leads abordados no periodo chegaram ate aqui. */
export interface DashboardCohortRow {
  count: number;
  help: string;
  label: string;
  /** Sobre os abordados: a taxa que compara periodos e SDRs. */
  percentOfBase: number;
  /** Sobre o degrau anterior: onde o funil vaza. `null` no primeiro degrau. */
  percentOfPrevious: number | null;
}

export interface DashboardCompanyRow {
  activeSdrs: number;
  companyId: string;
  companyName: string;
  discarded: number;
  followupsSent: number;
  handoffs: number;
  invalidPhone: number;
  leadsTotal: number;
  outboundMessages: number;
  pending: number;
  responded: number;
  segment: string;
  sent: number;
  totalSdrs: number;
}

/** Saude do WhatsApp de um SDR nos ultimos 7 dias, so no horario de envio. */
export interface DashboardChannelRow {
  sdrName: string;
  /** "93%" ou "-" sem historico. */
  connectedLabel: string;
  /** Abaixo da meta, ou fora do ar agora. */
  belowTarget: boolean;
  drops: number;
  reconnectLabel: string;
  downNowLabel: string;
  /** Explica de onde vem o numero (ex.: historico desde quando). */
  detail: string;
}

export interface DashboardViewModel {
  alerts: string[];
  channelRows: DashboardChannelRow[];
  cohortLost: number;
  cohortRows: DashboardCohortRow[];
  companies: Company[];
  companyRows: DashboardCompanyRow[];
  dispatchRows: DashboardDispatchRow[];
  filters: DashboardFilters;
  metrics: DashboardMetric[];
  periodLabel: string;
  sdrAgents: SdrAgent[];
  stageRows: DashboardFunnelRow[];
  statusRows: DashboardFunnelRow[];
  totals: {
    aiErrors: number;
    discarded: number;
    followupsDue: number;
    handoffs: number;
    initialSent: number;
    invalidPhone: number;
    jobErrors: number;
    outboundMessages: number;
    pending: number;
    respondedLeads: number;
    responseRate: string;
    totalKnownSends: number;
  };
  userLabel: string;
}

export const periodOptions: Array<{ label: string; value: DashboardPeriod }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Ultimos 7 dias' },
  { value: '30d', label: 'Ultimos 30 dias' },
  { value: 'all', label: 'Todo historico' },
];

export const leadStatusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'initial_sent', label: 'Abordado' },
  { value: 'in_conversation', label: 'Em conversa' },
  { value: 'followup_sent', label: 'Follow-up enviado' },
  { value: 'transferred', label: 'Handoff feito' },
  { value: 'not_interested', label: 'Sem interesse' },
  { value: 'discarded', label: 'Descartado' },
  { value: 'invalid_phone', label: 'Telefone inexistente' },
  { value: 'human_paused', label: 'Pausado por humano' },
];

export const stageOptions = [
  { value: '', label: 'Todas as etapas' },
  { value: 'permission', label: 'Permissao' },
  { value: 'discovery', label: 'Descoberta' },
  { value: 'solution', label: 'Solucao' },
  { value: 'handoff_offer', label: 'Oferta de handoff' },
  { value: 'handoff_done', label: 'Handoff feito' },
  { value: 'not_interested', label: 'Sem interesse' },
  { value: 'discarded', label: 'Descartado' },
];

const PROPOSAL_STAGES = new Set(['solution', 'handoff_offer', 'handoff_done']);

function percentOf(count: number, base: number): number {
  return base > 0 ? Math.round((count / base) * 100) : 0;
}

/**
 * O funil unico: dos leads abordados no periodo (a safra), quantos chegaram a cada degrau, em
 * qualquer momento depois. Ate 02/10 o painel mostrava "eventos do periodo" misturados (leads
 * criados, descartados, em conversa agora), e nenhuma linha dizia quantos abordados viraram
 * cliente. Cada degrau conta quem chegou nele ou passou dele — cliente fechado sem reuniao
 * marcada conta como reuniao, senao o funil teria degrau maior que o anterior.
 *
 * "Gente respondeu" segue a definicao do resto do portal: resposta automatica da loja nao conta.
 */
export function buildCohortFunnel(cohort: Lead[], humanRepliedLeadIds: ReadonlySet<string>): { rows: DashboardCohortRow[]; lost: number } {
  const won = cohort.filter((lead) => lead.wonAt);
  const trial = cohort.filter((lead) => lead.trialStartedAt || lead.wonAt);
  const meeting = cohort.filter((lead) => lead.meetingAt || lead.trialStartedAt || lead.wonAt);
  const handoff = cohort.filter((lead) => lead.handoffRequestedAt || lead.meetingAt || lead.trialStartedAt || lead.wonAt);
  const proposal = cohort.filter((lead) => PROPOSAL_STAGES.has(lead.conversationStage) || handoff.includes(lead));
  const replied = cohort.filter((lead) => humanRepliedLeadIds.has(lead.id) || lead.lastInboundAt || proposal.includes(lead));

  const steps: Array<{ label: string; leads: Lead[]; help: string }> = [
    { label: 'Abordados', leads: cohort, help: 'Receberam a primeira mensagem no periodo.' },
    { label: 'Gente respondeu', leads: replied, help: 'Uma pessoa respondeu. Robo e transmissao da loja nao contam.' },
    { label: 'Ouviu a proposta', leads: proposal, help: 'A conversa chegou na etapa de solucao ou alem.' },
    { label: 'Handoff', leads: handoff, help: 'Passado para alguem do time.' },
    { label: 'Reuniao marcada', leads: meeting, help: 'Marcado na tela do lead por quem atendeu.' },
    { label: 'Teste comecou', leads: trial, help: 'Marcado na tela do lead por quem atendeu.' },
    { label: 'Virou cliente', leads: won, help: 'Marcado na tela do lead por quem atendeu.' },
  ];

  const rows = steps.map((step, index) => {
    const previous = index > 0 ? steps[index - 1] : undefined;
    return {
      count: step.leads.length,
      help: step.help,
      label: step.label,
      percentOfBase: percentOf(step.leads.length, cohort.length),
      percentOfPrevious: previous ? percentOf(step.leads.length, previous.leads.length) : null,
    };
  });

  return { rows, lost: cohort.filter((lead) => lead.lostAt).length };
}

interface BuildDashboardInput {
  aiRuns: AiRun[];
  companies: Company[];
  conversations: Conversation[];
  filters: DashboardFilters;
  jobLogs: JobLog[];
  leads: Lead[];
  messages: Message[];
  now?: Date;
  /** Transicoes de conexao (monitor). Leia com folga antes dos 7 dias: o estado inicial vem delas. */
  connectionEvents?: SdrConnectionEvent[];
  sdrAgents: SdrAgent[];
  userLabel: string;
}

export const CHANNEL_HEALTH_DAYS = 7;

function periodStart(period: DashboardPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  if (period === 'today') {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const days = period === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isDateInPeriod(value: Date | null | undefined, start: Date | null, now: Date): boolean {
  if (!value) return false;
  if (value.getTime() > now.getTime()) return false;
  return !start || value.getTime() >= start.getTime();
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '-';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.ceil(totalMinutes));
  if (minutes <= 0) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function nowParts(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone,
    weekday: 'short',
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

function minutesUntilSendWindow(agent: SdrAgent, now: Date): number | null {
  for (let minutes = 0; minutes <= 8 * 24 * 60; minutes += 1) {
    if (isInsideSendWindow(agent, new Date(now.getTime() + minutes * 60 * 1000))) {
      return minutes;
    }
  }
  return null;
}

/**
 * Quantas abordagens a janela e o cooldown deixam sair num dia, no melhor caso.
 *
 * O limite diario nao manda sozinho: entre um envio e o proximo o disparo espera um cooldown
 * sorteado, entao a janela e quem decide o teto real. Janela de 15h as 21h com cooldown medio de
 * 10min cabe ~37 envios — configurar 40 nao aumenta nada e esconde o gargalo verdadeiro.
 */
function dailySendCapacity(agent: SdrAgent): number {
  const start = timeToMinutes(agent.sendWindowStart);
  const end = timeToMinutes(agent.sendWindowEnd);
  const windowMinutes = start <= end ? end - start : 24 * 60 - start + end;
  const minCooldown = Math.min(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  const maxCooldown = Math.max(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  const averageCooldown = (minCooldown + maxCooldown) / 2;
  if (averageCooldown <= 0) return agent.dailyInitialSendLimit;
  return Math.floor(windowMinutes / averageCooldown) + 1;
}

function hasUazapiCredentials(agent: SdrAgent): boolean {
  return Boolean(agent.uazapiBaseUrl?.trim() && agent.uazapiInstanceTokenEncrypted?.trim());
}

function countLeadEvents(leads: Lead[], dateKey: keyof Pick<Lead, 'firstMessageSentAt' | 'followupSentAt'>, since: Date): number {
  return leads.filter((lead) => {
    const value = lead[dateKey];
    return value !== null && value.getTime() >= since.getTime();
  }).length;
}

function nextPendingLead(leads: Lead[]): Lead | null {
  return leads.filter((lead) => lead.status === 'pending').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

function lastInitialSent(leads: Lead[]): Lead | null {
  return (
    leads
      .filter((lead) => lead.firstMessageSentAt !== null)
      .sort((a, b) => (b.firstMessageSentAt?.getTime() ?? 0) - (a.firstMessageSentAt?.getTime() ?? 0))[0] ?? null
  );
}

function isFollowupDue(lead: Lead, now: Date): boolean {
  return (
    lead.status === 'in_conversation' &&
    lead.lastInboundAt !== null &&
    lead.followupDueAt !== null &&
    lead.followupDueAt.getTime() <= now.getTime() &&
    lead.followupSentAt === null &&
    lead.followupDisabledAt === null
  );
}

function buildDispatchRow(agent: SdrAgent, company: Company | undefined, agentLeads: Lead[], now: Date): DashboardDispatchRow {
  const pending = agentLeads.filter((lead) => lead.status === 'pending');
  const nextLead = nextPendingLead(agentLeads);
  const today = startOfDayInTimeZone(now, agent.timezone);
  const sentToday = countLeadEvents(agentLeads, 'firstMessageSentAt', today);
  const followupsSentToday = countLeadEvents(agentLeads, 'followupSentAt', today);
  const followupsDue = agentLeads.filter((lead) => isFollowupDue(lead, now)).length;
  const lastSent = lastInitialSent(agentLeads);
  const lastSentAt = lastSent?.firstMessageSentAt ?? null;
  const minCooldown = Math.min(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  const maxCooldown = Math.max(agent.initialCooldownMinMinutes, agent.initialCooldownMaxMinutes);
  const base: Omit<DashboardDispatchRow, 'detail' | 'etaLabel' | 'status' | 'statusLabel'> = {
    companyName: company?.name ?? '-',
    followupsDue,
    followupsSentToday,
    lastSentLabel: formatDateTimeInTimeZone(lastSentAt, agent.timezone),
    nextLeadId: nextLead?.id ?? null,
    nextLeadName: nextLead?.companyName ?? '-',
    pendingCount: pending.length,
    sdrName: agent.displayName || agent.name,
    sentToday,
    sendLimitLabel: `${sentToday}/${agent.dailyInitialSendLimit}`,
  };

  if (!agent.isActive) {
    return { ...base, detail: 'SDR inativo.', etaLabel: '-', status: 'muted', statusLabel: 'Inativo' };
  }

  if (!hasUazapiCredentials(agent)) {
    return { ...base, detail: 'Configure URL/token UAZAPI antes de enviar.', etaLabel: '-', status: 'blocked', statusLabel: 'Config incompleta' };
  }

  if (!nextLead) {
    return { ...base, detail: 'Nenhum lead pendente para este SDR.', etaLabel: '-', status: 'muted', statusLabel: 'Sem fila' };
  }

  if (sentToday >= agent.dailyInitialSendLimit) {
    return { ...base, detail: 'Limite diario de abordagens atingido.', etaLabel: 'proximo dia', status: 'blocked', statusLabel: 'Limite atingido' };
  }

  const windowWait = minutesUntilSendWindow(agent, now);
  if (windowWait === null) {
    return { ...base, detail: 'Nenhuma janela de envio encontrada nos proximos dias.', etaLabel: '-', status: 'blocked', statusLabel: 'Sem janela' };
  }
  if (windowWait > 0) {
    return {
      ...base,
      detail: `Janela configurada: ${agent.sendWindowStart}-${agent.sendWindowEnd}.`,
      etaLabel: `em ${formatDuration(windowWait)}`,
      status: 'warning',
      statusLabel: 'Fora da janela',
    };
  }

  if (lastSentAt) {
    const elapsedMinutes = (now.getTime() - lastSentAt.getTime()) / 60000;
    if (elapsedMinutes < minCooldown) {
      return {
        ...base,
        detail: `Cooldown minimo de ${minCooldown}min entre abordagens.`,
        etaLabel: `em pelo menos ${formatDuration(minCooldown - elapsedMinutes)}`,
        status: 'warning',
        statusLabel: 'Cooldown',
      };
    }

    if (elapsedMinutes < maxCooldown) {
      return {
        ...base,
        detail: `Cooldown aleatorio entre ${minCooldown} e ${maxCooldown}min.`,
        etaLabel: `entre agora e ${formatDuration(maxCooldown - elapsedMinutes)}`,
        status: 'warning',
        statusLabel: 'Cooldown flexivel',
      };
    }

    // Fila cheia, dentro da janela, cooldown vencido e mesmo assim nada saiu: o disparo esta
    // preso em algo que o banco nao mostra — WhatsApp deslogado, UAZAPI fora, scheduler morto.
    // Sem esta linha o SDR aparecia como "Pronto" por dois dias enquanto nao enviava nada.
    if (elapsedMinutes >= stalledAfterMinutes(maxCooldown)) {
      return {
        ...base,
        detail: `Liberado para enviar, mas nada saiu ha ${formatDuration(elapsedMinutes)}. Confira a conexao do WhatsApp na tela Conectar deste SDR.`,
        etaLabel: 'travado',
        status: 'blocked',
        statusLabel: 'Parado',
      };
    }
  }

  return { ...base, detail: `Proximo lead: ${nextLead.companyName}.`, etaLabel: 'pronto agora', status: 'ready', statusLabel: 'Pronto' };
}

function countRows(items: Array<{ label: string; value: string }>, total: number, values: Map<string, number>): DashboardFunnelRow[] {
  return items.map((item) => {
    const count = values.get(item.value) ?? 0;
    return { count, label: item.label, percent: total > 0 ? Math.round((count / total) * 100) : 0 };
  });
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function filteredByPeriod<T extends { createdAt: Date }>(items: T[], start: Date | null, now: Date): T[] {
  return items.filter((item) => isDateInPeriod(item.createdAt, start, now));
}

function periodLabel(period: DashboardPeriod): string {
  return periodOptions.find((option) => option.value === period)?.label ?? 'Periodo';
}

export function buildDashboardViewModel(input: BuildDashboardInput): DashboardViewModel {
  const now = input.now ?? new Date();
  const start = periodStart(input.filters.period, now);
  const companyById = new Map(input.companies.map((company) => [company.id, company]));
  const scopedAgents = input.sdrAgents.filter((agent) => {
    if (input.filters.companyId && agent.companyId !== input.filters.companyId) return false;
    if (input.filters.sdrAgentId && agent.id !== input.filters.sdrAgentId) return false;
    if (input.filters.activeOnly && !agent.isActive) return false;
    return true;
  });
  const scopedAgentIds = new Set(scopedAgents.map((agent) => agent.id));
  const scopedLeads = input.leads.filter((lead) => {
    if (!scopedAgentIds.has(lead.sdrAgentId)) return false;
    if (input.filters.status && lead.status !== input.filters.status) return false;
    if (input.filters.stage && lead.conversationStage !== input.filters.stage) return false;
    return true;
  });
  const scopedLeadIds = new Set(scopedLeads.map((lead) => lead.id));
  const messagesInPeriod = filteredByPeriod(input.messages, start, now).filter((message) => scopedLeadIds.has(message.leadId));
  const conversations = input.conversations.filter((conversation) => scopedLeadIds.has(conversation.leadId));
  const jobLogsInPeriod = filteredByPeriod(input.jobLogs, start, now).filter(
    (log) => (log.leadId !== null && scopedLeadIds.has(log.leadId)) || (log.sdrAgentId !== null && scopedAgentIds.has(log.sdrAgentId)),
  );
  const aiRunsInPeriod = filteredByPeriod(input.aiRuns, start, now).filter(
    (run) => (run.leadId !== null && scopedLeadIds.has(run.leadId)) || (run.sdrAgentId !== null && scopedAgentIds.has(run.sdrAgentId)),
  );
  const initialSent = scopedLeads.filter((lead) => isDateInPeriod(lead.firstMessageSentAt, start, now)).length;
  const followupsSent = scopedLeads.filter((lead) => isDateInPeriod(lead.followupSentAt, start, now)).length;
  const handoffs = scopedLeads.filter((lead) => isDateInPeriod(lead.handoffRequestedAt, start, now)).length;
  const discarded = scopedLeads.filter((lead) => lead.status === 'discarded' && isDateInPeriod(lead.updatedAt, start, now)).length;
  const invalidPhone = scopedLeads.filter((lead) => lead.status === 'invalid_phone' && isDateInPeriod(lead.updatedAt, start, now)).length;
  const outboundMessages = messagesInPeriod.filter((message) => message.direction === 'outbound').length;
  const inboundMessages = messagesInPeriod.filter((message) => message.direction === 'inbound').length;
  // Resposta automatica da loja nao e resposta: contar o robo dava 60% de taxa numa caixa em que
  // gente respondeu 27% (docs/analises/mariana-2026-09-02.md), e era isso que impedia comparar
  // qualquer mudanca de abordagem.
  const autoReplyMessages = messagesInPeriod.filter((message) => message.direction === 'inbound' && message.autoReply).length;
  const respondedLeadIds = new Set<string>();
  for (const message of messagesInPeriod) {
    if (message.direction === 'inbound' && !message.autoReply) respondedLeadIds.add(message.leadId);
  }
  for (const lead of scopedLeads) {
    if (isDateInPeriod(lead.lastInboundAt, start, now)) respondedLeadIds.add(lead.id);
  }
  const pending = scopedLeads.filter((lead) => lead.status === 'pending').length;
  const followupsDue = scopedLeads.filter((lead) => isFollowupDue(lead, now)).length;
  const activeConversations = conversations.filter((conversation) => conversation.status === 'open').length;
  const aiErrors = aiRunsInPeriod.filter((run) => run.error !== null).length;
  const jobErrors = jobLogsInPeriod.filter((log) => log.status === 'failed' || log.error !== null).length;
  const totalTokens = aiRunsInPeriod.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0);
  const totalKnownSends = initialSent + followupsSent + outboundMessages;
  const responseRate = formatPercent(respondedLeadIds.size, initialSent || scopedLeads.filter((lead) => lead.firstMessageSentAt !== null).length);
  const dispatchRows = scopedAgents.map((agent) =>
    buildDispatchRow(
      agent,
      companyById.get(agent.companyId),
      scopedLeads.filter((lead) => lead.sdrAgentId === agent.id),
      now,
    ),
  );
  const readyCount = dispatchRows.filter((row) => row.statusLabel === 'Pronto').length;
  const blockedCount = dispatchRows.filter((row) => row.status === 'blocked').length;
  const lowPendingCount = dispatchRows.filter((row) => row.pendingCount < pendingLeadLowThreshold).length;
  const statusCounts = new Map<string, number>();
  const stageCounts = new Map<string, number>();
  for (const lead of scopedLeads) {
    addCount(statusCounts, lead.status);
    addCount(stageCounts, lead.conversationStage);
  }
  const cohort = scopedLeads.filter((lead) => isDateInPeriod(lead.firstMessageSentAt, start, now));
  const cohortIds = new Set(cohort.map((lead) => lead.id));
  const humanRepliedEver = new Set<string>();
  for (const message of input.messages) {
    if (message.direction === 'inbound' && !message.autoReply && cohortIds.has(message.leadId)) humanRepliedEver.add(message.leadId);
  }
  const cohortFunnel = buildCohortFunnel(cohort, humanRepliedEver);
  const companyRows = input.companies
    .filter((company) => !input.filters.companyId || company.id === input.filters.companyId)
    .map((company) => {
      const companyAgents = scopedAgents.filter((agent) => agent.companyId === company.id);
      const companyAgentIds = new Set(companyAgents.map((agent) => agent.id));
      const companyLeads = scopedLeads.filter((lead) => lead.companyId === company.id && companyAgentIds.has(lead.sdrAgentId));
      const companyLeadIds = new Set(companyLeads.map((lead) => lead.id));
      const companyMessages = messagesInPeriod.filter((message) => companyLeadIds.has(message.leadId));
      const companyResponded = new Set<string>();
      for (const message of companyMessages) {
        if (message.direction === 'inbound' && !message.autoReply) companyResponded.add(message.leadId);
      }
      for (const lead of companyLeads) {
        if (isDateInPeriod(lead.lastInboundAt, start, now)) companyResponded.add(lead.id);
      }
      return {
        activeSdrs: companyAgents.filter((agent) => agent.isActive).length,
        companyId: company.id,
        companyName: company.name,
        discarded: companyLeads.filter((lead) => lead.status === 'discarded' && isDateInPeriod(lead.updatedAt, start, now)).length,
        followupsSent: companyLeads.filter((lead) => isDateInPeriod(lead.followupSentAt, start, now)).length,
        handoffs: companyLeads.filter((lead) => isDateInPeriod(lead.handoffRequestedAt, start, now)).length,
        invalidPhone: companyLeads.filter((lead) => lead.status === 'invalid_phone' && isDateInPeriod(lead.updatedAt, start, now)).length,
        leadsTotal: companyLeads.length,
        outboundMessages: companyMessages.filter((message) => message.direction === 'outbound').length,
        pending: companyLeads.filter((lead) => lead.status === 'pending').length,
        responded: companyResponded.size,
        segment: company.segment ?? '-',
        sent: companyLeads.filter((lead) => isDateInPeriod(lead.firstMessageSentAt, start, now)).length,
        totalSdrs: companyAgents.length,
      } satisfies DashboardCompanyRow;
    })
    .filter((row) => row.totalSdrs > 0 || row.leadsTotal > 0)
    .sort((a, b) => b.leadsTotal - a.leadsTotal || a.companyName.localeCompare(b.companyName));
  const stalledSdrs = dispatchRows.filter((row) => row.statusLabel === 'Parado').map((row) => row.sdrName);
  // Limite diario acima do que a janela comporta e limite que nunca chega: quem segura o volume
  // passa a ser o cooldown, e a tela mostraria "0/40" para sempre sem dizer por que.
  const overCapacitySdrs = scopedAgents
    .filter((agent) => agent.isActive && dailySendCapacity(agent) < agent.dailyInitialSendLimit)
    .map((agent) => `${agent.displayName || agent.name} (~${dailySendCapacity(agent)}/${agent.dailyInitialSendLimit})`);
  const stalledHandoffOffers = scopedLeads.filter(
    (lead) =>
      lead.conversationStage === 'handoff_offer' &&
      lead.status !== 'transferred' &&
      lead.status !== 'not_interested' &&
      now.getTime() - lastActivityAt(lead).getTime() > stalledHandoffOfferMinutes * 60000 &&
      now.getTime() - lastActivityAt(lead).getTime() < stalledHandoffOfferMaxDays * 24 * 60 * 60000,
  );
  const DAY_MS = 24 * 60 * 60000;
  const healthFrom = new Date(now.getTime() - CHANNEL_HEALTH_DAYS * DAY_MS);
  const channelRows: DashboardChannelRow[] = scopedAgents
    .filter((agent) => agent.isActive)
    .map((agent) => {
      const health = computeChannelHealth({
        events: (input.connectionEvents ?? []).filter((event) => event.sdrAgentId === agent.id),
        from: healthFrom,
        to: now,
        isInsideWindow: (at) => isInsideSendWindow(agent, at),
      });
      const partial = health.coveredFrom && health.coveredFrom.getTime() > healthFrom.getTime();
      return {
        sdrName: agent.displayName || agent.name,
        connectedLabel: health.percent === null ? '-' : `${health.percent}%`,
        belowTarget: (health.percent !== null && health.percent < CHANNEL_HEALTH_TARGET_PERCENT) || health.downForMinutes !== null,
        drops: health.drops,
        reconnectLabel: health.averageReconnectMinutes === null ? '-' : formatDuration(health.averageReconnectMinutes),
        downNowLabel: health.downForMinutes === null ? '-' : formatDuration(health.downForMinutes),
        detail: !health.coveredFrom
          ? 'Sem historico ainda: o monitor de conexao grava a partir da proxima leitura.'
          : partial
            ? `Historico desde ${formatDateTimeInTimeZone(health.coveredFrom, agent.timezone)}.`
            : `Ultimos ${CHANNEL_HEALTH_DAYS} dias.`,
      };
    });
  const unhealthyChannels = channelRows.filter((row) => row.belowTarget && row.connectedLabel !== '-');
  const handoffsWithoutOutcome = scopedLeads.filter((lead) => {
    if (!lead.handoffRequestedAt || hasOutcome(lead)) return false;
    const age = now.getTime() - lead.handoffRequestedAt.getTime();
    return age > handoffOutcomeDueDays * DAY_MS && age < handoffOutcomeMaxDays * DAY_MS;
  });
  const failedHandoffNotices = jobLogsInPeriod.filter((log) => log.jobName === HANDOFF_NOTICE_JOB && log.status === 'failed');
  const failedNoticeLeads = failedHandoffNotices
    .map((log) => scopedLeads.find((lead) => lead.id === log.leadId)?.companyName)
    .filter((name): name is string => Boolean(name));
  const alerts = [
    unhealthyChannels.length > 0
      ? `WhatsApp abaixo da meta de ${CHANNEL_HEALTH_TARGET_PERCENT}% conectado no horario de envio: ${unhealthyChannels.map((row) => `${row.sdrName} (${row.connectedLabel}${row.downNowLabel !== '-' ? `, fora ha ${row.downNowLabel}` : ''})`).join(', ')}. Cada hora fora e abordagem que nao sai.`
      : null,
    stalledHandoffOffers.length > 0
      ? `${stalledHandoffOffers.length} lead(s) com interesse esperando ha mais de ${stalledHandoffOfferMinutes / 60}h na oferta de handoff: ${namesPreview(stalledHandoffOffers.map((lead) => lead.companyName))}. Chame pelo WhatsApp do SDR.`
      : null,
    handoffsWithoutOutcome.length > 0
      ? `${handoffsWithoutOutcome.length} handoff(s) de mais de ${handoffOutcomeDueDays} dias sem desfecho marcado: ${namesPreview(handoffsWithoutOutcome.map((lead) => lead.companyName))}. Abra o lead e marque reuniao, teste, cliente ou perdido.`
      : null,
    failedHandoffNotices.length > 0
      ? `${failedHandoffNotices.length} aviso(s) de handoff nao chegaram a quem atende${failedNoticeLeads.length > 0 ? ` (${namesPreview(failedNoticeLeads)})` : ''}. O resumo de cada um esta em Job logs.`
      : null,
    stalledSdrs.length > 0
      ? `SDR parado sem enviar: ${stalledSdrs.join(', ')}. Confira a conexao do WhatsApp na tela Conectar.`
      : null,
    readyCount > 0 ? `${readyCount} SDR(s) pronto(s) para chamar o proximo lead.` : null,
    lowPendingCount > 0 ? `${lowPendingCount} SDR(s) com menos de ${pendingLeadLowThreshold} leads pendentes. Importe mais leads para evitar fila vazia.` : null,
    followupsDue > 0 ? `${followupsDue} follow-up(s) vencido(s) aguardando envio.` : null,
    blockedCount > 0 ? `${blockedCount} SDR(s) bloqueado(s) por limite, janela ou configuracao.` : null,
    overCapacitySdrs.length > 0
      ? `Limite diario acima do que a janela permite: ${overCapacitySdrs.join(', ')}. Aumente a janela de envio ou baixe o cooldown para o limite valer.`
      : null,
    jobErrors > 0 ? `${jobErrors} erro(s) de job no periodo selecionado.` : null,
    aiErrors > 0 ? `${aiErrors} erro(s) de IA no periodo selecionado.` : null,
    initialSent >= 10 && responseRate !== '-' && respondedLeadIds.size / initialSent < 0.1
      ? 'Taxa de resposta abaixo de 10% para as abordagens do periodo.'
      : null,
  ].filter((alert): alert is string => alert !== null);

  return {
    alerts,
    channelRows,
    cohortLost: cohortFunnel.lost,
    cohortRows: cohortFunnel.rows,
    companies: input.companies,
    companyRows,
    dispatchRows,
    filters: input.filters,
    metrics: [
      { label: 'Mensagens enviadas', value: String(totalKnownSends), help: 'Abordagens + follow-ups + mensagens outbound registradas.' },
      { label: 'Responderam', value: String(respondedLeadIds.size), help: `Leads com resposta de gente. ${inboundMessages} inbound no periodo, ${autoReplyMessages} automatica(s) da loja fora da conta.` },
      { label: 'Handoffs', value: String(handoffs), help: `Taxa sobre abordagens: ${formatPercent(handoffs, initialSent)}.` },
      { label: 'Follow-ups feitos', value: String(followupsSent), help: `${followupsDue} follow-up(s) vencido(s) agora.` },
      { label: 'Taxa de resposta', value: responseRate, help: 'Leads com resposta de gente / abordagens iniciais. Robo da loja nao conta.' },
      { label: 'Descartados', value: String(discarded), help: 'Leads bloqueados antes do primeiro contato por baixo fit.' },
      { label: 'Telefone inexistente', value: String(invalidPhone), help: 'Leads descartados porque o numero nao existe no WhatsApp.' },
      { label: 'Fila pendente', value: String(pending), help: `${readyCount} SDR(s) pronto(s), ${blockedCount} bloqueado(s).` },
      { label: 'Conversas abertas', value: String(activeConversations), help: 'Conversas com status open no filtro atual.' },
      { label: 'Tokens IA', value: String(totalTokens), help: `${aiRunsInPeriod.length} chamada(s), ${aiErrors} erro(s).` },
    ],
    periodLabel: periodLabel(input.filters.period),
    sdrAgents: input.sdrAgents,
    stageRows: countRows(stageOptions.filter((option) => option.value), scopedLeads.length, stageCounts),
    statusRows: countRows(leadStatusOptions.filter((option) => option.value), scopedLeads.length, statusCounts),
    totals: {
      aiErrors,
      discarded,
      followupsDue,
      handoffs,
      initialSent,
      invalidPhone,
      jobErrors,
      outboundMessages,
      pending,
      respondedLeads: respondedLeadIds.size,
      responseRate,
      totalKnownSends,
    },
    userLabel: input.userLabel,
  };
}
