import type { Message } from '../../db/schema.js';

/**
 * Como a IA deve LER uma mensagem ja gravada da conversa.
 *
 * O cartao de contato de demonstracao e gravado com o numero no texto ("Contato enviado:
 * Fulano (5519...)"), e o fallback dele e um link ("...wa.me/5519..."). Devolvidos crus para o
 * modelo, esses registros voltam como turno DELE — ou seja, um exemplo na propria boca de duas
 * coisas que o prompt proibe (escrever numero de telefone e mandar link) e, ainda por cima, um
 * registro do que o lead nunca viu: no WhatsApp ele recebeu um cartao de contato, nao esse texto.
 */
export function aiHistoryText(message: Pick<Message, 'messageType' | 'text' | 'transcription' | 'autoReply'>): string {
  if (message.messageType === 'contact') {
    return '[o sistema enviou o cartao de contato de demonstracao nesta conversa]';
  }
  const body = message.text ?? message.transcription ?? '[mensagem sem texto]';
  // O SDR nunca responde a automatica (o webhook nem chama a IA), mas ela continua no
  // historico. Sem a etiqueta, o modelo le o menu da loja como fala do lead e responde a ele
  // quando a pessoa finalmente aparecer — que e exatamente o turno que nao pode ser perdido.
  return message.autoReply ? `[resposta automatica da loja, nao e a pessoa] ${body}` : body;
}
