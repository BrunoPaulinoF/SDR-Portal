import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import { renderWebhookEventsPage } from './webhook-event-pages.js';
import type { WebhookEventRepository } from './webhook-event-repository.js';

export function registerWebhookEventRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  webhookEventRepository: WebhookEventRepository,
): void {
  app.get('/webhook-events', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const events = await webhookEventRepository.list();
    return reply.type('text/html').send(renderWebhookEventsPage(events));
  });
}
