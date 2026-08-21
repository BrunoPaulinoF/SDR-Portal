import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { InboxChat, InboxDay, InboxMessage, InboxThread } from './conversation-inbox.js';

export interface InboxPageOptions {
  agents: SdrAgent[];
  chats: InboxChat[];
  hiddenChats: number;
  search: string;
  selectedAgent: SdrAgent | null;
  thread: InboxThread | null;
  totalChats: number;
}

/** Intervalo entre as buscas por novidade. Curto o bastante para a conversa parecer ao vivo. */
export const inboxPollMs = 4000;

function inboxHref(agentId: string, search: string, conversationId?: string): string {
  const params = new URLSearchParams({ sdr: agentId });
  if (conversationId) params.set('chat', conversationId);
  if (search) params.set('q', search);
  return `/conversations?${params.toString()}`;
}

function renderAgentPicker(agents: SdrAgent[], selectedAgent: SdrAgent | null): string {
  const options = agents
    .map(
      (agent) =>
        `<option value="${escapeHtml(agent.id)}"${agent.id === selectedAgent?.id ? ' selected' : ''}>${escapeHtml(agent.displayName || agent.name)}</option>`,
    )
    .join('');

  return `<form class="inbox-picker" method="get" action="/conversations">
    <label for="sdr">SDR</label>
    <select id="sdr" name="sdr" onchange="this.form.submit()">${options}</select>
    <noscript><button class="button button-secondary" type="submit">Ver conversas</button></noscript>
  </form>`;
}

function renderChatItem(chat: InboxChat, agentId: string, search: string, activeId: string): string {
  const active = chat.conversationId === activeId ? ' chat-item-active' : '';
  const flag = chat.awaitingReply ? '<span class="chat-item-flag" title="O lead falou por ultimo">respondeu</span>' : '';
  const paused = chat.aiPaused ? '<span class="chat-item-paused" title="IA pausada nesta conversa">IA off</span>' : '';

  // data-search: o mesmo texto normalizado da busca do servidor, para o filtro instantaneo bater igual.
  return `<a class="chat-item${active}" href="${escapeHtml(inboxHref(agentId, search, chat.conversationId))}" data-chat-id="${escapeHtml(chat.conversationId)}" data-search="${escapeHtml(chat.searchText)}">
    <span class="chat-avatar">${escapeHtml(chat.initials)}</span>
    <span class="chat-item-main">
      <span class="chat-item-line">
        <strong class="chat-item-title">${escapeHtml(chat.title)}</strong>
        <span class="chat-item-time">${escapeHtml(chat.timeLabel)}</span>
      </span>
      <span class="chat-item-line">
        <span class="chat-item-preview">${escapeHtml(chat.preview)}</span>
        ${paused}${flag}
      </span>
    </span>
  </a>`;
}

/**
 * Miolo da coluna de chats. Sai separado porque a atualizacao em tempo real troca so este
 * pedaco: o campo de busca fica de fora para nao perder o foco nem o que ja foi digitado.
 * `activeId` fica vazio na atualizacao — quem marca o chat aberto ali e a propria pagina,
 * para o clique responder na hora — e so a pagina inicial ja nasce com a marca no HTML.
 */
export function renderInboxChatsFragment(options: InboxPageOptions, activeId = ''): string {
  const agentId = options.selectedAgent?.id ?? '';
  const items = options.chats.map((chat) => renderChatItem(chat, agentId, options.search, activeId)).join('');
  const counter = options.search
    ? `${options.totalChats} conversa(s) para "${options.search}"`
    : `${options.totalChats} conversa(s)`;
  const truncated = options.hiddenChats
    ? `<p class="chat-list-note muted">Mostrando as ${options.chats.length} mais recentes. Use a busca para achar as outras.</p>`
    : '';
  const empty = options.chats.length
    ? ''
    : `<p class="chat-list-empty muted">${options.search ? 'Nenhuma conversa encontrada para essa busca.' : 'Este SDR ainda nao tem conversa registrada.'}</p>`;

  return `<p class="chat-list-note muted">${escapeHtml(counter)}</p>
    ${truncated}
    <div class="chat-list" id="chat-list">
      ${items}${empty}
      <p class="chat-list-empty muted" id="chat-list-filter-empty" hidden>Nenhuma conversa com esse texto na lista carregada.</p>
    </div>`;
}

