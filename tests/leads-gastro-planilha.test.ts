import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { importLeadsFromExcel, inspectLeadExcel } from '../src/modules/leads/lead-importer.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';

// A planilha de leads de gastronomia (docs/leads/) so serve se o proprio import
// do portal engolir ela. Ja quebrou uma vez de dois jeitos ao mesmo tempo:
// celula vazia gravada como inline string vazia (o read-excel-file aborta o
// arquivo inteiro) e cabecalho "Nome" que nao e alias de companyName.
const PLANILHA = new URL('../docs/leads/leads-gastro-delivery-sp.xlsx', import.meta.url);

function buffer(): Buffer {
  return readFileSync(PLANILHA);
}

describe('planilha de leads de gastronomia', () => {
  it('e lida pelo parser do portal', async () => {
    const preview = await inspectLeadExcel(buffer());

    expect(preview.totalRows).toBeGreaterThan(0);
    expect(preview.headers.length).toBeGreaterThan(0);
  });

  it('mapeia sozinha as colunas obrigatorias e as opcionais', async () => {
    const preview = await inspectLeadExcel(buffer());

    expect(preview.headers[preview.mapping.whatsappNumber ?? -1]).toBe('WhatsApp');
    expect(preview.headers[preview.mapping.companyName ?? -1]).toBe('Nome da empresa');
    expect(preview.headers[preview.mapping.segment ?? -1]).toBe('Segmento');
    expect(preview.headers[preview.mapping.city ?? -1]).toBe('Cidade');
    expect(preview.headers[preview.mapping.state ?? -1]).toBe('Estado');
  });

  it('importa todas as linhas sem erro', async () => {
    const leadRepository = createMemoryLeadRepository();
    const result = await importLeadsFromExcel({
      buffer: buffer(),
      companyId: 'empresa-1',
      fileName: 'leads-gastro-delivery-sp.xlsx',
      leadRepository,
      sdrAgentId: 'sdr-1',
    });

    expect(result.errors).toEqual([]);
    expect(result.errorRows).toBe(0);
    expect(result.successRows).toBe(result.totalRows);
    expect(result.successRows).toBeGreaterThan(0);
  });

  it('grava todo numero como 55 + DDD + numero', async () => {
    const leadRepository = createMemoryLeadRepository();
    await importLeadsFromExcel({
      buffer: buffer(),
      companyId: 'empresa-1',
      fileName: 'leads-gastro-delivery-sp.xlsx',
      leadRepository,
      sdrAgentId: 'sdr-1',
    });

    const leads = await leadRepository.list();
    const foraDoPadrao = leads.map((lead) => lead.whatsappNumber).filter((numero) => !/^55\d{10,11}$/.test(numero));

    expect(foraDoPadrao).toEqual([]);
  });
});
