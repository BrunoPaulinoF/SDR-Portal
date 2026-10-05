import { escapeHtml, renderLayout } from '../web/html.js';
import {
  leadStatusOptions,
  pendingLeadLowThreshold,
  periodOptions,
  stageOptions,
  type DashboardAction,
  type DashboardDispatchRow,
  type DashboardSdrCard,
  type DashboardViewModel,
} from './dashboard-view-model.js';

function renderOption(value: string, label: string, selected: string): string {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderCompanyOptions(model: DashboardViewModel): string {
  return [renderOption('', 'Todas as empresas', model.filters.companyId)]
    .concat(model.companies.map((company) => renderOption(company.id, company.name, model.filters.companyId)))
    .join('');
}

function renderSdrOptions(model: DashboardViewModel): string {
  return [renderOption('', 'Todos os SDRs', model.filters.sdrAgentId)]
    .concat(model.sdrAgents.map((agent) => renderOption(agent.id, agent.displayName || agent.name, model.filters.sdrAgentId)))
    .join('');
}

function dispatchStatusClass(status: DashboardDispatchRow['status']): string {
  if (status === 'ready') return 'status-on';
  if (status === 'warning') return 'status-warn';
  if (status === 'blocked') return 'status-danger';
  return 'status-off';
}

function renderPendingCount(row: DashboardDispatchRow): string {
  if (row.pendingCount < pendingLeadLowThreshold) {
    return `<span class="status-pill status-danger">${row.pendingCount}</span><br><span class="muted">abaixo de ${pendingLeadLowThreshold}</span>`;
  }

  return `<span class="status-pill status-on">${row.pendingCount}</span>`;
}

function renderMetricCards(model: DashboardViewModel): string {
  return `<section class="kpi-grid">${model.metrics
    .map(
      (metric) => `<article class="panel kpi-card">
        <span>${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.value)}</strong>
        <p class="muted">${escapeHtml(metric.help)}</p>
      </article>`,
    )
    .join('')}</section>`;
}

function renderFilters(model: DashboardViewModel): string {
  return `<section class="panel dashboard-filters">
    <form method="get" action="/relatorios" class="form-grid">
      <div class="field">
        <label for="companyId">Empresa</label>
        <select id="companyId" name="companyId">${renderCompanyOptions(model)}</select>
      </div>
      <div class="field">
        <label for="sdrAgentId">SDR</label>
        <select id="sdrAgentId" name="sdrAgentId">${renderSdrOptions(model)}</select>
      </div>
      <div class="field">
        <label for="period">Periodo</label>
        <select id="period" name="period">${periodOptions.map((option) => renderOption(option.value, option.label, model.filters.period)).join('')}</select>
      </div>
      <div class="field">
        <label for="status">Status</label>
        <select id="status" name="status">${leadStatusOptions.map((option) => renderOption(option.value, option.label, model.filters.status)).join('')}</select>
      </div>
      <div class="field">
        <label for="stage">Etapa</label>
        <select id="stage" name="stage">${stageOptions.map((option) => renderOption(option.value, option.label, model.filters.stage)).join('')}</select>
      </div>
      <div class="field">
        <label for="activeOnly">SDRs</label>
        <select id="activeOnly" name="activeOnly">
          ${renderOption('1', 'Somente ativos', model.filters.activeOnly ? '1' : '0')}
          ${renderOption('0', 'Todos', model.filters.activeOnly ? '1' : '0')}
        </select>
      </div>
      <div class="actions field-full">
        <button type="submit">Aplicar filtros</button>
        <a class="button button-secondary" href="/relatorios">Limpar</a>
      </div>
    </form>
  </section>`;
}

function renderNotes(model: DashboardViewModel): string {
  if (!model.notes.length) return '';
  return `<section class="panel">
    <div class="section-heading"><h2>Avisos do periodo</h2><p class="muted">So para informacao. O que pede acao fica no Painel.</p></div>
    <div class="alert-list">${model.notes.map((note) => `<div>${escapeHtml(note)}</div>`).join('')}</div>
  </section>`;
}

