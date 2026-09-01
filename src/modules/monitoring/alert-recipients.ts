import { digitsOnly } from '../phone/whatsapp-number.js';

/**
 * Numeros que recebem o alerta. O campo e um texto livre (um por linha, ou separados por
 * virgula/ponto-e-virgula) porque quem cadastra cola de qualquer lugar; aqui vira lista de
 * digitos, sem repetido e sem numero curto demais para ser WhatsApp.
 */
export function parseAlertRecipients(value: string | null | undefined): string[] {
  const recipients = new Set<string>();

  for (const part of String(value ?? '').split(/[\n,;]/)) {
    const digits = digitsOnly(part);
    if (digits.length >= 10) recipients.add(digits);
  }

  return [...recipients];
}
