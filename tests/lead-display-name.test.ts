import { describe, expect, it } from 'vitest';

import { responsibleReference, tradeBusinessName } from '../src/modules/leads/lead-display-name.js';
import type { Lead } from '../src/db/schema.js';

const NOW = new Date('2026-08-25T11:00:00.000Z');

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    companyId: 'company-1',
    sdrAgentId: 'sdr-1',
    whatsappNumber: '5519999990000',
    whatsappJid: null,
    whatsappLid: null,
    cnpj: null,
    companyName: 'Empresa',
    tradeName: null,
    segment: null,
    city: null,
    state: 'SP',
    contactName: null,
    extraData: null,
    status: 'pending',
    conversationStage: 'permission',
    source: 'manual',
    firstMessageVariantId: null,
    firstMessageSentAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    followupDueAt: null,
    followupSentAt: null,
    followupDisabledAt: null,
    followupAttempts: 0,
    humanPausedUntil: null,
    aiPausedAt: null,
    aiPauseReason: null,
    handoffRequestedAt: null,
    handoffSummary: null,
    notInterestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Nome como ele veio da lista, cidade do cadastro, nome que o dono usaria. */
const catalogNames: [string, string | null, string][] = [
  ['Suprema Pizza - Rodízio de pizza e delivery de pizza', 'Rio Claro', 'Suprema Pizza'],
  ['Escher Burger - Hambúrguer Gourmet - Hambúrguer artesanal', 'Rio Claro', 'Escher Burger'],
  // Os dois cortes se somam: primeiro o rabo depois do traco, depois a cidade colada.
  ['Pizzaria Pertutti Pizza Limeira - Disk Pizza', 'Limeira', 'Pizzaria Pertutti Pizza'],
  ['Point da Pizza | Araras', 'Araras', 'Point da Pizza'],
  ['Bella Capri Pizzaria - Rio Claro', 'Rio Claro', 'Bella Capri Pizzaria'],
  ['Destak Lanches - Araras', 'Araras', 'Destak Lanches'],
  ['Bom Beef Burgers Rio Claro', 'Rio Claro', 'Bom Beef Burgers'],
  ['Instinto Burger & Steaks Pirassununga', 'Pirassununga', 'Instinto Burger & Steaks'],
  ['X Calota Limeira', 'Limeira', 'X Calota'],
];

/** O que o corte NAO pode tocar: sem rabo de catalogo, ou com corte que apagaria a loja. */
const untouchedNames: [string, string | null][] = [
  ['Casa & Comida Restaurante', 'Rio Claro'],
  ['Dê Lanches Hambúrgueria Artesanal', 'Limeira'],
  ['General Burger House', 'Limeira'],
  // Cortar a cidade deixaria so a palavra de ramo: e ela que separa esta loja das outras.
  ['Pizzaria Limeira', 'Limeira'],
  // Mesmo caso com separador: o que vem antes do traco nao identifica ninguem.
  ['Pizzaria - Dom Rei', 'Rio Claro'],
  // Traco sem espaco e parte do nome, nao separador de catalogo.
  ['Rio-Preto Burger', 'Rio Claro'],
];

describe('nome do negocio sem o rabo de catalogo', () => {
  it.each(catalogNames)('%s -> %s', (tradeName, city, expected) => {
    expect(tradeBusinessName(makeLead({ tradeName, city }))).toBe(expected);
  });

  it.each(untouchedNames)('mantem %s inteiro', (tradeName, city) => {
    expect(tradeBusinessName(makeLead({ tradeName, city }))).toBe(tradeName);
  });

  it('vale tambem para a razao social, quando nao ha nome fantasia', () => {
    const lead = makeLead({ companyName: 'SUPREMA PIZZA - RODIZIO E DELIVERY LTDA', tradeName: null, city: 'Rio Claro' });
    expect(tradeBusinessName(lead)).toBe('Suprema Pizza');
  });

  it('nao muda o nome quando o cadastro nao tem cidade', () => {
    expect(tradeBusinessName(makeLead({ tradeName: 'Bom Beef Burgers Rio Claro', city: null }))).toBe('Bom Beef Burgers Rio Claro');
  });

  it('a abordagem pergunta pelo nome curto, com a preposicao certa', () => {
    const pizza = makeLead({ tradeName: 'Suprema Pizza - Rodízio de pizza e delivery de pizza', city: 'Rio Claro' });
    expect(responsibleReference(pizza)).toBe('a pessoa responsável pela Suprema Pizza');

    const burger = makeLead({ tradeName: 'Bom Beef Burgers Rio Claro', city: 'Rio Claro' });
    expect(responsibleReference(burger)).toBe('a pessoa responsável pelo Bom Beef Burgers');
  });

  it('continua escondendo razao social que e nome de pessoa fisica', () => {
    const lead = makeLead({ companyName: 'ERICA CRISTINA GUIMARAES PEREIRA LUIZ', tradeName: null, city: 'Limeira' });
    expect(tradeBusinessName(lead)).toBe('');
    expect(responsibleReference(lead)).toBe('a pessoa responsável pela loja');
  });
});