function renderDispatchTable(model: DashboardViewModel): string {
  const rows = model.dispatchRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.companyName)}</td>
        <td>${escapeHtml(row.sdrName)}</td>
        <td><span class="status-pill ${dispatchStatusClass(row.status)}">${escapeHtml(row.statusLabel)}</span></td>
        <td>${row.nextLeadId ? `<a href="/leads/${escapeHtml(row.nextLeadId)}">${escapeHtml(row.nextLeadName)}</a>` : escapeHtml(row.nextLeadName)}</td>
        <td>${renderPendingCount(row)}</td>
        <td>${escapeHtml(row.etaLabel)}<br><span class="muted">${escapeHtml(row.detail)}</span></td>
        <td>${escapeHtml(row.lastSentLabel)}</td>
        <td>${escapeHtml(row.sendLimitLabel)}</td>
        <td>${row.followupsDue}</td>
        <td>${row.followupsSentToday}</td>
      </tr>`,
    )
    .join('');
  const body = rows || '<tr><td colspan="10" class="muted">Nenhum SDR encontrado para os filtros atuais.</td></tr>';

  return `<section class="page-section">
    <div class="section-heading">
      <h2>Proximos disparos por SDR</h2>
      <p class="muted">Mostra quando cada SDR pode chamar o proximo lead, usando fila real, janela, limite e cooldown configurados.</p>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Empresa</th><th>SDR</th><th>Status</th><th>Proximo lead</th><th>Pendentes</th><th>Proximo disparo</th><th>Ultimo envio</th><th>Limite hoje</th><th>Follow-ups vencidos</th><th>Follow-ups hoje</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function renderChannelHealth(model: DashboardViewModel): string {
  if (!model.channelRows.length) return '';
  const rows = model.channelRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.sdrName)}</td>
        <td><span class="status-pill ${row.belowTarget ? 'status-off' : 'status-on'}">${escapeHtml(row.connectedLabel)}</span></td>
        <td>${row.drops}</td>
        <td>${escapeHtml(row.reconnectLabel)}</td>
        <td>${escapeHtml(row.downNowLabel)}</td>
        <td>${row.newChatsBlocked ? `<span class="status-pill status-off">${escapeHtml(row.newChatsLabel)}</span>` : escapeHtml(row.newChatsLabel)}</td>
        <td class="muted">${escapeHtml(row.detail)}</td>
      </tr>`,
    )
    .join('');

  return `<section class="page-section">
    <div class="section-heading"><h2>Saude do WhatsApp</h2><p class="muted">Quanto do horario de envio cada SDR ficou conectado nos ultimos 7 dias. Meta: 95%.</p></div>
    <div class="table-wrap"><table><thead><tr><th>SDR</th><th>Conectado</th><th>Quedas</th><th>Tempo medio para voltar</th><th>Fora agora ha</th><th>Conversas novas</th><th>Base</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function renderCohortFunnel(model: DashboardViewModel): string {
  const body = model.cohortRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)} <span class="muted">${escapeHtml(row.help)}</span></td>
        <td>${row.count}</td>
        <td><div class="bar-track"><span style="width:${row.percentOfBase}%"></span></div><span class="muted">${row.percentOfBase}%</span></td>
        <td>${row.percentOfPrevious === null ? '-' : `${row.percentOfPrevious}%`}</td>
      </tr>`,
    )
    .join('');

  return `<section class="page-section">
    <div class="section-heading"><h2>Funil da safra</h2><p class="muted">Dos leads abordados no periodo, quantos chegaram a cada etapa ate hoje. Perdidos depois do handoff: ${model.cohortLost}.</p></div>
    <div class="table-wrap"><table><thead><tr><th>Etapa</th><th>Leads</th><th>% dos abordados</th><th>% da etapa anterior</th></tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}

function renderDistributionTable(title: string, description: string, rows: DashboardViewModel['statusRows']): string {
  const body = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.count}</td>
        <td><div class="bar-track"><span style="width:${row.percent}%"></span></div><span class="muted">${row.percent}%</span></td>
      </tr>`,
    )
    .join('');

  return `<section class="page-section">
    <div class="section-heading"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(description)}</p></div>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Total</th><th>Distribuicao</th></tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}

