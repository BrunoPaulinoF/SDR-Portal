import type { JobLogRepository } from '../jobs/job-log-repository.js';
import { checkWhatsappChannel, type WhatsappChannelState } from '../uazapi/instance-provisioning.js';
import type { UazapiClient } from '../uazapi/uazapi-client.js';

/**
 * Uma linha a cada 30min por SDR basta para `/job-logs` contar a historia: canal fora nao muda
 * de minuto a minuto. O caminho antigo escrevia uma falha por tick (720 num unico dia, todas
 * iguais) e a primeira versao da guarda nao escrevia nenhuma — e a tabela muda passou a parecer
 * scheduler morto, que foi exatamente a leitura de quem olhou em 27/08.
 */
const channelDownLogIntervalMs = 30 * 60 * 1000;

export type ChannelGuard = (
  jobName: string,
  agentId: string,
  credentials: { baseUrl: string; token: string },
  now: Date,
) => Promise<WhatsappChannelState>;

/**
 * Guarda de canal com memoria de processo: pergunta a instancia se ela pode enviar e, quando
 * nao pode, registra o motivo em `job_logs` no maximo uma vez a cada 30min por SDR — com o
 * `lastDisconnectReason` junto, que e o que diz de quem e o conserto.
 *
 * **A guarda nunca chama `/instance/connect`.** Em 27/08 ela chamou, por meio dia, na crenca de
 * que aquilo restaurava uma sessao caida. Nao restaura: na UAZAPI o connect e a porta de
 * entrada do pareamento — ele publica um QR e espera alguem ler. Sem ninguem olhando, o QR
 * expira (`lastDisconnectReason: "QR Code timeout"`), a instancia volta a `disconnected` e a
 * guarda chamava de novo. Era esse o ciclo de ~5min que ninguem conseguia explicar.
 *
 * O estrago nao era so o laco: cada connect em segundo plano invalidava o QR que a pessoa tinha
 * na tela naquele instante, entao quem tentava parear pelo portal via a leitura simplesmente
 * nao pegar. Reconectar instancia e trabalho de quem esta olhando a tela — o scheduler so
 * observa, pula e conta o porque.
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
        result: JSON.stringify({
          instanceStatus: state.status,
          disconnectReason: state.disconnectReason,
          needsQrScan: state.needsQrScan,
        }),
        error: state.reason,
        startedAt: now,
        finishedAt: new Date(),
      });
    }

    return state;
  };
}
