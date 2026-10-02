import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import {
  FIRST_MESSAGE_FILE,
  extractFixedFirstMessage,
  planPromptUpdate,
  readPromptBundle,
} from '../src/modules/sdr-agents/prompt-bundle.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { promptDirNameFor } from '../src/modules/sdr-agents/prompt-bundle.js';

const INSUMOSMART_DIR = 'docs/prompts/insumosmart';

async function makeAgent(overrides: Partial<SdrAgent> = {}): Promise<SdrAgent> {
  const repo = createMemorySdrAgentRepository();
  const agent = await repo.create({ companyId: 'company-1', name: 'sdr-insumo-smart', displayName: 'Francielly' });
  return { ...agent, ...overrides };
}

describe('bundle de prompts do repositorio', () => {
  it('le so o bloco de codigo do markdown da mensagem inicial', () => {
    const markdown = ['# Titulo', '', 'Explicacao que nao pode ir para o WhatsApp.', '', '```', 'Opa, tudo bom?', '```', '', 'Mais texto.'].join('\n');

    expect(extractFixedFirstMessage(markdown)).toBe('Opa, tudo bom?');
    expect(extractFixedFirstMessage('markdown sem bloco nenhum')).toBeNull();
  });

  it('carrega os prompts da Insumo Smart do diretorio versionado', async () => {
    const bundle = await readPromptBundle(INSUMOSMART_DIR);

    expect(bundle.missing).toEqual([]);
    expect(bundle.fields.prompt).toContain('bora trocar uma ideia');
    expect(bundle.fields.followupPrompt).toContain('fechando as empresas');
    // So o cumprimento sai no disparo: os outros tres blocos a IA manda um por resposta.
    expect(bundle.firstMessage).toBe('Opa, tudo bom?');
    expect(bundle.fields.prompt).toContain('Também estou no ramo da gastronomia');
    expect(bundle.fields.prompt).toContain('Acho que podemos fazer esse projeto juntos, bora trocar uma ideia?');
  });

  it('traz o pedido de indicacao para quem nao e (mais) do ramo', async () => {
    const bundle = await readPromptBundle(INSUMOSMART_DIR);
    const prompt = bundle.fields.prompt ?? '';

    // O erro relatado nos prints: lead ex-gastronomia oferecendo contatos e ouvindo "nao precisa".
    expect(prompt).toContain('Contato oferecido não se recusa nunca');
    expect(prompt).toContain('será que pode me passar algum contato que se interessaria, por favor?');
    expect(prompt).toContain('notify_referral');
    expect(prompt).toContain('Informal não é seco');
  });

  it('pede autorizacao antes de passar o lead para o Fernando', async () => {
    const bundle = await readPromptBundle(INSUMOSMART_DIR);
    const prompt = bundle.fields.prompt ?? '';

    // O print do cliente: "ja pedi pra ele entrar em contato com voce" sem nunca ter perguntado.
    expect(prompt).toContain('Posso pedir para o Fernando te chamar?');
    expect(prompt).toContain('Nesta mensagem você NÃO aciona nada');
    expect(prompt).toContain('QUANDO NÃO PERGUNTAR');
    expect(prompt).toContain('NUNCA avise que o Fernando vai entrar em contato sem ter pedido autorização antes');
    // O lead que some depois da pergunta nao pode receber o roteiro de novo no follow-up.
    expect(bundle.fields.followupPrompt).toContain('pergunta da passagem');
  });

  it('explica a proposta central em vez de guardar o que a Insumo Smart faz', async () => {
    const bundle = await readPromptBundle(INSUMOSMART_DIR);
    const prompt = bundle.fields.prompt ?? '';

    // A curiosidade preservada e a aplicacao na casa do lead, nao o que a empresa faz.
    expect(prompt).toContain('acompanhar de perto os números da operação');
    // Sem as tres palavras concretas a pessoa ouve "acompanhar os números" e nao entende nada:
    // foi a frase sem elas que a Casa & Comida ouviu antes de responder "nao temos interesse".
    expect(prompt).toContain('custo de insumo, margem por prato e preço de cardápio');
    expect(prompt).toContain('Como cada casa tem uma realidade');
    // O que soava despreparo nos prints.
    expect(prompt).toContain('Nunca diga "só o Fernando sabe explicar"');
    expect(prompt).toContain('NÃO PRESUMA PROBLEMA');
    expect(prompt).toContain('NUNCA repita a mesma resposta');
    // A oferta nao pode entregar a "dor" como diagnostico pronto do lead.
    expect(bundle.fields.offerDescription).toContain('NÃO é diagnóstico deste lead');
  });

  it('planeja playbook, modo da primeira mensagem e prompts para um SDR ainda consultivo', async () => {
    const agent = await makeAgent({ playbook: 'consultivo', firstMessageMode: 'ai', handoffName: 'Fernando', handoffPhone: '11988887777' });
    const bundle = await readPromptBundle(INSUMOSMART_DIR);

    const plan = planPromptUpdate({ agent, bundle, currentFirstMessage: null, playbook: 'convite' });
    const fields = plan.changes.map((change) => change.field);

    expect(fields).toContain('playbook');
    expect(fields).toContain('firstMessageMode');
    expect(fields).toContain('prompt');
    expect(fields).toContain(FIRST_MESSAGE_FILE);
    expect(plan.firstMessage).toBe(bundle.firstMessage);
    expect(plan.warnings).toEqual([]);
  });

  it('nao propoe nada quando o banco ja esta igual aos arquivos', async () => {
    const bundle = await readPromptBundle(INSUMOSMART_DIR);
    const agent = await makeAgent({
      playbook: 'convite',
      firstMessageMode: 'ab_test',
      handoffName: 'Fernando',
      handoffPhone: '11988887777',
      prompt: bundle.fields.prompt ?? null,
      offerDescription: bundle.fields.offerDescription ?? null,
      firstMessagePrompt: bundle.fields.firstMessagePrompt ?? null,
      followupPrompt: bundle.fields.followupPrompt ?? null,
      bumpPrompt: bundle.fields.bumpPrompt ?? null,
      leadQualificationPrompt: bundle.fields.leadQualificationPrompt ?? null,
      handoffMessageTemplate: bundle.fields.handoffMessageTemplate ?? null,
    });

    const plan = planPromptUpdate({ agent, bundle, currentFirstMessage: bundle.firstMessage, playbook: 'convite' });

    expect(plan.changes).toEqual([]);
    expect(plan.firstMessage).toBeNull();
  });

  it('avisa quando o convite nao tem pessoa de handoff configurada', async () => {
    const agent = await makeAgent({ handoffName: null, handoffPhone: null });
    const bundle = await readPromptBundle(INSUMOSMART_DIR);

    const plan = planPromptUpdate({ agent, bundle, currentFirstMessage: null, playbook: 'convite' });

    expect(plan.warnings.join(' ')).toContain('handoffName vazio');
    expect(plan.warnings.join(' ')).toContain('handoffPhone vazio');
  });

  it('nao mexe no modo da primeira mensagem quando o diretorio nao tem roteiro', async () => {
    const agent = await makeAgent({ firstMessageMode: 'ai' });
    // Markdown sem bloco de codigo e sem secao de variantes: so explicacao.
    const bundle = { ...(await readPromptBundle('docs/prompts/mariana')), firstMessage: null, variants: null };

    const plan = planPromptUpdate({ agent, bundle, currentFirstMessage: null, playbook: 'consultivo' });

    expect(plan.changes.map((change) => change.field)).not.toContain('firstMessageMode');
    expect(plan.warnings.join(' ')).toContain(FIRST_MESSAGE_FILE);
  });
});

