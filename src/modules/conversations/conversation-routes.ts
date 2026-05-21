import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { LeadRepository } from '../leads/lead-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import type { ConversationRepository } from './conversation-repository.js';
import { renderConversationDetailPage, renderConversationNotFoundPage, renderConversationsListPage } from './conversation-pages.js';

const paramsSchema = z.object({ id: z.string().uuid() });

export function registerConversationRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  conversationRepository: ConversationRepository,
  leadRepository: LeadRepository,
  sdrAgentRepository: SdrAgentRepository,
): void {
  app.get('/conversations', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const [conversations, leads, agents] = await Promise.all([
      conversationRepository.list(),
      leadRepository.list(),
      sdrAgentRepository.list(),
    ]);
    return reply.type('text/html').send(renderConversationsListPage(conversations, leads, agents));
  });

  app.get('/conversations/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).type('text/html').send(renderConversationNotFoundPage());
    const conversation = await conversationRepository.findById(params.data.id);
    if (!conversation) return reply.status(404).type('text/html').send(renderConversationNotFoundPage());
    const [lead, messages] = await Promise.all([leadRepository.findById(conversation.leadId), conversationRepository.listMessages(conversation.id)]);
    return reply.type('text/html').send(renderConversationDetailPage(conversation, lead, messages));
  });
}
