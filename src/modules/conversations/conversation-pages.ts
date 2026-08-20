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

  // data-search: o mesmo texto normalizado da busca do servidor, para o filtro instantaneo bater igual.
  return `<a class="chat-item${active}" href="${escapeHtml(inboxHref(agentId, search, chat.conversationId))}" data-search="${escapeHtml(chat.searchText)}">
    <span class="chat-avatar">${escapeHtml(chat.initials)}</span>
    <span class="chat-item-main">
      <span class="chat-item-line">
        <strong class="chat-item-title">${escapeHtml(chat.title)}</strong>
        <span class="chat-item-time">${escapeHtml(chat.timeLabel)}</span>
      </span>
      <span class="chat-item-line">
        <span class="chat-item-preview">${escapeHtml(chat.preview)}</span>
        ${flag}
      </span>
    </span>
  </a>`;
}

function renderChatList(options: InboxPageOptions): string {
  const agentId = options.selectedAgent?.id ?? '';
  const activeId = options.thread?.conversationId ?? '';
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

  return `<aside class="chat-panel">
    <form class="chat-search" method="get" action="/conversations">
      <input type="hidden" name="sdr" value="${escapeHtml(agentId)}">
      <label class="chat-search-label" for="chat-search">Buscar conversa</label>
      <input id="chat-search" type="search" name="q" value="${escapeHtml(options.search)}" placeholder="Nome, numero ou mensagem" autocomplete="off">
    </form>
    <p class="chat-list-note muted">${escapeHtml(counter)}</p>
    ${truncated}
    <div class="chat-list" id="chat-list">
      ${items}${empty}
      <p class="chat-list-empty muted" id="chat-list-filter-empty" hidden>Nenhuma conversa com esse texto na lista carregada.</p>
    </div>
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

function renderThread(thread: InboxThread | null, hasAgent: boolean): string {
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
        <span class="status-pill status-off">${escapeHtml(thread.statusLabel)}</span>
        ${stage}
        <a class="button button-secondary" href="/leads/${escapeHtml(thread.leadId)}">Ver lead</a>
      </div>
    </header>
    <div class="chat-scroll" id="chat-scroll">${hidden}${body}</div>
  </section>`;
}

/** Auto-scroll, busca instantanea e recarga automatica: o que faz a tela parecer o WhatsApp Web. */
const inboxScript = `<script>
  (function () {
    var scroll = document.getElementById('chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;

    var busca = document.getElementById('chat-search');
    var lista = document.getElementById('chat-list');
    var vazio = document.getElementById('chat-list-filter-empty');
    if (busca && lista) {
      busca.addEventListener('input', function () {
        var termo = busca.value.trim().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
        var itens = lista.querySelectorAll('.chat-item');
        var visiveis = 0;
        for (var i = 0; i < itens.length; i += 1) {
          var mostra = !termo || (itens[i].getAttribute('data-search') || '').indexOf(termo) !== -1;
          itens[i].hidden = !mostra;
          if (mostra) visiveis += 1;
        }
        if (vazio) vazio.hidden = visiveis !== 0 || itens.length === 0;
      });
    }

    var auto = document.getElementById('chat-refresh');
    if (!auto) return;
    try {
      auto.checked = window.localStorage.getItem('sdr-portal:conversas-auto') !== 'off';
      auto.addEventListener('change', function () {
        window.localStorage.setItem('sdr-portal:conversas-auto', auto.checked ? 'on' : 'off');
      });
    } catch (erro) {
      // navegador sem localStorage: segue com o padrao ligado
    }

    window.setInterval(function () {
      if (!auto.checked || document.hidden) return;
      // busca em uso ou historico rolado para cima: recarregar agora atrapalharia a leitura
      if (busca && (busca === document.activeElement || busca.value.trim())) return;
      if (scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80) return;
      window.location.reload();
    }, 20000);
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
      <section class="whatsapp-shell">
        ${renderChatList(options)}
        ${renderThread(options.thread, Boolean(options.selectedAgent))}
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
