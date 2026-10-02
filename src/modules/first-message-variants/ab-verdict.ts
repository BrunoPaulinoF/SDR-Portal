/**
 * Leitura honesta de um teste A/B de primeira mensagem. Ate 02/10 a tela comparava variantes
 * pela taxa de "resposta" com 24 envios de um lado e 58 do outro, e a decisao saia de ruido:
 * a variante "nova" foi declarada melhor com 50% de resposta quando 10 das 12 eram o robo da
 * loja (`docs/analises/mariana-2026-08-28.md`).
 *
 * Duas regras: nada se decide antes de cada variante ter `AB_MIN_SAMPLE` envios, e a diferenca
 * so e "real" quando o teste de duas proporcoes da p < 0,05 — fora disso, ainda pode ser acaso.
 */
export const AB_MIN_SAMPLE = 150;
const SIGNIFICANCE = 0.05;

export interface AbArm {
  id: string;
  label: string;
  sent: number;
  replied: number;
}

export interface AbVerdict {
  /** Frase para o topo da tela. */
  summary: string;
  /** Status por variante (id -> frase curta). */
  perVariant: Map<string, string>;
}

/** Aproximacao de Abramowitz-Stegun para erf (erro < 1,5e-7): suficiente para um p-valor. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

/** p-valor bilateral do teste de duas proporcoes. `null` quando nao ha como calcular. */
export function twoProportionPValue(a: { sent: number; replied: number }, b: { sent: number; replied: number }): number | null {
  if (a.sent <= 0 || b.sent <= 0) return null;
  const pooled = (a.replied + b.replied) / (a.sent + b.sent);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.sent + 1 / b.sent));
  if (se === 0) return null;
  const z = Math.abs(a.replied / a.sent - b.replied / b.sent) / se;
  return 1 - erf(z / Math.SQRT2);
}

function rate(arm: AbArm): number {
  return arm.sent > 0 ? arm.replied / arm.sent : 0;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function abVerdict(arms: AbArm[]): AbVerdict {
  const perVariant = new Map<string, string>();
  const compared = arms.filter((arm) => arm.sent > 0);

  for (const arm of arms) {
    if (arm.sent < AB_MIN_SAMPLE) perVariant.set(arm.id, `Amostra pequena: faltam ${AB_MIN_SAMPLE - arm.sent} envios para comparar.`);
  }

  if (compared.length < 2) {
    return {
      summary: 'Uma variante so: nao ha teste. Para comparar, deixe duas ativas e mude uma coisa por vez entre elas.',
      perVariant,
    };
  }

  const leader = [...compared].sort((a, b) => rate(b) - rate(a))[0] as AbArm;
  const small = compared.filter((arm) => arm.sent < AB_MIN_SAMPLE);
  if (small.length > 0) {
    return {
      summary: `Ainda nao da para decidir: ${small.map((arm) => arm.label).join(', ')} tem menos de ${AB_MIN_SAMPLE} envios. ${leader.label} esta na frente (${percent(rate(leader))} de resposta de gente), mas com pouca amostra isso muda.`,
      perVariant,
    };
  }

  const verdicts = compared
    .filter((arm) => arm.id !== leader.id)
    .map((arm) => ({ arm, pValue: twoProportionPValue(leader, arm) }));
  for (const { arm, pValue } of verdicts) {
    perVariant.set(
      arm.id,
      pValue !== null && pValue < SIGNIFICANCE
        ? `Pior que ${leader.label} de verdade (p=${pValue.toFixed(3)}).`
        : `Empatada com ${leader.label}: a diferenca ainda pode ser acaso (p=${pValue === null ? '-' : pValue.toFixed(2)}).`,
    );
  }
  const beatsAll = verdicts.every(({ pValue }) => pValue !== null && pValue < SIGNIFICANCE);
  perVariant.set(leader.id, beatsAll ? 'Vencedora: melhor que as outras de verdade.' : 'Na frente, mas sem diferenca real ainda.');

  return {
    summary: beatsAll
      ? `${leader.label} venceu: ${percent(rate(leader))} de resposta de gente, com diferenca real sobre as outras. Pause as outras e teste uma variante nova contra ela.`
      : `Sem vencedora ainda: ${leader.label} esta na frente com ${percent(rate(leader))}, mas a diferenca pode ser acaso. Deixe rodar mais.`,
    perVariant,
  };
}
