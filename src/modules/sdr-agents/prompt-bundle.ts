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
  followupPrompt: 'followup-prompt.txt',
  bumpPrompt: 'bump-prompt.txt',
  leadQualificationPrompt: 'lead-qualification-prompt.txt',
  handoffMessageTemplate: 'handoff-template.txt',
} as const;

export type PromptField = keyof typeof PROMPT_FILES;

/** Arquivo da mensagem inicial fixa: markdown com o texto dentro de um bloco de codigo. */
export const FIRST_MESSAGE_FILE = 'first-message-variants.md';

/** Rotulo da variante criada por este script, para nao duplicar a cada execucao. */
export const FIRST_MESSAGE_LABEL = 'Roteiro';

export interface PromptBundle {
  /** Texto de cada campo encontrado no diretorio. Arquivo ausente = campo fora do bundle. */
  fields: Partial<Record<PromptField, string>>;
  /** Mensagem inicial fixa, se o arquivo existir e tiver um bloco de codigo. */
  firstMessage: string | null;
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

export async function readPromptBundle(dir: string): Promise<PromptBundle> {
  const fields: Partial<Record<PromptField, string>> = {};
  const missing: string[] = [];

  for (const [field, file] of Object.entries(PROMPT_FILES) as [PromptField, string][]) {
    const content = await readOptionalFile(dir, file);
    if (content === null) {
      missing.push(file);
      continue;
    }
    fields[field] = content.trim();
  }

  const markdown = await readOptionalFile(dir, FIRST_MESSAGE_FILE);
  if (markdown === null) missing.push(FIRST_MESSAGE_FILE);

  return {
    fields,
    firstMessage: markdown ? extractFixedFirstMessage(markdown) : null,
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
  /** O que o operador precisa saber antes de gravar (config que este script nao mexe). */
  warnings: string[];
}

function currentValue(agent: SdrAgent, field: PromptField): string | null {
  const value = agent[field];
  return typeof value === 'string' ? value : null;
}

export function planPromptUpdate(input: {
  agent: SdrAgent;
  bundle: PromptBundle;
  currentFirstMessage: string | null;
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

  const warnings: string[] = [];
  for (const file of bundle.missing) {
    warnings.push(`arquivo ausente no diretorio: ${file} (campo mantido como esta no banco)`);
  }
  if (bundle.firstMessage === null && !bundle.missing.includes(FIRST_MESSAGE_FILE)) {
    warnings.push(`${FIRST_MESSAGE_FILE} nao tem bloco de codigo com a mensagem: modo da primeira mensagem nao sera alterado`);
  }
  if (playbook === 'convite' && !agent.handoffName?.trim()) {
    warnings.push('handoffName vazio: no playbook convite a IA precisa do nome da pessoa do time (ela vai falar "alguem do time")');
  }
  if (playbook === 'convite' && !agent.handoffPhone?.trim()) {
    warnings.push('handoffPhone vazio: o aviso de handoff nao chega em ninguem');
  }

  return { changes, unchanged, firstMessage: firstMessageChanged ? bundle.firstMessage : null, warnings };
}
