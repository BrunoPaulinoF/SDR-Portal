import { describe, expect, it } from 'vitest';

import { buildSdrSystemPrompt, SDR_BASE_PROMPT } from '../src/modules/ai/sdr-base-prompt.js';
import { SDR_PLAYBOOK_FUNNELS } from '../src/modules/ai/sdr-playbooks.js';

/**
 * Conversa da Divinos (26/08): 11 turnos seguidos so de despedida, e nenhum handoff
 * apesar de a lead ter dito que gostou e que ia testar. Os dois defeitos eram de prompt.
 */
describe('encerramento de conversa', () => {
  it('manda responder a despedida uma vez so e calar depois', () => {
    expect(SDR_BASE_PROMPT).toContain('Despedida e encerramento:');
    expect(SDR_BASE_PROMPT).toContain('Despedida se responde UMA vez');
    expect(SDR_BASE_PROMPT).toContain('Nao existe segunda despedida sua na mesma conversa');
  });

  it('reconhece loop pela ideia repetida, nao pelo texto identico', () => {
    expect(SDR_BASE_PROMPT).toContain('O que conta e a IDEIA repetida, nao o texto igual');
    expect(SDR_BASE_PROMPT).toContain('"ate mais", "ate logo" e "foi um prazer"');
  });

  it('inclui a despedida ja respondida na lista fechada de casos de silencio', () => {
    // Sem isso, calar depois da despedida quebrava a regra "ficar em silencio e excecao".
    expect(SDR_BASE_PROMPT).toContain('despedida que voce ja respondeu');
  });

  it('nao trata como despedida a cortesia que vem com pergunta ou assunto novo', () => {
    expect(SDR_BASE_PROMPT).toContain('pergunta, duvida, objecao, assunto novo ou pedido');
  });

  it('leva as regras de encerramento para o prompt montado de qualquer SDR', () => {
    const prompt = buildSdrSystemPrompt({ sdrName: 'Mariana', playbook: 'consultivo' });
    expect(prompt).toContain('Despedida e encerramento:');
  });
});

describe('handoff por interesse no playbook consultivo', () => {
  const consultivo = SDR_PLAYBOOK_FUNNELS.consultivo;

  it('lista os sinais de interesse que disparam a oferta de handoff', () => {
    expect(consultivo).toContain('Como reconhecer o interesse');
    for (const sinal of ['que interessante', 'gostei', 'vou testar', 'vou ver com a equipe']) {
      expect(consultivo).toContain(sinal);
    }
  });

  it('nao deixa a IA esperar o lead pedir preco ou pedir humano', () => {
    expect(consultivo).toContain('No PRIMEIRO sinal desses, va para handoff_offer');
    expect(consultivo).toContain('quem espera o lead pedir handoff quase nunca recebe o pedido');
  });

  it('separa a pergunta da passagem do acionamento do handoff', () => {
    expect(consultivo).toContain('handoff_offer e uma PERGUNTA, nao um anuncio');
    expect(consultivo).toContain('acione notify_handoff na MESMA resposta');
  });

  it('manda oferecer a pessoa do time antes de se despedir', () => {
    expect(consultivo).toContain('faca a pergunta ANTES de se despedir');
  });

  it('nao contamina o playbook convite, que ja tem o proprio bloco de sim', () => {
    expect(SDR_PLAYBOOK_FUNNELS.convite).not.toContain('Como reconhecer o interesse');
    expect(SDR_PLAYBOOK_FUNNELS.convite).toContain('Como reconhecer o sim');
  });
});
