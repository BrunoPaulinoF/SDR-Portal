/**
 * Pictogramas, indicadores regionais (bandeiras), modificadores de tom de pele,
 * seletor de variacao (U+FE0F), ZWJ (U+200D) e o keycap (U+20E3).
 * `\p{Extended_Pictographic}` cobre as carinhas sem pegar digito nem pontuacao comum.
 */
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3/gu;

/**
 * O lead nunca pode receber emoji: a mensagem tem que passar por mensagem de gente.
 * O prompt base ja proibe, mas o modelo escapa de vez em quando — e uma carinha solta
 * denuncia o robo na hora. Aqui a garantia e deterministica, no ultimo ponto antes do envio.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
