import type { FastifyInstance } from 'fastify';

import type { AiRunRepository } from '../ai/ai-run-repository.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { CompanyRepository } from '../companies/company-repository.js';
import type { ConversationRepository } from '../conversations/conversation-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { renderDashboardPage } from './dashboard-pages.js';
import { buildDashboardViewModel, type DashboardFilters, type DashboardPeriod } from './dashboard-view-model.js';

const periods = new Set<DashboardPeriod>(['today', '7d', '30d', 'all']);

function queryValue(query: unknown, key: string): string {
  if (!query || typeof query !== 'object') return '';
  const value = (query as Record<string, unknown>)[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function parseFilters(query: unknown): DashboardFilters {
  const period = queryValue(query, 'period');
  return {
    activeOnly: queryValue(query, 'activeOnly') !== '0',
    companyId: queryValue(query, 'companyId'),
    period: periods.has(period as DashboardPeriod) ? (period as DashboardPeriod) : '7d',
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
): void {
  app.get('/dashboard', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const [companies, sdrAgents, leads, conversations, messages, aiRuns, jobLogs] = await Promise.all([
      companyRepository.list(),
      sdrAgentRepository.list(),
      leadRepository.list(),
      conversationRepository.list(),
      conversationRepository.listAllMessages(),
      aiRunRepository.list(),
      jobLogRepository.list(),
    ]);

    const model = buildDashboardViewModel({
      aiRuns,
      companies,
      conversations,
      filters: parseFilters(request.query),
      jobLogs,
      leads,
      messages,
      sdrAgents,
      userLabel: `${user.name} (${user.email})`,
    });

    return reply.type('text/html').send(renderDashboardPage(model));
  });
}
