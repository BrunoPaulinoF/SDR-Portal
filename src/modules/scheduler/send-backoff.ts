/**
 * Recuo por SDR depois de um envio recusado pela UAZAPI.
 *
 * O trabalho caro do disparo — pesquisa do lead, avaliacao de fit, geracao da mensagem —
 * acontece todo ANTES do envio, e uma recusa joga tudo fora sem marcar nada no lead. Como o
 * lead continua `pending` e primeiro da fila, o tick seguinte refaz o ciclo inteiro no mesmo
 * lead, de minuto em minuto: em 27/08, com a instancia da Insumo Smart devolvendo HTTP 500,
 * foram 12 avaliacoes de fit pagas no mesmo lead em 12 minutos.
 *
 * O recuo nao conserta o envio — so para de pagar pela mesma resposta. A memoria e de processo
 * e zera no restart, o que e aceitavel: o custo de uma rodada extra e uma chamada, nao doze.
 */
const sendBackoffMs = 5 * 60 * 1000;

export interface SendBackoff {
  /** Minutos restantes de recuo, ou `null` quando o SDR esta liberado. */
  remainingMinutes(agentId: string, now: Date): number | null;
  /** `until` manda no recuo quando existe: e o proprio WhatsApp dizendo ate quando. */
  recordFailure(agentId: string, now: Date, until?: Date | null): void;
  clear(agentId: string): void;
}

interface ReachoutTimelock {
  until: Date;
  enforcement: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Le a restricao que o WhatsApp — nao a UAZAPI — impoe a conta conectada.
 *
 * Em 27/08 todo envio da Insumo Smart voltava HTTP 500. O corpo, que so ficou visivel depois de
 * passarmos a grava-lo, dizia `provider_code: 463`,
 * `error_key: "WHATSAPP_REACHOUT_TIMELOCK"` e um `until` explicito: a conta estava proibida de
 * INICIAR novas conversas ate o dia seguinte, "normalmente relacionada a volume ou qualidade de
 * envios". Nada no portal conserta isso, e insistir contra um bloqueio de qualidade e a pior
 * reacao possivel — cada tentativa reforca o motivo do bloqueio.
 *
 * Repare que enviar para uma conversa que ja existe continua funcionando: foi por isso que o
 * envio de teste para o proprio numero da instancia respondeu 200 enquanto todo lead falhava.
 */
export function reachoutTimelockFrom(body: unknown): ReachoutTimelock | null {
  const root = asRecord(body);
  const timelock = asRecord(asRecord(root.details).reachout_timelock);
  const until = typeof timelock.until === 'string' ? new Date(timelock.until) : null;
  const ativo = timelock.active === true || root.error_key === 'WHATSAPP_REACHOUT_TIMELOCK';

  if (!ativo || !until || Number.isNaN(until.getTime())) return null;

  return {
    until,
    enforcement: typeof timelock.enforcement_type === 'string' ? timelock.enforcement_type : null,
  };
}

export function createSendBackoff(): SendBackoff {
  const liberadoEm = new Map<string, number>();

  return {
    remainingMinutes(agentId, now) {
      const until = liberadoEm.get(agentId);
      if (until === undefined) return null;

      const restante = until - now.getTime();
      if (restante <= 0) {
        liberadoEm.delete(agentId);
        return null;
      }

      return Math.max(1, Math.ceil(restante / 60000));
    },

    recordFailure(agentId, now, until) {
      // Prazo dito pelo WhatsApp vale mais que o nosso: tentar antes dele so gasta e insiste
      // contra um bloqueio que tem hora para acabar.
      const alvo = until && until.getTime() > now.getTime() ? until.getTime() : now.getTime() + sendBackoffMs;
      liberadoEm.set(agentId, alvo);
    },

    clear(agentId) {
      liberadoEm.delete(agentId);
    },
  };
}

/** Erro de envio que preserva o que a UAZAPI respondeu — sem isso o log so diz o numero. */
export class UazapiSendError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`UAZAPI returned HTTP ${status}`);
    this.name = 'UazapiSendError';
  }
}

/**
 * Quantas recusas seguidas no MESMO lead bastam para tira-lo da frente da fila.
 *
 * `findNextPendingForSdr` sempre devolve o lead mais antigo, entao um numero que a UAZAPI
 * recusa e eterno primeiro colocado: em 27/08 o lead "Divino Sabor" acumulou 17 chamadas de
 * IA sem nunca sair, com 536 leads atras dele que jamais seriam alcancados. Tres tentativas
 * separam um tropeco momentaneo de um numero que nao vai passar hoje.
 */
const maxSendAttemptsPerLead = 3;

export interface LeadSendFailures {
  /** Ids a excluir da proxima busca na fila. */
  blockedIds(): string[];
  /** Registra a recusa e devolve `true` quando o lead acabou de sair da fila. */
  record(leadId: string): boolean;
  clear(leadId: string): void;
}

/**
 * Memoria de processo, nao coluna no banco: a exclusao vale enquanto o problema durar e some
 * no restart, quando o lead ganha uma chance nova. Guardar isso no lead exigiria migration e
 * transformaria um problema de canal em marca permanente no cadastro.
 */
export function createLeadSendFailures(): LeadSendFailures {
  const failures = new Map<string, number>();

  return {
    blockedIds() {
      return [...failures.entries()].filter(([, count]) => count >= maxSendAttemptsPerLead).map(([leadId]) => leadId);
    },

    record(leadId) {
      const count = (failures.get(leadId) ?? 0) + 1;
      failures.set(leadId, count);
      return count === maxSendAttemptsPerLead;
    },

    clear(leadId) {
      failures.delete(leadId);
    },
  };
}
