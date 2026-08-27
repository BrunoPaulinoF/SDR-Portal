import type { JobLog } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

/**
 * A coluna mostrava `payload ?? result`, entao a linha que tinha os dois so exibia o payload —
 * e e o `result` que guarda a resposta da UAZAPI numa falha. Em 27/08 isso escondeu justamente
 * o corpo do HTTP 500 que explicava o disparo travado: a informacao estava gravada e invisivel.
 */
function renderDetails(log: JobLog): string {
  const blocos = [
    log.payload ? `payload: ${log.payload}` : null,
    log.result ? `resultado: ${log.result}` : null,
  ].filter((bloco): bloco is string => bloco !== null);

  return blocos.length > 0 ? blocos.join('\n\n') : '-';
}

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
        <td><details><summary>Ver</summary><pre style="max-height:150px;overflow:auto;font-size:0.75rem;">${escapeHtml(renderDetails(log))}</pre></details></td>
      </tr>`,
    )
    .join('');

  const table = logs.length
    ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Job</th><th>Status</th><th>Tentativa</th><th>SDR</th><th>Lead</th><th>Erro</th><th>Payload/Resultado</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="empty-state"><h2>Nenhum job executado</h2><p class="muted">Execucoes de disparo inicial e follow-up aparecerao aqui.</p></section>';

  return renderLayout({
    title: 'Job logs - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Logs de jobs</h1><p class="muted">Execucoes de disparo inicial, follow-up e outros jobs do scheduler.</p></div></header><nav class="tabs-inline"><a href="/webhook-events">Webhook logs</a><a href="/ai-runs">AI logs</a><a href="/job-logs">Job logs</a></nav>${table}</main>`,
  });
}
