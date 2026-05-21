import type { Company, SdrAgent } from '../../db/schema.js';
import { escapeHtml, renderLayout } from '../web/html.js';

interface SdrAgentFormData {
  companyId: string;
  name: string;
  displayName: string;
  isActive: boolean;
  productName: string;
  productDescription: string;
  offerDescription: string;
  prompt: string;
  firstMessagePrompt: string;
  followupPrompt: string;
  aiProvider: string;
  aiModel: string;
  aiTemperature: string;
  aiMaxOutputTokens: string;
  openaiApiKeyEncrypted: string;
  openrouterApiKeyEncrypted: string;
  uazapiBaseUrl: string;
  uazapiInstanceId: string;
  uazapiInstanceTokenEncrypted: string;
  uazapiAdminTokenEncrypted: string;
  whatsappNumber: string;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  sendDaysOfWeek: string;
  initialCooldownMinMinutes: string;
  initialCooldownMaxMinutes: string;
  followupEnabled: boolean;
  followupAfterHours: string;
  followupCooldownMinMinutes: string;
  followupCooldownMaxMinutes: string;
  dailyInitialSendLimit: string;
  dailyFollowupSendLimit: string;
  responseDelayBaseMs: string;
  responseDelayPerCharMs: string;
  responseDelayMaxMs: string;
  messageSplitMaxChars: string;
  humanPauseHours: string;
  handoffName: string;
  handoffPhone: string;
  handoffMessageTemplate: string;
}

const defaultForm: SdrAgentFormData = {
  companyId: '',
  name: '',
  displayName: '',
  isActive: false,
  productName: '',
  productDescription: '',
  offerDescription: '',
  prompt: '',
  firstMessagePrompt: '',
  followupPrompt: '',
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  aiTemperature: '0.4',
  aiMaxOutputTokens: '800',
  openaiApiKeyEncrypted: '',
  openrouterApiKeyEncrypted: '',
  uazapiBaseUrl: '',
  uazapiInstanceId: '',
  uazapiInstanceTokenEncrypted: '',
  uazapiAdminTokenEncrypted: '',
  whatsappNumber: '',
  timezone: 'America/Sao_Paulo',
  sendWindowStart: '08:00',
  sendWindowEnd: '18:00',
  sendDaysOfWeek: '1,2,3,4,5',
  initialCooldownMinMinutes: '5',
  initialCooldownMaxMinutes: '15',
  followupEnabled: true,
  followupAfterHours: '24',
  followupCooldownMinMinutes: '10',
  followupCooldownMaxMinutes: '30',
  dailyInitialSendLimit: '50',
  dailyFollowupSendLimit: '50',
  responseDelayBaseMs: '1200',
  responseDelayPerCharMs: '35',
  responseDelayMaxMs: '12000',
  messageSplitMaxChars: '450',
  humanPauseHours: '24',
  handoffName: '',
  handoffPhone: '',
  handoffMessageTemplate: '',
};

function agentToForm(agent?: SdrAgent): SdrAgentFormData {
  if (!agent) {
    return defaultForm;
  }

  return {
    companyId: agent.companyId,
    name: agent.name,
    displayName: agent.displayName,
    isActive: agent.isActive,
    productName: agent.productName ?? '',
    productDescription: agent.productDescription ?? '',
    offerDescription: agent.offerDescription ?? '',
    prompt: agent.prompt ?? '',
    firstMessagePrompt: agent.firstMessagePrompt ?? '',
    followupPrompt: agent.followupPrompt ?? '',
    aiProvider: agent.aiProvider,
    aiModel: agent.aiModel,
    aiTemperature: String(agent.aiTemperature),
    aiMaxOutputTokens: String(agent.aiMaxOutputTokens),
    openaiApiKeyEncrypted: '',
    openrouterApiKeyEncrypted: '',
    uazapiBaseUrl: agent.uazapiBaseUrl ?? '',
    uazapiInstanceId: agent.uazapiInstanceId ?? '',
    uazapiInstanceTokenEncrypted: '',
    uazapiAdminTokenEncrypted: '',
    whatsappNumber: agent.whatsappNumber ?? '',
    timezone: agent.timezone,
    sendWindowStart: agent.sendWindowStart,
    sendWindowEnd: agent.sendWindowEnd,
    sendDaysOfWeek: agent.sendDaysOfWeek,
    initialCooldownMinMinutes: String(agent.initialCooldownMinMinutes),
    initialCooldownMaxMinutes: String(agent.initialCooldownMaxMinutes),
    followupEnabled: agent.followupEnabled,
    followupAfterHours: String(agent.followupAfterHours),
    followupCooldownMinMinutes: String(agent.followupCooldownMinMinutes),
    followupCooldownMaxMinutes: String(agent.followupCooldownMaxMinutes),
    dailyInitialSendLimit: String(agent.dailyInitialSendLimit),
    dailyFollowupSendLimit: String(agent.dailyFollowupSendLimit),
    responseDelayBaseMs: String(agent.responseDelayBaseMs),
    responseDelayPerCharMs: String(agent.responseDelayPerCharMs),
    responseDelayMaxMs: String(agent.responseDelayMaxMs),
    messageSplitMaxChars: String(agent.messageSplitMaxChars),
    humanPauseHours: String(agent.humanPauseHours),
    handoffName: agent.handoffName ?? '',
    handoffPhone: agent.handoffPhone ?? '',
    handoffMessageTemplate: agent.handoffMessageTemplate ?? '',
  };
}

