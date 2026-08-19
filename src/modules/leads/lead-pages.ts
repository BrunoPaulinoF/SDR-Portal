import type { AiRun, Company, JobLog, Lead, LeadImport, SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';
import { leadImportFields, type LeadExcelPreview, type LeadImportMapping } from './lead-importer.js';

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
const bulkDeleteStatuses: Array<[string, string]> = [
  ['pending', 'Pendente'],
  ['invalid_phone', 'Telefone inexistente'],
  ['discarded', 'Descartado'],
  ['not_interested', 'Sem interesse'],
  ['initial_sent', 'Abordado'],
  ['in_conversation', 'Em conversa'],
  ['followup_sent', 'Follow-up enviado'],
  ['human_paused', 'Pausado por humano'],
  ['transferred', 'Handoff feito'],
];

function renderBulkDeletePanel(leads: Lead[], agents: SdrAgent[]): string {
  if (agents.length === 0) return '';

  const agentOptions = agents
    .map((agent) => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`)
    .join('');

  const checkboxes = bulkDeleteStatuses
    .map(([value, label]) => {
      const total = leads.filter((lead) => lead.status === value).length;
      return `<label class="check-item">
        <input type="checkbox" name="statuses" value="${escapeHtml(value)}" />
        <span>${escapeHtml(label)} <span class="muted">(${total})</span></span>
      </label>`;
    })
    .join('');

  return `<section class="panel">
    <h2>Limpar leads</h2>
    <p class="muted">Apaga os leads do SDR escolhido nos status marcados. Conversas e mensagens desses leads vao junto, e nao da para desfazer.</p>
    <form method="post" action="/leads/limpar" onsubmit="return confirm('Isso apaga os leads selecionados e o historico de conversa deles. Confirmar?')">
      <div class="field">
        <label for="bulkSdrAgentId">SDR</label>
        <select id="bulkSdrAgentId" name="sdrAgentId" required>${agentOptions}</select>
      </div>
      <div class="check-grid">${checkboxes}</div>
      <button class="button button-danger" type="submit">Limpar leads selecionados</button>
    </form>
  </section>`;
}

export function renderLeadsListPage(leads: Lead[], companies: Company[], agents: SdrAgent[], notice?: string): string {
  const companiesById = new Map(companies.map((company) => [company.id, company.name]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const rows = leads
    .map(
      (lead) => `<tr>
        <td>${escapeHtml(lead.companyName)}<br><span class="muted">${escapeHtml(lead.whatsappNumber)}</span></td>
        <td>${escapeHtml(companiesById.get(lead.companyId) ?? '-')}</td>
        <td>${escapeHtml(agentsById.get(lead.sdrAgentId) ?? '-')}</td>
        <td>${escapeHtml(lead.segment ?? '-')}</td>
        <td><span class="status-pill status-off">${escapeHtml(lead.status)}</span></td>
        <td class="table-actions"><a href="/leads/${lead.id}">Ver</a><a href="/leads/${lead.id}/edit">Editar</a><form method="post" action="/leads/${lead.id}/delete" data-inline onsubmit="return confirm('Tem certeza que deseja excluir este lead?')"><button class="link-button" type="submit">Excluir</button></form></td>
      </tr>`,
    )
    .join('');
  const table = leads.length
    ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Empresa</th><th>SDR</th><th>Segmento</th><th>Status</th><th>Acoes</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<section class="empty-state"><h2>Nenhum lead cadastrado</h2><p class="muted">Importe uma planilha Excel ou crie um lead manualmente para iniciar a operacao.</p><div class="actions"><a class="button button-secondary" href="/leads/import">Importar Excel</a><a class="button" href="/leads/new">Novo lead</a></div></section>';

  const noticeHtml = notice ? `<p class="form-notice">${escapeHtml(notice)}</p>` : '';

  return renderLayout({
    title: 'Leads - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Leads</h1><p class="muted">Cadastre, edite e importe contatos para os SDRs.</p></div><div class="actions"><a class="button button-secondary" href="/leads/import">Importar Excel</a><a class="button" href="/leads/new">Novo lead</a></div></header>${noticeHtml}${table}${renderBulkDeletePanel(leads, agents)}</main>`,
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

export function renderLeadDetailPage(
  lead: Lead,
  company: Company | null,
  agents: SdrAgent[],
  aiRuns: AiRun[],
  jobLogs: JobLog[],
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
    ['Status', lead.status],
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
      <p class="muted">${escapeHtml(lead.whatsappNumber)} — ${escapeHtml(lead.status)}</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/leads">Voltar</a>
      <a class="button" href="/leads/${lead.id}/edit">Editar</a>
    </div>
  </header>

  <section class="panel">
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
</main>`,
  });
}
