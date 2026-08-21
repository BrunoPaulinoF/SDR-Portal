import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { renderFollowupOutreachResultPage, renderInitialOutreachResultPage, renderPendingReplyResultPage } from './scheduler-pages.js';
import type { createFollowupOutreachService } from './followup-outreach.js';
import type { createInitialOutreachService } from './initial-outreach.js';
import type { createPendingReplyService } from './pending-reply.js';

type InitialOutreachService = ReturnType<typeof createInitialOutreachService>;
type FollowupOutreachService = ReturnType<typeof createFollowupOutreachService>;
type PendingReplyService = ReturnType<typeof createPendingReplyService>;

export function registerSchedulerRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  initialOutreachService: InitialOutreachService,
  followupOutreachService: FollowupOutreachService,
  pendingReplyService: PendingReplyService,
): void {
  app.post('/scheduler/initial-outreach/run', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const result = await initialOutreachService.runOnce();
    return reply.type('text/html').send(renderInitialOutreachResultPage(result));
  });

  app.post('/scheduler/followup/run', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const result = await followupOutreachService.runOnce();
    return reply.type('text/html').send(renderFollowupOutreachResultPage(result));
  });

  app.post('/scheduler/pending-reply/run', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    const result = await pendingReplyService.runOnce();
    return reply.type('text/html').send(renderPendingReplyResultPage(result));
  });
}
