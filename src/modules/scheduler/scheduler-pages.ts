import { escapeHtml, renderLayout } from '../web/html.js';
import type { FollowupOutreachResult } from './followup-outreach.js';
import type { InitialOutreachResult } from './initial-outreach.js';
import type { PendingReplyResult } from './pending-reply.js';

function renderSchedulerResultPage(
  title: string,
  description: string,
  result: { skipped: number; errors: number; details: string[] },
  primary: { label: string; value: number },
): string {
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
    <p>${escapeHtml(primary.label)}: ${primary.value}</p>
    <p>Ignoradas: ${result.skipped}</p>
    <p>Erros: ${result.errors}</p>
    <ul>${details}</ul>
  </section>
</main>`,
  });
}

export function renderInitialOutreachResultPage(result: InitialOutreachResult): string {
  return renderSchedulerResultPage('Disparo inicial', 'Execucao manual do scheduler de mensagens iniciais.', result, {
    label: 'Enviadas',
    value: result.sent,
  });
}

export function renderFollowupOutreachResultPage(result: FollowupOutreachResult): string {
  return renderSchedulerResultPage('Follow-up', 'Execucao manual do scheduler de follow-up unico.', result, {
    label: 'Enviadas',
    value: result.sent,
  });
}

export function renderPendingReplyResultPage(result: PendingReplyResult): string {
  return renderSchedulerResultPage(
    'Respostas pendentes',
    'Leads que responderam e ficaram sem resposta da IA — nova tentativa manual.',
    result,
    { label: 'Reenviadas para a IA', value: result.retried },
  );
}
