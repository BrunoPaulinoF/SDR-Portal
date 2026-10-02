import type { AiRun, Company, ContactBlock, JobLog, Lead, LeadImport, SdrAgent } from '../../db/schema.js';
import { formatDateTimeInTimeZone, resolveTimeZone } from '../timezone.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import { leadImportFields, type LeadExcelPreview, type LeadImportMapping } from './lead-importer.js';
import { statusLabel } from '../conversations/conversation-inbox.js';
import { LEAD_MILESTONES, MILESTONE_LABELS, milestoneDate, type LeadMilestone } from './lead-outcome.js';

interface LeadFormData {
  companyId: string;
  sdrAgentId: string;
  whatsappNumber: string;
  cnpj: string;
  companyName: string;
  tradeName: string;
  segment: string;
  city: string;
  state: string;
  contactName: string;
  extraData: string;
  status: string;
}

const defaultForm: LeadFormData = {
  companyId: '',
  sdrAgentId: '',
  whatsappNumber: '',
  cnpj: '',
  companyName: '',
  tradeName: '',
  segment: '',
  city: '',
  state: '',
  contactName: '',
  extraData: '',
  status: 'pending',
};

function leadToForm(lead?: Lead): LeadFormData {
  if (!lead) {
    return defaultForm;
  }

  return {
    companyId: lead.companyId,
    sdrAgentId: lead.sdrAgentId,
    whatsappNumber: lead.whatsappNumber,
    cnpj: lead.cnpj ?? '',
    companyName: lead.companyName,
    tradeName: lead.tradeName ?? '',
    segment: lead.segment ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    contactName: lead.contactName ?? '',
    extraData: lead.extraData ?? '',
    status: lead.status,
  };
}

function renderField(name: keyof LeadFormData, label: string, value: string, required = false): string {
  const requiredAttribute = required ? ' required' : '';
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escapeHtml(value)}"${requiredAttribute}></div>`;
}

function renderTextArea(name: keyof LeadFormData, label: string, value: string): string {
  return `<div class="field field-full"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" rows="4">${escapeHtml(value)}</textarea></div>`;
}

function renderCompanySelect(companies: Company[], selectedId: string): string {
  const options = companies
    .map((company) => `<option value="${company.id}"${company.id === selectedId ? ' selected' : ''}>${escapeHtml(company.name)}</option>`)
    .join('');
  return `<div class="field"><label for="companyId">Empresa</label><select id="companyId" name="companyId" required>${options}</select></div>`;
}

function renderSdrSelect(agents: SdrAgent[], selectedId: string): string {
  const options = agents
    .map((agent) => `<option value="${agent.id}"${agent.id === selectedId ? ' selected' : ''}>${escapeHtml(agent.name)}</option>`)
    .join('');
  return `<div class="field"><label for="sdrAgentId">SDR</label><select id="sdrAgentId" name="sdrAgentId" required>${options}</select></div>`;
}

function renderColumnLabel(index: number, header: string): string {
  return `${index + 1}. ${header || `Coluna ${index + 1}`}`;
}

function renderColumnSelect(preview: LeadExcelPreview, mapping: LeadImportMapping, field: (typeof leadImportFields)[number]): string {
  const selectedIndex = mapping[field.key];
  const emptyLabel = field.required ? 'Selecione uma coluna' : 'Nao importar';
  const requiredAttribute = field.required ? ' required' : '';
  const options = preview.headers
    .map((header, index) => `<option value="${index}"${selectedIndex === index ? ' selected' : ''}>${escapeHtml(renderColumnLabel(index, header))}</option>`)
    .join('');

  return `<div class="field"><label for="${field.key}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><select id="${field.key}" name="${field.key}"${requiredAttribute}><option value="">${emptyLabel}</option>${options}</select></div>`;
}

