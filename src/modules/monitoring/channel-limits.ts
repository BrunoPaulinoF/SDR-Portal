import type { SdrChannelLimits } from '../../db/schema.js';
import type { JobLogRepository } from '../jobs/job-log-repository.js';
import type { UazapiClient, UazapiCredentials } from '../uazapi/uazapi-client.js';

/**
 * Limites do WhatsApp para a conta de cada SDR iniciar conversas novas.
 *
 * Duas coisas do proprio WhatsApp — nao da UAZAPI — seguram o disparo, e as duas so apareciam
 * para o portal quando um envio ja tinha sido recusado (`provider_code: 463`):
 * - `reachout_timelock`: proibicao temporaria de iniciar conversas, com `until` explicito,
 *   "normalmente relacionada a volume ou qualidade de envios";
 * - `new_chat_message_capping`: cota de conversas novas por ciclo (`used_quota`/`total_quota`).
 *
 * A UAZAPI expoe as duas em `GET /instance/wa_messages_limits`. Consultar antes de disparar
 * evita a tentativa que bate no bloqueio — e cada tentativa contra um bloqueio de qualidade
 * reforca o motivo dele. A resposta fica em `sdr_channel_limits` para sobreviver ao restart (o
 * recuo de `send-backoff.ts` e so de memoria) e para o painel e o relatorio mostrarem.
 */

/** Uma consulta a cada 15min por SDR: o tick do disparo roda a cada minuto. */
export const CHANNEL_LIMITS_TTL_MS = 15 * 60 * 1000;

export interface ChannelLimitsRepository {
  find(sdrAgentId: string): Promise<SdrChannelLimits | null>;
  list(): Promise<SdrChannelLimits[]>;
  save(row: SdrChannelLimits): Promise<void>;
}

