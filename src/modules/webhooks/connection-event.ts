interface RecordValue {
  [key: string]: unknown;
}

export interface ConnectionEvent {
  /** `status` cru da instancia, quando o payload traz (`connected`, `disconnected`, ...). */
  status: string | null;
  instanceId: string | null;
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Evento de conexao da UAZAPI (`connection`), que avisa quando a instancia cai ou volta.
 *
 * Ele nao carrega mensagem nenhuma, entao `normalizeUazapiWebhook` devolve `null` e o
 * webhook o marcava como falha — era ruido no `/webhook-events` e, pior, a queda passava
 * batida. Aqui ele vira sinal: o monitor confere a instancia na hora.
 */
export function readConnectionEvent(body: unknown): ConnectionEvent | null {
  const root = asRecord(body);
  const eventType = firstString(root.EventType, root.eventType, root.event, root.type)?.toLowerCase() ?? '';

  // So `connection`: `status` tambem aparece em evento de entrega de mensagem, e tratar
  // aquilo como conexao faria a mensagem do lead ser descartada aqui.
  if (!eventType.includes('connection')) return null;

  const instance = asRecord(root.instance);
  const data = asRecord(root.data);

  return {
    status: firstString(instance.status, data.status, root.status, root.state, root.connection),
    instanceId: firstString(instance.id, instance.instanceId, root.instance, data.instance, root.instanceId, root.instance_id),
  };
}
