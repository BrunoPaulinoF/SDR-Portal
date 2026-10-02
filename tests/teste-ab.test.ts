import { describe, expect, it } from 'vitest';

import { abVerdict, AB_MIN_SAMPLE, twoProportionPValue } from '../src/modules/first-message-variants/ab-verdict.js';
import { renderFirstMessageVariantsPage } from '../src/modules/first-message-variants/first-message-variant-pages.js';
import { createMemorySdrAgentRepository } from '../src/modules/sdr-agents/sdr-agent-repository.js';

describe('p-valor de duas proporcoes', () => {
  it('diferenca grande com amostra grande e real', () => {
    expect(twoProportionPValue({ sent: 400, replied: 120 }, { sent: 400, replied: 60 })).toBeLessThan(0.001);
  });

  it('a "variante nova melhor" de agosto era acaso', () => {
    // 2 de 24 contra 8 de 58 (mariana-2026-08-28.md): nenhuma conclusao possivel.
    expect(twoProportionPValue({ sent: 24, replied: 2 }, { sent: 58, replied: 8 })).toBeGreaterThan(0.3);
  });
});

describe('veredito do teste A/B', () => {
  it('com uma variante so nao ha teste', () => {
    expect(abVerdict([{ id: 'a', label: 'A', sent: 300, replied: 60 }]).summary).toContain('Uma variante so');
  });

  it('nao decide antes da amostra minima', () => {
    const verdict = abVerdict([
      { id: 'a', label: 'A', sent: 40, replied: 15 },
      { id: 'b', label: 'B', sent: 40, replied: 5 },
    ]);

    expect(verdict.summary).toContain('Ainda nao da para decidir');
    expect(verdict.perVariant.get('b')).toBe(`Amostra pequena: faltam ${AB_MIN_SAMPLE - 40} envios para comparar.`);
  });

  it('declara vencedora so com diferenca real', () => {
    const verdict = abVerdict([
      { id: 'a', label: 'A', sent: 200, replied: 70 },
      { id: 'b', label: 'B', sent: 200, replied: 30 },
    ]);

    expect(verdict.summary).toContain('A venceu');
    expect(verdict.perVariant.get('b')).toContain('Pior que A de verdade');
  });

  it('empate continua empate', () => {
    const verdict = abVerdict([
      { id: 'a', label: 'A', sent: 200, replied: 44 },
      { id: 'b', label: 'B', sent: 200, replied: 40 },
    ]);

    expect(verdict.summary).toContain('Sem vencedora ainda');
    expect(verdict.perVariant.get('b')).toContain('pode ser acaso');
  });
});

describe('tela de mensagem inicial', () => {
  it('mostra resposta de gente, handoff e o resultado do teste', async () => {
    const base = await createMemorySdrAgentRepository().create({ companyId: 'c1', name: 'Mariana', displayName: 'Mariana', isActive: true });
    const agent = { ...base, firstMessageMode: 'ab_test' };
    const variant = (id: string, label: string) => ({
      id,
      sdrAgentId: agent.id,
      label,
      body: `Oi, aqui e a Mariana (${label})`,
      isActive: true,
      sortOrder: 0,
      assignedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const html = renderFirstMessageVariantsPage(agent, [
      { variant: variant('a', 'A'), sent: 200, replied: 70, handoffs: 6 },
      { variant: variant('b', 'B'), sent: 200, replied: 30, handoffs: 1 },
    ]);

    expect(html).toContain('Gente respondeu: <strong>70</strong> (35%)');
    expect(html).toContain('Passados para o time: <strong>6</strong> (3%)');
    expect(html).toContain('Resultado do teste:</strong> A venceu');
  });
});
