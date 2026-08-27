import type { JobLogRepository } from '../jobs/job-log-repository.js';
import { checkWhatsappChannel, type WhatsappChannelState } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';

/**
 * Uma linha a cada 30min por SDR basta para `/job-logs` contar a historia: canal fora nao muda
 * de minuto a minuto. O caminho antigo escrevia uma falha por tick (720 num unico dia, todas
 * iguais) e o novo nao escrevia nenhuma — e a tabela muda passou a parecer scheduler morto,
 * que foi exatamente a leitura de quem olhou em 27/08.
 */
const channelDownLogIntervalMs = 30 * 60 * 1000;

export type ChannelGuard = (
  jobName: string,
  agentId: string,
  credentials: { baseUrl: string; token: string },
  now: Date,
) => Promise<WhatsappChannelState>;

/**
 * Guarda de canal com memoria de processo: consulta a instancia e, quando ela nao pode enviar,
 * registra o motivo em `job_logs` no maximo uma vez a cada `channelDownLogIntervalMs`.
 *
 * O relogio e por SDR e zera quando o canal volta, entao a proxima queda e anunciada na hora.
 * Reiniciar o app tambem zera — de proposito: uma linha logo apos o boot diz que o canal ja
 * subiu fora do ar, em vez de esperar meia hora para contar.
 */
export function createChannelGuard(uazapiClient: UazapiClient, jobLogRepository: JobLogRepository): ChannelGuard {
  const lastLoggedAt = new Map<string, number>();

  return async function ensureChannel(jobName, agentId, credentials, now) {
    const state = await checkWhatsappChannel(uazapiClient, credentials);

    if (state.usable) {
      lastLoggedAt.delete(agentId);
      return state;
    }

    const previous = lastLoggedAt.get(agentId);
    if (previous === undefined || now.getTime() - previous >= channelDownLogIntervalMs) {
      lastLoggedAt.set(agentId, now.getTime());
      await jobLogRepository.create({
        jobName,
        jobKey: `channel-down-${agentId}`,
        sdrAgentId: agentId,
        leadId: null,
        status: 'skipped',
        attempt: 1,
        payload: JSON.stringify({ agentId }),
        result: JSON.stringify({ instanceStatus: state.status, reason: state.reason }),
        error: state.reason,
        startedAt: now,
        finishedAt: new Date(),
      });
    }

    return state;
  };
}
