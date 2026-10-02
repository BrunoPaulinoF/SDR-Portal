import type { SdrAgent } from '../../db/schema.js';
import { readMessageLimits } from '../monitoring/channel-limits.js';
import { formatDateTimeInTimeZone } from '../timezone.js';
import { instanceRecord, readString } from './instance-provisioning.js';
import type { UazapiResult } from './uazapi-client.js';

/**
 * Resultado dos botoes de teste da tela do SDR (status, limites, webhook, mensagem e audio de
 * teste) em portugues de gente. Antes cada botao abria outra pagina com o JSON cru da UAZAPI:
 * quem nao programa nao sabia se tinha dado certo, e ainda perdia o lugar na tela do SDR.
 * O JSON continua indo junto, em `raw`, recolhido em "Detalhes tecnicos".
 */
export type UazapiActionKind = 'status' | 'limites' | 'webhook' | 'mensagem' | 'audio';

export interface UazapiActionOutcome {
  title: string;
  ok: boolean;
  summary: string;
  /** O que fazer agora, quando da para dizer. */
  hint: string | null;
  raw: string | null;
}

export const ACTION_TITLES: Record<UazapiActionKind, string> = {
  status: 'Status do WhatsApp',
  limites: 'Limites do WhatsApp',
  webhook: 'Webhook',
  mensagem: 'Mensagem de teste',
  audio: 'Audio de teste',
};

interface SummaryContext {
  agent: Pick<SdrAgent, 'timezone'>;
  /** Numero de destino da mensagem ou do audio de teste. */
  number?: string;
  now?: Date;
}

function rawOf(result: UazapiResult | null): string | null {
  if (!result) return null;
  return `HTTP ${result.status}\n${typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}`;
}

/** Recusa ou falha antes de chegar na UAZAPI (configuracao faltando, formulario incompleto). */
export function failedAction(kind: UazapiActionKind, message: string, hint: string | null = null): UazapiActionOutcome {
  return { title: ACTION_TITLES[kind], ok: false, summary: message, hint, raw: null };
}

/** Erro levantado no meio da acao: rede, timeout, ElevenLabs recusando a voz. */
export function erroredAction(kind: UazapiActionKind, error: unknown): UazapiActionOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (/library voices/i.test(message)) {
    return failedAction(
      kind,
      'A ElevenLabs recusou a voz: no plano gratuito so as vozes padrao funcionam pelo sistema.',
      'Troque o "ID da voz" por uma voz padrao da ElevenLabs (ou assine um plano pago) e teste de novo.',
    );
  }
  if (/unusual activity|detected_unusual/i.test(message)) {
    return failedAction(
      kind,
      'A ElevenLabs bloqueou a conta gratuita por "atividade incomum".',
      'Isso e regra do plano gratuito usado a partir de servidor. O plano pago mais barato resolve.',
    );
  }
  return { ...failedAction(kind, `Nao deu certo: ${message}`), raw: message };
}

export function summarizeUazapiAction(kind: UazapiActionKind, result: UazapiResult, context: SummaryContext): UazapiActionOutcome {
  const title = ACTION_TITLES[kind];
  const raw = rawOf(result);
  const refused = (summary: string, hint: string | null = null): UazapiActionOutcome => ({ title, ok: false, summary, hint, raw });
  const done = (summary: string, hint: string | null = null): UazapiActionOutcome => ({ title, ok: true, summary, hint, raw });

  if (kind === 'status') {
    const record = instanceRecord(result.body);
    const status = readString(record, 'status');
    if (!result.ok) {
      return refused(
        `A UAZAPI respondeu erro (HTTP ${result.status}) ao consultar a instancia.`,
        'Confira a URL e o token da instancia na secao WhatsApp deste SDR.',
      );
    }
    if (status === 'connected' || status === null) {
      const name = readString(record, 'profileName', 'name');
      return done(`WhatsApp conectado${name ? ` (${name})` : ''}. Pode enviar e receber.`);
    }
    const reason = readString(record, 'lastDisconnectReason');
    return refused(
      `WhatsApp fora do ar (situacao: ${status}${reason ? `, ultima queda: ${reason}` : ''}).`,
      'Use "Conectar / ver QR code" e leia o QR com o celular que atende este numero.',
    );
  }

  if (kind === 'limites') {
    if (!result.ok) {
      return refused(
        `Nao foi possivel consultar os limites (HTTP ${result.status}).`,
        'A consulta so funciona com o WhatsApp conectado. Teste o status primeiro.',
      );
    }
    const reading = readMessageLimits(result.body, context.now ?? new Date());
    const quota = reading.quotaUsed !== null && reading.quotaTotal !== null ? ` Cota de conversas novas: ${reading.quotaUsed} de ${reading.quotaTotal}.` : '';
    if (reading.blockedUntil) {
      return refused(
        `O WhatsApp nao deixa iniciar conversas novas ate ${formatDateTimeInTimeZone(reading.blockedUntil, context.agent.timezone)}${reading.blockReason ? ` (${reading.blockReason})` : ''}.${quota}`,
        'A prospeccao para sozinha ate la e as respostas continuam saindo. Vale baixar o limite diario ou ligar o aquecimento.',
      );
    }
    if (reading.canStartConversations === null) {
      return refused('O WhatsApp nao respondeu sobre os limites agora.', 'Tente de novo em alguns minutos.');
    }
    return done(`Pode iniciar conversas novas.${quota}`);
  }

  if (kind === 'webhook') {
    return result.ok
      ? done('Webhook configurado: as mensagens e as quedas deste numero chegam ao portal.')
      : refused(`A UAZAPI recusou a configuracao do webhook (HTTP ${result.status}).`);
  }

  const sent = kind === 'audio' ? 'Audio enviado' : 'Mensagem enviada';
  return result.ok
    ? done(`${sent} para ${context.number ?? 'o numero informado'}. Confira no celular.`)
    : refused(
        `A UAZAPI recusou o envio (HTTP ${result.status}).`,
        'Confira se o WhatsApp deste SDR esta conectado e se o numero de teste esta certo, com DDD.',
      );
}
