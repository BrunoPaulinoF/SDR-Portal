import { escapeHtml, renderLayout } from '../web/html.js';
import { leadStatusOptions, periodOptions, stageOptions, type DashboardDispatchRow, type DashboardViewModel } from './dashboard-view-model.js';

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
    <form method="get" action="/dashboard" class="form-grid">
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
        <a class="button button-secondary" href="/dashboard">Limpar</a>
      </div>
    </form>
  </section>`;
}

function renderAlerts(model: DashboardViewModel): string {
  if (!model.alerts.length) {
    return '<section class="empty-state"><h2>Nenhum alerta operacional</h2><p class="muted">Nao ha bloqueios, erros ou follow-ups vencidos no filtro atual.</p></section>';
  }

  return `<section class="panel">
    <div class="section-heading"><h2>Alertas inteligentes</h2><p class="muted">Pontos que merecem atencao agora.</p></div>
    <div class="alert-list">${model.alerts.map((alert) => `<div>${escapeHtml(alert)}</div>`).join('')}</div>
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
        <td>${row.pendingCount}</td>
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
      <thead><tr><th>Empresa</th><th>SDR</th><th>Status</th><th>Proximo lead</th><th>Fila</th><th>Proximo disparo</th><th>Ultimo envio</th><th>Limite hoje</th><th>Follow-ups vencidos</th><th>Follow-ups hoje</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function renderDistributionTable(title: string, description: string, rows: DashboardViewModel['funnelRows']): string {
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

export function renderDashboardPage(model: DashboardViewModel): string {
  return renderLayout({
    title: 'Dashboard - SDR Portal',
    body: `<main class="app-shell dashboard-shell">
  <header class="topbar">
    <div>
      <h1>Dashboard</h1>
      <p class="muted">Dados reais da operacao. Periodo: ${escapeHtml(model.periodLabel)}. Logado como ${escapeHtml(model.userLabel)}.</p>
    </div>
  </header>

  ${renderFilters(model)}
  ${renderMetricCards(model)}
  ${renderAlerts(model)}
  ${renderDispatchTable(model)}
  ${renderDistributionTable('Funil do periodo', 'Eventos comerciais no periodo selecionado.', model.funnelRows)}
  ${renderDistributionTable('Status atual dos leads', 'Situacao atual da base filtrada.', model.statusRows)}
  ${renderDistributionTable('Etapas da conversa', 'Distribuicao atual por etapa do fluxo SDR.', model.stageRows)}
  ${renderCompanyTable(model)}
</main>`,
  });
}