function renderField(name: keyof SdrAgentFormData, label: string, value: string, required = false, type = 'text'): string {
  const requiredAttribute = required ? ' required' : '';
  return `<div class="field">
    <label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"${requiredAttribute}>
  </div>`;
}

function renderTextArea(name: keyof SdrAgentFormData, label: string, value: string, rows = 5): string {
  return `<div class="field field-full">
    <label for="${name}">${label}</label>
    <textarea id="${name}" name="${name}" rows="${rows}">${escapeHtml(value)}</textarea>
  </div>`;
}

function renderCheckbox(name: keyof SdrAgentFormData, label: string, checked: boolean): string {
  const checkedAttribute = checked ? ' checked' : '';
  return `<label class="checkbox-field"><input name="${name}" type="checkbox"${checkedAttribute}> ${label}</label>`;
}

function renderCompanySelect(companies: Company[], selectedId: string): string {
  const options = companies
    .map((company) => {
      const selected = company.id === selectedId ? ' selected' : '';
      return `<option value="${company.id}"${selected}>${escapeHtml(company.name)}</option>`;
    })
    .join('');

  return `<div class="field">
    <label for="companyId">Empresa</label>
    <select id="companyId" name="companyId" required>${options}</select>
  </div>`;
}

function renderProviderSelect(selectedProvider: string): string {
  const providers = ['openai', 'openrouter'];
  const options = providers
    .map((provider) => {
      const selected = provider === selectedProvider ? ' selected' : '';
      return `<option value="${provider}"${selected}>${provider}</option>`;
    })
    .join('');

  return `<div class="field">
    <label for="aiProvider">Provedor IA</label>
    <select id="aiProvider" name="aiProvider" required>${options}</select>
  </div>`;
}

function renderSecretHint(): string {
  return '<p class="muted field-full">Campos de chave/token ficam em branco na edicao. Preencha apenas quando quiser substituir o valor salvo.</p>';
}

