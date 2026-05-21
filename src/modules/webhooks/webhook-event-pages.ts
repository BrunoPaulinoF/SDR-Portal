import type { WebhookEvent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

export function renderWebhookEventsPage(events: WebhookEvent[]): string {
  const rows = events
    .map(
      (event) => `<tr>
        <td>${event.createdAt.toISOString()}</td>
        <td>${escapeHtml(event.processingStatus)}</td>
        <td>${escapeHtml(event.eventType ?? '-')}</td>
        <td>${escapeHtml(event.fromNumber ?? '-')}</td>
        <td>${escapeHtml(event.processingError ?? '-')}</td>
        <td><details><summary>Payload</summary><pre>${escapeHtml(event.rawBody)}</pre></details></td>
      </tr>`,
    )
    .join('');
  const table = events.length
    ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Status</th><th>Evento</th><th>Numero</th><th>Erro</th><th>Raw</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="panel"><p class="muted">Nenhum webhook recebido ainda.</p></section>';

  return renderLayout({
    title: 'Webhook logs - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Webhook logs</h1><p class="muted">Payloads brutos recebidos da UAZAPI.</p></div><a class="button button-secondary" href="/dashboard">Dashboard</a></header>${table}</main>`,
  });
}
