import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { UazapiActionOutcome } from './action-summary.js';

/**
 * Pagina de reserva dos botoes de teste do SDR, para quando o navegador nao roda o
 * `/app.js` (que mostra o resultado na propria tela). Mesmo texto em portugues; o JSON da
 * UAZAPI fica recolhido.
 */
export function renderUazapiResultPage(agent: SdrAgent, outcome: UazapiActionOutcome): string {
  const raw = outcome.raw
    ? `<details class="spacing-top"><summary>Detalhes tecnicos</summary><pre>${escapeHtml(outcome.raw)}</pre></details>`
    : '';
  const hint = outcome.hint ? `<p class="muted">${escapeHtml(outcome.hint)}</p>` : '';

  return renderLayout({
    title: `${outcome.title} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>${escapeHtml(outcome.title)}</h1>
      <p class="muted">SDR: ${escapeHtml(agent.displayName || agent.name)}</p>
    </div>
    <div class="actions">
      <a class="button" href="/sdr-agents/${agent.id}/edit">Voltar ao SDR</a>
    </div>
  </header>
  <section class="panel action-result ${outcome.ok ? 'action-result-ok' : 'action-result-error'}">
    <strong>${outcome.ok ? '&#10003;' : '&#10007;'} ${escapeHtml(outcome.summary)}</strong>
    ${hint}
    ${raw}
  </section>
</main>`,
  });
}