function renderSdrAgentForm(action: string, companies: Company[], agent?: SdrAgent, error?: string): string {
  const data = agentToForm(agent);
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';

  return `${errorHtml}
    <form method="post" action="${escapeHtml(action)}" class="form-grid">
      <h2 class="field-full">Geral</h2>
      ${renderCompanySelect(companies, data.companyId || companies[0]?.id || '')}
      ${renderField('name', 'Nome interno', data.name, true)}
      ${renderField('displayName', 'Nome usado na conversa', data.displayName, true)}
      <div class="field">${renderCheckbox('isActive', 'SDR ativo', data.isActive)}</div>
      ${renderField('productName', 'Produto ou servico', data.productName)}
      ${renderTextArea('productDescription', 'Descricao do produto ou servico', data.productDescription)}
      ${renderTextArea('offerDescription', 'Descricao da oferta', data.offerDescription)}

      <h2 class="field-full">IA</h2>
      ${renderProviderSelect(data.aiProvider)}
      ${renderField('aiModel', 'Modelo', data.aiModel, true)}
      ${renderField('aiTemperature', 'Temperatura', data.aiTemperature, true, 'number')}
      ${renderField('aiMaxOutputTokens', 'Maximo de tokens de saida', data.aiMaxOutputTokens, true, 'number')}
      ${renderField('openaiApiKeyEncrypted', 'Chave OpenAI', data.openaiApiKeyEncrypted, false, 'password')}
      ${renderField('openrouterApiKeyEncrypted', 'Chave OpenRouter', data.openrouterApiKeyEncrypted, false, 'password')}
      ${renderSecretHint()}
      ${renderTextArea('prompt', 'Prompt principal', data.prompt, 10)}
      ${renderTextArea('firstMessagePrompt', 'Prompt da primeira mensagem', data.firstMessagePrompt, 6)}
      ${renderTextArea('followupPrompt', 'Prompt de follow-up', data.followupPrompt, 5)}

      <h2 class="field-full">WhatsApp e UAZAPI</h2>
      ${renderField('uazapiBaseUrl', 'URL base UAZAPI', data.uazapiBaseUrl)}
      ${renderField('uazapiInstanceId', 'ID ou nome da instancia', data.uazapiInstanceId)}
      ${renderField('whatsappNumber', 'Numero WhatsApp', data.whatsappNumber)}
      ${renderField('uazapiInstanceTokenEncrypted', 'Token da instancia', data.uazapiInstanceTokenEncrypted, false, 'password')}
      ${renderField('uazapiAdminTokenEncrypted', 'Token admin UAZAPI', data.uazapiAdminTokenEncrypted, false, 'password')}

      <h2 class="field-full">Envio</h2>
      ${renderField('timezone', 'Timezone', data.timezone, true)}
      ${renderField('sendWindowStart', 'Inicio da janela de envio', data.sendWindowStart, true, 'time')}
      ${renderField('sendWindowEnd', 'Fim da janela de envio', data.sendWindowEnd, true, 'time')}
      ${renderField('sendDaysOfWeek', 'Dias da semana', data.sendDaysOfWeek, true)}
      ${renderField('initialCooldownMinMinutes', 'Cooldown inicial minimo em minutos', data.initialCooldownMinMinutes, true, 'number')}
      ${renderField('initialCooldownMaxMinutes', 'Cooldown inicial maximo em minutos', data.initialCooldownMaxMinutes, true, 'number')}
      ${renderField('dailyInitialSendLimit', 'Limite diario de mensagens iniciais', data.dailyInitialSendLimit, true, 'number')}

      <h2 class="field-full">Follow-up</h2>
      <div class="field">${renderCheckbox('followupEnabled', 'Follow-up ativo', data.followupEnabled)}</div>
      ${renderField('followupAfterHours', 'Enviar follow-up apos quantas horas', data.followupAfterHours, true, 'number')}
      ${renderField('followupCooldownMinMinutes', 'Cooldown follow-up minimo em minutos', data.followupCooldownMinMinutes, true, 'number')}
      ${renderField('followupCooldownMaxMinutes', 'Cooldown follow-up maximo em minutos', data.followupCooldownMaxMinutes, true, 'number')}
      ${renderField('dailyFollowupSendLimit', 'Limite diario de follow-ups', data.dailyFollowupSendLimit, true, 'number')}

      <h2 class="field-full">Buffer e handoff</h2>
      ${renderField('responseDelayBaseMs', 'Delay base da resposta em ms', data.responseDelayBaseMs, true, 'number')}
      ${renderField('responseDelayPerCharMs', 'Delay por caractere em ms', data.responseDelayPerCharMs, true, 'number')}
      ${renderField('responseDelayMaxMs', 'Delay maximo por parte em ms', data.responseDelayMaxMs, true, 'number')}
      ${renderField('messageSplitMaxChars', 'Maximo de caracteres por parte', data.messageSplitMaxChars, true, 'number')}
      ${renderField('humanPauseHours', 'Pausa humana em horas', data.humanPauseHours, true, 'number')}
      ${renderField('handoffName', 'Responsavel humano', data.handoffName)}
      ${renderField('handoffPhone', 'WhatsApp do responsavel humano', data.handoffPhone)}
      ${renderTextArea('handoffMessageTemplate', 'Modelo de mensagem para handoff', data.handoffMessageTemplate, 4)}

      <div class="actions field-full">
        <button type="submit">Salvar SDR</button>
        <a class="button button-secondary" href="/sdr-agents">Cancelar</a>
      </div>
    </form>`;
}

