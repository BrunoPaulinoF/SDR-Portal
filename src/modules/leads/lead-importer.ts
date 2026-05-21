import { readSheet } from 'read-excel-file/node';

import type { LeadInput, LeadRepository } from './lead-repository.js';

interface ImportLeadsInput {
  buffer: Buffer;
  companyId: string;
  fileName: string;
  leadRepository: LeadRepository;
  sdrAgentId: string;
}

interface ImportLeadsResult {
  errorRows: number;
  errors: string[];
  mapping: Record<string, number>;
  successRows: number;
  totalRows: number;
}

const aliases: Record<keyof Pick<LeadInput, 'whatsappNumber' | 'cnpj' | 'companyName' | 'tradeName' | 'segment' | 'city' | 'state' | 'contactName'>, string[]> = {
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

function buildMapping(headers: unknown[]): Record<string, number> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: Record<string, number> = {};

  for (const [field, fieldAliases] of Object.entries(aliases)) {
    const normalizedAliases = fieldAliases.map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));

    if (index >= 0) {
      mapping[field] = index;
    }
  }

  return mapping;
}

function valueByMapping(row: unknown[], mapping: Record<string, number>, field: string): string {
  const index = mapping[field];
  return typeof index === 'number' ? cellToString(row[index]) : '';
}

export async function importLeadsFromExcel(input: ImportLeadsInput): Promise<ImportLeadsResult> {
  const rows = await readSheet(input.buffer);
  const [headers, ...dataRows] = rows;
  const errors: string[] = [];

  if (!headers) {
    return { errorRows: 0, errors: ['Planilha vazia.'], mapping: {}, successRows: 0, totalRows: 0 };
  }

  const mapping = buildMapping(headers);

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
