export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface LayoutOptions {
  title: string;
  body: string;
}

function navItem(href: string, label: string, title: string, matches: string[]): string {
  const normalizedTitle = title.split(' - ')[0]?.toLowerCase() ?? title.toLowerCase();
  const active = matches.some((match) => normalizedTitle.includes(match)) ? ' nav-active' : '';
  return `<a class="nav-link${active}" href="${href}">${label}</a>`;
}

function renderAppNavigation(title: string): string {
  return `<aside class="sidebar">
    <div class="brand">
      <strong>SDR Portal</strong>
      <span>Operacao interna</span>
    </div>
    <nav class="nav-groups" aria-label="Menu principal">
      <section class="nav-group">
        <p>Operacao</p>
        ${navItem('/dashboard', 'Dashboard', title, ['dashboard'])}
        ${navItem('/leads', 'Leads', title, ['lead'])}
        ${navItem('/conversations', 'Conversas', title, ['conversa'])}
      </section>
      <section class="nav-group">
        <p>Configuracao</p>
        ${navItem('/companies', 'Empresas', title, ['empresa'])}
        ${navItem('/sdr-agents', 'SDRs', title, ['sdr'])}
        ${navItem('/prompt-assistant', 'IA auxiliar', title, ['auxiliar de prompt'])}
      </section>
      <section class="nav-group">
        <p>Diagnostico</p>
        ${navItem('/webhook-events', 'Webhook logs', title, ['webhook'])}
        ${navItem('/ai-runs', 'AI logs', title, ['ai runs', 'logs de ia'])}
        ${navItem('/job-logs', 'Job logs', title, ['job'])}
      </section>
    </nav>
    <form method="post" action="/logout" class="sidebar-logout">
      <button class="button button-secondary" type="submit">Sair</button>
    </form>
  </aside>`;
}

export function renderLayout({ title, body }: LayoutOptions): string {
  const pageTitle = escapeHtml(title);
  const isAppPage = body.includes('app-shell');
  const bodyHtml = isAppPage ? `<div class="app-frame">${renderAppNavigation(title)}${body}</div>` : body;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>${bodyHtml}</body>
</html>`;
}
