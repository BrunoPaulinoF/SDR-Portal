import { toString as qrToString } from 'qrcode';

import { env } from '../../config/env.js';
import type { UazapiClient } from './uazapi-client.js';

export interface ProvisionedInstance {
  baseUrl: string;
  instanceId: string | null;
  token: string;
}

export interface InstanceConnectionState {
  /** SVG pronto para embutir na pagina, ou null quando nao ha QR para mostrar. */
  qrCodeSvg: string | null;
  /** Codigo de pareamento por numero, quando a UAZAPI devolver um. */
  pairCode: string | null;
  connected: boolean;
  status: string | null;
  /** Motivo legivel quando nao deu para mostrar o QR — vai para a tela e para o log. */
  detail: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A UAZAPI ora responde `{instance:{...}}`, ora o objeto direto: procura nos dois. */
function instanceRecord(body: unknown): Record<string, unknown> {
  const root = asRecord(body);
  const nested = asRecord(root.instance ?? root.data);
  return Object.keys(nested).length > 0 ? nested : root;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function isInstanceProvisioningEnabled(): boolean {
  return Boolean(env.UAZAPI_BASE_URL && env.UAZAPI_ADMIN_TOKEN);
}

/**
 * Cria a instancia no servidor UAZAPI configurado por ambiente e devolve as credenciais
 * para salvar no SDR. Lanca quando a UAZAPI recusa ou nao devolve token — sem token a
 * instancia criada e inutilizavel e nao faz sentido gravar o SDR pela metade.
 */
export async function provisionInstance(uazapiClient: UazapiClient, instanceName: string): Promise<ProvisionedInstance> {
  const baseUrl = env.UAZAPI_BASE_URL;
  const adminToken = env.UAZAPI_ADMIN_TOKEN;
  if (!baseUrl || !adminToken) throw new Error('UAZAPI_BASE_URL e UAZAPI_ADMIN_TOKEN sao obrigatorios para criar a instancia.');

  const result = await uazapiClient.createInstance({ baseUrl, adminToken, name: instanceName });
  if (!result.ok) throw new Error(`UAZAPI recusou a criacao da instancia (HTTP ${result.status}).`);

  const record = instanceRecord(result.body);
  const token = readString(record, 'token', 'instanceToken', 'apikey');
  if (!token) throw new Error('UAZAPI criou a instancia mas nao devolveu o token.');

  return { baseUrl, instanceId: readString(record, 'id', 'instanceId', 'name'), token };
}

/**
 * Aponta o webhook da instancia para este portal. Falhar aqui nao invalida a instancia:
 * o SDR ja existe e o webhook pode ser reconfigurado pela tela, entao o chamador decide.
 */
export async function configureInstanceWebhook(
  uazapiClient: UazapiClient,
  credentials: { baseUrl: string; token: string },
  sdrAgentId: string,
): Promise<boolean> {
  if (!env.APP_URL) return false;

  const url = new URL(`/webhooks/uazapi/${sdrAgentId}`, env.APP_URL);
  if (env.WEBHOOK_SHARED_SECRET) url.searchParams.set('secret', env.WEBHOOK_SHARED_SECRET);

  const result = await uazapiClient.configureWebhook({
    ...credentials,
    url: url.toString(),
    events: ['messages', 'messages_update', 'connection'],
    excludeMessages: ['wasSentByApi'],
  });

  return result.ok;
}

/** O campo `qrcode` vem ora como data URI/base64 de imagem, ora como o payload cru do QR. */
async function toQrSvg(qrcode: string): Promise<string | null> {
  const value = qrcode.trim();
  if (!value) return null;

  const base64 = value.startsWith('data:') ? value : /^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 256 ? `data:image/png;base64,${value}` : null;
  if (base64) {
    return `<img src="${base64}" alt="QR Code para conectar o WhatsApp" width="288" height="288" />`;
  }

  try {
    return await qrToString(value, { type: 'svg', margin: 1, width: 288, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

/**
 * Le o estado da instancia **sem** pedir pareamento: serve para pintar a pagina sem
 * queimar um QR que ninguem esta olhando. O QR so nasce quando alguem clica no botao
 * (ver `requestConnectionQr`), porque a UAZAPI expira o codigo em poucos segundos.
 */
export async function readConnectionStatus(
  uazapiClient: UazapiClient,
  credentials: { baseUrl: string; token: string },
): Promise<InstanceConnectionState> {
  const record = instanceRecord((await uazapiClient.getInstanceStatus(credentials)).body);
  const status = readString(record, 'status');

  return {
    qrCodeSvg: null,
    pairCode: null,
    connected: status === 'connected',
    status,
    detail: null,
  };
}

/** Tentativas de reler o status ate a UAZAPI publicar o QR, e a pausa entre elas. */
const qrPollAttempts = 5;
const qrPollDelayMs = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mensagem de erro que a UAZAPI devolve no corpo, quando devolve alguma. */
function errorMessage(body: unknown): string | null {
  const record = asRecord(body);
  return readString(record, 'error', 'message', 'erro');
}

function failureDetail(step: string, result: { status: number; body: unknown }): string {
  const message = errorMessage(result.body);
  return `A UAZAPI respondeu HTTP ${result.status} ${step}${message ? `: ${message}` : '.'}`;
}

/**
 * Pede o pareamento de fato. Chama `/instance/connect` quando ainda nao ha QR e depois
 * insiste no status por alguns segundos: a UAZAPI costuma responder o connect com
 * `connecting` e so publicar o `qrcode` logo em seguida — desistir na primeira leitura
 * era o que fazia a tela dizer que nao deu para gerar o codigo.
 */
export async function requestConnectionQr(
  uazapiClient: UazapiClient,
  credentials: { baseUrl: string; token: string },
  options: { pollDelayMs?: number } = {},
): Promise<InstanceConnectionState> {
  const pollDelayMs = options.pollDelayMs ?? qrPollDelayMs;
  const first = await uazapiClient.getInstanceStatus(credentials);
  let record = instanceRecord(first.body);
  let status = readString(record, 'status');
  let qrcode = readString(record, 'qrcode', 'qrCode');
  let detail = first.ok ? null : failureDetail('ao consultar a instancia', first);

  if (status !== 'connected' && !qrcode) {
    const connect = await uazapiClient.connectInstance(credentials);
    const connectRecord = instanceRecord(connect.body);
    status = readString(connectRecord, 'status') ?? status;
    qrcode = readString(connectRecord, 'qrcode', 'qrCode');
    if (qrcode || connect.ok) record = connectRecord;
    detail = connect.ok ? null : failureDetail('ao pedir a conexao', connect);

    for (let attempt = 0; !qrcode && status !== 'connected' && attempt < qrPollAttempts; attempt += 1) {
      await wait(pollDelayMs);
      const poll = await uazapiClient.getInstanceStatus(credentials);
      const pollRecord = instanceRecord(poll.body);
      status = readString(pollRecord, 'status') ?? status;
      qrcode = readString(pollRecord, 'qrcode', 'qrCode');
      if (qrcode) record = pollRecord;
      if (!poll.ok) detail = failureDetail('ao consultar a instancia', poll);
    }
  }

  const qrCodeSvg = qrcode ? await toQrSvg(qrcode) : null;
  if (qrcode && !qrCodeSvg) detail = 'A UAZAPI devolveu um codigo que nao deu para desenhar.';
  else if (!qrcode && !detail && status !== 'connected') {
    detail = 'A UAZAPI aceitou o pedido mas ainda nao publicou o QR code.';
  }

  return {
    qrCodeSvg,
    pairCode: readString(record, 'paircode', 'pairCode'),
    connected: status === 'connected',
    status,
    detail: qrCodeSvg ? null : detail,
  };
}

/**
 * Remove a instancia no servidor UAZAPI. Devolve `true` tambem quando a instancia ja nao
 * existe (404): o objetivo — nao deixar instancia orfa — ja esta cumprido.
 */
export async function deleteInstance(
  uazapiClient: UazapiClient,
  credentials: { baseUrl: string; token: string },
): Promise<{ removed: boolean; status: number }> {
  const result = await uazapiClient.deleteInstance(credentials);
  return { removed: result.ok || result.status === 404, status: result.status };
}
