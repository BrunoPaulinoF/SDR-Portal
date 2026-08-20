import type { SdrAgent } from '../../db/schema.js';
import { resolveSdrPlaybook } from '../ai/sdr-playbooks.js';
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
  // O playbook convite depende de um roteiro exato: com a IA escrevendo a abertura,
  // cada lead recebe um texto diferente do combinado — foi assim que um SDR de convite
  // acabou mandando a abertura consultiva ("posso te fazer uma pergunta sobre a operacao?").
  const roteiroWarning = !abOn && resolveSdrPlaybook(agent.playbook) === 'convite'
    ? '<p class="alert-error">Este SDR usa o playbook Convite, que depende de um roteiro exato. Enquanto a primeira mensagem for gerada por IA, o texto sai diferente do roteiro a cada lead. Cadastre a mensagem do roteiro abaixo e mude para mensagem fixa.</p>'
    : '';
  const totalSent = metrics.reduce((sum, m) => sum + m.sent, 0);
  const totalReplied = metrics.reduce((sum, m) => sum + m.replied, 0);

  const errorHtml = error ? `<p class="alert-error">${escapeHtml(error)}</p>` : '';

  const modePanel = `<section class="panel">
    <header class="topbar">
      <div>
        <h2>Modo da primeira mensagem</h2>
        <p class="muted">${abOn
          ? '<strong>Mensagem fixa</strong>: o texto das variantes ativas abaixo sai exatamente como esta escrito, por rodizio, sem IA e sem custo de token.'
          : '<strong>Gerada por IA</strong>: a primeira mensagem e escrita pela IA a cada lead, com o prompt de primeira mensagem. O texto muda de lead para lead, e as variantes abaixo ficam paradas.'}</p>
      </div>
      <div class="table-actions">
        <form method="post" action="/sdr-agents/${agent.id}/first-message-mode" data-inline>
          <input type="hidden" name="mode" value="${abOn ? 'ai' : 'ab_test'}">
          <button class="button ${abOn ? 'button-secondary' : ''}" type="submit">${abOn ? 'Deixar a IA gerar a primeira mensagem' : 'Usar mensagem fixa (texto exato, sem IA)'}</button>
        </form>
      </div>
    </header>
    ${roteiroWarning}
    <p class="muted">Com duas ou mais variantes ativas, o modo fixo vira teste A/B: o rodizio compara a taxa de resposta de cada texto. Com uma so, todo lead recebe a mesma mensagem.</p>
    <p class="muted">Resumo geral: <strong>${totalSent}</strong> enviadas · <strong>${totalReplied}</strong> respostas · taxa <strong>${replyRate(totalSent, totalReplied)}</strong>.</p>
  </section>`;

  const cards = metrics.map((m) => renderVariantCard(agent.id, m)).join('');
  const emptyCards = metrics.length
    ? ''
    : '<section class="empty-state"><h2>Nenhuma variante ainda</h2><p class="muted">Crie a mensagem abaixo para o SDR mandar um texto fixo em vez de deixar a IA escrever.</p></section>';

  const newPanel = `<section class="panel">
    <h2>Nova variante</h2>
    <p class="muted">Placeholders disponiveis: <code>{{responsavel}}</code> (complemento de "Falo com ___?": usa o nome do negocio, ou o primeiro nome do contato cadastrado), <code>{{nome}}</code> (contato do lead ou titular do MEI) e <code>{{restaurante}}</code> (nome fantasia ou empresa). Se o lead nao tiver o dado, o texto e limpo automaticamente.</p>
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
      <p class="muted">Mensagem fixa (texto exato, sem token) ou gerada por IA, com a taxa de resposta de cada texto.</p>
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
