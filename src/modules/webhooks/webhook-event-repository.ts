import { randomUUID } from 'node:crypto';

import type { NewWebhookEvent, WebhookEvent } from '../../db/schema.js';
import type { RecentLogFilter } from '../logs/recent-log-filter.js';

export type WebhookEventInput = Pick<
  NewWebhookEvent,
  | 'sdrAgentId'
  | 'eventType'
  | 'messageType'
  | 'instanceId'
  | 'whatsappMessageId'
  | 'fromNumber'
  | 'toNumber'
  | 'fromMe'
  | 'wasSentByApi'
  | 'rawHeaders'
  | 'rawBody'
  | 'normalizedBody'
  | 'processingStatus'
  | 'processingError'
>;

export interface WebhookEventUpdateInput {
  eventType?: string | null;
  messageType?: string | null;
  instanceId?: string | null;
  whatsappMessageId?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  fromMe?: boolean | null;
  wasSentByApi?: boolean | null;
  normalizedBody?: string | null;
  processingStatus: string;
  processingError?: string | null;
}

export interface WebhookEventRepository {
  create(input: WebhookEventInput): Promise<WebhookEvent>;
  list(): Promise<WebhookEvent[]>;
  /** Uma pagina da tela Registros, do mais novo para o mais velho. Erro = `processing_status = 'failed'`. */
  listRecent(filter: RecentLogFilter, limit: number, offset: number): Promise<WebhookEvent[]>;
  updateProcessing(id: string, input: WebhookEventUpdateInput): Promise<WebhookEvent | null>;
}

export function createMemoryWebhookEventRepository(seedEvents: WebhookEvent[] = []): WebhookEventRepository {
  const rows = new Map<string, WebhookEvent>();
  for (const event of seedEvents) rows.set(event.id, event);

  return {
    async create(input) {
      const event: WebhookEvent = {
        id: randomUUID(),
        sdrAgentId: input.sdrAgentId ?? null,
        eventType: input.eventType ?? null,
        messageType: input.messageType ?? null,
        instanceId: input.instanceId ?? null,
        whatsappMessageId: input.whatsappMessageId ?? null,
        fromNumber: input.fromNumber ?? null,
        toNumber: input.toNumber ?? null,
        fromMe: input.fromMe ?? null,
        wasSentByApi: input.wasSentByApi ?? null,
        rawHeaders: input.rawHeaders ?? null,
        rawBody: input.rawBody,
        normalizedBody: input.normalizedBody ?? null,
        processingStatus: input.processingStatus ?? 'received',
        processingError: input.processingError ?? null,
        createdAt: new Date(),
      };
      rows.set(event.id, event);
      return event;
    },

    async list() {
      return [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async listRecent(filter, limit, offset) {
      return [...rows.values()]
        .filter(
          (event) =>
            (!filter.onlyErrors || event.processingStatus === 'failed') && (!filter.sdrAgentId || event.sdrAgentId === filter.sdrAgentId),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(offset, offset + limit);
    },

    async updateProcessing(id, input) {
      const current = rows.get(id);
      if (!current) return null;
      const updated: WebhookEvent = { ...current, ...input };
      rows.set(id, updated);
      return updated;
    },
  };
}
