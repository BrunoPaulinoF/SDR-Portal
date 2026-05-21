import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { verifyPassword } from './password.js';
import type { AuthRepository } from './auth-repository.js';
import { clearSessionCookie, setSessionCookie } from './session.js';
import { renderLoginPage } from './auth-pages.js';
import { getCurrentUser } from './access.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, repository: AuthRepository): void {
  app.get('/', async (_request, reply) => reply.redirect('/dashboard'));

  app.get('/login', async (request, reply) => {
    const user = await getCurrentUser(request, repository);

    if (user) {
      return reply.redirect('/dashboard');
    }

    return reply.type('text/html').send(renderLoginPage());
  });

  app.post('/login', async (request, reply) => {
    const parsedBody = loginSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.status(400).type('text/html').send(renderLoginPage('Informe e-mail e senha validos.'));
    }

    const email = parsedBody.data.email.toLowerCase();
    const user = await repository.findByEmail(email);
    const isValidPassword = user ? await verifyPassword(user.passwordHash, parsedBody.data.password) : false;

    if (!user || !isValidPassword) {
      return reply.status(401).type('text/html').send(renderLoginPage('E-mail ou senha invalidos.'));
    }

    setSessionCookie(reply, { userId: user.id });
    return reply.redirect('/dashboard');
  });

  app.post('/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return reply.redirect('/login');
  });

}