function renderExcelPreviewTable(preview: LeadExcelPreview): string {
  const headerRow = preview.headers.map((header, index) => `<th>${escapeHtml(renderColumnLabel(index, header))}</th>`).join('');
  const rows = preview.sampleRows.length
    ? preview.sampleRows
        .map((row) => `<tr>${preview.headers.map((_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td colspan="${Math.max(preview.headers.length, 1)}" class="muted">Nenhuma linha de dados encontrada na planilha.</td></tr>`;

  return `<div class="table-wrap spacing-top"><table><thead><tr>${headerRow}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderLeadForm(action: string, companies: Company[], agents: SdrAgent[], lead?: Lead, error?: string): string {
  const data = leadToForm(lead);
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';

  return `${errorHtml}<form method="post" action="${escapeHtml(action)}" class="form-grid">
    ${renderCompanySelect(companies, data.companyId || companies[0]?.id || '')}
    ${renderSdrSelect(agents, data.sdrAgentId || agents[0]?.id || '')}
    ${renderField('whatsappNumber', 'Numero WhatsApp', data.whatsappNumber, true)}
    ${renderField('companyName', 'Nome da empresa lead', data.companyName, true)}
    ${renderField('cnpj', 'CNPJ', data.cnpj)}
    ${renderField('tradeName', 'Nome fantasia', data.tradeName)}
    ${renderField('segment', 'Segmento', data.segment)}
    ${renderField('city', 'Cidade', data.city)}
    ${renderField('state', 'Estado', data.state)}
    ${renderField('contactName', 'Nome do contato', data.contactName)}
    ${renderField('status', 'Status', data.status, true)}
    ${renderTextArea('extraData', 'Dados extras', data.extraData)}
    <div class="actions field-full"><button type="submit">Salvar lead</button><a class="button button-secondary" href="/leads">Cancelar</a></div>
  </form>`;
}

/** Status que valem uma limpeza em massa, com a contagem atual para o usuario decidir. */
/** Status na ordem em que aparecem nos filtros e na tela de limpar leads. */
export const LEAD_STATUS_OPTIONS: Array<[string, string]> = [
  ['pending', 'Pendente'],
  ['initial_sent', 'Abordado'],
  ['in_conversation', 'Em conversa'],
  ['followup_sent', 'Follow-up enviado'],
  ['human_paused', 'Pausado por humano'],
  ['transferred', 'Handoff feito'],
  ['not_interested', 'Sem interesse'],
  ['discarded', 'Descartado'],
  ['invalid_phone', 'Telefone inexistente'],
];

export const LEADS_PAGE_SIZE = 50;

export interface LeadListFilters {
  q: string;
  sdrAgentId: string;
  status: string;
}

export interface LeadsListView {
  filters: LeadListFilters;
  leads: Lead[];
  page: number;
  total: number;
}

/** Endereco da lista com os filtros atuais, para a paginacao nao perder a busca. */
function leadsUrl(filters: LeadListFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sdrAgentId) params.set('sdr', filters.sdrAgentId);
  if (filters.status) params.set('status', filters.status);
  if (page > 1) params.set('pagina', String(page));
  const query = params.toString();
  return query ? `/leads?${query}` : '/leads';
}

function renderLeadFilters(filters: LeadListFilters, agents: SdrAgent[]): string {
  const agentOptions = agents
    .map((agent) => `<option value="${escapeHtml(agent.id)}"${agent.id === filters.sdrAgentId ? ' selected' : ''}>${escapeHtml(agent.displayName || agent.name)}</option>`)
    .join('');
  const statusOptions = LEAD_STATUS_OPTIONS.map(
    ([value, label]) => `<option value="${value}"${value === filters.status ? ' selected' : ''}>${escapeHtml(label)}</option>`,
  ).join('');
  const active = filters.q || filters.sdrAgentId || filters.status;

  return `<form method="get" action="/leads" class="panel filter-bar">
    <div class="field"><label for="q">Buscar</label><input id="q" name="q" value="${escapeHtml(filters.q)}" placeholder="Nome da loja, contato ou numero"></div>
    <div class="field"><label for="sdr">SDR</label><select id="sdr" name="sdr"><option value="">Todos os SDRs</option>${agentOptions}</select></div>
    <div class="field"><label for="status">Situacao</label><select id="status" name="status"><option value="">Todas</option>${statusOptions}</select></div>
    <div class="actions"><button type="submit">Filtrar</button>${active ? '<a class="button button-secondary" href="/leads">Limpar filtros</a>' : ''}</div>
  </form>`;
}

function renderPagination(view: LeadsListView): string {
  const pages = Math.max(1, Math.ceil(view.total / LEADS_PAGE_SIZE));
  if (pages <= 1) return `<p class="muted">${view.total} lead(s).</p>`;
  const previous = view.page > 1 ? `<a class="button button-secondary" href="${escapeHtml(leadsUrl(view.filters, view.page - 1))}">&lsaquo; Anterior</a>` : '';
  const next = view.page < pages ? `<a class="button button-secondary" href="${escapeHtml(leadsUrl(view.filters, view.page + 1))}">Proxima &rsaquo;</a>` : '';
  return `<nav class="pagination" aria-label="Paginas de leads">${previous}<span class="muted">Pagina ${view.page} de ${pages} &middot; ${view.total} lead(s)</span>${next}</nav>`;
}

export function renderLeadsListPage(view: LeadsListView, companies: Company[], agents: SdrAgent[], notice?: string): string {
  const companiesById = new Map(companies.map((company) => [company.id, company.name]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.name]));
  const rows = view.leads
    .map(
      (lead) => `<tr>
        <td><a href="/leads/${lead.id}">${escapeHtml(lead.companyName)}</a><br><span class="muted">${escapeHtml(lead.whatsappNumber)}</span></td>
        <td>${escapeHtml(companiesById.get(lead.companyId) ?? '-')}</td>
        <td>${escapeHtml(agentsById.get(lead.sdrAgentId) ?? '-')}</td>
        <td>${escapeHtml(lead.segment ?? '-')}</td>
        <td><span class="status-pill status-off">${escapeHtml(statusLabel(lead.status))}</span></td>
        <td class="table-actions"><a href="/leads/${lead.id}">Ver</a><a href="/leads/${lead.id}/edit">Editar</a></td>
      </tr>`,
    )
    .join('');
  const filtered = Boolean(view.filters.q || view.filters.sdrAgentId || view.filters.status);
  const table = view.leads.length
    ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Empresa</th><th>SDR</th><th>Segmento</th><th>Situacao</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table></div>${renderPagination(view)}`
    : filtered
      ? '<section class="empty-state"><h2>Nenhum lead com esses filtros</h2><p class="muted">Mude a busca ou limpe os filtros.</p><a class="button button-secondary" href="/leads">Limpar filtros</a></section>'
      : '<section class="empty-state"><h2>Nenhum lead cadastrado</h2><p class="muted">Importe uma planilha Excel ou crie um lead manualmente para iniciar a operacao.</p><div class="actions"><a class="button button-secondary" href="/leads/import">Importar Excel</a><a class="button" href="/leads/new">Novo lead</a></div></section>';

  const noticeHtml = notice ? `<p class="form-notice">${escapeHtml(notice)}</p>` : '';

  return renderLayout({
    title: 'Leads - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Leads</h1><p class="muted">Cadastre, edite e importe contatos para os SDRs.</p></div><div class="actions"><a class="button button-secondary" href="/leads/nao-contatar">Nao contatar</a><a class="button button-secondary" href="/leads/limpar">Limpar leads</a><a class="button button-secondary" href="/leads/import">Importar Excel</a><a class="button" href="/leads/new">Novo lead</a></div></header>${noticeHtml}${renderLeadFilters(view.filters, agents)}${table}</main>`,
  });
}

/**
 * Apagar em massa tem tela propria: no pe da lista ele ficava a um clique de qualquer outra
 * coisa. Os numeros por status sao do SDR escolhido, para a pessoa ver o que vai sumir.
 */
export function renderBulkDeletePage(agents: SdrAgent[], selectedSdrId: string, counts: Record<string, number>, error?: string): string {
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';
  const agentOptions = agents
    .map((agent) => `<option value="${escapeHtml(agent.id)}"${agent.id === selectedSdrId ? ' selected' : ''}>${escapeHtml(agent.displayName || agent.name)}</option>`)
    .join('');
  const checkboxes = LEAD_STATUS_OPTIONS.map(
    ([value, label]) => `<label class="check-item">
        <input type="checkbox" name="statuses" value="${escapeHtml(value)}" />
        <span>${escapeHtml(label)} <span class="muted">(${counts[value] ?? 0})</span></span>
      </label>`,
  ).join('');
  const body = agents.length
    ? `<section class="panel">
    ${errorHtml}
    <form method="get" action="/leads/limpar" class="form-grid">
      <div class="field"><label for="sdr">SDR</label><select id="sdr" name="sdr" onchange="this.form.submit()">${agentOptions}</select></div>
      <noscript><div class="actions"><button type="submit">Ver quantidades</button></div></noscript>
    </form>
    <form method="post" action="/leads/limpar" class="spacing-top" onsubmit="return confirm('Isso apaga os leads marcados e o historico de conversa deles. Nao da para desfazer. Confirmar?')">
      <input type="hidden" name="sdrAgentId" value="${escapeHtml(selectedSdrId)}">
      <p class="muted">Marque as situacoes que vao ser apagadas. Conversas e mensagens desses leads vao junto, e nao da para desfazer.</p>
      <div class="check-grid">${checkboxes}</div>
      <button class="button button-danger" type="submit">Apagar leads marcados</button>
    </form>
  </section>`
    : '<section class="empty-state"><h2>Nenhum SDR cadastrado</h2></section>';

  return renderLayout({
    title: 'Limpar leads - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Limpar leads</h1><p class="muted">Apaga de uma vez os leads de um SDR em certas situacoes.</p></div><a class="button button-secondary" href="/leads">Voltar para leads</a></header>${body}</main>`,
  });
}

export function renderNewLeadPage(companies: Company[], agents: SdrAgent[], error?: string): string {
  const body = companies.length && agents.length
    ? `<section class="panel">${renderLeadForm('/leads', companies, agents, undefined, error)}</section>`
    : '<section class="panel"><p class="muted">Cadastre pelo menos uma empresa e um SDR antes de criar leads.</p></section>';
  return renderLayout({
    title: 'Novo lead - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Novo lead</h1><p class="muted">Insira um contato manualmente.</p></div></header>${body}</main>`,
  });
}

export function renderEditLeadPage(lead: Lead, companies: Company[], agents: SdrAgent[], error?: string): string {
  return renderLayout({
    title: 'Editar lead - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Editar lead</h1><p class="muted">Atualize os dados do contato.</p></div></header><section class="panel">${renderLeadForm(`/leads/${lead.id}`, companies, agents, lead, error)}</section></main>`,
  });
}

export function renderLeadNotFoundPage(): string {
  return renderLayout({
    title: 'Lead nao encontrado - SDR Portal',
    body: '<main class="app-shell"><section class="panel"><h1>Lead nao encontrado</h1><p class="muted">O lead solicitado nao existe ou foi excluido.</p><a class="button" href="/leads">Voltar para leads</a></section></main>',
  });
}

export function renderImportLeadsPage(companies: Company[], agents: SdrAgent[], imports: LeadImport[], error?: string): string {
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';
  const importRows = imports
    .map(
      (item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${item.totalRows}</td><td>${item.successRows}</td><td>${item.errorRows}</td><td>${item.createdAt.toISOString()}</td></tr>`,
    )
    .join('');
  const importTable = imports.length
    ? `<div class="table-wrap spacing-top"><table><thead><tr><th>Arquivo</th><th>Total</th><th>Sucesso</th><th>Erros</th><th>Data</th></tr></thead><tbody>${importRows}</tbody></table></div>`
    : '<p class="muted spacing-top">Nenhuma importacao registrada ainda.</p>';

  return renderLayout({
    title: 'Importar leads - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Importar leads</h1><p class="muted">Envie um Excel para conferir e mapear as colunas antes de importar.</p></div><a class="button button-secondary" href="/leads">Voltar</a></header><section class="panel">${errorHtml}<form method="post" action="/leads/import" enctype="multipart/form-data" class="form-grid">${renderCompanySelect(companies, companies[0]?.id ?? '')}${renderSdrSelect(agents, agents[0]?.id ?? '')}<div class="field field-full"><label for="file">Arquivo .xlsx</label><input id="file" name="file" type="file" accept=".xlsx" required></div><div class="actions field-full"><button type="submit">Continuar para mapeamento</button></div></form></section>${importTable}</main>`,
  });
}

interface ImportMappingPageOptions {
  agentName: string;
  companyName: string;
  error?: string;
  fileName: string;
  mapping: LeadImportMapping;
  preview: LeadExcelPreview;
  token: string;
}

export function renderImportMappingPage(options: ImportMappingPageOptions): string {
  const errorHtml = options.error ? `<div class="alert-error">${escapeHtml(options.error)}</div>` : '';
  const mappingFields = leadImportFields.map((field) => renderColumnSelect(options.preview, options.mapping, field)).join('');

  return renderLayout({
    title: 'Mapear colunas - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Mapear colunas</h1><p class="muted">Arquivo: ${escapeHtml(options.fileName)} | Empresa: ${escapeHtml(options.companyName)} | SDR: ${escapeHtml(options.agentName)}</p></div><a class="button button-secondary" href="/leads/import">Cancelar</a></header><section class="panel">${errorHtml}<p class="muted">Escolha qual coluna do Excel corresponde a cada campo do lead. WhatsApp e nome da empresa sao obrigatorios.</p><form method="post" action="/leads/import/confirm" class="form-grid"><input type="hidden" name="token" value="${escapeHtml(options.token)}">${mappingFields}<div class="actions field-full"><button type="submit">Confirmar importacao</button><a class="button button-secondary" href="/leads/import">Enviar outro arquivo</a></div></form></section><section class="panel spacing-top"><h2>Previa da planilha</h2><p class="muted">${options.preview.totalRows} linha(s) de dados. Mostrando ate 5 linhas para conferencia.</p>${renderExcelPreviewTable(options.preview)}</section></main>`,
  });
}

export function renderImportResultPage(leadImport: LeadImport): string {
  return renderLayout({
    title: 'Resultado da importacao - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Importacao concluida</h1><p class="muted">Arquivo: ${escapeHtml(leadImport.fileName)}</p></div><a class="button" href="/leads">Ver leads</a></header><section class="panel"><p>Total: ${leadImport.totalRows}</p><p>Importados: ${leadImport.successRows}</p><p>Erros: ${leadImport.errorRows}</p><pre>${escapeHtml(leadImport.errors ?? '[]')}</pre></section></main>`,
  });
}

function renderMilestoneRow(lead: Lead, milestone: LeadMilestone, timeZone: string): string {
  const at = milestoneDate(lead, milestone);
  const label = escapeHtml(MILESTONE_LABELS[milestone]);
  if (at) {
    const reason = milestone === 'lost' && lead.lostReason ? ` — ${escapeHtml(lead.lostReason)}` : '';
    return `<tr><th style="text-align:left;width:200px;">${label}</th><td><strong>${escapeHtml(formatDateTimeInTimeZone(at, timeZone))}</strong>${reason}</td>
      <td><form method="post" action="/leads/${lead.id}/desfecho" data-inline><input type="hidden" name="marco" value="${milestone}"><input type="hidden" name="desfazer" value="1"><button class="link-button" type="submit">Desfazer</button></form></td></tr>`;
  }
  const reasonInput =
    milestone === 'lost' ? '<input type="text" name="motivo" placeholder="Motivo (preco, ja tem sistema, sumiu...)" maxlength="200"> ' : '';
  return `<tr><th style="text-align:left;width:200px;">${label}</th><td class="muted">—</td>
    <td><form method="post" action="/leads/${lead.id}/desfecho" data-inline><input type="hidden" name="marco" value="${milestone}">${reasonInput}<button class="button button-secondary" type="submit">Marcar agora</button></form></td></tr>`;
}

/**
 * Painel que fecha o funil: quem atendeu o handoff marca o que aconteceu. Aparece em todo lead
 * (cliente pode fechar sem handoff formal), mas e no lead transferido que ele importa.
 */
/** Bloqueio do numero para todos os SDRs, ou o botao para bloquear. */
function renderContactBlockPanel(lead: Lead, block: ContactBlock | null): string {
  if (block) {
    return `<section class="panel spacing-top">
    <h2>Nao contatar</h2>
    <p>Este numero esta na lista de nao contatar${block.reason ? `: <strong>${escapeHtml(block.reason)}</strong>` : ''}. Nenhum SDR aborda, e a importacao nao traz de volta.</p>
    <form method="post" action="/leads/nao-contatar/${block.id}/remover" data-inline><input type="hidden" name="voltar" value="/leads/${lead.id}"><button class="link-button" type="submit">Tirar da lista</button></form>
  </section>`;
  }
  return `<section class="panel spacing-top">
    <h2>Nao contatar</h2>
    <p class="muted">Pediu para nao receber mais mensagem, nao e do ramo, numero errado: bloqueie para nenhum SDR abordar de novo, nem numa importacao futura. O lead tambem e marcado sem interesse.</p>
    <form method="post" action="/leads/${lead.id}/nao-contatar" class="form-grid">
      <div class="field"><label for="motivo">Motivo</label><input id="motivo" name="motivo" maxlength="200" placeholder="Ex: pediu para parar, e taxi"></div>
      <div class="actions"><button class="button button-secondary" type="submit">Nao contatar mais</button></div>
    </form>
  </section>`;
}

export function renderContactBlocksPage(blocks: ContactBlock[]): string {
  const rows = blocks
    .map(
      (block) => `<tr>
        <td>${escapeHtml(block.whatsappNumber)}</td>
        <td>${escapeHtml(block.reason ?? '-')}</td>
        <td class="muted">${escapeHtml(block.source)}</td>
        <td>${escapeHtml(formatDateTimeInTimeZone(block.createdAt, 'America/Sao_Paulo'))}</td>
        <td><form method="post" action="/leads/nao-contatar/${block.id}/remover" data-inline><button class="link-button" type="submit">Tirar da lista</button></form></td>
      </tr>`,
    )
    .join('');
  const table = blocks.length
    ? `<div class="table-wrap"><table><thead><tr><th>WhatsApp</th><th>Motivo</th><th>Quem bloqueou</th><th>Quando</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="empty-state"><h2>Lista vazia</h2><p class="muted">Bloqueie pela tela do lead, no quadro "Nao contatar".</p></section>';
  return renderLayout({
    title: 'Nao contatar - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Nao contatar</h1><p class="muted">Numeros que nenhum SDR aborda e que a importacao de planilha pula.</p></div><div class="actions"><a class="button button-secondary" href="/leads">Voltar</a></div></header>${table}</main>`,
  });
}

