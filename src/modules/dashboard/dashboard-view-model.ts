import type { AiRun, Company, Conversation, JobLog, Lead, Message, SdrAgent } from '../../db/schema.js';
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

export interface DashboardViewModel {
  alerts: string[];
  companies: Company[];
  companyRows: DashboardCompanyRow[];
  dispatchRows: DashboardDispatchRow[];
  filters: DashboardFilters;
  funnelRows: DashboardFunnelRow[];
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

interface BuildDashboardInput {
  aiRuns: AiRun[];
  companies: Company[];
  conversations: Conversation[];
  filters: DashboardFilters;
  jobLogs: JobLog[];
  leads: Lead[];
  messages: Message[];
  now?: Date;
  sdrAgents: SdrAgent[];
  userLabel: string;
}

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
  const notInterested = scopedLeads.filter((lead) => isDateInPeriod(lead.notInterestedAt, start, now)).length;
  const discarded = scopedLeads.filter((lead) => lead.status === 'discarded' && isDateInPeriod(lead.updatedAt, start, now)).length;
  const invalidPhone = scopedLeads.filter((lead) => lead.status === 'invalid_phone' && isDateInPeriod(lead.updatedAt, start, now)).length;
  const created = scopedLeads.filter((lead) => isDateInPeriod(lead.createdAt, start, now)).length;
  const outboundMessages = messagesInPeriod.filter((message) => message.direction === 'outbound').length;
  const inboundMessages = messagesInPeriod.filter((message) => message.direction === 'inbound').length;
  const respondedLeadIds = new Set<string>();
  for (const message of messagesInPeriod) {
    if (message.direction === 'inbound') respondedLeadIds.add(message.leadId);
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
  const funnelItems = [
    { value: 'created', label: 'Leads criados' },
    { value: 'initial_sent', label: 'Abordagens iniciais' },
    { value: 'responded', label: 'Responderam' },
    { value: 'in_conversation', label: 'Em conversa agora' },
    { value: 'transferred', label: 'Handoffs' },
    { value: 'discarded', label: 'Descartados' },
    { value: 'invalid_phone', label: 'Telefone inexistente' },
    { value: 'not_interested', label: 'Sem interesse' },
  ];
  const funnelValues = new Map<string, number>([
    ['created', created],
    ['initial_sent', initialSent],
    ['responded', respondedLeadIds.size],
    ['in_conversation', scopedLeads.filter((lead) => lead.status === 'in_conversation').length],
    ['transferred', handoffs],
    ['discarded', discarded],
    ['invalid_phone', invalidPhone],
    ['not_interested', notInterested],
  ]);
  const funnelBase = Math.max(created, initialSent, scopedLeads.length, 1);
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
        if (message.direction === 'inbound') companyResponded.add(message.leadId);
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
  const alerts = [
    stalledSdrs.length > 0
      ? `SDR parado sem enviar: ${stalledSdrs.join(', ')}. Confira a conexao do WhatsApp na tela Conectar.`
      : null,
    readyCount > 0 ? `${readyCount} SDR(s) pronto(s) para chamar o proximo lead.` : null,
    lowPendingCount > 0 ? `${lowPendingCount} SDR(s) com menos de ${pendingLeadLowThreshold} leads pendentes. Importe mais leads para evitar fila vazia.` : null,
    followupsDue > 0 ? `${followupsDue} follow-up(s) vencido(s) aguardando envio.` : null,
    blockedCount > 0 ? `${blockedCount} SDR(s) bloqueado(s) por limite, janela ou configuracao.` : null,
    jobErrors > 0 ? `${jobErrors} erro(s) de job no periodo selecionado.` : null,
    aiErrors > 0 ? `${aiErrors} erro(s) de IA no periodo selecionado.` : null,
    initialSent >= 10 && responseRate !== '-' && respondedLeadIds.size / initialSent < 0.1
      ? 'Taxa de resposta abaixo de 10% para as abordagens do periodo.'
      : null,
  ].filter((alert): alert is string => alert !== null);

  return {
    alerts,
    companies: input.companies,
    companyRows,
    dispatchRows,
    filters: input.filters,
    funnelRows: funnelItems.map((item) => ({ count: funnelValues.get(item.value) ?? 0, label: item.label, percent: Math.round(((funnelValues.get(item.value) ?? 0) / funnelBase) * 100) })),
    metrics: [
      { label: 'Mensagens enviadas', value: String(totalKnownSends), help: 'Abordagens + follow-ups + mensagens outbound registradas.' },
      { label: 'Responderam', value: String(respondedLeadIds.size), help: `${inboundMessages} mensagem(ns) inbound no periodo.` },
      { label: 'Handoffs', value: String(handoffs), help: `Taxa sobre abordagens: ${formatPercent(handoffs, initialSent)}.` },
      { label: 'Follow-ups feitos', value: String(followupsSent), help: `${followupsDue} follow-up(s) vencido(s) agora.` },
      { label: 'Taxa de resposta', value: responseRate, help: 'Leads que responderam / abordagens iniciais.' },
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
