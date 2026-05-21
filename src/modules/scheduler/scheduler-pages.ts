import { escapeHtml, renderLayout } from '../web/html.js';
import type { FollowupOutreachResult } from './followup-outreach.js';
import type { InitialOutreachResult } from './initial-outreach.js';

function renderSchedulerResultPage(title: string, description: string, result: InitialOutreachResult | FollowupOutreachResult): string {
  const details = result.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('');

  return renderLayout({
    title: `${title} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(description)}</p>
    </div>
    <a class="button button-secondary" href="/job-logs">Ver job logs</a>
  </header>
  <section class="panel">
    <p>Enviadas: ${result.sent}</p>
    <p>Ignoradas: ${result.skipped}</p>
    <p>Erros: ${result.errors}</p>
    <ul>${details}</ul>
  </section>
</main>`,
  });
}

export function renderInitialOutreachResultPage(result: InitialOutreachResult): string {
  return renderSchedulerResultPage('Disparo inicial', 'Execucao manual do scheduler de mensagens iniciais.', result);
}

export function renderFollowupOutreachResultPage(result: FollowupOutreachResult): string {
  return renderSchedulerResultPage('Follow-up', 'Execucao manual do scheduler de follow-up unico.', result);
}
