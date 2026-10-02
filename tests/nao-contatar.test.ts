import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMemoryAuthRepository } from '../src/modules/auth/auth-repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createMemoryContactBlockRepository } from '../src/modules/leads/contact-block-repository.js';
import { importLeadsFromExcel } from '../src/modules/leads/lead-importer.js';
import { createMemoryLeadRepository } from '../src/modules/leads/lead-repository.js';

const KYBERNAN = 'company-kybernan';
const INSUMO = 'company-insumo';

async function planilha(numero: string) {
  return writeXlsxFile([
    ['numero_whatsapp', 'nome_empresa'],
    [numero, 'Pizzaria Florida'],
  ]).toBuffer();
}

async function baseCom(lead: { companyId: string; sdrAgentId: string; whatsappNumber: string; status?: string }) {
  const leadRepository = createMemoryLeadRepository();
  await leadRepository.create({ ...lead, companyName: 'Pizzaria Florida', status: lead.status ?? 'initial_sent', source: 'manual' });
  return leadRepository;
}

describe('importacao nao traz de volta quem nao deve', () => {
  it('o mesmo numero sem o nono digito e o mesmo lead', async () => {
    const leadRepository = await baseCom({ companyId: KYBERNAN, sdrAgentId: 'mariana', whatsappNumber: '5519999990000' });

    const result = await importLeadsFromExcel({
      buffer: await planilha('(19) 9999-0000'),
      companyId: KYBERNAN,
      fileName: 'lote.xlsx',
      leadRepository,
      sdrAgentId: 'mariana',
    });

    expect(result.successRows).toBe(0);
    expect(result.errors[0]).toContain('ja cadastrado para este SDR');
  });

  it('outro SDR da mesma empresa nao aborda a mesma loja', async () => {
    const leadRepository = await baseCom({ companyId: KYBERNAN, sdrAgentId: 'mariana', whatsappNumber: '5519999990000' });

    const result = await importLeadsFromExcel({
      buffer: await planilha('19999990000'),
      companyId: KYBERNAN,
      fileName: 'lote.xlsx',
      leadRepository,
      sdrAgentId: 'outro-sdr-kybernan',
    });

    expect(result.errors[0]).toContain('outro SDR desta empresa');
  });

  it('outra empresa pode abordar: vende outra coisa', async () => {
    const leadRepository = await baseCom({ companyId: INSUMO, sdrAgentId: 'francielly', whatsappNumber: '5519999990000', status: 'not_interested' });

    const result = await importLeadsFromExcel({
      buffer: await planilha('19999990000'),
      companyId: KYBERNAN,
      fileName: 'lote.xlsx',
      leadRepository,
      sdrAgentId: 'mariana',
    });

    expect(result.successRows).toBe(1);
  });

  it('numero que ja se mostrou sem WhatsApp nao volta para a fila', async () => {
    const leadRepository = await baseCom({ companyId: INSUMO, sdrAgentId: 'francielly', whatsappNumber: '5519999990000', status: 'invalid_phone' });

    const result = await importLeadsFromExcel({
      buffer: await planilha('19999990000'),
      companyId: KYBERNAN,
      fileName: 'lote.xlsx',
      leadRepository,
      sdrAgentId: 'mariana',
    });

    expect(result.errors[0]).toContain('nao tem WhatsApp');
  });

  it('a lista de nao contatar vale para qualquer empresa', async () => {
    const contactBlockRepository = createMemoryContactBlockRepository();
    await contactBlockRepository.add({ whatsappNumber: '5519999990000', reason: 'e taxi', source: 'portal:admin' });

    const result = await importLeadsFromExcel({
      buffer: await planilha('(19) 9999-0000'),
      companyId: KYBERNAN,
      contactBlockRepository,
      fileName: 'lote.xlsx',
      leadRepository: createMemoryLeadRepository(),
      sdrAgentId: 'mariana',
    });

    expect(result.successRows).toBe(0);
    expect(result.errors[0]).toContain('nao contatar (e taxi)');
  });
});

describe('tela do lead bloqueia o numero', () => {
  it('bloqueia, marca sem interesse e permite tirar da lista', async () => {
    const authRepository = createMemoryAuthRepository();
    await authRepository.createUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('segredo123'),
      role: 'admin',
    });
    const leadRepository = createMemoryLeadRepository();
    const contactBlockRepository = createMemoryContactBlockRepository();
    const lead = await leadRepository.create({
      companyId: KYBERNAN,
      sdrAgentId: 'mariana',
      whatsappNumber: '5519999990000',
      companyName: 'Gringa Smoke',
      status: 'in_conversation',
      source: 'manual',
    });
    const app = buildApp({ authRepository, contactBlockRepository, leadRepository });
    const login = await app.inject({ method: 'POST', url: '/login', payload: { email: 'admin@example.com', password: 'segredo123' } });
    const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;

    await app.inject({ method: 'POST', url: `/leads/${lead.id}/nao-contatar`, headers: { cookie }, payload: { motivo: 'esse telefone e de taxi' } });

    const block = await contactBlockRepository.findBlocked('551999990000');
    expect(block?.reason).toBe('esse telefone e de taxi');
    expect(block?.source).toBe('portal:admin@example.com');
    expect((await leadRepository.findById(lead.id))?.status).toBe('not_interested');

    const page = await app.inject({ method: 'GET', url: '/leads/nao-contatar', headers: { cookie } });
    expect(page.body).toContain('esse telefone e de taxi');

    const removed = await app.inject({
      method: 'POST',
      url: `/leads/nao-contatar/${block?.id}/remover`,
      headers: { cookie },
      payload: { voltar: 'https://site-externo.example/' },
    });
    // Redirect so para dentro do portal.
    expect(removed.headers.location).toBe('/leads/nao-contatar');
    expect(await contactBlockRepository.findBlocked('5519999990000')).toBeNull();
    await app.close();
  });
});
