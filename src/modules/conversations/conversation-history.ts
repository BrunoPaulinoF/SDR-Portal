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
export function aiHistoryText(message: Pick<Message, 'messageType' | 'text' | 'transcription'>): string {
  if (message.messageType === 'contact') {
    return '[o sistema enviou o cartao de contato de demonstracao nesta conversa]';
  }
  return message.text ?? message.transcription ?? '[mensagem sem texto]';
}
