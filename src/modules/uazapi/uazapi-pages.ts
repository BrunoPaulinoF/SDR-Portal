import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { UazapiResult } from './uazapi-client.js';

export function renderUazapiResultPage(agent: SdrAgent, title: string, result: UazapiResult | null, error?: string): string {
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';
  const resultHtml = result
    ? `<section class="panel">
      <h2>Resposta</h2>
      <p>Status HTTP: ${result.status} - ${result.ok ? 'OK' : 'Erro'}</p>
      <pre>${escapeHtml(JSON.stringify(result.body, null, 2))}</pre>
    </section>`
    : '';

  return renderLayout({
    title: `${title} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">SDR: ${escapeHtml(agent.name)}</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/sdr-agents/${agent.id}/edit">Voltar ao SDR</a>
      <a class="button button-secondary" href="/sdr-agents">Lista de SDRs</a>
    </div>
  </header>
  ${errorHtml}
  ${resultHtml}
</main>`,
  });
}
