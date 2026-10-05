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
  /** Paginas publicas (sem sessao) nao podem exibir o menu do portal. */
  hideNavigation?: boolean;
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
        ${navItem('/dashboard', 'Painel', title, ['painel'])}
        ${navItem('/conversations', 'Conversas', title, ['conversa'])}
        ${navItem('/leads', 'Leads', title, ['lead'])}
        ${navItem('/sdr-agents', 'SDRs', title, ['sdr'])}
        ${navItem('/relatorios', 'Relatorios', title, ['relatorios'])}
      </section>
      <section class="nav-group">
        <p>Configuracoes</p>
        ${navItem('/companies', 'Empresas', title, ['empresa'])}
        ${navItem('/monitoring', 'Monitor', title, ['monitor de conexao'])}
        ${navItem('/prompt-assistant', 'IA auxiliar', title, ['auxiliar de prompt'])}
        ${navItem('/registros', 'Registros', title, ['registros'])}
      </section>
    </nav>
    <form method="post" action="/logout" class="sidebar-logout">
      <button class="button button-secondary" type="submit">Sair</button>
    </form>
  </aside>`;
}

export function renderLayout({ title, body, hideNavigation = false }: LayoutOptions): string {
  const pageTitle = escapeHtml(title);
  const isAppPage = !hideNavigation && body.includes('app-shell');
  const bodyHtml = isAppPage ? `<div class="app-frame">${renderAppNavigation(title)}${body}</div>` : body;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${pageTitle}</title>
    <link rel="stylesheet" href="/styles.css">
    <script src="/app.js" defer></script>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}
