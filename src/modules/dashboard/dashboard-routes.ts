import type { FastifyInstance } from 'fastify';

import type { AiRunRepository } from '../ai/ai-run-repository.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { CompanyRepository } from '../companies/company-repository.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { ChannelLimitsRepository } from '../monitoring/channel-limits.js';
import type { ConnectionMonitorRepository } from '../monitoring/connection-monitor-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { renderDashboardPage, renderReportsPage } from './dashboard-pages.js';
import {
  buildDashboardViewModel,
  dashboardSince,
  type DashboardFilters,
  type DashboardPeriod,
  type DashboardViewModel,
} from './dashboard-view-model.js';

const periods = new Set<DashboardPeriod>(['today', '7d', '30d', 'all']);

function queryValue(query: unknown, key: string): string {
  if (!query || typeof query !== 'object') return '';
  const value = (query as Record<string, unknown>)[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function parsePeriod(query: unknown): DashboardPeriod {
  const period = queryValue(query, 'period');
  return periods.has(period as DashboardPeriod) ? (period as DashboardPeriod) : '7d';
}

function parseFilters(query: unknown): DashboardFilters {
  return {
    activeOnly: queryValue(query, 'activeOnly') !== '0',
    companyId: queryValue(query, 'companyId'),
    period: parsePeriod(query),
    sdrAgentId: queryValue(query, 'sdrAgentId'),
    stage: queryValue(query, 'stage'),
    status: queryValue(query, 'status'),
  };
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  companyRepository: CompanyRepository,
  sdrAgentRepository: SdrAgentRepository,
  leadRepository: LeadRepository,
  conversationRepository: ConversationRepository,
  aiRunRepository: AiRunRepository,
  jobLogRepository: JobLogRepository,
  connectionMonitorRepository: ConnectionMonitorRepository,
  channelLimitsRepository?: ChannelLimitsRepository,
): void {
  async function buildModel(filters: DashboardFilters, userLabel: string, withConversations: boolean): Promise<DashboardViewModel> {
    const since = dashboardSince(filters.period, new Date());
    const [companies, sdrAgents, leads, conversations, messages, aiRuns, jobLogs] = await Promise.all([
      companyRepository.list(),
      sdrAgentRepository.list(),
      leadRepository.list(),
      // So Relatorios conta conversas abertas; o Painel nao precisa ler a tabela.
      withConversations ? conversationRepository.list() : Promise.resolve([]),
      conversationRepository.listMessageStats(since),
      aiRunRepository.listStats(since),
      jobLogRepository.listStats(since),
    ]);
    // Folga de 60 dias: a ultima transicao antes dos 7 dias e o que diz como a semana comecou.
    const connectionEvents = await connectionMonitorRepository.listConnectionEvents(new Date(Date.now() - 60 * 24 * 60 * 60000));
    const channelLimits = (await channelLimitsRepository?.list()) ?? [];

    return buildDashboardViewModel({
      aiRuns,
      channelLimits,
      companies,
      connectionEvents,
      conversations,
      filters,
      jobLogs,
      leads,
      messages,
      sdrAgents,
      userLabel,
    });
  }

  // Painel: so o periodo muda. Avisos e cartoes olham todos os SDRs ativos — filtro escondendo
  // um WhatsApp fora do ar e justamente o que o painel nao pode fazer.
  app.get('/dashboard', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const filters: DashboardFilters = { activeOnly: true, companyId: '', period: parsePeriod(request.query), sdrAgentId: '', stage: '', status: '' };
    const model = await buildModel(filters, `${user.name} (${user.email})`, false);
    return reply.type('text/html').send(renderDashboardPage(model));
  });

  app.get('/relatorios', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const model = await buildModel(parseFilters(request.query), `${user.name} (${user.email})`, true);
    return reply.type('text/html').send(renderReportsPage(model));
  });
}
