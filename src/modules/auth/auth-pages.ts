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
      <h1>Dashboard</h1>
      <p class="muted">Resumo das areas do portal. Logado como ${escapeHtml(user.name)} (${escapeHtml(user.email)}).</p>
    </div>
  </header>

  <section class="page-section">
    <div class="section-heading">
      <h2>Operacao diaria</h2>
      <p class="muted">Acompanhe leads, conversas e execucoes manuais.</p>
    </div>
    <div class="grid">
      <article class="panel module-card">
        <h3>Leads</h3>
        <p class="muted">Cadastre contatos manualmente ou importe planilhas Excel.</p>
        <a class="button" href="/leads">Abrir leads</a>
      </article>
      <article class="panel module-card">
        <h3>Conversas</h3>
        <p class="muted">Consulte mensagens recebidas e enviadas registradas via webhook.</p>
        <a class="button" href="/conversations">Abrir conversas</a>
      </article>
      <article class="panel module-card">
        <h3>Scheduler</h3>
        <p class="muted">Execute disparos iniciais e follow-ups para validar fila e configuracoes.</p>
        <div class="actions">
          <form method="post" action="/scheduler/initial-outreach/run"><button type="submit">Rodar inicial</button></form>
          <form method="post" action="/scheduler/followup/run"><button class="button-secondary" type="submit">Rodar follow-up</button></form>
        </div>
      </article>
    </div>
  </section>

  <section class="page-section">
    <div class="section-heading">
      <h2>Configuracao</h2>
      <p class="muted">Defina empresas, SDRs, prompts, modelos e WhatsApp.</p>
    </div>
    <div class="grid">
      <article class="panel module-card">
        <h3>Empresas</h3>
        <p class="muted">Cadastre empresas que terao um ou mais SDRs.</p>
        <a class="button" href="/companies">Abrir empresas</a>
      </article>
      <article class="panel module-card">
        <h3>SDRs</h3>
        <p class="muted">Configure agentes, prompts, modelos e conexoes WhatsApp.</p>
        <a class="button" href="/sdr-agents">Abrir SDRs</a>
      </article>
      <article class="panel module-card">
        <h3>IA auxiliar de prompt</h3>
        <p class="muted">Gere e refine prompts para seus SDRs com ajuda da IA.</p>
        <a class="button" href="/prompt-assistant">Abrir IA auxiliar</a>
      </article>
    </div>
  </section>

  <section class="page-section">
    <div class="section-heading">
      <h2>Diagnostico</h2>
      <p class="muted">Use quando precisar entender webhooks, IA, jobs e erros. Perfil: ${escapeHtml(user.role)}.</p>
    </div>
    <div class="grid">
      <article class="panel module-card">
        <h3>Webhook logs</h3>
        <p class="muted">Veja payloads brutos recebidos da UAZAPI.</p>
        <a class="button" href="/webhook-events">Abrir webhooks</a>
      </article>
      <article class="panel module-card">
        <h3>AI logs</h3>
        <p class="muted">Consulte chamadas de IA com tokens, latencia e erros.</p>
        <a class="button" href="/ai-runs">Abrir AI logs</a>
      </article>
      <article class="panel module-card">
        <h3>Job logs</h3>
        <p class="muted">Veja execucoes do scheduler com payload e resultado.</p>
        <a class="button" href="/job-logs">Abrir job logs</a>
      </article>
    </div>
  </section>
</main>`,
  });
}