export function createMemoryChannelLimitsRepository(seed: SdrChannelLimits[] = []): ChannelLimitsRepository {
  const rows = new Map(seed.map((row) => [row.sdrAgentId, row]));
  return {
    async find(sdrAgentId) {
      return rows.get(sdrAgentId) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async save(row) {
      rows.set(row.sdrAgentId, row);
    },
  };
}

type LimitsReading = Omit<SdrChannelLimits, 'sdrAgentId' | 'source' | 'checkedAt'>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Le a resposta de `/instance/wa_messages_limits` (ou o `details` de um envio recusado, que tem
 * os mesmos blocos). `blockedUntil` e ate quando o disparo nao tenta: o `until` do timelock, o
 * fim do ciclo da cota, ou a proxima consulta quando o WhatsApp diz "nao" sem dar data.
 */
export function readMessageLimits(body: unknown, now: Date, recheckMs = CHANNEL_LIMITS_TTL_MS): LimitsReading {
  const root = asRecord(body);
  const timelock = asRecord(root.reachout_timelock);
  const capping = asRecord(root.new_chat_message_capping);
  const canStart = typeof root.can_send_new_messages === 'boolean' ? root.can_send_new_messages : null;
  const recheckAt = new Date(now.getTime() + recheckMs);

  const timelockUntil = timelock.active === true ? (asDate(timelock.until) ?? recheckAt) : null;
  const quotaUsed = capping.available === false ? null : asCount(capping.used_quota);
  const quotaTotal = capping.available === false ? null : asCount(capping.total_quota);
  const quotaResetsAt = asDate(capping.cycle_end);
  const capped =
    capping.status === 'CAPPED' || (quotaUsed !== null && quotaTotal !== null && quotaTotal > 0 && quotaUsed >= quotaTotal);
  const cappedUntil = capped ? (quotaResetsAt && quotaResetsAt.getTime() > now.getTime() ? quotaResetsAt : recheckAt) : null;

  const reasons: string[] = [];
  if (timelockUntil) {
    const enforcement = typeof timelock.enforcement_type === 'string' ? ` (${timelock.enforcement_type})` : '';
    reasons.push(`WhatsApp bloqueou novas conversas${enforcement}`);
  }
  if (capped) reasons.push(`cota de conversas novas esgotada${quotaTotal !== null ? ` (${quotaUsed ?? quotaTotal}/${quotaTotal})` : ''}`);

  let blockedUntil = later(timelockUntil, cappedUntil);
  if (!blockedUntil && canStart === false) {
    blockedUntil = recheckAt;
    const message = typeof root.provider_message_ptbr === 'string' ? root.provider_message_ptbr : null;
    reasons.push(message ?? 'WhatsApp diz que a conta nao pode iniciar conversas agora');
  }

  return {
    canStartConversations: blockedUntil ? false : canStart,
    blockedUntil,
    blockReason: reasons.length > 0 ? reasons.join('; ') : null,
    quotaUsed,
    quotaTotal,
    quotaResetsAt,
  };
}

/**
 * Restricao de conta no corpo de um envio recusado, ou `null` quando a recusa e outra coisa
 * (instancia fora, numero ruim). So o 463 do WhatsApp entra: tratar qualquer erro como bloqueio
 * pararia o disparo por motivo que nao e do canal.
 */
export function restrictionFromSendRefusal(body: unknown, now: Date): LimitsReading | null {
  const root = asRecord(body);
  const errorKey = typeof root.error_key === 'string' ? root.error_key : '';
  if (root.provider_code !== 463 && !errorKey.startsWith('WHATSAPP_')) return null;

  const details = asRecord(root.details);
  return readMessageLimits(
    {
      can_send_new_messages: false,
      reachout_timelock: details.reachout_timelock,
      new_chat_message_capping: details.new_chat_message_capping,
      provider_message_ptbr: root.provider_message_ptbr,
    },
    now,
  );
}

export type ChannelLimitsDecision = { allowed: true } | { allowed: false; until: Date; reason: string };

export interface ChannelLimitsGate {
  /** Pode iniciar conversa nova agora? Consulta a UAZAPI no maximo uma vez a cada 15min. */
  check(agentId: string, credentials: UazapiCredentials, now: Date): Promise<ChannelLimitsDecision>;
  /** Guarda o bloqueio que veio no corpo de um envio recusado; ignora recusa que nao e de conta. */
  recordSendRefusal(agentId: string, body: unknown, now: Date): Promise<void>;
}

interface GateDependencies {
  jobLogRepository: JobLogRepository;
  repository: ChannelLimitsRepository;
  uazapiClient: UazapiClient;
  ttlMs?: number;
}

function isBlocked(row: SdrChannelLimits | null, now: Date): row is SdrChannelLimits & { blockedUntil: Date } {
  return Boolean(row?.blockedUntil && row.blockedUntil.getTime() > now.getTime());
}

export function createChannelLimitsGate(deps: GateDependencies): ChannelLimitsGate {
  const ttlMs = deps.ttlMs ?? CHANNEL_LIMITS_TTL_MS;

  async function store(agentId: string, reading: LimitsReading, source: string, now: Date): Promise<SdrChannelLimits> {
    const previous = await deps.repository.find(agentId);
    const row: SdrChannelLimits = { sdrAgentId: agentId, ...reading, source, checkedAt: now };
    await deps.repository.save(row);

    // Uma linha em /job-logs por bloqueio novo, nao uma por consulta.
    const fresh = isBlocked(row, now) && (!isBlocked(previous, now) || previous.blockedUntil.getTime() !== row.blockedUntil?.getTime());
    if (fresh) {
      await deps.jobLogRepository.create({
        jobName: 'channel-limits',
        jobKey: `channel-limits-${agentId}`,
        sdrAgentId: agentId,
        leadId: null,
        status: 'skipped',
        attempt: 1,
        payload: JSON.stringify({ source }),
        result: JSON.stringify(row),
        error: row.blockReason,
        startedAt: now,
        finishedAt: new Date(),
      });
    }
    return row;
  }

  function decision(row: SdrChannelLimits, now: Date): ChannelLimitsDecision {
    if (!isBlocked(row, now)) return { allowed: true };
    return { allowed: false, until: row.blockedUntil, reason: row.blockReason ?? 'WhatsApp nao deixa iniciar conversas agora' };
  }

  return {
    async check(agentId, credentials, now) {
      const stored = await deps.repository.find(agentId);
      if (stored && (isBlocked(stored, now) || now.getTime() - stored.checkedAt.getTime() < ttlMs)) {
        return decision(stored, now);
      }

      let reading: LimitsReading;
      try {
        const result = await deps.uazapiClient.getMessageLimits(credentials);
        reading = result.ok
          ? readMessageLimits(result.body, now, ttlMs)
          : { canStartConversations: null, blockedUntil: null, blockReason: `consulta de limites recusada (HTTP ${result.status})`, quotaUsed: null, quotaTotal: null, quotaResetsAt: null };
      } catch (error) {
        // Consulta que falha nao para o disparo: sem ela o portal funcionava antes, e o envio
        // recusado continua sendo pego pelo recuo e por `recordSendRefusal`.
        const message = error instanceof Error ? error.message : String(error);
        reading = { canStartConversations: null, blockedUntil: null, blockReason: `consulta de limites falhou: ${message}`, quotaUsed: null, quotaTotal: null, quotaResetsAt: null };
      }

      return decision(await store(agentId, reading, 'consulta', now), now);
    },

    async recordSendRefusal(agentId, body, now) {
      const reading = restrictionFromSendRefusal(body, now);
      if (reading) await store(agentId, reading, 'envio', now);
    },
  };
}
