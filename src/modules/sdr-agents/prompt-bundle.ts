import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SdrAgent } from '../../db/schema.js';
import { resolveSdrPlaybook, type SdrPlaybook } from '../ai/sdr-playbooks.js';

/**
 * Os prompts de producao vivem no banco, mas o texto revisado vive em docs/prompts/<sdr>/.
 * Este modulo le aquele diretorio e diz, campo a campo, o que precisaria mudar no SDR —
 * a parte pura do script que aplica os prompts (src/db/apply-sdr-prompts.ts).
 */

/** Campo do SDR que este bundle sabe preencher, e o arquivo de onde ele vem. */
export const PROMPT_FILES = {
  prompt: 'prompt.txt',
  offerDescription: 'offer-description.txt',
  firstMessagePrompt: 'first-message-prompt.txt',
  secondMessage: 'second-message.txt',
  followupPrompt: 'followup-prompt.txt',
  bumpPrompt: 'bump-prompt.txt',
  leadQualificationPrompt: 'lead-qualification-prompt.txt',
  handoffMessageTemplate: 'handoff-template.txt',
} as const;

/**
 * Campos que nem todo SDR tem. Ausente, o arquivo nao vira aviso de bundle incompleto: a
 * abordagem de duas mensagens e uma escolha por SDR, e cobrar `second-message.txt` de quem
 * aborda com uma mensagem so faria todo `--apply` terminar com um aviso que nao e problema.
 */
const OPTIONAL_PROMPT_FIELDS = new Set<PromptField>(['secondMessage']);

export type PromptField = keyof typeof PROMPT_FILES;

/** Arquivo da mensagem inicial fixa: markdown com o texto dentro de um bloco de codigo. */
export const FIRST_MESSAGE_FILE = 'first-message-variants.md';

/** Rotulo da variante criada por este script, para nao duplicar a cada execucao. */
export const FIRST_MESSAGE_LABEL = 'Roteiro';

export interface BundleVariant {
  label: string;
  body: string;
}

export interface PromptBundle {
  /** Texto de cada campo encontrado no diretorio. Arquivo ausente = campo fora do bundle. */
  fields: Partial<Record<PromptField, string>>;
  /** Mensagem inicial fixa, se o arquivo existir e tiver um bloco de codigo. */
  firstMessage: string | null;
  /**
   * Variantes do teste A/B, quando o markdown tem a secao `## Variantes no ar`. Com ela o
   * arquivo manda nas variantes ativas; sem ela vale o bloco unico de `firstMessage`.
   */
  variants: BundleVariant[] | null;
  /** Arquivos que o diretorio nao tinha, para o script avisar em vez de sobrescrever com vazio. */
  missing: string[];
}