function renderCompanyTable(model: DashboardViewModel): string {
  const rows = model.companyRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.companyName)}<br><span class="muted">${escapeHtml(row.segment)}</span></td>
        <td>${row.activeSdrs}/${row.totalSdrs}</td>
        <td>${row.leadsTotal}</td>
        <td>${row.pending}</td>
        <td>${row.discarded}</td>
        <td>${row.invalidPhone}</td>
        <td>${row.sent}</td>
        <td>${row.outboundMessages}</td>
        <td>${row.responded}</td>
        <td>${row.followupsSent}</td>
        <td>${row.handoffs}</td>
      </tr>`,
    )
    .join('');
  const body = rows || '<tr><td colspan="11" class="muted">Nenhuma empresa com dados para os filtros atuais.</td></tr>';

  return `<section class="page-section">
    <div class="section-heading"><h2>Empresas</h2><p class="muted">Resumo por empresa no periodo selecionado.</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Empresa</th><th>SDRs ativos</th><th>Leads</th><th>Pendentes</th><th>Descartados</th><th>Tel. inexistente</th><th>Abordagens</th><th>Msgs conversa</th><th>Responderam</th><th>Follow-ups</th><th>Handoffs</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

/** Hoje / 7 dias / 30 dias / Tudo: o unico filtro do Painel. O resto fica em Relatorios. */
function renderPeriodChips(model: DashboardViewModel): string {
  return `<nav class="period-chips" aria-label="Periodo">${periodOptions
    .map(
      (option) =>
        `<a class="chip${option.value === model.filters.period ? ' chip-active' : ''}" href="/dashboard?period=${option.value}"${option.value === model.filters.period ? ' aria-current="page"' : ''}>${escapeHtml(option.label)}</a>`,
    )
    .join('')}</nav>`;
}

function renderAction(action: DashboardAction): string {
  const items = action.items?.length
    ? `<p class="action-links">${action.items.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</p>`
    : '';
  return `<article class="action-item action-${action.tone}">
    <div>
      <strong>${escapeHtml(action.title)}</strong>
      <p class="muted">${escapeHtml(action.detail)}</p>
      ${items}
    </div>
    <a class="button${action.tone === 'urgent' ? '' : ' button-secondary'}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>
  </article>`;
}

function renderNeedsYou(model: DashboardViewModel): string {
  if (!model.actions.length) {
    return `<section class="panel needs-you needs-you-ok">
      <h2>Precisa de voce agora</h2>
      <p>✓ Tudo certo. Nenhum lead esperando, nenhum WhatsApp fora do ar e nenhuma fila no fim.</p>
    </section>`;
  }
  const urgent = model.actions.filter((action) => action.tone === 'urgent').length;
  return `<section class="panel needs-you">
    <div class="section-heading">
      <h2>Precisa de voce agora</h2>
      <p class="muted">${model.actions.length} item(ns)${urgent > 0 ? `, ${urgent} urgente(s)` : ''}. Cada um tem o botao para resolver.</p>
    </div>
    <div class="action-list">${model.actions.map(renderAction).join('')}</div>
  </section>`;
}

function renderSdrCard(card: DashboardSdrCard): string {
  return `<article class="panel sdr-card">
    <header class="sdr-card-head">
      <div>
        <h3><a href="/sdr-agents/${escapeHtml(card.agentId)}/edit">${escapeHtml(card.name)}</a></h3>
        <p class="muted">${escapeHtml(card.companyName)}</p>
      </div>
      <span class="status-pill ${dispatchStatusClass(card.status)}">${escapeHtml(card.statusLabel)}</span>
    </header>
    <p class="muted sdr-card-next">${escapeHtml(card.nextLabel)}</p>
    <dl class="sdr-card-stats sdr-card-stats-4">
      <div><dt>WhatsApp</dt><dd class="summary-${card.whatsappTone}">${escapeHtml(card.whatsappLabel)}</dd></div>
      <div><dt>Abordagens hoje</dt><dd>${escapeHtml(card.sentLabel)}</dd></div>
      <div><dt>Fila</dt><dd class="${card.pending < pendingLeadLowThreshold ? 'summary-bad' : ''}">${card.pending}</dd></div>
      <div><dt>Follow-ups hoje</dt><dd>${card.followupsToday}</dd></div>
    </dl>
    <div class="actions"><a class="button button-secondary" href="/sdr-agents/${escapeHtml(card.agentId)}/edit">Abrir</a></div>
  </article>`;
}