function renderChatPanel(options: InboxPageOptions, chatsHtml: string): string {
  const agentId = options.selectedAgent?.id ?? '';

  return `<aside class="chat-panel">
    <form class="chat-search" method="get" action="/conversations" id="chat-search-form">
      <input type="hidden" name="sdr" value="${escapeHtml(agentId)}">
      <label class="chat-search-label" for="chat-search">Buscar conversa</label>
      <input id="chat-search" type="search" name="q" value="${escapeHtml(options.search)}" placeholder="Nome, numero ou mensagem" autocomplete="off">
    </form>
    <div class="chat-panel-body" id="chat-panel-body">${chatsHtml}</div>
  </aside>`;
}

function renderBubble(message: InboxMessage): string {
  const side = message.direction === 'inbound' ? 'chat-bubble-in' : 'chat-bubble-out';
  const author = message.authorLabel ? `<span class="chat-bubble-author">${escapeHtml(message.authorLabel)}</span>` : '';
  const kind = message.kindLabel ? `<span class="chat-bubble-kind">${escapeHtml(message.kindLabel)}</span>` : '';
  const tags = author || kind ? `<span class="chat-bubble-tags">${author}${kind}</span>` : '';
  const body = message.body ? `<p class="chat-bubble-text">${escapeHtml(message.body)}</p>` : '';

  return `<article class="chat-bubble ${side}">
    ${tags}${body}
    <span class="chat-bubble-time">${escapeHtml(message.timeLabel)}</span>
  </article>`;
}

function renderDay(day: InboxDay): string {
  return `<div class="chat-day"><span>${escapeHtml(day.label)}</span></div>${day.messages.map(renderBubble).join('')}`;
}

/** Botao que pausa ou libera a IA da conversa. Sem JS ele vale como POST + redirect normal. */
function renderAiSwitch(thread: InboxThread): string {
  const action = thread.aiPaused ? 'liberar' : 'pausar';
  const label = thread.aiPaused ? 'Liberar IA' : 'Pausar IA';
  const style = thread.aiPaused ? 'button' : 'button button-secondary';

  return `<form class="chat-ia-form" method="post" action="/conversations/${escapeHtml(thread.conversationId)}/ia" data-ia-form>
    <input type="hidden" name="acao" value="${action}">
    <button class="${style}" type="submit">${label}</button>
  </form>`;
}

function renderPauseBanner(thread: InboxThread): string {
  if (!thread.aiPaused) return '';
  const when = thread.aiPausedAtLabel ? ` desde ${escapeHtml(thread.aiPausedAtLabel)}` : '';

  return `<p class="chat-pause-note">IA pausada${when}: ${escapeHtml(thread.aiPauseLabel)}. Ela so volta a responder quando alguem clicar em "Liberar IA".</p>`;
}

/** Painel da direita. Trocado inteiro pela atualizacao em tempo real, por isso sai separado. */
export function renderInboxThreadFragment(thread: InboxThread | null, hasAgent: boolean): string {
  if (!thread) {
    const message = hasAgent ? 'Escolha uma conversa na lista ao lado.' : 'Cadastre um SDR para acompanhar as conversas.';
    return `<section class="chat-thread chat-thread-empty"><p class="muted">${escapeHtml(message)}</p></section>`;
  }

  const contact = thread.contactLabel ? ` &middot; ${escapeHtml(thread.contactLabel)}` : '';
  const stage = thread.stageLabel ? `<span class="status-pill status-off">${escapeHtml(thread.stageLabel)}</span>` : '';
  const hidden = thread.hiddenMessages
    ? `<p class="chat-hidden-note muted">Mostrando as ultimas ${thread.totalMessages - thread.hiddenMessages} mensagens de ${thread.totalMessages}.</p>`
    : '';
  const body = thread.days.length
    ? thread.days.map(renderDay).join('')
    : '<p class="chat-empty-thread muted">Conversa aberta, ainda sem mensagem.</p>';

  return `<section class="chat-thread">
    <header class="chat-thread-top">
      <span class="chat-avatar">${escapeHtml(thread.initials)}</span>
      <div class="chat-thread-identity">
        <strong>${escapeHtml(thread.title)}</strong>
        <p class="muted">${escapeHtml(thread.numberLabel)}${contact}</p>
      </div>
      <div class="chat-thread-tags">
        <span class="status-pill ${thread.aiPaused ? 'status-off' : 'status-on'}">${thread.aiPaused ? 'IA pausada' : 'IA ativa'}</span>
        <span class="status-pill status-off">${escapeHtml(thread.statusLabel)}</span>
        ${stage}
        ${renderAiSwitch(thread)}
        <a class="button button-secondary" href="/leads/${escapeHtml(thread.leadId)}">Ver lead</a>
      </div>
    </header>
    ${renderPauseBanner(thread)}
    <div class="chat-scroll" id="chat-scroll">${hidden}${body}</div>
  </section>`;
}

