import { escapeHtml, renderLayout } from '../web/html.js';
import type { AuthUser } from './auth-repository.js';

export function renderLoginPage(error?: string): string {
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';

  return renderLayout({
    title: 'Login - SDR Portal',
    body: `<main class="auth-page">
  <section class="card">
    <h1>SDR Portal</h1>
    <p class="muted">Acesse o painel interno para configurar e operar seus SDRs.</p>
    ${errorHtml}
    <form method="post" action="/login">
      <div class="field">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="email" required autofocus>
      </div>
      <div class="field">
        <label for="password">Senha</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit">Entrar</button>
    </form>
  </section>
</main>`,
  });
}

export function renderDashboardPage(user: Pick<AuthUser, 'name' | 'email' | 'role'>): string {
  return renderLayout({
    title: 'Dashboard - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>SDR Portal</h1>
      <p class="muted">Logado como ${escapeHtml(user.name)} (${escapeHtml(user.email)})</p>
    </div>
    <form method="post" action="/logout">
      <button class="button-secondary" type="submit">Sair</button>
    </form>
  </header>
  <section class="grid">
    <article class="panel">
      <h2>Empresas</h2>
      <p class="muted">Cadastre empresas que terao um ou mais SDRs.</p>
      <a class="button" href="/companies">Abrir empresas</a>
    </article>
    <article class="panel">
      <h2>SDRs</h2>
      <p class="muted">Configure agentes, prompts, modelos e conexoes WhatsApp.</p>
      <a class="button" href="/sdr-agents">Abrir SDRs</a>
    </article>
    <article class="panel">
      <h2>Status</h2>
      <p class="muted">Portal configurado ate a Fase 17. Perfil: ${escapeHtml(user.role)}.</p>
    </article>
    <article class="panel">
      <h2>Leads</h2>
      <p class="muted">Cadastre contatos manualmente ou importe planilhas Excel.</p>
      <a class="button" href="/leads">Abrir leads</a>
    </article>
    <article class="panel">
      <h2>Scheduler</h2>
      <p class="muted">Execute manualmente disparos iniciais e follow-ups para validar fila e configuracoes.</p>
      <form method="post" action="/scheduler/initial-outreach/run">
        <button type="submit">Rodar disparo inicial</button>
      </form>
      <form method="post" action="/scheduler/followup/run">
        <button type="submit">Rodar follow-up</button>
      </form>
    </article>
    <article class="panel">
      <h2>IA auxiliar de prompt</h2>
      <p class="muted">Gere e refine prompts para seus SDRs com ajuda da IA.</p>
      <a class="button" href="/prompt-assistant">Abrir IA auxiliar</a>
    </article>
    <article class="panel">
      <h2>Conversas</h2>
      <p class="muted">Consulte mensagens recebidas e enviadas registradas via webhook.</p>
      <a class="button" href="/conversations">Abrir conversas</a>
    </article>
    <article class="panel">
      <h2>Webhook logs</h2>
      <p class="muted">Veja payloads brutos recebidos da UAZAPI para diagnostico.</p>
      <a class="button" href="/webhook-events">Abrir logs</a>
    </article>
    <article class="panel">
      <h2>AI logs</h2>
      <p class="muted">Consulte chamadas de IA com tokens, latencia, proposito e erros.</p>
      <a class="button" href="/ai-runs">Abrir AI logs</a>
    </article>
    <article class="panel">
      <h2>Job logs</h2>
      <p class="muted">Veja execucoes do scheduler com payload, resultado e erros.</p>
      <a class="button" href="/job-logs">Abrir job logs</a>
    </article>
  </section>
</main>`,
  });
}
