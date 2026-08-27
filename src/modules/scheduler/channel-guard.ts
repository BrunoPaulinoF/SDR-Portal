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

/** Intervalo entre tentativas de reconexao. Curto: queda de rede volta em segundos. */
const reconnectIntervalMs = 5 * 60 * 1000;

export type ChannelGuard = (
  jobName: string,
  agentId: string,
  credentials: { baseUrl: string; token: string },
  now: Date,
) => Promise<WhatsappChannelState>;

/**
 * Guarda de canal com memoria de processo. Faz tres coisas em cima do `checkWhatsappChannel`:
 *
 * 1. **Reconecta sozinha** quando a queda nao invalidou a sessao (rede, `restartRequired`).
 *    Ate 27/08 qualquer queda esperava uma pessoa clicar em Conectar — inclusive as que um
 *    `/instance/connect` resolveria em segundos.
 * 2. **Nao tenta** quando a sessao foi invalidada (`401: logged out`). Verificado contra a
 *    instancia real da Insumo Smart: o connect nao restaura nada, so publica um QR que ninguem
 *    esta olhando. Insistir seria queimar QR em looping.
 * 3. **Registra o motivo** em `job_logs` no maximo uma vez a cada 30min por SDR, com o
 *    `lastDisconnectReason` junto — e ele que diz se o conserto e do scheduler ou de quem tem
 *    o celular na mao.
 *
 * Os dois relogios sao por SDR e zeram quando o canal volta, entao a proxima queda e anunciada
 * e tentada na hora. Reiniciar o app tambem zera, de proposito.
 */
export function createChannelGuard(uazapiClient: UazapiClient, jobLogRepository: JobLogRepository): ChannelGuard {
  const lastLoggedAt = new Map<string, number>();
  const lastReconnectAt = new Map<string, number>();

  return async function ensureChannel(jobName, agentId, credentials, now) {
    let state = await checkWhatsappChannel(uazapiClient, credentials);

    if (!state.usable && !state.needsQrScan) {
      const previousAttempt = lastReconnectAt.get(agentId);
      if (previousAttempt === undefined || now.getTime() - previousAttempt >= reconnectIntervalMs) {
        lastReconnectAt.set(agentId, now.getTime());
        // Tentativa de reconexao nunca pode derrubar a guarda: se ela falhar, o canal segue
        // fora e o caminho normal (pular e registrar) tem de continuar valendo. Sem este
        // try o erro subia para o catch do job e virava `failed` no lead da vez.
        try {
          await uazapiClient.connectInstance(credentials);
          // Rele o estado: quando o connect pega, o tick corrente ja envia em vez de perder a vez.
          state = await checkWhatsappChannel(uazapiClient, credentials);
        } catch {
          // Mantem o `state` da leitura anterior.
        }
      }
    }

    if (state.usable) {
      lastLoggedAt.delete(agentId);
      lastReconnectAt.delete(agentId);
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
