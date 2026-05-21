import type { JobLog } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

export function renderJobLogsPage(logs: JobLog[]): string {
  const rows = logs
    .map(
      (log) => `<tr>
        <td>${log.createdAt.toISOString()}</td>
        <td>${escapeHtml(log.jobName)}</td>
        <td>${escapeHtml(log.status)}</td>
        <td>${log.attempt}</td>
        <td>${escapeHtml(log.sdrAgentId ?? '-')}</td>
        <td>${escapeHtml(log.leadId ?? '-')}</td>
        <td>${escapeHtml(log.error ?? '-')}</td>
        <td><details><summary>Ver</summary><pre style="max-height:150px;overflow:auto;font-size:0.75rem;">${escapeHtml(log.payload ?? log.result ?? '-')}</pre></details></td>
      </tr>`,
    )
    .join('');

  const table = logs.length
    ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Job</th><th>Status</th><th>Tentativa</th><th>SDR</th><th>Lead</th><th>Erro</th><th>Payload/Resultado</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="panel"><p class="muted">Nenhum job executado ainda.</p></section>';

  return renderLayout({
    title: 'Job logs - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Logs de jobs</h1><p class="muted">Execucoes de disparo inicial, follow-up e outros jobs do scheduler.</p></div><a class="button button-secondary" href="/dashboard">Dashboard</a></header>${table}</main>`,
  });
}
