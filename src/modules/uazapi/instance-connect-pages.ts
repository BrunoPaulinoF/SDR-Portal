import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { InstanceConnectionState } from './instance-provisioning.js';
import { shareLinkTtlMinutes } from './instance-share-link-repository.js';

/**
 * O SVG do QR e gerado por nos (biblioteca qrcode) ou e um <img> com data URI montado
 * a partir do que a UAZAPI devolveu — em nenhum dos casos ha texto do usuario dentro,
 * por isso entra sem escape.
 */
function renderQrPanel(state: InstanceConnectionState): string {
  if (state.connected) {
    return `<div class="qr-box qr-connected">
      <p class="qr-status-ok">WhatsApp conectado</p>
      <p class="muted">Pode fechar esta pagina.</p>
    </div>`;
  }

  if (!state.qrCodeSvg) {
    return `<div class="qr-box">
      <p class="muted">Gerando o QR code...</p>
      <p class="muted">Status atual: ${escapeHtml(state.status ?? 'desconhecido')}</p>
    </div>`;
  }

  const pairCode = state.pairCode
    ? `<p class="muted">Ou use o codigo de pareamento: <strong>${escapeHtml(state.pairCode)}</strong></p>`
    : '';

  return `<div class="qr-box">
    ${state.qrCodeSvg}
    ${pairCode}
  </div>`;
}

function renderInstructions(): string {
  return `<ol class="qr-steps">
    <li>Abra o WhatsApp no celular que vai atender.</li>
    <li>Toque em <strong>Configuracoes</strong> e depois em <strong>Aparelhos conectados</strong>.</li>
    <li>Toque em <strong>Conectar um aparelho</strong> e aponte a camera para o codigo.</li>
  </ol>`;
}

/** Recarrega sozinho porque o QR da UAZAPI expira em poucos segundos. */
function autoRefreshScript(seconds: number): string {
  return `<script>setTimeout(function () { window.location.reload(); }, ${seconds * 1000});</script>`;
}

export function renderSdrConnectPage(agent: SdrAgent, state: InstanceConnectionState, shareUrl: string | null): string {
  const share = shareUrl
    ? `<div class="share-box">
        <p>Link para o cliente conectar, valido por ${shareLinkTtlMinutes} minutos:</p>
        <input id="shareUrl" class="share-input" type="text" value="${escapeHtml(shareUrl)}" readonly onclick="this.select()" />
        <div class="actions">
          <button class="button" type="button" onclick="copiarLink(this)">Copiar link</button>
          <button class="button button-secondary" type="button" id="shareNative" hidden onclick="compartilharLink()">Compartilhar</button>
          <form method="post" action="/sdr-agents/${agent.id}/conectar/compartilhar" data-inline>
            <button class="button button-secondary" type="submit">Gerar outro link</button>
          </form>
        </div>
        <p class="muted">Depois de ${shareLinkTtlMinutes} minutos o link para de funcionar. Gerar outro cancela este.</p>
        <script>
          var campo = document.getElementById('shareUrl');
          function copiarLink(botao) {
            campo.select();
            var pronto = function () { botao.textContent = 'Copiado!'; setTimeout(function () { botao.textContent = 'Copiar link'; }, 2000); };
            if (navigator.clipboard) { navigator.clipboard.writeText(campo.value).then(pronto, pronto); } else { document.execCommand('copy'); pronto(); }
          }
          function compartilharLink() {
            navigator.share({ title: 'Conectar o WhatsApp', url: campo.value });
          }
          if (navigator.share) { document.getElementById('shareNative').hidden = false; }
        </script>
      </div>`
    : `<form method="post" action="/sdr-agents/${agent.id}/conectar/compartilhar">
        <button class="button" type="submit">Gerar link para compartilhar</button>
        <p class="muted">Cria um link publico temporario (${shareLinkTtlMinutes} min) para outra pessoa ler o QR code do proprio celular.</p>
      </form>`;

  return renderLayout({
    title: `Conectar ${agent.name} - SDR Portal`,
    body: `<main class="app-shell">
      <header class="topbar">
        <div>
          <h1>Conectar o WhatsApp de ${escapeHtml(agent.name)}</h1>
          <p class="muted">Instancia ${escapeHtml(agent.uazapiInstanceId ?? 'sem identificador')}.</p>
        </div>
        <a class="button button-secondary" href="/sdr-agents">Voltar</a>
      </header>
      <section class="panel qr-panel">
        ${renderQrPanel(state)}
        ${state.connected ? '' : renderInstructions()}
      </section>
      <section class="panel">${share}</section>
    </main>${state.connected ? '' : autoRefreshScript(30)}`,
  });
}

/** Pagina publica: sem menu, sem link para o portal, so o necessario para parear. */
export function renderPublicConnectPage(agentName: string, state: InstanceConnectionState, minutesLeft: number): string {
  return renderLayout({
    title: 'Conectar WhatsApp',
    body: `<main class="app-shell public-connect">
      <header class="topbar">
        <div>
          <h1>Conectar o WhatsApp</h1>
          <p class="muted">${escapeHtml(agentName)}</p>
        </div>
      </header>
      <section class="panel qr-panel">
        ${renderQrPanel(state)}
        ${state.connected ? '' : renderInstructions()}
        ${state.connected ? '' : `<p class="muted">Este link expira em ${minutesLeft} minuto(s).</p>`}
      </section>
    </main>${state.connected ? '' : autoRefreshScript(30)}`,
    hideNavigation: true,
  });
}

export function renderShareLinkInvalidPage(reason: string): string {
  return renderLayout({
    title: 'Link indisponivel',
    body: `<main class="app-shell public-connect">
      <section class="panel">
        <h1>Link indisponivel</h1>
        <p class="muted">${escapeHtml(reason)}</p>
        <p class="muted">Peca um link novo para quem te enviou.</p>
      </section>
    </main>`,
    hideNavigation: true,
  });
}
