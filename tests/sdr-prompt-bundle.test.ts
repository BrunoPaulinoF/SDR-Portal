import { describe, expect, it } from 'vitest';

import type { SdrAgent } from '../src/db/schema.js';
import {
  FIRST_MESSAGE_FILE,
  extractFixedFirstMessage,
  planPromptUpdate,
  readPromptBundle,
} from '../src/modules/sdr-agents/prompt-bundle.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

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
    expect(prompt).toContain('acompanhar de perto os números da operação e transformá-los em decisões práticas para a gestão financeira');
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
    const bundle = await readPromptBundle('docs/prompts/mariana');

    const plan = planPromptUpdate({ agent, bundle, currentFirstMessage: null, playbook: 'consultivo' });

    expect(plan.changes.map((change) => change.field)).not.toContain('firstMessageMode');
    expect(plan.warnings.join(' ')).toContain(FIRST_MESSAGE_FILE);
  });
});
