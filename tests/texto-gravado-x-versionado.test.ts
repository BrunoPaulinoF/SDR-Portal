import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import { repeatsSecondMessage } from '../src/modules/first-message-variants/first-message-variant-pages.js';
import { findPromptDrift } from '../src/modules/sdr-agents/prompt-bundle.js';
import { renderSdrAgentTabPage } from '../src/modules/sdr-agents/sdr-agent-pages.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

async function mariana(overrides: Partial<SdrAgent> = {}): Promise<SdrAgent> {
  const agent = await createMemorySdrAgentRepository().create({ companyId: 'company-1', name: 'Mariana', displayName: 'Mariana', isActive: true });
  return { ...agent, ...overrides };
}

async function promptsRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'prompts-'));
  await mkdir(path.join(root, 'mariana'));
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, 'mariana', file), content);
  return root;
}

describe('texto gravado x versionado', () => {
  it('aponta o campo cujo texto no banco nao bate com o arquivo', async () => {
    const root = await promptsRoot({ 'prompt.txt': 'prompt novo\n', 'followup-prompt.txt': 'retomada' });
    const agent = await mariana({ prompt: 'prompt antigo', followupPrompt: 'retomada' });

    const drift = await findPromptDrift(agent, root);

    expect(drift?.fields).toEqual(['prompt']);
  });

  it('SDR sem diretorio versionado nao tem o que comparar', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'prompts-'));

    expect(await findPromptDrift(await mariana(), root)).toBeNull();
  });

  it('a tela do SDR mostra o aviso com o comando para gravar', async () => {
    const agent = await mariana();
    const html = renderSdrAgentTabPage({ agent, companies: [], tab: 'conversa', drift: { dir: 'docs/prompts/mariana', fields: ['prompt', 'secondMessage'] } });

    expect(html).toContain('esta diferente de <code>docs/prompts/mariana</code>');
    expect(html).toContain('<code>prompt.txt</code>, <code>second-message.txt</code>');
    expect(html).toContain('apply-sdr-prompts.js --agent="Mariana" --apply');
  });

  it('sem divergencia a tela fica como era', async () => {
    const html = renderSdrAgentTabPage({ agent: await mariana(), companies: [], tab: 'conversa', drift: { dir: 'docs/prompts/mariana', fields: [] } });

    expect(html).not.toContain('esta diferente de');
  });
});

describe('variante que repete a segunda mensagem', () => {
  const segunda =
    'a KyberFood é uma IA que atende o WhatsApp do delivery: responde na hora, a qualquer hora, entende áudio e monta o pedido inteiro.';

  it('pega a variante B que ficou no ar ate 29/09', () => {
    const antiga =
      'Olá, tudo bem? Me chamo Mariana, sou do comercial da KyberFood. A gente tem uma IA que atende o WhatsApp do delivery, responde na hora e monta o pedido sozinha. Falo com {{responsavel}}?';

    expect(repeatsSecondMessage(antiga, segunda)).toBe(true);
  });

  it('a apresentacao curta passa', () => {
    const curta = 'Olá, tudo bem? Me chamo Mariana, sou da KyberFood. Queria falar sobre o atendimento do WhatsApp de vocês. Falo com {{responsavel}}?';

    expect(repeatsSecondMessage(curta, segunda)).toBe(false);
  });

  it('sem segunda mensagem nao ha o que repetir', () => {
    expect(repeatsSecondMessage('qualquer texto com uma IA que atende o WhatsApp do delivery', null)).toBe(false);
  });
});
