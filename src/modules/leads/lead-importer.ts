import { readSheet } from 'read-excel-file/node';

import type { LeadRepository } from './lead-repository.js';

export const leadImportFields = [
  { key: 'whatsappNumber', label: 'WhatsApp', required: true },
  { key: 'companyName', label: 'Nome da empresa', required: true },
  { key: 'cnpj', label: 'CNPJ', required: false },
  { key: 'tradeName', label: 'Nome fantasia', required: false },
  { key: 'segment', label: 'Segmento', required: false },
  { key: 'city', label: 'Cidade', required: false },
  { key: 'state', label: 'Estado/UF', required: false },
  { key: 'contactName', label: 'Nome do contato', required: false },
] as const;

export type LeadImportField = (typeof leadImportFields)[number]['key'];
export type LeadImportMapping = Partial<Record<LeadImportField, number>>;

interface ImportLeadsInput {
  buffer: Buffer;
  companyId: string;
  fileName: string;
  leadRepository: LeadRepository;
  mapping?: LeadImportMapping;
  sdrAgentId: string;
}

interface ImportLeadsResult {
  errorRows: number;
  errors: string[];
  mapping: LeadImportMapping;
  successRows: number;
  totalRows: number;
}

export interface LeadExcelPreview {
  headers: string[];
  mapping: LeadImportMapping;
  sampleRows: string[][];
  totalRows: number;
}

const aliases: Record<LeadImportField, string[]> = {
  whatsappNumber: ['numero whatsapp', 'numero do whatsapp', 'whatsapp', 'telefone', 'celular', 'numero', 'phone'],
  cnpj: ['cnpj', 'documento'],
  companyName: ['nome da empresa', 'empresa', 'razao social', 'company name', 'nome empresa'],
  tradeName: ['nome fantasia', 'fantasia'],
  segment: ['segmento', 'setor', 'ramo', 'segment'],
  city: ['cidade', 'city'],
  state: ['estado', 'uf', 'state'],
  contactName: ['contato', 'nome do contato', 'responsavel', 'contact'],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellToString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePhone(value: unknown): string {
  const digits = cellToString(value).replace(/\D/g, '');

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

function buildMapping(headers: unknown[]): LeadImportMapping {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: LeadImportMapping = {};

  for (const field of leadImportFields) {
    const fieldAliases = aliases[field.key];
    const normalizedAliases = fieldAliases.map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));

    if (index >= 0) {
      mapping[field.key] = index;
    }
  }

  return mapping;
}

function sanitizeMapping(mapping: LeadImportMapping, headerCount: number): LeadImportMapping {
  const sanitized: LeadImportMapping = {};

  for (const field of leadImportFields) {
    const index = mapping[field.key];

    if (Number.isInteger(index) && typeof index === 'number' && index >= 0 && index < headerCount) {
      sanitized[field.key] = index;
    }
  }

  return sanitized;
}

function valueByMapping(row: unknown[], mapping: LeadImportMapping, field: LeadImportField): string {
  const index = mapping[field];
  return typeof index === 'number' ? cellToString(row[index]) : '';
}

export async function inspectLeadExcel(buffer: Buffer): Promise<LeadExcelPreview> {
  const rows = await readSheet(buffer);
  const [headers, ...dataRows] = rows;

  if (!headers) {
    return { headers: [], mapping: {}, sampleRows: [], totalRows: 0 };
  }

  const stringHeaders = headers.map(cellToString);
  const sampleRows = dataRows.slice(0, 5).map((row) => stringHeaders.map((_, index) => cellToString(row[index])));

  return {
    headers: stringHeaders,
    mapping: buildMapping(headers),
    sampleRows,
    totalRows: dataRows.length,
  };
}

export async function importLeadsFromExcel(input: ImportLeadsInput): Promise<ImportLeadsResult> {
  const rows = await readSheet(input.buffer);
  const [headers, ...dataRows] = rows;
  const errors: string[] = [];

  if (!headers) {
    return { errorRows: 0, errors: ['Planilha vazia.'], mapping: {}, successRows: 0, totalRows: 0 };
  }

  const mapping = input.mapping ? sanitizeMapping(input.mapping, headers.length) : buildMapping(headers);

  if (typeof mapping.whatsappNumber !== 'number' || typeof mapping.companyName !== 'number') {
    return {
      errorRows: dataRows.length,
      errors: ['Colunas obrigatorias nao encontradas: WhatsApp e nome da empresa.'],
      mapping,
      successRows: 0,
      totalRows: dataRows.length,
    };
  }

  let successRows = 0;

  for (const [index, row] of dataRows.entries()) {
    const line = index + 2;
    const whatsappNumber = normalizePhone(row[mapping.whatsappNumber]);
    const companyName = valueByMapping(row, mapping, 'companyName');

    if (!whatsappNumber || whatsappNumber.length < 10) {
      errors.push(`Linha ${line}: WhatsApp invalido.`);
      continue;
    }

    if (!companyName) {
      errors.push(`Linha ${line}: nome da empresa vazio.`);
      continue;
    }

    const existingLead = await input.leadRepository.findBySdrAndWhatsapp(input.sdrAgentId, whatsappNumber);

    if (existingLead) {
      errors.push(`Linha ${line}: WhatsApp ja cadastrado para este SDR.`);
      continue;
    }

    await input.leadRepository.create({
      companyId: input.companyId,
      sdrAgentId: input.sdrAgentId,
      whatsappNumber,
      companyName,
      cnpj: valueByMapping(row, mapping, 'cnpj') || null,
      tradeName: valueByMapping(row, mapping, 'tradeName') || null,
      segment: valueByMapping(row, mapping, 'segment') || null,
      city: valueByMapping(row, mapping, 'city') || null,
      state: valueByMapping(row, mapping, 'state') || null,
      contactName: valueByMapping(row, mapping, 'contactName') || null,
      extraData: null,
      status: 'pending',
      source: `import:${input.fileName}`,
    });
    successRows += 1;
  }

  return {
    errorRows: errors.length,
    errors,
    mapping,
    successRows,
    totalRows: dataRows.length,
  };
}
