import type { Lead } from '../../db/schema.js';

/**
 * Nomes de lead que podem aparecer numa mensagem ou num prompt.
 *
 * O cadastro vem da Receita e traz muita coisa que NAO e nome de empresa:
 * placeholders ("Lead sem cadastro"), o proprio numero de WhatsApp (leads criados
 * por inbound desconhecido) e razao social de MEI, que e o nome da pessoa fisica
 * acompanhado do CPF ("FULANA DE TAL 12345678900") ou da base do CNPJ
 * ("12.345.678 FULANO DE TAL"). Nada disso pode chegar ao lead nem a IA.
 */

const MEI_CPF_SUFFIX = /\s\d{11}\s*$/;
const MEI_CNPJ_PREFIX = /^\s*\d{2}[.\s/-]?\d{3}[.\s/-]?\d{3}\s/;

const PLACEHOLDER_NAMES = ['lead sem cadastro', 'contato sem cadastro', 'sua empresa', 'sem cadastro'];

const TITLE_CASE_LOWER_WORDS = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por']);

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function hasLetters(value: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(value);
}

export function isUnsafeLeadName(value: string | null | undefined, whatsappNumber: string): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return true;

  if (PLACEHOLDER_NAMES.includes(trimmed.toLowerCase())) return true;

  const digits = onlyDigits(trimmed);
  if (!hasLetters(trimmed) && digits.length >= 8) return true;

  return digits.length > 0 && digits === onlyDigits(whatsappNumber);
}

export function leadNameForPrompt(lead: Lead, value: string | null | undefined): string {
  return isUnsafeLeadName(value, lead.whatsappNumber) ? '' : value?.trim() ?? '';
}

/** "FANTASTICA CONFEITARIA LTDA" -> "Fantastica Confeitaria Ltda". Nome ja capitalizado passa intacto. */
export function prettifyBusinessName(value: string): string {
  const collapsed = value.replace(/\s{2,}/g, ' ').trim();
  if (/[a-zà-ÿ]/.test(collapsed)) return collapsed;

  return collapsed
    .split(' ')
    .map((token, index) => {
      const lower = token.toLowerCase();
      if (index > 0 && TITLE_CASE_LOWER_WORDS.has(lower)) return lower;
      // Siglas curtas sem vogal (ZM, JB, MK) ficam melhor em caixa alta; "ZE"/"PA" nao sao siglas.
      if (token.length <= 2 && !/[aeiouà-ü]/i.test(token)) return token;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function businessNameFrom(lead: Lead, value: string | null | undefined): string {
  const name = leadNameForPrompt(lead, value);
  if (!name || MEI_CPF_SUFFIX.test(name) || MEI_CNPJ_PREFIX.test(name)) return '';
  return prettifyBusinessName(name);
}

/** Razao social utilizavel ({{razaosocial}}). Vazio quando so ha nome de pessoa fisica. */
export function legalBusinessName(lead: Lead): string {
  return businessNameFrom(lead, lead.companyName) || businessNameFrom(lead, lead.tradeName);
}

/** Nome comercial utilizavel ({{restaurante}}), priorizando o nome fantasia. */
export function tradeBusinessName(lead: Lead): string {
  return businessNameFrom(lead, lead.tradeName) || businessNameFrom(lead, lead.companyName);
}

/**
 * Um lead so e "abordado por nos" se a primeira mensagem partiu do SDR. Sem isso,
 * foi o lead que chamou e a IA nao pode agir como se tivesse iniciado a conversa.
 */
export function leadStartedTheConversation(lead: Lead): boolean {
  return !lead.firstMessageSentAt;
}