function renderSdrCards(model: DashboardViewModel): string {
  const cards = model.sdrCards.length
    ? `<div class="sdr-cards">${model.sdrCards.map(renderSdrCard).join('')}</div>`
    : '<p class="muted">Nenhum SDR ativo. <a href="/sdr-agents">Ver todos os SDRs</a>.</p>';
  return `<section class="page-section">
    <div class="section-heading"><h2>SDRs agora</h2><p class="muted">Como cada SDR ativo esta neste momento. <a href="/sdr-agents">Todos os SDRs</a></p></div>
    ${cards}
  </section>`;
}

function renderResults(model: DashboardViewModel): string {
  const tiles = model.headline
    .map(
      (item) =>
        `<div class="summary-card"><span class="muted">${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><span class="muted">${escapeHtml(item.help)}</span></div>`,
    )
    .join('');
  const funnel = model.cohortRows
    .map(
      (row) => `<div class="funnel-row">
        <span>${escapeHtml(row.label)}</span>
        <div class="bar-track"><span style="width:${row.percentOfBase}%"></span></div>
        <strong>${row.count}</strong>
        <span class="muted">${row.percentOfPrevious === null ? '' : `${row.percentOfPrevious}% da etapa anterior`}</span>
      </div>`,
    )
    .join('');
  return `<section class="page-section">
    <div class="section-heading">
      <h2>Resultado · ${escapeHtml(model.periodLabel)}</h2>
      <p class="muted">Dos leads abordados no periodo, ate onde cada um chegou. <a href="/relatorios?period=${escapeHtml(model.filters.period)}">Ver relatorio completo</a></p>
    </div>
    <div class="summary-grid headline-grid">${tiles}</div>
    <div class="panel funnel-compact spacing-top">${funnel}</div>
  </section>`;
}

/** Painel: o que precisa de alguem agora, cada SDR em uma linha de cartoes e o resultado do periodo. */
export function renderDashboardPage(model: DashboardViewModel): string {
  return renderLayout({
    title: 'Painel - SDR Portal',
    body: `<main class="app-shell dashboard-shell">
  <header class="topbar">
    <div>
      <h1>Painel</h1>
      <p class="muted">Logado como ${escapeHtml(model.userLabel)}.</p>
    </div>
    <div class="actions">${renderPeriodChips(model)}<a class="button button-secondary" href="/relatorios?period=${escapeHtml(model.filters.period)}">Relatorios</a></div>
  </header>

  ${renderNeedsYou(model)}
  ${renderSdrCards(model)}
  ${renderResults(model)}
</main>`,
  });
}

/** Relatorios: tudo o que o painel antigo mostrava, com os filtros completos. */
export function renderReportsPage(model: DashboardViewModel): string {
  return renderLayout({
    title: 'Relatorios - SDR Portal',
    body: `<main class="app-shell dashboard-shell">
  <header class="topbar">
    <div>
      <h1>Relatorios</h1>
      <p class="muted">Numeros detalhados da operacao. Periodo: ${escapeHtml(model.periodLabel)}.</p>
    </div>
    <div class="actions"><a class="button button-secondary" href="/dashboard?period=${escapeHtml(model.filters.period)}">Voltar ao painel</a></div>
  </header>

  ${renderFilters(model)}
  ${renderMetricCards(model)}
  ${renderNotes(model)}
  ${renderDispatchTable(model)}
  ${renderChannelHealth(model)}
  ${renderCohortFunnel(model)}
  ${renderDistributionTable('Status atual dos leads', 'Situacao atual da base filtrada.', model.statusRows)}
  ${renderDistributionTable('Etapas da conversa', 'Distribuicao atual por etapa do fluxo SDR.', model.stageRows)}
  ${renderCompanyTable(model)}
</main>`,
  });
}
