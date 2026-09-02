import type { UazapiClient } from '../uazapi/uazapi-client.js';

export interface MonitorCredentials {
  baseUrl: string;
  token: string;
}

/**
 * Manda o mesmo texto para cada numero cadastrado pela instancia do monitor e devolve
 * quantos foram entregues. Um numero que falha nao derruba os outros: o erro entra na lista
 * e o envio continua — meio aviso e melhor do que nenhum.
 */
export async function sendToRecipients(
  uazapiClient: UazapiClient,
  credentials: MonitorCredentials,
  recipients: string[],
  text: string,
  errors: string[],
  trackSource = 'sdr-portal-monitor',
): Promise<number> {
  let sent = 0;

  for (const number of recipients) {
    try {
      const result = await uazapiClient.sendText({
        ...credentials,
        number,
        text,
        trackSource,
        trackId: `${trackSource}-${Date.now()}`,
      });

      if (result.ok) sent += 1;
      else errors.push(`Falha ao avisar ${number}: a UAZAPI respondeu HTTP ${result.status}.`);
    } catch (error) {
      errors.push(`Falha ao avisar ${number}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }

  return sent;
}
