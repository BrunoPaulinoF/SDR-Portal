import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import type { AiRunRepository } from '../ai/ai-run-repository.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { WebhookEventRepository } from '../webhooks/webhook-event-repository.js';
import { aiRunRow, jobLogRow, LOGS_PAGE_SIZE, renderLogsPage, resolveLogTab, webhookRow, type LogRow } from './log-pages.js';
import type { RecentLogFilter } from './recent-log-filter.js';

const querySchema = z.object({
  aba: z.string().optional(),
  sdr: z.string().uuid().optional().catch(undefined),
  erros: z.string().optional(),
  pagina: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});

/** Paginas fundas na aba Erros leem `pagina x 50` linhas de cada tabela: o teto evita abuso. */
const MAX_ERROR_PAGE = 20;

export interface LogSources {
  aiRunRepository: AiRunRepository;
  jobLogRepository: JobLogRepository;
  webhookEventRepository: WebhookEventRepository;
}

export function registerLogRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  sdrAgentRepository: SdrAgentRepository,
  sources: LogSources,
): void {
  app.get('/registros', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const parsed = querySchema.safeParse(request.query ?? {});
    const query: z.infer<typeof querySchema> = parsed.success ? parsed.data : {};
    const tab = resolveLogTab(query.aba);
    const page = tab === 'erros' ? Math.min(query.pagina ?? 1, MAX_ERROR_PAGE) : (query.pagina ?? 1);
    const onlyErrors = tab === 'erros' || query.erros === '1';
    const filter: RecentLogFilter = { onlyErrors, ...(query.sdr ? { sdrAgentId: query.sdr } : {}) };
    const agents = await sdrAgentRepository.list();
    const sdrNames = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.name]));
    const offset = (page - 1) * LOGS_PAGE_SIZE;
    // Uma linha a mais que a pagina diz se existe a proxima, sem contar a tabela inteira.
    const take = LOGS_PAGE_SIZE + 1;

    let rows: LogRow[];
    if (tab === 'tarefas') {
      rows = (await sources.jobLogRepository.listRecent(filter, take, offset)).map((log) => jobLogRow(log, sdrNames));
    } else if (tab === 'ia') {
      rows = (await sources.aiRunRepository.listRecent(filter, take, offset)).map((run) => aiRunRow(run, sdrNames));
    } else if (tab === 'webhooks') {
      rows = (await sources.webhookEventRepository.listRecent(filter, take, offset)).map((event) => webhookRow(event, sdrNames));
    } else {
      // Erros das tres tabelas na mesma lista: le de cada uma o bastante para cobrir a pagina e
      // ordena junto. So erro, entao o volume e pequeno mesmo nas paginas mais fundas.
      const enough = offset + take;
      const [jobs, runs, events] = await Promise.all([
        sources.jobLogRepository.listRecent(filter, enough, 0),
        sources.aiRunRepository.listRecent(filter, enough, 0),
        sources.webhookEventRepository.listRecent(filter, enough, 0),
      ]);
      rows = [
        ...jobs.map((log) => jobLogRow(log, sdrNames)),
        ...runs.map((run) => aiRunRow(run, sdrNames)),
        ...events.map((event) => webhookRow(event, sdrNames)),
      ]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(offset, offset + take);
    }

    return reply.type('text/html').send(
      renderLogsPage({
        tab,
        rows: rows.slice(0, LOGS_PAGE_SIZE),
        page,
        hasNext: rows.length > LOGS_PAGE_SIZE && !(tab === 'erros' && page >= MAX_ERROR_PAGE),
        sdrAgentId: query.sdr ?? '',
        onlyErrors,
        agents,
        timeZone: env.DEFAULT_TIMEZONE,
      }),
    );
  });

  // Endereços antigos (menu, favoritos, links em texto de alerta) continuam funcionando.
  app.get('/job-logs', async (_request, reply) => reply.redirect('/registros?aba=tarefas'));
  app.get('/ai-runs', async (_request, reply) => reply.redirect('/registros?aba=ia'));
  app.get('/webhook-events', async (_request, reply) => reply.redirect('/registros?aba=webhooks'));
}