async function readOptionalFile(dir: string, file: string): Promise<string | null> {
  try {
    return await readFile(path.join(dir, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * O texto da mensagem inicial e o primeiro bloco de codigo do markdown: o resto do arquivo
 * e explicacao para quem le, e nao pode ir para o WhatsApp junto.
 */
export function extractFixedFirstMessage(markdown: string): string | null {
  const match = /```[^\n]*\n([\s\S]*?)```/.exec(markdown);
  const body = match?.[1]?.trim();
  return body ? body : null;
}

export const VARIANTS_SECTION = 'Variantes no ar';

/**
 * Le a secao `## Variantes no ar`: cada `### <rotulo>` seguido de um bloco de codigo e uma
 * variante ativa. `null` quando a secao nao existe. Foi o que faltou em setembro: a abordagem
 * nova da Mariana estava escrita no repositorio e a variante no banco continuou a antiga.
 */
export function extractVariantSection(markdown: string): BundleVariant[] | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${VARIANTS_SECTION.toLowerCase()}`);
  if (start === -1) return null;

  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    section.push(line);
  }

  const variants: BundleVariant[] = [];
  const parts = section.join('\n').split(/^### +/m).slice(1);
  for (const part of parts) {
    const [heading = '', ...rest] = part.split('\n');
    const label = heading.trim();
    const body = extractFixedFirstMessage(rest.join('\n'));
    if (label && body) variants.push({ label, body });
  }
  return variants;
}

export async function readPromptBundle(dir: string): Promise<PromptBundle> {
  const fields: Partial<Record<PromptField, string>> = {};
  const missing: string[] = [];

  for (const [field, file] of Object.entries(PROMPT_FILES) as [PromptField, string][]) {
    const content = await readOptionalFile(dir, file);
    if (content === null) {
      if (!OPTIONAL_PROMPT_FIELDS.has(field)) missing.push(file);
      continue;
    }
    fields[field] = content.trim();
  }

  const markdown = await readOptionalFile(dir, FIRST_MESSAGE_FILE);
  if (markdown === null) missing.push(FIRST_MESSAGE_FILE);

  const variants = markdown ? extractVariantSection(markdown) : null;
  return {
    fields,
    // Com a secao de variantes, o primeiro bloco de codigo e uma delas, nao o roteiro unico.
    firstMessage: markdown && variants === null ? extractFixedFirstMessage(markdown) : null,
    variants,
    missing,
  };
}

export interface PlannedChange {
  field: string;
  before: string | null;
  after: string;
}

export interface PromptUpdatePlan {
  /** Colunas de sdr_agents a atualizar, ja sem o que estava igual. */
  changes: PlannedChange[];
  /** Campos que o bundle trouxe e o banco ja tinha identicos. */
  unchanged: string[];
  /** Texto da variante fixa, quando ele precisa ser criado ou atualizado. */
  firstMessage: string | null;
  /** Variantes a gravar/ativar e rotulos a pausar, quando o arquivo traz a secao de variantes. */
  variantSync: { upsert: BundleVariant[]; deactivate: string[] } | null;
  /** O que o operador precisa saber antes de gravar (config que este script nao mexe). */
  warnings: string[];
}

function currentValue(agent: SdrAgent, field: PromptField): string | null {
  const value = agent[field];
  return typeof value === 'string' ? value : null;
}

export interface CurrentVariant {
  label: string;
  body: string;
  isActive: boolean;
}

function describeVariant(variant: { body: string; isActive: boolean }): string {
  return `${variant.isActive ? '[ativa]' : '[pausada]'} ${variant.body.trim()}`;
}

export function planPromptUpdate(input: {
  agent: SdrAgent;
  bundle: PromptBundle;
  currentFirstMessage: string | null;
  /** Todas as variantes gravadas do SDR. So importa quando o bundle tem a secao de variantes. */
  currentVariants?: CurrentVariant[];
  playbook: SdrPlaybook;
}): PromptUpdatePlan {
  const { agent, bundle, currentFirstMessage, playbook } = input;
  const changes: PlannedChange[] = [];
  const unchanged: string[] = [];

  for (const field of Object.keys(PROMPT_FILES) as PromptField[]) {
    const after = bundle.fields[field];
    if (after === undefined) continue;

    const before = currentValue(agent, field);
    if (before?.trim() === after) {
      unchanged.push(field);
      continue;
    }
    changes.push({ field, before, after });
  }

  if (resolveSdrPlaybook(agent.playbook) !== playbook) {
    changes.push({ field: 'playbook', before: agent.playbook, after: playbook });
  } else {
    unchanged.push('playbook');
  }

  // Sem mensagem fixa no diretorio nao da para forcar o modo: a IA continua escrevendo a
  // abertura, e trocar o modo deixaria o SDR sem primeira mensagem nenhuma.
  const firstMessageChanged = bundle.firstMessage !== null && bundle.firstMessage !== currentFirstMessage;
  if (bundle.firstMessage !== null) {
    if (firstMessageChanged) {
      changes.push({ field: FIRST_MESSAGE_FILE, before: currentFirstMessage, after: bundle.firstMessage });
    } else {
      unchanged.push(FIRST_MESSAGE_FILE);
    }

    if (agent.firstMessageMode !== 'ab_test') {
      changes.push({ field: 'firstMessageMode', before: agent.firstMessageMode, after: 'ab_test' });
    } else {
      unchanged.push('firstMessageMode');
    }
  }

  // Secao de variantes: o arquivo manda no que esta ativo. Variante fora dele so pausa — apagar
  // perderia as metricas do teste A/B que ela ja acumulou.
  let variantSync: PromptUpdatePlan['variantSync'] = null;
  if (bundle.variants !== null && bundle.variants.length > 0) {
    const current = input.currentVariants ?? [];
    const wanted = new Set(bundle.variants.map((variant) => variant.label));
    const upsert: BundleVariant[] = [];
    for (const variant of bundle.variants) {
      const existing = current.find((item) => item.label === variant.label);
      if (existing && existing.isActive && existing.body.trim() === variant.body) {
        unchanged.push(`variante:${variant.label}`);
        continue;
      }
      upsert.push(variant);
      changes.push({
        field: `variante:${variant.label}`,
        before: existing ? describeVariant(existing) : null,
        after: describeVariant({ body: variant.body, isActive: true }),
      });
    }
    const deactivate = current.filter((item) => item.isActive && !wanted.has(item.label)).map((item) => item.label);
    for (const label of deactivate) {
      const existing = current.find((item) => item.label === label);
      if (existing) changes.push({ field: `variante:${label}`, before: describeVariant(existing), after: describeVariant({ ...existing, isActive: false }) });
    }
    if (agent.firstMessageMode !== 'ab_test') {
      changes.push({ field: 'firstMessageMode', before: agent.firstMessageMode, after: 'ab_test' });
    }
    variantSync = upsert.length > 0 || deactivate.length > 0 ? { upsert, deactivate } : null;
  }

  const warnings: string[] = [];
  if (bundle.variants !== null && bundle.variants.length === 0) {
    warnings.push(`${FIRST_MESSAGE_FILE} tem a secao "${VARIANTS_SECTION}" sem variante valida (### rotulo + bloco de codigo): variantes nao mexidas`);
  }
  for (const file of bundle.missing) {
    warnings.push(`arquivo ausente no diretorio: ${file} (campo mantido como esta no banco)`);
  }
  if (bundle.firstMessage === null && bundle.variants === null && !bundle.missing.includes(FIRST_MESSAGE_FILE)) {
    warnings.push(`${FIRST_MESSAGE_FILE} nao tem bloco de codigo com a mensagem: modo da primeira mensagem nao sera alterado`);
  }
  if (playbook === 'convite' && !agent.handoffName?.trim()) {
    warnings.push('handoffName vazio: no playbook convite a IA precisa do nome da pessoa do time (ela vai falar "alguem do time")');
  }
  // Vale para qualquer playbook: e para esse numero que vai o aviso de "lead pediu para falar".
  if (!agent.handoffPhone?.trim()) {
    warnings.push('handoffPhone vazio: o aviso de handoff nao chega em ninguem');
  }

  return { changes, unchanged, firstMessage: firstMessageChanged ? bundle.firstMessage : null, variantSync, warnings };
}

/** Raiz dos prompts versionados. No container ela vem do Dockerfile, junto com `dist/`. */
export const PROMPTS_ROOT = 'docs/prompts';

export interface PromptDrift {
  dir: string;
  /** Campos cujo texto no banco nao bate com o arquivo do diretorio. */
  fields: PromptField[];
}

/**
 * Compara o que esta gravado no SDR com docs/prompts/<sdr>/. `null` quando o SDR nao tem
 * diretorio versionado: nao ha o que comparar.
 *
 * Existe porque o banco e o repositorio divergiam em silencio: a documentacao da Mariana dizia
 * desde 22/09 que a abordagem tinha mudado, e o que saia para os leads era o texto antigo.
 */
export async function findPromptDrift(agent: SdrAgent, root: string = PROMPTS_ROOT): Promise<PromptDrift | null> {
  const dir = path.join(root, promptDirNameFor(agent.name));
  const bundle = await readPromptBundle(dir);
  const fields = (Object.keys(bundle.fields) as PromptField[]).filter((field) => bundle.fields[field] !== undefined);
  if (fields.length === 0) return null;

  return { dir, fields: fields.filter((field) => (currentValue(agent, field) ?? '').trim() !== bundle.fields[field]) };
}

/**
 * Nome do diretorio de prompts de um SDR: `Mariana` -> `mariana`, `Insumo Smart` ->
 * `insumosmart`. Mora aqui, e nao no script, para poder ser testado sem abrir conexao com o
 * banco — e porque e a regra que liga um SDR ao bundle dele.
 */
export function promptDirNameFor(agentName: string): string {
  return agentName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
