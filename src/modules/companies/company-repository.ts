import { randomUUID } from 'node:crypto';

import type { Company, NewCompany } from '../../db/schema.js';

export type CompanyInput = Pick<
  NewCompany,
  'name' | 'legalName' | 'cnpj' | 'segment' | 'description' | 'websiteUrl' | 'defaultHandoffName' | 'defaultHandoffPhone'
>;

export interface CompanyRepository {
  create(input: CompanyInput): Promise<Company>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Company | null>;
  list(): Promise<Company[]>;
  update(id: string, input: CompanyInput): Promise<Company | null>;
}

export function createMemoryCompanyRepository(seedCompanies: Company[] = []): CompanyRepository {
  const rows = new Map<string, Company>();

  for (const company of seedCompanies) {
    rows.set(company.id, company);
  }

  return {
    async create(input) {
      const now = new Date();
      const company: Company = {
        id: randomUUID(),
        name: input.name,
        legalName: input.legalName ?? null,
        cnpj: input.cnpj ?? null,
        segment: input.segment ?? null,
        description: input.description ?? null,
        websiteUrl: input.websiteUrl ?? null,
        defaultHandoffName: input.defaultHandoffName ?? null,
        defaultHandoffPhone: input.defaultHandoffPhone ?? null,
        createdAt: now,
        updatedAt: now,
      };

      rows.set(company.id, company);
      return company;
    },

    async delete(id) {
      rows.delete(id);
    },

    async findById(id) {
      return rows.get(id) ?? null;
    },

    async list() {
      return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    async update(id, input) {
      const current = rows.get(id);

      if (!current) {
        return null;
      }

      const company: Company = {
        ...current,
        name: input.name,
        legalName: input.legalName ?? null,
        cnpj: input.cnpj ?? null,
        segment: input.segment ?? null,
        description: input.description ?? null,
        websiteUrl: input.websiteUrl ?? null,
        defaultHandoffName: input.defaultHandoffName ?? null,
        defaultHandoffPhone: input.defaultHandoffPhone ?? null,
        updatedAt: new Date(),
      };

      rows.set(id, company);
      return company;
    },
  };
}