/**
 * O script tinha `DEFAULT_DIR = 'docs/prompts/insumosmart'`: rodar `--agent="Mariana" --apply`,
 * que e a forma documentada no CLAUDE.md, gravava os prompts da Insumo Smart na Mariana e ainda
 * trocava o playbook dela para `convite`. Em 27/08 ela passou a se apresentar como SDR da
 * Insumo Smart para os leads da KyberFood.
 */
describe('diretorio de prompts sai do nome do SDR', () => {
  it('deriva o diretorio de cada SDR', () => {
    expect(promptDirNameFor('Mariana')).toBe('mariana');
    expect(promptDirNameFor('Insumo Smart')).toBe('insumosmart');
  });

  it('ignora acento, caixa e pontuacao', () => {
    expect(promptDirNameFor('Franciely')).toBe('franciely');
    expect(promptDirNameFor('SDR Açaí-Express')).toBe('sdracaiexpress');
  });

  // O que existe no repositorio tem de casar com o que o script vai procurar sozinho.
  it('casa com os bundles versionados', () => {
    for (const sdr of ['mariana', 'insumosmart']) {
      expect(existsSync(join('docs/prompts', sdr))).toBe(true);
    }
    expect(promptDirNameFor('Mariana')).toBe('mariana');
  });
});

