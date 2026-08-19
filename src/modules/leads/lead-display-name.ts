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

/** Formas societarias no fim do nome: uteis no cadastro, estranhas numa conversa de zap. */
const LEGAL_SUFFIX = /[\s,.-]+(ltda|limitada|me|epp|eireli|s\s*[./]?\s*a|mei|em recuperacao judicial)\.?$/i;

const PLACEHOLDER_NAMES = ['lead sem cadastro', 'contato sem cadastro', 'sua empresa', 'sem cadastro'];

const TITLE_CASE_LOWER_WORDS = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por']);

/** Palavras que so aparecem em nome de negocio: se sobrarem depois do documento, o que restou nao e nome de pessoa. */
const BUSINESS_WORDS = new Set([
  'acai', 'acaiteria', 'adega', 'alimentacao', 'alimenticio', 'alimento', 'bar', 'bebida', 'bistro', 'bufe', 'buffet',
  'burger', 'burguer', 'cafe', 'cafeteria', 'cantina', 'casa', 'chopp', 'churrascaria', 'clinica', 'comercial',
  'comercio', 'comida', 'confeitaria', 'conveniencia', 'delivery', 'deposito', 'distribuidora', 'doce', 'doceria',
  'eireli', 'emporio', 'empreendimento', 'entretenimento', 'epp', 'espetaria', 'estetica', 'fabrica', 'fabricacao',
  'food', 'frutaria', 'gastronomia', 'gelateria', 'grupo', 'hamburgueria', 'horti', 'hortifrut', 'hotelaria',
  'hoteleiro', 'lanche', 'lanchonete', 'lounge', 'ltda', 'marmitaria', 'mercadinho', 'mercado', 'mercearia', 'padaria',
  'paes', 'panificadora', 'pastelaria', 'pescado', 'pizza', 'pizzaria', 'pub', 'refeicao', 'restaurante', 'rotisseria',
  'rotisserie', 'salgado', 'servico', 'snack', 'sorveteria', 'studio', 'supermercado', 'sushi', 'tempero',
]);

/** Femininos que nao terminam em -a e masculinos que terminam em -a, onde a regra da terminacao erraria. */
const FEMININE_HEADS = new Set(['creperie', 'lanchonete', 'pizza', 'rotisserie']);
const MASCULINE_HEADS = new Set(['cinema', 'clima', 'dia', 'mapa', 'sofa']);

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function hasLetters(value: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(value);
}

function withoutAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function wordsOf(value: string): string[] {
  return withoutAccents(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function looksLikeBusinessName(value: string): boolean {
  // O cadastro mistura singular e plural ("LANCHES", "LANCHONETES"): a lista guarda o singular.
  return wordsOf(value).some((word) => BUSINESS_WORDS.has(word) || (word.endsWith('s') && BUSINESS_WORDS.has(word.slice(0, -1))));
}

/**
 * Razao social que e so o nome do titular, sem o documento colado que denuncia o MEI
 * ("ERICA CRISTINA GUIMARAES PEREIRA LUIZ"). Sem isso a abordagem sai como
 * "Falo com a pessoa responsavel pela Erica Cristina Guimaraes Pereira Luiz?".
 *
 * O que separa dos nomes de negocio, medido sobre os 1.333 cadastros sem documento da base:
 * forma societaria no fim (empresa), "&" ou digito (empresa), qualquer palavra de ramo
 * (empresa). O que sobra — dois ou mais termos, so letras — e nome de pessoa em 140 dos 141
 * casos. Vale so para a razao social: nome fantasia e marca escolhida, nunca cadastro da Receita.
 */
function looksLikePersonName(value: string): boolean {
  if (LEGAL_SUFFIX.test(value) || value.includes('&')) return false;

  const words = wordsOf(value);
  return words.length >= 2 && !words.some((word) => /\d/.test(word)) && !looksLikeBusinessName(value);
}

/** Razao social de MEI sem o documento colado. Vazio quando o valor nao segue nenhum dos dois formatos de MEI. */
function withoutMeiDocument(value: string): string {
  if (MEI_CPF_SUFFIX.test(value)) return value.replace(MEI_CPF_SUFFIX, '').trim();
  if (MEI_CNPJ_PREFIX.test(value)) return value.replace(MEI_CNPJ_PREFIX, '').trim();
  return '';
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
  // Tira ate duas formas seguidas ("Fulano ME Ltda"), sem deixar o nome vazio.
  let stripped = value.replace(/\s{2,}/g, ' ').trim();
  for (let round = 0; round < 2; round += 1) {
    const withoutSuffix = stripped.replace(LEGAL_SUFFIX, '').trim();
    if (!withoutSuffix || withoutSuffix === stripped) break;
    stripped = withoutSuffix;
  }

  const collapsed = stripped;
  if (/[a-zà-ÿ]/.test(collapsed)) return collapsed;

  return collapsed
    .split(' ')
    .map((token, index) => {
      const lower = token.toLowerCase();
      if (index > 0 && TITLE_CASE_LOWER_WORDS.has(lower)) return lower;
      // Siglas sem vogal (ZM, JB, BBQ) ficam melhor em caixa alta; "ZE"/"PA" nao sao siglas.
      if (!/[aeiouà-ü]/i.test(token)) return token;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function businessNameFrom(lead: Lead, value: string | null | undefined, kind: 'legal' | 'trade'): string {
  const name = leadNameForPrompt(lead, value);
  if (!name) return '';

  const withoutDocument = withoutMeiDocument(name);
  // Sem documento colado a razao social ainda pode ser so o nome do titular.
  if (!withoutDocument) return kind === 'legal' && looksLikePersonName(name) ? '' : prettifyBusinessName(name);
  // Razao social de MEI: so aproveitamos quando o que sobra e nome de negocio
  // ("12.345.678 PIZZARIA DO ZE"), nunca o nome da pessoa fisica.
  return looksLikeBusinessName(withoutDocument) ? prettifyBusinessName(withoutDocument) : '';
}

/** Razao social utilizavel ({{razaosocial}}). Vazio quando so ha nome de pessoa fisica. */
export function legalBusinessName(lead: Lead): string {
  return businessNameFrom(lead, lead.companyName, 'legal') || businessNameFrom(lead, lead.tradeName, 'trade');
}

/** Nome comercial utilizavel ({{restaurante}}), priorizando o nome fantasia. */
export function tradeBusinessName(lead: Lead): string {
  return businessNameFrom(lead, lead.tradeName, 'trade') || businessNameFrom(lead, lead.companyName, 'legal');
}

/**
 * Nome do titular quando a razao social e MEI ("29.729.620 CHRISTIAN SAMUEL BARBOSA"
 * -> "Christian Samuel Barbosa"). O documento nunca acompanha o retorno. Vazio quando
 * o cadastro nao segue o formato de MEI ou quando o que sobra e nome de negocio.
 */
export function ownerPersonName(lead: Lead): string {
  for (const [value, kind] of [[lead.companyName, 'legal'], [lead.tradeName, 'trade']] as const) {
    const name = leadNameForPrompt(lead, value);
    if (!name) continue;

    const withoutDocument = withoutMeiDocument(name);
    if (withoutDocument) {
      if (!looksLikeBusinessName(withoutDocument)) return prettifyBusinessName(withoutDocument);
      continue;
    }

    if (kind === 'legal' && looksLikePersonName(name)) return prettifyBusinessName(name);
  }

  return '';
}

/** Primeiro nome do titular do MEI, para tratar a pessoa pelo nome. */
export function ownerFirstName(lead: Lead): string {
  return ownerPersonName(lead).split(' ')[0] ?? '';
}

/** Como chamar a pessoa ({{nome}}): o contato cadastrado ou, na falta dele, o titular do MEI. */
export function contactDisplayName(lead: Lead): string {
  return leadNameForPrompt(lead, lead.contactName) || ownerFirstName(lead);
}

/** "pela Padaria X", "pelo Restaurante Y", "por ZM BBQ" quando nao ha palavra da qual deduzir o genero. */
function businessPreposition(name: string): string {
  const head = wordsOf(name).find((word) => word.length >= 3 && /[aeiou]/.test(word));
  if (!head) return 'por';
  if (FEMININE_HEADS.has(head)) return 'pela';
  if (MASCULINE_HEADS.has(head)) return 'pelo';
  // "-acao/-icao" sao femininos (alimentacao, refeicao); "-ao" de aumentativo (galpao, sinucao) nao.
  return head.endsWith('a') || /(?:acao|icao|dade|gem|tude|ice)$/.test(head) ? 'pela' : 'pelo';
}

/**
 * Complemento de "Falo com ___?" na abordagem inicial ({{responsavel}}): o nome real do
 * negocio quando existe, senao o primeiro nome do contato cadastrado. O titular do MEI
 * nunca entra aqui — o generico pergunta pelo papel quando nao ha nome utilizavel.
 */
export function responsibleReference(lead: Lead): string {
  const business = tradeBusinessName(lead);
  if (business) return `a pessoa responsável ${businessPreposition(business)} ${business}`;

  // Um contato cadastrado de verdade (planilha) pode ser tratado pelo nome.
  const contactName = leadNameForPrompt(lead, lead.contactName);
  if (contactName) return contactName.split(' ')[0] ?? contactName;

  // Sem nome de negocio nem contato, so sobra o titular do MEI — e o numero costuma ser da
  // loja, do conjuge ou de um filho. Perguntar pelo papel evita o "nao, aqui e a filha dela".
  return 'a pessoa responsável pela loja';
}

/**
 * Um lead so e "abordado por nos" se a primeira mensagem partiu do SDR. Sem isso,
 * foi o lead que chamou e a IA nao pode agir como se tivesse iniciado a conversa.
 */
export function leadStartedTheConversation(lead: Lead): boolean {
  return !lead.firstMessageSentAt;
}