/**
 * Assinatura do HTML que a tela ja mostra. A pagina devolve a sua a cada atualizacao e o
 * servidor so responde com HTML novo quando ela mudou — e o que deixa a busca de segundo em
 * segundo nao piscar a tela nem jogar a rolagem de volta para o comeco. FNV-1a serve: nao e
 * seguranca, e so comparar dois textos que sairam do mesmo lugar.
 */
function signature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${value.length.toString(16)}`;
}

export function inboxSignature(html: string): string {
  return signature(html);
}

/**
 * Caixa de conversas sem recarregar a pagina: clicar num chat, buscar, pausar/liberar a IA e
 * receber mensagem nova trocam so o pedaco que mudou, buscando `/conversations/updates`.
 * Sem JS os links e os formularios continuam navegando do jeito antigo.
 */
const inboxScript = `<script>
  (function () {
    var raiz = document.getElementById('inbox-shell');
    if (!raiz) return;

    var estado = {
      sdr: raiz.getAttribute('data-sdr') || '',
      chat: raiz.getAttribute('data-chat') || '',
      busca: raiz.getAttribute('data-busca') || '',
      chatsSig: raiz.getAttribute('data-chats-sig') || '',
      threadSig: raiz.getAttribute('data-thread-sig') || ''
    };
    var emVoo = false;
    var pendente = null;
    var filtro = '';

    function porId(id) { return document.getElementById(id); }

    function normalizar(valor) {
      return valor.trim().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }

    function aplicarFiltro() {
      var lista = porId('chat-list');
      var vazio = porId('chat-list-filter-empty');
      if (!lista) return;
      var itens = lista.querySelectorAll('.chat-item');
      var visiveis = 0;
      for (var i = 0; i < itens.length; i += 1) {
        var mostra = !filtro || (itens[i].getAttribute('data-search') || '').indexOf(filtro) !== -1;
        itens[i].hidden = !mostra;
        if (mostra) visiveis += 1;
      }
      if (vazio) vazio.hidden = visiveis !== 0 || itens.length === 0;
    }

    function marcarAtivo() {
      var lista = porId('chat-list');
      if (!lista) return;
      var itens = lista.querySelectorAll('.chat-item');
      for (var i = 0; i < itens.length; i += 1) {
        if (itens[i].getAttribute('data-chat-id') === estado.chat) itens[i].classList.add('chat-item-active');
        else itens[i].classList.remove('chat-item-active');
      }
    }

    function trocarLista(html) {
      var painel = porId('chat-panel-body');
      if (!painel) return;
      var lista = porId('chat-list');
      var topo = lista ? lista.scrollTop : 0;
      painel.innerHTML = html;
      var nova = porId('chat-list');
      if (nova) nova.scrollTop = topo;
      aplicarFiltro();
    }

    function trocarThread(html, chatNovo) {
      var slot = porId('chat-thread-slot');
      if (!slot) return;
      var rolagem = porId('chat-scroll');
      var topo = rolagem ? rolagem.scrollTop : 0;
      var noFim = !rolagem || rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < 80;
      slot.innerHTML = html;
      var atual = porId('chat-scroll');
      if (!atual) return;
      // so puxa para o fim quem ja estava la: quem subiu para reler nao perde o lugar
      if (chatNovo || noFim) atual.scrollTop = atual.scrollHeight;
      else atual.scrollTop = topo;
    }

    function endereco() {
      var params = new URLSearchParams();
      if (estado.sdr) params.set('sdr', estado.sdr);
      if (estado.chat) params.set('chat', estado.chat);
      if (estado.busca) params.set('q', estado.busca);
      return '/conversations?' + params.toString();
    }

    function atualizar(opcoes) {
      var config = opcoes || {};
      if (emVoo) {
        // clique e busca nao podem se perder atras de uma rodada automatica; rodada some sem dor
        if (config.chatNovo || config.listaNova) {
          pendente = {
            chatNovo: Boolean(config.chatNovo || (pendente && pendente.chatNovo)),
            listaNova: Boolean(config.listaNova || (pendente && pendente.listaNova))
          };
        }
        return Promise.resolve();
      }
      emVoo = true;
      var params = new URLSearchParams();
      if (estado.sdr) params.set('sdr', estado.sdr);
      if (estado.chat) params.set('chat', estado.chat);
      if (estado.busca) params.set('q', estado.busca);
      // sem assinatura o servidor sempre manda o HTML: e assim que o clique troca de conversa
      if (!config.chatNovo) params.set('threadSig', estado.threadSig);
      if (!config.listaNova) params.set('chatsSig', estado.chatsSig);

      return fetch('/conversations/updates?' + params.toString(), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      })
        .then(function (resposta) {
          // sessao expirada: o fetch segue o redirect e cai na tela de login
          if (resposta.redirected && resposta.url.indexOf('/login') !== -1) {
            window.location.href = '/login';
            throw new Error('sessao expirada');
          }
          if (!resposta.ok) throw new Error('falha ao atualizar');
          return resposta.json();
        })
        .then(function (dados) {
          if (typeof dados.sdr === 'string' && dados.sdr) estado.sdr = dados.sdr;
          if (typeof dados.chat === 'string') estado.chat = dados.chat;
          if (typeof dados.chatsHtml === 'string') trocarLista(dados.chatsHtml);
          if (typeof dados.chatsSig === 'string') estado.chatsSig = dados.chatsSig;
          if (typeof dados.threadHtml === 'string') trocarThread(dados.threadHtml, Boolean(config.chatNovo));
          if (typeof dados.threadSig === 'string') estado.threadSig = dados.threadSig;
          marcarAtivo();
        })
        .catch(function () {
          // rede caiu ou sessao expirou: a proxima rodada tenta de novo
        })
        .then(function () {
          emVoo = false;
          var proxima = pendente;
          pendente = null;
          if (proxima) return atualizar(proxima);
          return undefined;
        });
    }

    function abrirConversa(id) {
      if (!id || id === estado.chat) return;
      estado.chat = id;
      marcarAtivo();
      window.history.pushState({ chat: id }, '', endereco());
      void atualizar({ chatNovo: true });
    }

    document.addEventListener('click', function (evento) {
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      var alvo = evento.target && evento.target.closest ? evento.target.closest('.chat-item') : null;
      if (!alvo) return;
      evento.preventDefault();
      abrirConversa(alvo.getAttribute('data-chat-id'));
    });

    document.addEventListener('submit', function (evento) {
      var form = evento.target;
      if (!form || !form.matches || !form.matches('[data-ia-form]')) return;
      evento.preventDefault();
      var botao = form.querySelector('button');
      if (botao) botao.disabled = true;
      fetch(form.getAttribute('action'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString()
      })
        .catch(function () {
          // se o POST falhar, a atualizacao abaixo traz o estado real de volta
        })
        .then(function () {
          estado.threadSig = '';
          return atualizar({ listaNova: true });
        });
    });

    var busca = porId('chat-search');
    var formBusca = porId('chat-search-form');
    if (busca) {
      busca.addEventListener('input', function () {
        filtro = normalizar(busca.value);
        aplicarFiltro();
      });
    }
    if (formBusca && busca) {
      formBusca.addEventListener('submit', function (evento) {
        evento.preventDefault();
        // enter manda a busca para o servidor, que procura em todas as conversas do SDR
        estado.busca = busca.value.trim();
        filtro = '';
        window.history.pushState({ chat: estado.chat }, '', endereco());
        void atualizar({ listaNova: true });
      });
    }

    window.addEventListener('popstate', function () {
      var params = new URLSearchParams(window.location.search);
      estado.chat = params.get('chat') || '';
      estado.busca = params.get('q') || '';
      if (busca) busca.value = estado.busca;
      filtro = '';
      void atualizar({ chatNovo: true, listaNova: true });
    });

    var auto = porId('chat-refresh');
    if (auto) {
      try {
        auto.checked = window.localStorage.getItem('sdr-portal:conversas-auto') !== 'off';
        auto.addEventListener('change', function () {
          window.localStorage.setItem('sdr-portal:conversas-auto', auto.checked ? 'on' : 'off');
          if (auto.checked) void atualizar({});
        });
      } catch (erro) {
        // navegador sem localStorage: segue com o padrao ligado
      }
    }

    var rolagemInicial = porId('chat-scroll');
    if (rolagemInicial) rolagemInicial.scrollTop = rolagemInicial.scrollHeight;

    window.setInterval(function () {
      if (auto && !auto.checked) return;
      if (document.hidden) return;
      void atualizar({});
    }, ${inboxPollMs});

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && (!auto || auto.checked)) void atualizar({});
    });
  })();
