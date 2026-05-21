import type { AiRun } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

export function renderAiRunsPage(runs: AiRun[]): string {
  const rows = runs
    .map(
      (run) => `<tr>
        <td>${run.createdAt.toISOString()}</td>
        <td>${escapeHtml(run.provider)}</td>
        <td>${escapeHtml(run.model)}</td>
        <td>${escapeHtml(run.purpose)}</td>
        <td>${escapeHtml(run.sdrAgentId ?? '-')}</td>
        <td>${escapeHtml(run.leadId ?? '-')}</td>
        <td>${escapeHtml(run.error ?? 'OK')}</td>
        <td>${run.promptTokens ?? '-'} / ${run.completionTokens ?? '-'}</td>
        <td>${run.latencyMs != null ? `${run.latencyMs}ms` : '-'}</td>
        <td><details><summary>Ver</summary><pre style="max-height:200px;overflow:auto;font-size:0.75rem;">${escapeHtml(run.outputText ?? run.error ?? '-')}</pre></details></td>
      </tr>`,
    )
    .join('');

  const table = runs.length
    ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Provider</th><th>Modelo</th><th>Proposito</th><th>SDR</th><th>Lead</th><th>Erro</th><th>Tokens</th><th>Latencia</th><th>Output</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="panel"><p class="muted">Nenhuma chamada de IA registrada ainda.</p></section>';

  return renderLayout({
    title: 'AI runs - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Logs de IA</h1><p class="muted">Chamadas registradas ao modelo de IA com resultados e erros.</p></div><a class="button button-secondary" href="/dashboard">Dashboard</a></header>${table}</main>`,
  });
}
