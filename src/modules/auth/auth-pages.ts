import { escapeHtml, renderLayout } from '../web/html.js';

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