</script>`;

export function renderInboxPage(options: InboxPageOptions): string {
  if (options.agents.length === 0) {
    return renderLayout({
      title: 'Conversas - SDR Portal',
      body: `<main class="app-shell"><header class="topbar"><div><h1>Conversas</h1><p class="muted">Acompanhe os chats de cada SDR como no WhatsApp Web.</p></div></header>
        <section class="empty-state"><h2>Nenhum SDR cadastrado</h2><p class="muted">Crie um SDR e conecte o WhatsApp para as conversas comecarem a aparecer aqui.</p><div class="actions"><a class="button" href="/sdr-agents">Ver SDRs</a></div></section></main>`,
    });
  }

  const subtitle = options.selectedAgent
    ? `Chats de ${escapeHtml(options.selectedAgent.displayName || options.selectedAgent.name)} em ordem de atividade.`
    : 'Escolha um SDR para ver os chats.';
  const activeId = options.thread?.conversationId ?? '';
  // a assinatura sai do HTML sem a marca do chat aberto, igual ao que a atualizacao devolve
  const neutralChatsHtml = renderInboxChatsFragment(options);
  const threadHtml = renderInboxThreadFragment(options.thread, Boolean(options.selectedAgent));

  return renderLayout({
    title: 'Conversas - SDR Portal',
    body: `<main class="app-shell app-shell-inbox">
      <header class="topbar inbox-topbar">
        <div>
          <h1>Conversas</h1>
          <p class="muted">${subtitle}</p>
        </div>
        <div class="inbox-toolbar">
          ${renderAgentPicker(options.agents, options.selectedAgent)}
          <label class="inbox-refresh"><input type="checkbox" id="chat-refresh" checked> Atualizar sozinho</label>
        </div>
      </header>
      <section class="whatsapp-shell" id="inbox-shell" data-sdr="${escapeHtml(options.selectedAgent?.id ?? '')}" data-chat="${escapeHtml(activeId)}" data-busca="${escapeHtml(options.search)}" data-chats-sig="${escapeHtml(signature(neutralChatsHtml))}" data-thread-sig="${escapeHtml(signature(threadHtml))}">
        ${renderChatPanel(options, renderInboxChatsFragment(options, activeId))}
        <div class="chat-thread-slot" id="chat-thread-slot">${threadHtml}</div>
      </section>
      ${inboxScript}
    </main>`,
  });
}

export function renderConversationNotFoundPage(): string {
  return renderLayout({
    title: 'Conversa nao encontrada - SDR Portal',
    body: '<main class="app-shell"><section class="panel"><h1>Conversa nao encontrada</h1><a class="button" href="/conversations">Voltar</a></section></main>',
  });
}
