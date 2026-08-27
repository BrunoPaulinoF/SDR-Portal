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
  recordFailure(agentId: string, now: Date): void;
  clear(agentId: string): void;
}

export function createSendBackoff(): SendBackoff {
  const failedAt = new Map<string, number>();

  return {
    remainingMinutes(agentId, now) {
      const since = failedAt.get(agentId);
      if (since === undefined) return null;

      const elapsed = now.getTime() - since;
      if (elapsed >= sendBackoffMs) {
        failedAt.delete(agentId);
        return null;
      }

      return Math.max(1, Math.ceil((sendBackoffMs - elapsed) / 60000));
    },

    recordFailure(agentId, now) {
      failedAt.set(agentId, now.getTime());
    },

    clear(agentId) {
      failedAt.delete(agentId);
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
