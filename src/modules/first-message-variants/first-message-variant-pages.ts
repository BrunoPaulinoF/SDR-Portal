import type { SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import type { FirstMessageVariantMetrics } from './first-message-variant-repository.js';

function replyRate(sent: number, replied: number): string {
  if (sent <= 0) return '—';
  return `${Math.round((replied / sent) * 100)}%`;
}

function renderVariantCard(agentId: string, metrics: FirstMessageVariantMetrics): string {
  const { variant, sent, replied } = metrics;
  const toggleLabel = variant.isActive ? 'Pausar' : 'Ativar';
  return `<section class="panel">
    <header class="topbar">
      <div>
        <h2>Variante ${escapeHtml(variant.label)} <span class="status-pill ${variant.isActive ? 'status-on' : 'status-off'}">${variant.isActive ? 'Ativa' : 'Pausada'}</span></h2>
        <p class="muted">Enviadas: <strong>${sent}</strong> · Respostas: <strong>${replied}</strong> · Taxa: <strong>${replyRate(sent, replied)}</strong></p>
      </div>
      <div class="table-actions">
        <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}/toggle" data-inline><button class="link-button" type="submit">${toggleLabel}</button></form>
        <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}/delete" data-inline onsubmit="return confirm('Excluir esta variante? As metricas dela serao perdidas.')"><button class="link-button" type="submit">Excluir</button></form>
      </div>
    </header>
    <form method="post" action="/sdr-agents/${agentId}/first-messages/${variant.id}" class="form-grid">
      <div class="field field-full"><label>Rotulo</label>
        <input type="text" name="label" value="${escapeHtml(variant.label)}" required>
      </div>
      <div class="field field-full"><label>Mensagem</label>
        <textarea name="body" rows="10" required>${escapeHtml(variant.body)}</textarea>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="isActive" ${variant.isActive ? 'checked' : ''}> Variante ativa (entra no rodizio)</label>
      <div class="actions field-full"><button class="button" type="submit">Salvar variante</button></div>
    </form>
  </section>`;
}

export function renderFirstMessageVariantsPage(
  agent: SdrAgent,
  metrics: FirstMessageVariantMetrics[],
  error?: string,
): string {
  const abOn = agent.firstMessageMode === 'ab_test';
  const totalSent = metrics.reduce((sum, m) => sum + m.sent, 0);
  const totalReplied = metrics.reduce((sum, m) => sum + m.replied, 0);

  const errorHtml = error ? `<p class="alert-error">${escapeHtml(error)}</p>` : '';

  const modePanel = `<section class="panel">
    <header class="topbar">
      <div>
        <h2>Modo da primeira mensagem</h2>
        <p class="muted">${abOn
          ? 'Teste A/B <strong>ligado</strong>: as variantes fixas abaixo sao enviadas por rodizio, sem IA e sem custo de token.'
          : 'IA <strong>ligada</strong>: a primeira mensagem e gerada pela IA com o first_message_prompt. As variantes abaixo ficam paradas.'}</p>
      </div>
      <div class="table-actions">
        <form method="post" action="/sdr-agents/${agent.id}/first-message-mode" data-inline>
          <input type="hidden" name="mode" value="${abOn ? 'ai' : 'ab_test'}">
          <button class="button ${abOn ? 'button-secondary' : ''}" type="submit">${abOn ? 'Desligar teste A/B (voltar pra IA)' : 'Ligar teste A/B'}</button>
        </form>
      </div>
    </header>
    <p class="muted">Resumo geral: <strong>${totalSent}</strong> enviadas · <strong>${totalReplied}</strong> respostas · taxa <strong>${replyRate(totalSent, totalReplied)}</strong>.</p>
  </section>`;

  const cards = metrics.map((m) => renderVariantCard(agent.id, m)).join('');
  const emptyCards = metrics.length
    ? ''
    : '<section class="empty-state"><h2>Nenhuma variante ainda</h2><p class="muted">Crie a primeira variante abaixo para comecar o teste A/B.</p></section>';

  const newPanel = `<section class="panel">
    <h2>Nova variante</h2>
    <p class="muted">Placeholders disponiveis: <code>{{nome}}</code> (contato do lead) e <code>{{restaurante}}</code> (nome fantasia ou empresa). Se o lead nao tiver o dado, o texto e limpo automaticamente.</p>
    <form method="post" action="/sdr-agents/${agent.id}/first-messages" class="form-grid">
      <div class="field field-full"><label>Rotulo</label>
        <input type="text" name="label" placeholder="Ex: A, B, Prova social..." required>
      </div>
      <div class="field field-full"><label>Mensagem</label>
        <textarea name="body" rows="10" placeholder="Escreva a mensagem fixa. Use {{nome}} e {{restaurante}} se quiser." required></textarea>
      </div>
      <label class="checkbox-field field-full"><input type="checkbox" name="isActive" checked> Entrar no rodizio ao salvar</label>
      <div class="actions field-full"><button class="button" type="submit">Adicionar variante</button></div>
    </form>
  </section>`;

  return renderLayout({
    title: `Mensagem inicial - ${agent.displayName} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Mensagem inicial · ${escapeHtml(agent.displayName)}</h1>
      <p class="muted">Teste A/B de primeira mensagem (fixa, sem token) e taxa de resposta por variante.</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/sdr-agents">Voltar para SDRs</a>
    </div>
  </header>
  ${errorHtml}
  ${modePanel}
  ${emptyCards}
  ${cards}
  ${newPanel}
</main>`,
  });
}
