import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AiRunRepository } from '../ai/ai-run-repository.js';
import { requireUser } from '../auth/access.js';
import type { AuthRepository } from '../auth/auth-repository.js';
import type { CompanyRepository } from '../companies/company-repository.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { SdrAgentRepository } from '../sdr-agents/sdr-agent-repository.js';
import { importLeadsFromExcel, inspectLeadExcel, leadImportFields, type LeadImportMapping } from './lead-importer.js';
import type { LeadInput, LeadRepository } from './lead-repository.js';
import {
  renderEditLeadPage,
  renderImportLeadsPage,
  renderImportMappingPage,
  renderImportResultPage,
  renderLeadDetailPage,
  renderLeadNotFoundPage,
  renderLeadsListPage,
  renderNewLeadPage,
} from './lead-pages.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const IMPORT_DRAFT_TTL_MS = 30 * 60 * 1000;

interface LeadImportDraft {
  buffer: Buffer;
  companyId: string;
  createdAt: number;
  fileName: string;
  sdrAgentId: string;
}

const leadFormSchema = z.object({
  companyId: z.string().uuid(),
  sdrAgentId: z.string().uuid(),
  whatsappNumber: z.string().trim().min(10),
  cnpj: z.string().trim().optional().default(''),
  companyName: z.string().trim().min(1),
  tradeName: z.string().trim().optional().default(''),
  segment: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  state: z.string().trim().optional().default(''),
  contactName: z.string().trim().optional().default(''),
  extraData: z.string().trim().optional().default(''),
  status: z.string().trim().min(1).default('pending'),
});

function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

function parseLeadInput(body: unknown): LeadInput | null {
  const parsed = leadFormSchema.safeParse(body);

  if (!parsed.success) {
    return null;
  }

  return {
    companyId: parsed.data.companyId,
    sdrAgentId: parsed.data.sdrAgentId,
    whatsappNumber: normalizePhone(parsed.data.whatsappNumber),
    cnpj: emptyToNull(parsed.data.cnpj),
    companyName: parsed.data.companyName,
    tradeName: emptyToNull(parsed.data.tradeName),
    segment: emptyToNull(parsed.data.segment),
    city: emptyToNull(parsed.data.city),
    state: emptyToNull(parsed.data.state),
    contactName: emptyToNull(parsed.data.contactName),
    extraData: emptyToNull(parsed.data.extraData),
    status: parsed.data.status,
    source: 'manual',
  };
}

async function isValidRelation(input: LeadInput, companyRepository: CompanyRepository, sdrAgentRepository: SdrAgentRepository): Promise<boolean> {
  const [company, agent] = await Promise.all([companyRepository.findById(input.companyId), sdrAgentRepository.findById(input.sdrAgentId)]);
  return Boolean(company && agent && agent.companyId === input.companyId);
}

function getBodyField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const value = (body as Record<string, unknown>)[field];
  const firstValue = Array.isArray(value) ? value[0] : value;
  return String(firstValue ?? '');
}

function parseImportMapping(body: unknown): LeadImportMapping {
  const mapping: LeadImportMapping = {};

  for (const field of leadImportFields) {
    const value = getBodyField(body, field.key);
    const index = Number(value);

    if (value !== '' && Number.isInteger(index) && index >= 0) {
      mapping[field.key] = index;
    }
  }

  return mapping;
}

function pruneImportDrafts(importDrafts: Map<string, LeadImportDraft>, now = Date.now()): void {
  for (const [token, draft] of importDrafts.entries()) {
    if (now - draft.createdAt > IMPORT_DRAFT_TTL_MS) {
      importDrafts.delete(token);
    }
  }
}