function renderOutcomePanel(lead: Lead, timeZone: string): string {
  const intro = lead.handoffRequestedAt
    ? 'O lead foi passado para o time. Marque aqui o que aconteceu: e isso que diz se o SDR esta trazendo cliente.'
    : 'Ainda sem handoff. Se o time fechou com este lead por outro caminho, marque aqui do mesmo jeito.';
  return `<section class="panel">
    <h2>Depois do handoff</h2>
    <p class="muted">${intro}</p>
    <div class="table-wrap"><table>${LEAD_MILESTONES.map((milestone) => renderMilestoneRow(lead, milestone, timeZone)).join('')}</table></div>
  </section>`;
}

export function renderLeadDetailPage(
  lead: Lead,
  company: Company | null,
  agents: SdrAgent[],
  aiRuns: AiRun[],
  jobLogs: JobLog[],
  block: ContactBlock | null = null,
): string {
  const agent = agents.find((a) => a.id === lead.sdrAgentId);

  const infoRows = [
    ['Empresa', company?.name ?? lead.companyName],
    ['SDR', agent?.displayName ?? agent?.name ?? '-'],
    ['WhatsApp', lead.whatsappNumber],
    ['CNPJ', lead.cnpj],
    ['Nome fantasia', lead.tradeName],
    ['Segmento', lead.segment],
    ['Cidade/Estado', [lead.city, lead.state].filter(Boolean).join(' / ')],
    ['Contato', lead.contactName],
    ['Situacao', statusLabel(lead.status)],
    ['Etapa', lead.conversationStage],
    ['Fonte', lead.source],
    ['Primeira msg', lead.firstMessageSentAt?.toISOString()],
    ['Ultimo inbound', lead.lastInboundAt?.toISOString()],
    ['Ultimo outbound', lead.lastOutboundAt?.toISOString()],
    ['Follow-up em', lead.followupDueAt?.toISOString()],
    ['Follow-up enviado', lead.followupSentAt?.toISOString()],
    ['Follow-up desativado', lead.followupDisabledAt?.toISOString()],
    ['Pausa humana ate', lead.humanPausedUntil?.toISOString()],
    ['IA pausada em', lead.aiPausedAt?.toISOString()],
    ['Motivo pausa', lead.aiPauseReason],
    ['Handoff em', lead.handoffRequestedAt?.toISOString()],
    ['Resumo handoff', lead.handoffSummary],
    ['Dados extras', lead.extraData],
  ]
    .filter(([, value]) => value)
    .map(
      ([label, value]) => `<tr><th style="text-align:left;width:200px;">${escapeHtml(label ?? '')}</th><td>${escapeHtml(String(value ?? ''))}</td></tr>`,
    )
    .join('');

  const aiRunRows = aiRuns.length
    ? aiRuns
        .map(
          (run) => `<tr>
          <td>${run.createdAt.toISOString()}</td>
          <td>${escapeHtml(run.purpose)}</td>
          <td>${escapeHtml(run.model)}</td>
          <td>${escapeHtml(run.error ?? 'OK')}</td>
          <td>${run.latencyMs != null ? `${run.latencyMs}ms` : '-'}</td>
          <td><details><summary>Ver</summary><pre style="max-height:100px;overflow:auto;font-size:0.75rem;">${escapeHtml(run.outputText ?? run.error ?? '-')}</pre></details></td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="muted">Nenhuma chamada IA para este lead.</td></tr>';

  const jobRows = jobLogs.length
    ? jobLogs
        .map(
          (log) => `<tr>
          <td>${log.createdAt.toISOString()}</td>
          <td>${escapeHtml(log.jobName)}</td>
          <td>${escapeHtml(log.status)}</td>
          <td>${log.attempt}</td>
          <td>${escapeHtml(log.error ?? '-')}</td>
          <td><details><summary>Ver</summary><pre style="max-height:100px;overflow:auto;font-size:0.75rem;">${escapeHtml(log.payload ?? log.result ?? '-')}</pre></details></td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="muted">Nenhum job para este lead.</td></tr>';

  return renderLayout({
    title: `${lead.companyName} - SDR Portal`,
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>${escapeHtml(lead.companyName)}</h1>
      <p class="muted">${escapeHtml(lead.whatsappNumber)} — ${escapeHtml(statusLabel(lead.status))}</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/leads">Voltar</a>
      <a class="button" href="/leads/${lead.id}/edit">Editar</a>
    </div>
  </header>

  ${renderOutcomePanel(lead, resolveTimeZone(agent?.timezone))}
  ${renderContactBlockPanel(lead, block)}

  <section class="panel spacing-top">
    <h2>Dados do lead</h2>
    <div class="table-wrap"><table>${infoRows}</table></div>
  </section>

  <details class="panel spacing-top">
    <summary><strong>Chamadas de IA</strong> <span class="muted">${aiRuns.length} registro(s)</span></summary>
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Proposito</th><th>Modelo</th><th>Erro</th><th>Latencia</th><th>Output</th></tr></thead><tbody>${aiRunRows}</tbody></table></div>
  </details>

  <details class="panel spacing-top">
    <summary><strong>Jobs</strong> <span class="muted">${jobLogs.length} registro(s)</span></summary>
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Job</th><th>Status</th><th>Tentativa</th><th>Erro</th><th>Payload</th></tr></thead><tbody>${jobRows}</tbody></table></div>
  </details>

  <details class="panel spacing-top">
    <summary><strong>Excluir este lead</strong> <span class="muted">Apaga o lead, a conversa e as mensagens. Nao da para desfazer.</span></summary>
    <form method="post" action="/leads/${lead.id}/delete" class="spacing-top" onsubmit="return confirm('Excluir este lead e todo o historico de conversa dele?')"><button class="button button-danger" type="submit">Excluir lead</button></form>
  </details>
</main>`,
  });
}
