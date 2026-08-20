import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { InstanceConnectionState } from './instance-provisioning.js';
import { shareLinkTtlMinutes } from './instance-share-link-repository.js';

/** Intervalo de renovacao do QR: a UAZAPI expira o codigo em poucos segundos. */
const qrRefreshSeconds = 25;
/** Quando nem veio QR, insiste mais rapido — pode ser so a UAZAPI ainda publicando. */
const qrRetrySeconds = 5;
/** Depois de tantas tentativas seguidas sem QR, para e devolve a decisao ao usuario. */
const qrMaxRetries = 3;

/**
 * O SVG do QR e gerado por nos (biblioteca qrcode) ou e um <img> com data URI montado
 * a partir do que a UAZAPI devolveu — em nenhum dos casos ha texto do usuario dentro,
 * por isso entra sem escape.
 */
export function renderQrPanel(state: InstanceConnectionState): string {
  if (state.connected) {
    return `<div class="qr-box qr-connected" data-connected="true">
      <p class="qr-status-ok">WhatsApp conectado</p>
      <p class="muted">Pode fechar esta pagina.</p>
    </div>`;
  }

  if (!state.qrCodeSvg) {
    return `<div class="qr-box" data-connected="false" data-qr="ausente" data-retry-seconds="${qrRetrySeconds}">
      <p class="muted">Nao foi possivel gerar o QR code agora.</p>
      <p class="muted">Status atual: ${escapeHtml(state.status ?? 'desconhecido')}</p>
      ${state.detail ? `<p class="muted">${escapeHtml(state.detail)}</p>` : ''}
      <button class="button" type="button" data-qr-start>Tentar de novo</button>
    </div>`;
  }

  const pairCode = state.pairCode
    ? `<p class="muted">Ou use o codigo de pareamento: <strong>${escapeHtml(state.pairCode)}</strong></p>`
    : '';

  return `<div class="qr-box" data-connected="false" data-qr="ok" data-retry-seconds="${qrRefreshSeconds}">
    ${state.qrCodeSvg}
    ${pairCode}
    <p class="muted">O codigo se renova sozinho enquanto esta pagina estiver aberta.</p>
  </div>`;
}

/** Estado inicial: nada de QR ate alguem pedir, para o codigo nao nascer e morrer sozinho. */
function renderQrIdle(state: InstanceConnectionState): string {
  if (state.connected) return renderQrPanel(state);

  return `<div class="qr-box" data-connected="false">
    <p class="muted">Clique no botao para gerar o QR code e leia com o celular em seguida.</p>
    <p class="muted">Status atual: ${escapeHtml(state.status ?? 'desconhecido')}</p>
    <button class="button" type="button" data-qr-start>Gerar QR code</button>
  </div>`;
}

function renderInstructions(): string {
  return `<ol class="qr-steps">
    <li>Abra o WhatsApp no celular que vai atender.</li>
    <li>Toque em <strong>Configuracoes</strong> e depois em <strong>Aparelhos conectados</strong>.</li>
    <li>Toque em <strong>Conectar um aparelho</strong> e aponte a camera para o codigo.</li>
  </ol>`;
}

/**
 * Busca o QR sob demanda e vai renovando so o painel. Nada de `location.reload()`: a
 * pagina do link compartilhavel nasce de um POST, e recarregar reenviava o formulario —
 * era isso que cancelava o link recem-criado poucos segundos depois.
 */
function qrScript(endpoint: string): string {
  return `<script>
    (function () {
      var painel = document.getElementById('qrPanel');
      if (!painel) return;
      var timer = null;
      var ativo = false;
      var falhas = 0;

      function caixa() {
        return painel.querySelector('[data-connected]');
      }

      function conectado() {
        var box = caixa();
        return !!box && box.getAttribute('data-connected') === 'true';
      }

      function segundos() {
        var box = caixa();
        var valor = box && parseInt(box.getAttribute('data-retry-seconds'), 10);
        return valor > 0 ? valor : ${qrRefreshSeconds};
      }

      function agendar(espera) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(carregar, espera * 1000);
      }

      function parar() {
        ativo = false;
        if (timer) clearTimeout(timer);
      }

      function carregar() {
        if (!ativo) return;
        fetch(${JSON.stringify(endpoint)}, { headers: { Accept: 'text/html' } })
          .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
          .then(function (html) {
            painel.innerHTML = html;
            if (conectado()) return parar();
            var box = caixa();
            // Sem QR na resposta: insiste algumas vezes e depois deixa o botao decidir.
            if (box && box.getAttribute('data-qr') === 'ausente') {
              falhas += 1;
              if (falhas >= ${qrMaxRetries}) return parar();
            } else {
              falhas = 0;
            }
            agendar(segundos());
          })
          .catch(function () {
            falhas += 1;
            if (falhas >= ${qrMaxRetries}) return parar();
            agendar(${qrRetrySeconds});
          });
      }

      painel.addEventListener('click', function (evento) {
        var alvo = evento.target;
        var botao = alvo && alvo.closest ? alvo.closest('[data-qr-start]') : null;
        if (!botao) return;
        botao.disabled = true;
        botao.textContent = 'Gerando...';
        falhas = 0;
        ativo = true;
        carregar();
      });
    })();
  </script>`;
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
        <div id="qrPanel">${renderQrIdle(state)}</div>
        ${state.connected ? '' : renderInstructions()}
      </section>
      <section class="panel">${share}</section>
    </main>${state.connected ? '' : qrScript(`/sdr-agents/${agent.id}/conectar/qr`)}`,
  });
}

/** Pagina publica: sem menu, sem link para o portal, so o necessario para parear. */
export function renderPublicConnectPage(
  agentName: string,
  state: InstanceConnectionState,
  minutesLeft: number,
  qrEndpoint: string,
): string {
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
        <div id="qrPanel">${renderQrIdle(state)}</div>
        ${state.connected ? '' : renderInstructions()}
        ${state.connected ? '' : `<p class="muted">Este link expira em ${minutesLeft} minuto(s).</p>`}
      </section>
    </main>${state.connected ? '' : qrScript(qrEndpoint)}`,
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
