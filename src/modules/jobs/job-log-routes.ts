import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { JobLogRepository } from './job-log-repository.js';
import { renderJobLogsPage } from './job-log-pages.js';

export function registerJobLogRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  jobLogRepository: JobLogRepository,
): void {
  app.get('/job-logs', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const logs = await jobLogRepository.list();
    return reply.type('text/html').send(renderJobLogsPage(logs));
  });
}
