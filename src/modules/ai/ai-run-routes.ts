import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { AiRunRepository } from './ai-run-repository.js';
import { renderAiRunsPage } from './ai-run-pages.js';

export function registerAiRunRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  aiRunRepository: AiRunRepository,
): void {
  app.get('/ai-runs', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const runs = await aiRunRepository.list();
    return reply.type('text/html').send(renderAiRunsPage(runs));
  });
}
