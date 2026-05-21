import type { Company } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

export interface CompanyFormData {
  name: string;
  legalName: string;
  cnpj: string;
  segment: string;
  description: string;
  websiteUrl: string;
  defaultHandoffName: string;
  defaultHandoffPhone: string;
}

const emptyForm: CompanyFormData = {
  name: '',
  legalName: '',
  cnpj: '',
  segment: '',
  description: '',
  websiteUrl: '',
  defaultHandoffName: '',
  defaultHandoffPhone: '',
};

function companyToForm(company?: Company): CompanyFormData {
  if (!company) {
    return emptyForm;
  }

  return {
    name: company.name,
    legalName: company.legalName ?? '',
    cnpj: company.cnpj ?? '',
    segment: company.segment ?? '',
    description: company.description ?? '',
    websiteUrl: company.websiteUrl ?? '',
    defaultHandoffName: company.defaultHandoffName ?? '',
    defaultHandoffPhone: company.defaultHandoffPhone ?? '',
  };
}

function renderField(name: keyof CompanyFormData, label: string, value: string, required = false): string {
  const requiredAttribute = required ? ' required' : '';
  return `<div class="field">
    <label for="${name}">${label}</label>
    <input id="${name}" name="${name}" value="${escapeHtml(value)}"${requiredAttribute}>
  </div>`;
}

function renderCompanyForm(action: string, company?: Company, error?: string): string {
  const data = companyToForm(company);
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';

  return `${errorHtml}
    <form method="post" action="${escapeHtml(action)}" class="form-grid">
      ${renderField('name', 'Nome da empresa', data.name, true)}
      ${renderField('legalName', 'Razao social', data.legalName)}
      ${renderField('cnpj', 'CNPJ', data.cnpj)}
      ${renderField('segment', 'Segmento', data.segment)}
      ${renderField('websiteUrl', 'Site', data.websiteUrl)}
      ${renderField('defaultHandoffName', 'Responsavel humano padrao', data.defaultHandoffName)}
      ${renderField('defaultHandoffPhone', 'WhatsApp do responsavel', data.defaultHandoffPhone)}
      <div class="field field-full">
        <label for="description">Descricao do negocio</label>
        <textarea id="description" name="description" rows="5">${escapeHtml(data.description)}</textarea>
      </div>
      <div class="actions field-full">
        <button type="submit">Salvar</button>
        <a class="button button-secondary" href="/companies">Cancelar</a>
      </div>
    </form>`;
}

export function renderCompaniesListPage(companies: Company[]): string {
  const rows = companies
    .map(
      (company) => `<tr>
        <td>${escapeHtml(company.name)}</td>
        <td>${escapeHtml(company.segment ?? '-')}</td>
        <td>${escapeHtml(company.cnpj ?? '-')}</td>
        <td>${escapeHtml(company.defaultHandoffName ?? '-')}</td>
        <td class="table-actions">
          <a href="/companies/${company.id}/edit">Editar</a>
          <form method="post" action="/companies/${company.id}/delete" data-inline onsubmit="return confirm('Tem certeza que deseja excluir esta empresa?')">
            <button class="link-button" type="submit">Excluir</button>
          </form>
        </td>
      </tr>`,
    )
    .join('');

  const table = companies.length
    ? `<div class="table-wrap"><table>
      <thead>
        <tr>
          <th>Empresa</th>
          <th>Segmento</th>
          <th>CNPJ</th>
          <th>Responsavel</th>
          <th>Acoes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table></div>`
    : '<section class="empty-state"><h2>Nenhuma empresa cadastrada</h2><p class="muted">Cadastre a primeira empresa para criar SDRs e leads vinculados a ela.</p><a class="button" href="/companies/new">Nova empresa</a></section>';

  return renderLayout({
    title: 'Empresas - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Empresas</h1>
      <p class="muted">Cadastre as empresas que terao um ou mais SDRs.</p>
    </div>
    <div class="actions">
      <a class="button" href="/companies/new">Nova empresa</a>
    </div>
  </header>
  ${table}
</main>`,
  });
}

export function renderNewCompanyPage(error?: string): string {
  return renderLayout({
    title: 'Nova empresa - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Nova empresa</h1>
      <p class="muted">Esses dados serao usados depois nos prompts e nos SDRs.</p>
    </div>
  </header>
  <section class="panel">${renderCompanyForm('/companies', undefined, error)}</section>
</main>`,
  });
}

export function renderEditCompanyPage(company: Company, error?: string): string {
  return renderLayout({
    title: 'Editar empresa - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>Editar empresa</h1>
      <p class="muted">Atualize os dados base da empresa.</p>
    </div>
  </header>
  <section class="panel">${renderCompanyForm(`/companies/${company.id}`, company, error)}</section>
</main>`,
  });
}

export function renderCompanyNotFoundPage(): string {
  return renderLayout({
    title: 'Empresa nao encontrada - SDR Portal',
    body: `<main class="app-shell">
  <section class="panel">
    <h1>Empresa nao encontrada</h1>
    <p class="muted">O cadastro solicitado nao existe ou ja foi excluido.</p>
    <a class="button" href="/companies">Voltar para empresas</a>
  </section>
</main>`,
  });
}
