import type { FastifyReply, FastifyRequest } from 'fastify';

export const sessionCookieName = 'sdr_portal_session';

export interface SessionData {
  userId: string;
}

export function setSessionCookie(reply: FastifyReply, session: SessionData): void {
  reply.setCookie(sessionCookieName, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    signed: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: '/' });
}

export function getSession(request: FastifyRequest): SessionData | null {
  const cookie = request.cookies[sessionCookieName];

  if (!cookie) {
    return null;
  }

  const unsigned = request.unsignCookie(cookie);

  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(unsigned.value) as Partial<SessionData>;
    return typeof parsedSession.userId === 'string' ? { userId: parsedSession.userId } : null;
  } catch {
    return null;
  }
}