export function registerLeadRoutes(
  app: FastifyInstance,
  authRepository: AuthRepository,
  companyRepository: CompanyRepository,
  sdrAgentRepository: SdrAgentRepository,
  leadRepository: LeadRepository,
  aiRunRepository: AiRunRepository,
  jobLogRepository: JobLogRepository,
): void {
  const importDrafts = new Map<string, LeadImportDraft>();

  app.get('/leads', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const [leads, companies, agents] = await Promise.all([leadRepository.list(), companyRepository.list(), sdrAgentRepository.list()]);
    return reply.type('text/html').send(renderLeadsListPage(leads, companies, agents));
  });

  app.get('/leads/new', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const [companies, agents] = await Promise.all([companyRepository.list(), sdrAgentRepository.list()]);
    return reply.type('text/html').send(renderNewLeadPage(companies, agents));
  });

  app.post('/leads', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const [companies, agents] = await Promise.all([companyRepository.list(), sdrAgentRepository.list()]);
    const input = parseLeadInput(request.body);

    if (!input || !(await isValidRelation(input, companyRepository, sdrAgentRepository))) {
      return reply.status(400).type('text/html').send(renderNewLeadPage(companies, agents, 'Confira os campos obrigatorios e o vinculo empresa/SDR.'));
    }

    const existing = await leadRepository.findBySdrAndWhatsapp(input.sdrAgentId, input.whatsappNumber);
    if (existing) {
      return reply.status(409).type('text/html').send(renderNewLeadPage(companies, agents, 'Este WhatsApp ja esta cadastrado para o SDR selecionado.'));
    }

    await leadRepository.create(input);
    return reply.redirect('/leads');
  });

  app.get('/leads/:id/edit', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    const [lead, companies, agents] = await Promise.all([leadRepository.findById(params.data.id), companyRepository.list(), sdrAgentRepository.list()]);
    if (!lead) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    return reply.type('text/html').send(renderEditLeadPage(lead, companies, agents));
  });

  app.post('/leads/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    const [lead, companies, agents] = await Promise.all([leadRepository.findById(params.data.id), companyRepository.list(), sdrAgentRepository.list()]);
    if (!lead) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    const input = parseLeadInput(request.body);
    if (!input || !(await isValidRelation(input, companyRepository, sdrAgentRepository))) {
      return reply.status(400).type('text/html').send(renderEditLeadPage(lead, companies, agents, 'Confira os campos obrigatorios e o vinculo empresa/SDR.'));
    }
    await leadRepository.update(params.data.id, input);
    return reply.redirect('/leads');
  });

  app.get('/leads/:id', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    const [lead, agents] = await Promise.all([leadRepository.findById(params.data.id), sdrAgentRepository.list()]);
    if (!lead) return reply.status(404).type('text/html').send(renderLeadNotFoundPage());
    const company = await companyRepository.findById(lead.companyId);
    const [aiRuns, jobLogs] = await Promise.all([aiRunRepository.findByLeadId(lead.id), jobLogRepository.findByLeadId(lead.id)]);
    return reply.type('text/html').send(renderLeadDetailPage(lead, company, agents, aiRuns, jobLogs));
  });

  app.post('/leads/:id/delete', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const params = paramsSchema.safeParse(request.params);
    if (params.success) await leadRepository.delete(params.data.id);
    return reply.redirect('/leads');
  });

  app.get('/leads/import', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const [companies, agents, imports] = await Promise.all([companyRepository.list(), sdrAgentRepository.list(), leadRepository.listImports()]);
    return reply.type('text/html').send(renderImportLeadsPage(companies, agents, imports));
  });

  app.post('/leads/import', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;
    const fields = new Map<string, string>();
    let fileName = 'leads.xlsx';
    let buffer: Buffer | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        fileName = part.filename;
        buffer = await part.toBuffer();
      } else {
        fields.set(part.fieldname, String(part.value ?? ''));
      }
    }

    const [companies, agents, imports] = await Promise.all([companyRepository.list(), sdrAgentRepository.list(), leadRepository.listImports()]);
    const companyId = fields.get('companyId') ?? '';
    const sdrAgentId = fields.get('sdrAgentId') ?? '';
    const agent = await sdrAgentRepository.findById(sdrAgentId);

    if (!buffer || !companyId || !agent || agent.companyId !== companyId) {
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'Envie um arquivo e selecione empresa/SDR validos.'));
    }

    let preview;
    try {
      preview = await inspectLeadExcel(buffer);
    } catch {
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'Nao foi possivel ler o arquivo Excel enviado.'));
    }

    if (preview.headers.length === 0) {
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'A planilha enviada esta vazia.'));
    }

    pruneImportDrafts(importDrafts);
    const token = randomUUID();
    importDrafts.set(token, { buffer, companyId, createdAt: Date.now(), fileName, sdrAgentId });
    const company = companies.find((item) => item.id === companyId);

    return reply.type('text/html').send(
      renderImportMappingPage({
        agentName: agent.displayName ?? agent.name,
        companyName: company?.name ?? companyId,
        fileName,
        mapping: preview.mapping,
        preview,
        token,
      }),
    );
  });

  app.post('/leads/import/confirm', async (request, reply) => {
    const user = await requireUser(request, reply, authRepository);
    if (!user) return undefined;

    pruneImportDrafts(importDrafts);
    const token = getBodyField(request.body, 'token');
    const draft = importDrafts.get(token);
    const [companies, agents, imports] = await Promise.all([companyRepository.list(), sdrAgentRepository.list(), leadRepository.listImports()]);

    if (!draft) {
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'Upload expirado. Envie a planilha novamente.'));
    }

    const agent = await sdrAgentRepository.findById(draft.sdrAgentId);
    if (!agent || agent.companyId !== draft.companyId) {
      importDrafts.delete(token);
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'Empresa/SDR invalidos para esta importacao.'));
    }

    let preview;
    try {
      preview = await inspectLeadExcel(draft.buffer);
    } catch {
      importDrafts.delete(token);
      return reply.status(400).type('text/html').send(renderImportLeadsPage(companies, agents, imports, 'Nao foi possivel reler o arquivo Excel enviado.'));
    }

    const mapping = parseImportMapping(request.body);
    const whatsappColumn = mapping.whatsappNumber;
    const companyNameColumn = mapping.companyName;
    const hasValidRequiredMapping =
      typeof whatsappColumn === 'number' && typeof companyNameColumn === 'number' && whatsappColumn < preview.headers.length && companyNameColumn < preview.headers.length;
    const company = companies.find((item) => item.id === draft.companyId);

    if (!hasValidRequiredMapping) {
      return reply.status(400).type('text/html').send(
        renderImportMappingPage({
          agentName: agent.displayName ?? agent.name,
          companyName: company?.name ?? draft.companyId,
          error: 'Selecione as colunas obrigatorias de WhatsApp e nome da empresa.',
          fileName: draft.fileName,
          mapping,
          preview,
          token,
        }),
      );
    }

    const result = await importLeadsFromExcel({
      buffer: draft.buffer,
      companyId: draft.companyId,
      fileName: draft.fileName,
      leadRepository,
      mapping,
      sdrAgentId: draft.sdrAgentId,
    });
    importDrafts.delete(token);
    const leadImport = await leadRepository.createImport({
      companyId: draft.companyId,
      sdrAgentId: draft.sdrAgentId,
      fileName: draft.fileName,
      totalRows: result.totalRows,
      successRows: result.successRows,
      errorRows: result.errorRows,
      mapping: JSON.stringify(result.mapping),
      errors: JSON.stringify(result.errors, null, 2),
    });

    return reply.type('text/html').send(renderImportResultPage(leadImport));
  });
}