export function renderSdrAgentsListPage(agents: SdrAgent[], companies: Company[]): string {
  const companiesById = new Map(companies.map((company) => [company.id, company.name]));
  const rows = agents
    .map((agent) => {
      const toggleLabel = agent.isActive ? 'Desativar' : 'Ativar';
      return `<tr>
        <td>${escapeHtml(agent.name)}<br><span class="muted">${escapeHtml(agent.displayName)}</span></td>
        <td>${escapeHtml(companiesById.get(agent.companyId) ?? '-')}</td>
        <td>${escapeHtml(agent.aiProvider)}<br><span class="muted">${escapeHtml(agent.aiModel)}</span></td>
        <td><span class="status-pill ${agent.isActive ? 'status-on' : 'status-off'}">${agent.isActive ? 'Ativo' : 'Inativo'}</span></td>
        <td class="table-actions">
          <a href="/sdr-agents/${agent.id}/edit">Editar</a>
          <form method="post" action="/sdr-agents/${agent.id}/toggle" data-inline><button class="link-button" type="submit">${toggleLabel}</button></form>
          <form method="post" action="/sdr-agents/${agent.id}/delete" data-inline><button class="link-button" type="submit">Excluir</button></form>
        </td>
      </tr>`;
    })
    .join('');

  const table = agents.length
    ? `<div class="table-wrap"><table>
      <thead><tr><th>SDR</th><th>Empresa</th><th>IA</th><th>Status</th><th>Acoes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
    : '<section class="panel"><p class="muted">Nenhum SDR cadastrado ainda.</p></section>';

  return renderLayout({
    title: 'SDRs - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>SDRs</h1>
      <p class="muted">Configure agentes, prompts, modelos, WhatsApp e regras de envio.</p>
    </div>
    <div class="actions">
      <a class="button button-secondary" href="/dashboard">Dashboard</a>
      <a class="button" href="/sdr-agents/new">Novo SDR</a>
    </div>
  </header>
  ${table}
</main>`,
  });
}

export function renderNewSdrAgentPage(companies: Company[], error?: string): string {
  const body = companies.length
    ? `<section class="panel">${renderSdrAgentForm('/sdr-agents', companies, undefined, error)}</section>`
    : `<section class="panel"><h1>Nenhuma empresa cadastrada</h1><p class="muted">Cadastre uma empresa antes de criar SDRs.</p><a class="button" href="/companies/new">Criar empresa</a></section>`;

  return renderLayout({
    title: 'Novo SDR - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Novo SDR</h1><p class="muted">Crie um agente vinculado a uma empresa.</p></div></header>${body}</main>`,
  });
}

export function renderEditSdrAgentPage(agent: SdrAgent, companies: Company[], error?: string): string {
  return renderLayout({
    title: 'Editar SDR - SDR Portal',
    body: `<main class="app-shell"><header class="topbar"><div><h1>Editar SDR</h1><p class="muted">Atualize as configuracoes do agente.</p></div></header><section class="panel">${renderSdrAgentForm(`/sdr-agents/${agent.id}`, companies, agent, error)}</section>${renderUazapiActions(agent)}</main>`,
  });
}

function renderUazapiActions(agent: SdrAgent): string {
  return `<section class="panel spacing-top">
    <h2>Acoes UAZAPI</h2>
    <p class="muted">Use estas acoes para testar a instancia, configurar webhook e enviar uma mensagem manual de teste.</p>
    <div class="actions">
      <form method="post" action="/sdr-agents/${agent.id}/uazapi/status">
        <button type="submit">Testar status</button>
      </form>
      <form method="post" action="/sdr-agents/${agent.id}/uazapi/configure-webhook">
        <button type="submit">Configurar webhook</button>
      </form>
    </div>
    <form method="post" action="/sdr-agents/${agent.id}/uazapi/send-test" class="form-grid spacing-top">
      <div class="field">
        <label for="testNumber">Numero para teste</label>
        <input id="testNumber" name="number" value="${escapeHtml(agent.whatsappNumber ?? '')}" required>
      </div>
      <div class="field field-full">
        <label for="testText">Mensagem de teste</label>
        <textarea id="testText" name="text" rows="3" required>Mensagem de teste do SDR Portal.</textarea>
      </div>
      <div class="actions field-full"><button type="submit">Enviar mensagem teste</button></div>
    </form>
  </section>`;
}

export function renderSdrAgentNotFoundPage(): string {
  return renderLayout({
    title: 'SDR nao encontrado - SDR Portal',
    body: `<main class="app-shell"><section class="panel"><h1>SDR nao encontrado</h1><p class="muted">O agente solicitado nao existe ou foi excluido.</p><a class="button" href="/sdr-agents">Voltar para SDRs</a></section></main>`,
  });
}
