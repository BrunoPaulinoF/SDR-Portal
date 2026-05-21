import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthRepository, AuthUser } from './auth-repository.js';
import { getSession } from './session.js';

export async function getCurrentUser(request: FastifyRequest, repository: AuthRepository): Promise<AuthUser | null> {
  const session = getSession(request);
  return session ? repository.findById(session.userId) : null;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AuthRepository,
): Promise<AuthUser | null> {
  const user = await getCurrentUser(request, repository);

  if (!user) {
    await reply.redirect('/login');
    return null;
  }

  return user;
}
