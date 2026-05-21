import type { Conversation, Lead, Message, SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

export function renderConversationsListPage(conversations: Conversation[], leads: Lead[], agents: SdrAgent[]): string {
  const leadsById = new Map(leads.map((lead) => [lead.id, lead.companyName]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const rows = conversations
    .map(
      (conversation) => `<tr>
        <td>${escapeHtml(leadsById.get(conversation.leadId) ?? conversation.whatsappNumber)}<br><span class="muted">${escapeHtml(conversation.whatsappNumber)}</span></td>
        <td>${escapeHtml(agentsById.get(conversation.sdrAgentId) ?? '-')}</td>
        <td>${escapeHtml(conversation.status)}</td>
        <td>${conversation.lastMessageAt?.toISOString() ?? '-'}</td>
        <td><a href="/conversations/${conversation.id}">Abrir</a></td>
      </tr>`,
    )
    .join('');
  const table = conversations.length
    ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>SDR</th><th>Status</th><th>Ultima mensagem</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="empty-state"><h2>Nenhuma conversa registrada</h2><p class="muted">As conversas aparecem aqui quando os webhooks da UAZAPI receberem ou enviarem mensagens.</p></section>';

  return renderLayout({
    title: 'Conversas - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Conversas</h1><p class="muted">Historico salvo a partir dos webhooks recebidos.</p></div></header>${table}</main>`,
  });
}

export function renderConversationDetailPage(conversation: Conversation, lead: Lead | null, messages: Message[]): string {
  const rows = messages
    .map(
      (message) => `<article class="message-card ${message.direction === 'inbound' ? 'message-inbound' : 'message-outbound'}">
        <p><strong>${escapeHtml(message.senderType)}</strong> <span class="muted">${message.createdAt.toISOString()} - ${escapeHtml(message.messageType)}</span></p>
        <p>${escapeHtml(message.text ?? message.transcription ?? '[sem texto]')}</p>
      </article>`,
    )
    .join('');

  return renderLayout({
    title: 'Conversa - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>${escapeHtml(lead?.companyName ?? conversation.whatsappNumber)}</h1><p class="muted">${escapeHtml(conversation.whatsappNumber)}</p></div><a class="button button-secondary" href="/conversations">Voltar</a></header><section class="conversation-stack">${rows || '<p class="muted">Sem mensagens.</p>'}</section></main>`,
  });
}

export function renderConversationNotFoundPage(): string {
  return renderLayout({
    title: 'Conversa nao encontrada - SDR Portal',
    body: '<main class="app-shell"><section class="panel"><h1>Conversa nao encontrada</h1><a class="button" href="/conversations">Voltar</a></section></main>',
  });
}
