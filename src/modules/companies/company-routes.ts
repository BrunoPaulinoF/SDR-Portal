import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthRepository } from '../auth/auth-repository.js';
import { requireUser } from '../auth/access.js';
import type { CompanyInput, CompanyRepository } from './company-repository.js';
import { renderCompaniesListPage, renderCompanyNotFoundPage, renderEditCompanyPage, renderNewCompanyPage } from './company-pages.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const companyFormSchema = z.object({
  name: z.string().trim().min(1),
  legalName: z.string().trim().optional().default(''),
  cnpj: z.string().trim().optional().default(''),
  segment: z.string().trim().optional().default(''),
  description: z.string().trim().optional().default(''),
  websiteUrl: z.string().trim().optional().default(''),
  defaultHandoffName: z.string().trim().optional().default(''),
  defaultHandoffPhone: z.string().trim().optional().default(''),
});

function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function parseCompanyInput(body: unknown): CompanyInput | null {
  const parsedBody = companyFormSchema.safeParse(body);

  if (!parsedBody.success) {
    return null;
  }

  return {
    name: parsedBody.data.name,
    legalName: emptyToNull(parsedBody.data.legalName),
    cnpj: emptyToNull(parsedBody.data.cnpj),
    segment: emptyToNull(parsedBody.data.segment),
    description: emptyToNull(parsedBody.data.description),
    websiteUrl: emptyToNull(parsedBody.data.websiteUrl),
    defaultHandoffName: emptyToNull(parsedBody.data.defaultHandoffName),
    defaultHandoffPhone: emptyToNull(parsedBody.data.defaultHandoffPhone),
  };
}

export function registerCompanyRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  companyRepository: CompanyRepository,
): void {
  app.get('/companies', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const companies = await companyRepository.list();
    return reply.type('text/html').send(renderCompaniesListPage(companies));
  });

  app.get('/companies/new', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    return reply.type('text/html').send(renderNewCompanyPage());
  });

  app.post('/companies', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const input = parseCompanyInput(request.body);

    if (!input) {
      return reply.status(400).type('text/html').send(renderNewCompanyPage('Informe pelo menos o nome da empresa.'));
    }

    await companyRepository.create(input);
    return reply.redirect('/companies');
  });

  app.get('/companies/:id/edit', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(404).type('text/html').send(renderCompanyNotFoundPage());
    }

    const company = await companyRepository.findById(params.data.id);

    if (!company) {
      return reply.status(404).type('text/html').send(renderCompanyNotFoundPage());
    }

    return reply.type('text/html').send(renderEditCompanyPage(company));
  });

  app.post('/companies/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(404).type('text/html').send(renderCompanyNotFoundPage());
    }

    const input = parseCompanyInput(request.body);
    const company = await companyRepository.findById(params.data.id);

    if (!company) {
      return reply.status(404).type('text/html').send(renderCompanyNotFoundPage());
    }

    if (!input) {
      return reply.status(400).type('text/html').send(renderEditCompanyPage(company, 'Informe pelo menos o nome da empresa.'));
    }

    await companyRepository.update(params.data.id, input);
    return reply.redirect('/companies');
  });

  app.post('/companies/:id/delete', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);

    if (!user) {
      return undefined;
    }

    const params = paramsSchema.safeParse(request.params);

    if (params.success) {
      await companyRepository.delete(params.data.id);
    }

    return reply.redirect('/companies');
  });
}
