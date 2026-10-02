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
  // Transferir/encaminhar so e robo quando o destino e "o atendente", "o setor": "vou encaminhar
  // pro meu socio" e a pessoa do balcao passando o recado — o sinal mais quente que existe.
  /(vou|vamos|irei|iremos)\s+(te\s+|lhe\s+)?(transferir|encaminhar)\b.{0,40}\b(atendente|atendimento|setor|departamento|equipe\s+de)/i,
  /(estamos|vou)\s+te?\s*encaminhando\s+para/i,
  /encaminhar\s+sua\s+mensagem\b.{0,40}\b(setor|departamento|atendente|equipe)/i,
  // "So um momento" e "um momento que vou chamar o dono" sao gente; "um momento enquanto te
  // transfiro" nao.
  /um\s+momento\s+enquanto/i,
  // Atendente de IA da propria loja: nenhuma pessoa diz que nao e capaz de compreender.
  /desculpe,?\s*\*?\s*n[ãa]o\s+consegui\s+te\s+entender/i,
  /n[ãa]o\s+sou\s+capa[zs]\s+de\s+(compreender|entender)/i,
  /(explicar|escrever|reformular)\b.{0,20}\bde\s+(forma|maneira)\s+mais\s+(concisa|simples|curta)/i,
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

/**
 * Sinais de gente que vencem as frases de robo: recusa ("obrigado pelo contato, mas nao temos
 * interesse"), recado para o dono ("vou passar pro meu socio"), convite para chamar depois.
 * Antes deles, "obrigado pelo contato" sozinho fazia a recusa virar automatica — o lead nao
 * era marcado sem interesse e recebia o segundo toque.
 */
const HUMAN_SIGNALS: RegExp[] = [
  /\bn[ãa]o\s+(temos|tenho|tem|h[áa])\s+(nenhum\s+)?interesse/i,
  /\bsem\s+interesse\b/i,
  /\bn[ãa]o\s+(precisamos|preciso|queremos|quero)\b/i,
  /\b(meu|minha|nosso|nossa|o|a|pro|pra|para\s+o|para\s+a)\s+(s[óo]ci[oa]|dono|dona|patr[ãa]o|chefe|marido|esposa)\b/i,
  /\bpode\s+(me\s+)?(chamar|falar|ligar)\b/i,
];

/** Link em resposta a um contato frio e o menu da loja, nao alguem digitando. */
const LINK = /(https?:\/\/|www\.[a-z0-9-]+\.|wa\.me\/|\b[a-z0-9-]+\.(com|com\.br|app|delivery|to)\/)/i;

/** Cardapio colado: muito negrito de WhatsApp junto, coisa que ninguem faz respondendo "oi". */
const HEAVY_MARKUP = /\*[^*\n]{2,60}\*(?:[\s\S]{0,200}?\*[^*\n]{2,60}\*){2,}/;

/**
 * Perguntas que so fazem sentido dirigidas a quem escreveu: quem pergunta isso quer saber com
 * quem esta falando, e espera resposta.
 */
const IDENTITY_QUESTION =
  /(com quem (eu\s+)?(falo|estou falando)|quem (fala|est[áa] falando|[ée] voc[êe])|qual (o |[ée] o )?seu nome|me diz seu nome|poderia (me )?informar( o)? seu nome)/i;

/**
 * Sinais que nenhuma pessoa produz: menu numerado, link, bloco gigante. So eles derrubam o
 * desempate da pergunta de identidade.
 */
const MENU_ONLY: RegExp[] = [
  LINK,
  /\bdigite\b/i,
  /escolha uma op[çc][ãa]o/i,
  /op[çc][ãa]o\s+inv[áa]lida/i,
  /(atendente|assistente)\s+virtual/i,
  /autoatendimento/i,
];

/**
 * `true` quando a mensagem termina perguntando quem esta do outro lado.
 *
 * Isso desempata para gente mesmo quando a saudacao parece automatica ("Seja bem-vindo ao X!
 * Tudo bem? Com quem falo?"). O criterio veio do Retro House, que ficou tres dias sem resposta
 * por cair no filtro (docs/analises/francielly-2026-08-28.md): o custo de calar com uma pessoa
 * esperando e maior que o de gastar uma mensagem com um robo.
 */