describe('variantes versionadas no arquivo', () => {
  it('le cada ### rotulo com o bloco de codigo da secao', async () => {
    const { extractVariantSection } = await import('../src/modules/sdr-agents/prompt-bundle.js');
    const markdown = [
      '# Titulo',
      '```',
      'bloco fora da secao',
      '```',
      '## Variantes no ar',
      'texto de explicacao',
      '### A',
      '```',
      'oi, aqui e a Mariana',
      '```',
      '### B',
      'sem bloco nao vale',
      '### C',
      '```text',
      'oi! Mariana aqui',
      '```',
      '## Outra secao',
      '### D',
      '```',
      'fora',
      '```',
    ].join('\n');

    expect(extractVariantSection(markdown)).toEqual([
      { label: 'A', body: 'oi, aqui e a Mariana' },
      { label: 'C', body: 'oi! Mariana aqui' },
    ]);
    expect(extractVariantSection('# sem secao')).toBeNull();
  });

  it('a Mariana tem duas variantes no ar e nenhum roteiro unico', async () => {
    const bundle = await readPromptBundle('docs/prompts/mariana');

    expect(bundle.variants?.map((variant) => variant.label)).toEqual(['Nao e pedido', 'Nao sou cliente']);
    expect(bundle.firstMessage).toBeNull();
    for (const variant of bundle.variants ?? []) {
      // Nada do que a segunda mensagem explica entra na primeira.
      expect(variant.body).not.toMatch(/comercial|\bIA\b|teste gr/i);
    }
  });

  it('grava as do arquivo e pausa a variante antiga, sem apagar', async () => {
    const bundle = await readPromptBundle('docs/prompts/mariana');
    const agent = await createMemorySdrAgentRepository().create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });

    const plan = planPromptUpdate({
      agent: { ...agent, firstMessageMode: 'ab_test' },
      bundle,
      currentFirstMessage: null,
      currentVariants: [{ label: 'B', body: 'Olá, tudo bem? Me chamo Mariana, sou do comercial da KyberFood.', isActive: true }],
      playbook: 'consultivo',
    });

    expect(plan.variantSync?.upsert.map((variant) => variant.label)).toEqual(['Nao e pedido', 'Nao sou cliente']);
    expect(plan.variantSync?.deactivate).toEqual(['B']);
    expect(plan.changes.find((change) => change.field === 'variante:B')?.after).toContain('[pausada]');
  });

  it('nao mexe quando o banco ja esta igual ao arquivo', async () => {
    const bundle = await readPromptBundle('docs/prompts/mariana');
    const agent = await createMemorySdrAgentRepository().create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });

    const plan = planPromptUpdate({
      agent: { ...agent, firstMessageMode: 'ab_test' },
      bundle,
      currentFirstMessage: null,
      currentVariants: (bundle.variants ?? []).map((variant) => ({ ...variant, isActive: true })),
      playbook: 'consultivo',
    });

    expect(plan.variantSync).toBeNull();
    expect(plan.unchanged).toContain('variante:Nao e pedido');
  });
});
