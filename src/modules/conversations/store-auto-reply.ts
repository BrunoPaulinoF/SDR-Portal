/**
 * Reconhece a resposta automatica da propria loja (menu, saudacao de boas-vindas, horario,
 * link de cardapio, atendente virtual) para o SDR nao gastar um turno conversando com ela.
 *
 * Por que isso mora no codigo e nao so no prompt: a regra ja estava escrita em
 * `sdr-base-prompt.ts` ("mensagem automatica nao e uma pessoa, use nao_responder") e o modelo
 * nao obedecia — na leitura de 02/09 a Mariana respondeu a automatica em 12 das 12 conversas
 * que tiveram uma (`docs/analises/mariana-2026-09-02.md`). Filtrar antes de chamar a IA e a
 * unica forma que nao depende de obediencia; de quebra economiza a chamada inteira.
 *
 * O criterio de erro e assimetrico e a heuristica foi calibrada para isso: tratar gente como
 * robo faz o SDR ficar calado com uma pessoa esperando resposta — o pior erro possivel aqui.
 * Tratar robo como gente so custa uma mensagem. Na duvida, portanto, **e gente**: os sinais
 * abaixo sao os que nenhuma pessoa no balcao produz ao responder um contato frio.
 */

/** Frase de autoatendimento. Nenhuma delas aparece numa resposta digitada na hora. */
const AUTO_PHRASES: RegExp[] = [
  /\bseja bem[- ]?vind[oa]/i,
  /\bbem[- ]?vind[oa]\b.{0,40}\b(ao|a|à|nosso|nossa)\b/i,
  /agradec\w+\s+(o\s+|seu\s+|sua\s+|pelo\s+|pela\s+)?(contato|mensagem|prefer[eê]ncia)/i,
  /obrigad[oa]\s+pel[oa]\s+contato/i,
  /(responderemos|retornaremos|retornamos|vamos responder)\b.{0,30}\b(em breve|assim que|o quanto antes)/i,
  /assim que poss[ií]vel\s+(retorn|respond)/i,
  /hor[áa]rio(s)?\s+de\s+(atendimento|funcionamento)/i,
  /n[ãa]o\s+estamos\s+(recebendo|atendendo)/i,
  /fa[çc]a\s+(o\s+)?seu\s+pedido/i,
  /confira\s+(o\s+|nosso\s+|nossa\s+)?(card[áa]pio|menu|promo)/i,
  /card[áa]pio\s+(digital|online|completo)/i,
  /(pe[çc]a|pedir)\s+aqui\b/i,
  /\bdigite\s+(o|a|um|uma)?\s*(n[úu]mero|op[çc][ãa]o|\d)/i,
  /escolha\s+uma\s+op[çc][ãa]o/i,
  /op[çc][ãa]o\s+inv[áa]lida/i,
  /(atendente|assistente)\s+virtual/i,
  /atendimento\s+(digital|autom[áa]tico)|autoatendimento/i,
  /(um|uma)\s+atendente\s+(ir[áa]|vai)\s+(te\s+|lhe\s+)?atend/i,
  /chamar\s+(um|uma)\s+atendente|chamar\s+algu[ée]m\s+da\s+equipe/i,
  /setor\s+respons[áa]vel/i,
  /clic(ar|a|ando|que)\s+(aqui|no\s+link|abaixo)/i,
  /avalie\s+(sua|seu)\s+(experi[êe]ncia|atendimento)/i,
  /agradecemos\s+(o\s+|seu\s+)?feedback|sua\s+opini[ãa]o\s+foi/i,
  /vou\s+(te\s+)?(transferir|encaminhar)\b/i,
  /(estamos|vou)\s+te?\s*encaminhando\s+para/i,
  /encaminhar\s+sua\s+mensagem/i,
  /um\s+momento\s+(enquanto|que|s[óo])/i,
  /s[óo]\s+um\s+(momento|momentinho|instante)/i,
  /ainda\s+n[ãa]o\s+fez\s+(o\s+)?seu\s+pedido/i,
  /pedidos?\s+(apenas|somente|exclusivamente)\s+pel[oa]/i,
  /nosso\(s\)\s+endere[çc]o\(s\)/i,
  /\bmaps\b.{0,20}\bhttps?:/i,
];

/**
 * Frases que so denunciam automatico quando vem dentro de um texto de aviso, nao soltas:
 * "Estamos abertos." pode ser alguem digitando, "Estamos fechados agora. Nosso horario e..." nao.
 */
const AUTO_PHRASES_LONG: RegExp[] = [/(estamos|hoje estamos)\s+(fechad|abert|ausente|de folga)/i];
const LONG_ENOUGH = 40;

/** Link em resposta a um contato frio e o menu da loja, nao alguem digitando. */
const LINK = /(https?:\/\/|www\.[a-z0-9-]+\.|wa\.me\/|\b[a-z0-9-]+\.(com|com\.br|app|delivery|to)\/)/i;

/** Cardapio colado: muito negrito de WhatsApp junto, coisa que ninguem faz respondendo "oi". */
const HEAVY_MARKUP = /\*[^*\n]{2,60}\*(?:[\s\S]{0,200}?\*[^*\n]{2,60}\*){2,}/;

function countEmoji(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

/**
 * `true` quando a mensagem recebida e, quase com certeza, a resposta automatica da loja.
 *
 * Recebe o texto ja resolvido (audio chega em `transcription`): audio nunca e automatico,
 * entao a transcricao entra como sinal de que ha gente do outro lado.
 */
export function isStoreAutoReply(input: {
  messageType?: string | null;
  text?: string | null;
  transcription?: string | null;
}): boolean {
  // Audio e a coisa mais humana que chega neste chat: nenhum autoatendimento grava voz.
  if (input.transcription?.trim()) return false;

  const text = input.text?.trim();
  if (!text) return false;

  if (LINK.test(text)) return true;
  if (AUTO_PHRASES.some((pattern) => pattern.test(text))) return true;
  if (text.length >= LONG_ENOUGH && AUTO_PHRASES_LONG.some((pattern) => pattern.test(text))) return true;
  if (/^card[áa]pio\s*:?$/i.test(text)) return true;
  // Bloco longo e formatado (cardapio, tabela de precos, lista de horarios).
  if (text.length >= 220 && (HEAVY_MARKUP.test(text) || countEmoji(text) >= 4)) return true;

  return false;
}