function endsWithIdentityQuestion(text: string): boolean {
  if (text.length >= 220) return false;
  if (MENU_ONLY.some((pattern) => pattern.test(text))) return false;
  if (!/\?[\s\p{Extended_Pictographic}]*$/u.test(text)) return false;
  return IDENTITY_QUESTION.test(text.slice(-80));
}

/** Os sinais de MENU_ONLY que nenhuma pessoa produz nem por acaso (link, pessoa cola). */
const BOT_ONLY: RegExp[] = MENU_ONLY.filter((pattern) => pattern !== LINK);

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

  // Vem antes de tudo: a saudacao da loja e a da pessoa que assumiu o balcao sao iguais ate a
  // ultima frase, e e a pergunta no fim que separa as duas.
  if (endsWithIdentityQuestion(text)) return false;

  // Menu numerado e atendente virtual nao recusam nem passam recado: so eles seguram o robo.
  if (text.length < 220 && HUMAN_SIGNALS.some((pattern) => pattern.test(text)) && !BOT_ONLY.some((pattern) => pattern.test(text))) {
    return false;
  }

  if (LINK.test(text)) return true;
  if (AUTO_PHRASES.some((pattern) => pattern.test(text))) return true;
  if (text.length >= LONG_ENOUGH && AUTO_PHRASES_LONG.some((pattern) => pattern.test(text))) return true;
  if (/^card[áa]pio\s*:?$/i.test(text)) return true;
  // Bloco longo e formatado (cardapio, tabela de precos, lista de horarios).
  if (text.length >= 220 && (HEAVY_MARKUP.test(text) || countEmoji(text) >= 4)) return true;

  return false;
}

/** O que as regras que olham o historico precisam saber das mensagens anteriores da conversa. */
interface PriorMessage {
  autoReply: boolean;
  createdAt: Date;
  direction: string;
  text: string | null;
  transcription: string | null;
}

/** "Bom dia!! ☀️" e "bom dia" sao a mesma transmissao. */
function broadcastKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BROADCAST_MIN_KEY = 5;
const BROADCAST_PREVIOUS_DAYS = 2;

/**
 * `true` quando o mesmo texto ja chegou deste chat em pelo menos dois outros dias: e a
 * transmissao da loja (o "Bom dia" que vem com o cardapio do dia, toda manha), nao alguem
 * respondendo. O Sabor Divino mandou o mesmo bom-dia 20 dias seguidos e cada um contou como
 * "respondeu" no painel. Uma pessoa nao repete a mesma frase em tres dias diferentes para um
 * numero que nao conhece; no segundo dia ainda e tratada como gente.
 */
export function isRepeatedBroadcast(input: { text?: string | null; now: Date; history: PriorMessage[] }): boolean {
  const key = input.text ? broadcastKey(input.text) : '';
  if (key.length < BROADCAST_MIN_KEY) return false;

  const today = input.now.toISOString().slice(0, 10);
  const days = new Set<string>();
  for (const message of input.history) {
    if (message.direction !== 'inbound' || !message.text) continue;
    if (broadcastKey(message.text) !== key) continue;
    const day = message.createdAt.toISOString().slice(0, 10);
    if (day !== today) days.add(day);
  }
  return days.size >= BROADCAST_PREVIOUS_DAYS;
}

/**
 * `true` para a foto que e conteudo da loja, nao alguem conversando: foto **sem legenda** que
 * chega antes de qualquer fala de gente no chat — o cardapio do dia, o panfleto da promocao, a
 * imagem que o robo manda junto da saudacao. Chamar so para mensagem de imagem.
 *
 * Ate 02/10 toda imagem pausava a IA para sempre e desligava o follow-up, sem avisar ninguem.
 * Loja que manda o cardapio do dia em foto (Ceciliana, Sabor Divino) virava lead morto no
 * primeiro bom-dia (`docs/analises/plano-reestruturacao-2026-10-02.md`).
 *
 * Legenda digitada ("olha o meu cardapio") ou conversa ja aberta com uma pessoa fazem a foto
 * ser de gente: ai a IA para e um humano olha, como antes.
 */
export function isStoreImage(input: { text?: string | null; history: PriorMessage[] }): boolean {
  if (input.text?.trim()) return false;
  return !input.history.some(
    (message) => message.direction === 'inbound' && !message.autoReply && Boolean(message.text?.trim() || message.transcription?.trim()),
  );
}
