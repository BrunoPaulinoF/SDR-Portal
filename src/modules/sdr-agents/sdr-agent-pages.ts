import type { Company, SdrAgent } from '../../db/schema.js';
import { SDR_BASE_PROMPT } from '../ai/sdr-base-prompt.js';
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

const exampleProductDescription = `Sorvetes artesanais premium para restaurantes, cafeterias, mercados e gelaterias que querem vender uma sobremesa de maior qualidade.

Diferenciais:
- sabores classicos e especiais
- boa apresentacao para revenda
- producao cuidadosa e padronizada
- possibilidade de compra recorrente conforme demanda do estabelecimento`;

const exampleOfferDescription = `Ajudamos estabelecimentos a aumentarem o ticket medio com sorvetes artesanais prontos para revenda ou para compor sobremesas do cardapio.

A conversa inicial deve descobrir se o lead ja vende sobremesas, se trabalha com sorvete hoje e se faz sentido encaminhar para atendimento humano com detalhes de sabores, volumes e condicoes.`;

const exampleMainPrompt = `Voce e a Lucia, uma SDR consultiva, simpatica e objetiva.

Objetivo:
Conversar com donos ou responsaveis de restaurantes, cafeterias, mercados e negocios de alimentacao para entender se existe oportunidade de venda de sorvetes artesanais para revenda ou uso em sobremesas.

Como conduzir:
- Comece com perguntas simples e naturais.
- Faca uma pergunta por vez.
- Primeiro entenda se o negocio ja vende sobremesas ou sorvetes.
- Depois descubra se ha interesse em conhecer opcoes para revenda ou cardapio.
- Nao pressione o lead.
- Nao fale preco antes de entender o perfil e volume.
- Se perguntarem preco, explique que depende de volume, sabores e formato de compra, e ofereca encaminhar para alguem do time.
- Se o lead demonstrar interesse, peca cidade e melhor horario para atendimento.

Tom:
Humano, educado, direto, sem exagero comercial e sem parecer robo.`;

const exampleFirstMessagePrompt = `Crie uma primeira abordagem curta para {{companyName}}.

Contexto disponivel:
- Segmento: {{segment}}
- Produto: {{productName}}
- Pesquisa sobre o lead: {{researchSummary}}

Regras:
- Seja natural e educada.
- Nao venda direto.
- Nao fale preco.
- Faca apenas uma pergunta simples para iniciar a conversa.
- Use no maximo 2 frases.`;

const exampleFollowupPrompt = `Crie um follow-up curto e educado para um lead que recebeu a primeira mensagem, mas ainda nao respondeu.

Regras:
- Nao cobre resposta de forma agressiva.
- Reforce o contexto de forma leve.
- Faca uma pergunta simples.
- Use no maximo 2 frases.`;

const exampleHandoffTemplate = `Novo lead para atendimento humano.

SDR: {{sdrName}}
Lead: {{companyName}}
WhatsApp: {{whatsappNumber}}
Produto: {{productName}}
Resumo: {{summary}}`;

const fieldHelp: Partial<Record<keyof SdrAgentFormData, string>> = {
  aiMaxOutputTokens: 'Limite aproximado de tokens que a IA pode gerar. Para WhatsApp, 800 a 2000 costuma ser suficiente; modelos reasoning podem usar mais internamente.',
  aiModel: 'Modelo usado por este SDR. Ex: gpt-4o-mini para velocidade/custo, gpt-5.4-mini para reasoning com mais qualidade.',
  aiProvider: 'Escolha onde a IA sera chamada. OpenAI usa sua chave OpenAI; OpenRouter usa sua chave OpenRouter.',
  aiTemperature: 'Controla variacao/criatividade. Para SDR, valores baixos como 0.3 a 0.6 tendem a ser mais consistentes.',
  dailyFollowupSendLimit: 'Maximo de follow-ups enviados por este SDR em um dia.',
  dailyInitialSendLimit: 'Maximo de primeiras mensagens enviadas por este SDR em um dia.',
  displayName: 'Nome que a IA usa ao se apresentar na conversa. Ex: Lucia.',
  firstMessagePrompt: 'Instrucao usada pela IA para criar a primeira mensagem. Pode usar as variaveis listadas abaixo.',
  followupAfterHours: 'Quantidade de horas apos a primeira mensagem para tentar o follow-up unico.',
  followupCooldownMaxMinutes: 'Intervalo maximo entre follow-ups automaticos.',
  followupCooldownMinMinutes: 'Intervalo minimo entre follow-ups automaticos.',
  followupEnabled: 'Quando ativo, o sistema tenta enviar um unico follow-up se o lead nao responder.',
  followupPrompt: 'Instrucao usada pela IA ou pelo template para criar o follow-up.',
  handoffMessageTemplate: 'Mensagem enviada ao responsavel humano quando a IA solicita transferencia.',
  handoffName: 'Nome do responsavel ou time que recebe handoffs.',
  handoffPhone: 'WhatsApp que recebera avisos de transferencia para humano.',
  humanPauseHours: 'Tempo que a IA fica pausada quando alguem responde manualmente pelo WhatsApp do SDR.',
  initialCooldownMaxMinutes: 'Tempo maximo aleatorio entre primeiras mensagens.',
  initialCooldownMinMinutes: 'Tempo minimo aleatorio entre primeiras mensagens para evitar disparos muito proximos.',
  messageSplitMaxChars: 'Tamanho maximo de cada parte quando a resposta for dividida em varias mensagens.',
  name: 'Nome interno para organizacao. Nao precisa ser o nome que aparece para o lead.',
  offerDescription: 'Explique a oferta comercial, promessa, diferenciais e quando chamar humano.',
  openaiApiKeyEncrypted: 'Chave OpenAI especifica deste SDR. Se ficar vazio, usa a chave global do ambiente quando existir.',
  openrouterApiKeyEncrypted: 'Chave OpenRouter especifica deste SDR. Preencha apenas se usar provider OpenRouter.',
  productDescription: 'Descreva o produto/servico para a IA entender o que vende, para quem vende e os diferenciais.',
  productName: 'Nome curto do produto ou servico. Ex: Sorvetes artesanais.',
  prompt: 'Prompt comercial editavel. Defina persona, publico, abordagem, tom, objecoes e limites comerciais. Nao precisa explicar comandos internos.',
  responseDelayBaseMs: 'Delay minimo antes de enviar cada parte da resposta, simulando digitacao.',
  responseDelayMaxMs: 'Delay maximo permitido antes de enviar uma parte da resposta.',
  responseDelayPerCharMs: 'Quanto maior, mais tempo a IA espera proporcionalmente ao tamanho da mensagem.',
  sendDaysOfWeek: 'Dias permitidos para disparo: 0=domingo, 1=segunda, 2=terca, 3=quarta, 4=quinta, 5=sexta, 6=sabado.',
  sendWindowEnd: 'Horario final em que este SDR pode enviar mensagens automaticas.',
  sendWindowStart: 'Horario inicial em que este SDR pode enviar mensagens automaticas.',
  timezone: 'Fuso usado para calcular janela de envio e dias permitidos.',
  uazapiAdminTokenEncrypted: 'Token admin usado para configurar webhook quando necessario.',
  uazapiBaseUrl: 'URL base da sua UAZAPI. Ex: https://sua-uazapi.com.',
  uazapiInstanceId: 'ID ou nome da instancia WhatsApp dentro da UAZAPI.',
  uazapiInstanceTokenEncrypted: 'Token da instancia usado para enviar mensagens, presenca e baixar audios.',
  whatsappNumber: 'Numero conectado nesta instancia/SDR, preferencialmente com DDI e DDD.',
};

const defaultForm: SdrAgentFormData = {
  companyId: '',
  name: '',
  displayName: '',
  isActive: false,
  productName: '',
  productDescription: exampleProductDescription,
  offerDescription: exampleOfferDescription,
  prompt: exampleMainPrompt,
  firstMessagePrompt: exampleFirstMessagePrompt,
  followupPrompt: exampleFollowupPrompt,
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
  handoffMessageTemplate: exampleHandoffTemplate,
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

function renderHelp(name: keyof SdrAgentFormData): string {
  const help = fieldHelp[name];
  return help ? ` <span class="help-tooltip" title="${escapeHtml(help)}">(?)</span>` : '';
}

function renderLabel(name: keyof SdrAgentFormData, label: string): string {
  return `<label for="${name}" class="label-with-help">${label}${renderHelp(name)}</label>`;
}

function renderField(name: keyof SdrAgentFormData, label: string, value: string, required = false, type = 'text'): string {
  const requiredAttribute = required ? ' required' : '';
  return `<div class="field">
    ${renderLabel(name, label)}
    <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"${requiredAttribute}>
  </div>`;
}

function renderTextArea(name: keyof SdrAgentFormData, label: string, value: string, rows = 5): string {
  return `<div class="field field-full">
    ${renderLabel(name, label)}
    <textarea id="${name}" name="${name}" rows="${rows}">${escapeHtml(value)}</textarea>
  </div>`;
}

function renderCheckbox(name: keyof SdrAgentFormData, label: string, checked: boolean): string {
  const checkedAttribute = checked ? ' checked' : '';
  return `<label class="checkbox-field"><input name="${name}" type="checkbox"${checkedAttribute}> ${label}${renderHelp(name)}</label>`;
}

function renderCompanySelect(companies: Company[], selectedId: string): string {
  const options = companies
    .map((company) => {
      const selected = company.id === selectedId ? ' selected' : '';
      return `<option value="${company.id}"${selected}>${escapeHtml(company.name)}</option>`;
    })
    .join('');

  return `<div class="field">
    <label for="companyId" class="label-with-help">Empresa <span class="help-tooltip" title="Empresa dona deste SDR. Leads, conversas e relatorios ficam vinculados a ela.">(?)</span></label>
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
    ${renderLabel('aiProvider', 'Provedor IA')}
    <select id="aiProvider" name="aiProvider" required>${options}</select>
  </div>`;
}

function renderFirstMessageVariables(): string {
  const variables: Array<[string, string]> = [
    ['{{companyName}}', 'nome da empresa lead'],
    ['{{company_name}}', 'alias de companyName'],
    ['{{segment}}', 'segmento do lead'],
    ['{{whatsappNumber}}', 'WhatsApp do lead'],
    ['{{sdrName}}', 'nome do SDR'],
    ['{{productName}}', 'produto/servico'],
    ['{{researchSummary}}', 'resumo da pesquisa web, quando houver'],
    ['{{researchSources}}', 'fontes da pesquisa web, quando houver'],
  ];
  const items = variables.map(([key, description]) => `<li><code>${escapeHtml(key)}</code><span>${escapeHtml(description)}</span></li>`).join('');

  return `<div class="template-vars field-full">
    <strong>Variaveis permitidas para copiar e colar</strong>
    <p class="muted">Use no prompt da primeira mensagem. Se alguma informacao nao existir, ela fica vazia.</p>
    <ul>${items}</ul>
  </div>`;
}

function renderSecretHint(): string {
  return '<p class="muted field-full">Campos de chave/token ficam em branco na edicao. Preencha apenas quando quiser substituir o valor salvo.</p>';
}

function renderLockedBasePrompt(): string {
  return `<div class="field field-full locked-prompt">
    <div class="locked-prompt-header">
      <label>Instrucoes fixas do SDR</label>
      <span>Nao editavel</span>
    </div>
    <p class="muted">Estas regras sempre sao enviadas para a IA. Use o prompt editavel abaixo apenas para produto, publico, tom e regras comerciais especificas.</p>
    <pre>${escapeHtml(SDR_BASE_PROMPT)}</pre>
  </div>`;
}

function renderFormSection(title: string, description: string, content: string, open = false): string {
  return `<details class="form-section"${open ? ' open' : ''}>
    <summary>${escapeHtml(title)}<span>${escapeHtml(description)}</span></summary>
    <div class="form-section-body"><div class="form-grid">${content}</div></div>
  </details>`;
}

function renderSdrAgentForm(action: string, companies: Company[], agent?: SdrAgent, error?: string): string {
  const data = agentToForm(agent);
  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';

  return `${errorHtml}
    <form method="post" action="${escapeHtml(action)}" class="form-sections">
      ${renderFormSection(
        'Identidade',
        'Empresa, nome do agente, status e oferta principal.',
        `
      ${renderCompanySelect(companies, data.companyId || companies[0]?.id || '')}
      ${renderField('name', 'Nome interno', data.name, true)}
      ${renderField('displayName', 'Nome usado na conversa', data.displayName, true)}
      <div class="field">${renderCheckbox('isActive', 'SDR ativo', data.isActive)}</div>
      ${renderField('productName', 'Produto ou servico', data.productName)}
      ${renderTextArea('productDescription', 'Descricao do produto ou servico', data.productDescription)}
      ${renderTextArea('offerDescription', 'Descricao da oferta', data.offerDescription)}
        `,
        true,
      )}

      ${renderFormSection(
        'IA e prompts',
        'Modelo, chaves e instrucoes usadas nas respostas.',
        `
      ${renderProviderSelect(data.aiProvider)}
      ${renderField('aiModel', 'Modelo', data.aiModel, true)}
      ${renderField('aiTemperature', 'Temperatura', data.aiTemperature, true, 'number')}
      ${renderField('aiMaxOutputTokens', 'Maximo de tokens de saida', data.aiMaxOutputTokens, true, 'number')}
      ${renderField('openaiApiKeyEncrypted', 'Chave OpenAI', data.openaiApiKeyEncrypted, false, 'password')}
      ${renderField('openrouterApiKeyEncrypted', 'Chave OpenRouter', data.openrouterApiKeyEncrypted, false, 'password')}
      ${renderSecretHint()}
      ${renderLockedBasePrompt()}
      ${renderTextArea('prompt', 'Prompt editavel do SDR', data.prompt, 10)}
      ${renderTextArea('firstMessagePrompt', 'Prompt da primeira mensagem', data.firstMessagePrompt, 6)}
      ${renderFirstMessageVariables()}
      ${renderTextArea('followupPrompt', 'Prompt de follow-up', data.followupPrompt, 5)}
        `,
        true,
      )}

      ${renderFormSection(
        'WhatsApp e UAZAPI',
        'Conexao da instancia, tokens e numero do SDR.',
        `
      ${renderField('uazapiBaseUrl', 'URL base UAZAPI', data.uazapiBaseUrl)}
      ${renderField('uazapiInstanceId', 'ID ou nome da instancia', data.uazapiInstanceId)}
      ${renderField('whatsappNumber', 'Numero WhatsApp', data.whatsappNumber)}
      ${renderField('uazapiInstanceTokenEncrypted', 'Token da instancia', data.uazapiInstanceTokenEncrypted, false, 'password')}
      ${renderField('uazapiAdminTokenEncrypted', 'Token admin UAZAPI', data.uazapiAdminTokenEncrypted, false, 'password')}
        `,
      )}

      ${renderFormSection(
        'Envio inicial',
        'Janela de envio, dias permitidos, cooldown e limite diario.',
        `
      ${renderField('timezone', 'Timezone', data.timezone, true)}
      ${renderField('sendWindowStart', 'Inicio da janela de envio', data.sendWindowStart, true, 'time')}
      ${renderField('sendWindowEnd', 'Fim da janela de envio', data.sendWindowEnd, true, 'time')}
      ${renderField('sendDaysOfWeek', 'Dias da semana', data.sendDaysOfWeek, true)}
      ${renderField('initialCooldownMinMinutes', 'Cooldown inicial minimo em minutos', data.initialCooldownMinMinutes, true, 'number')}
      ${renderField('initialCooldownMaxMinutes', 'Cooldown inicial maximo em minutos', data.initialCooldownMaxMinutes, true, 'number')}
      ${renderField('dailyInitialSendLimit', 'Limite diario de mensagens iniciais', data.dailyInitialSendLimit, true, 'number')}
        `,
      )}

      ${renderFormSection(
        'Follow-up',
        'Regras para uma tentativa automatica posterior.',
        `
      <div class="field">${renderCheckbox('followupEnabled', 'Follow-up ativo', data.followupEnabled)}</div>
      ${renderField('followupAfterHours', 'Enviar follow-up apos quantas horas', data.followupAfterHours, true, 'number')}
      ${renderField('followupCooldownMinMinutes', 'Cooldown follow-up minimo em minutos', data.followupCooldownMinMinutes, true, 'number')}
      ${renderField('followupCooldownMaxMinutes', 'Cooldown follow-up maximo em minutos', data.followupCooldownMaxMinutes, true, 'number')}
      ${renderField('dailyFollowupSendLimit', 'Limite diario de follow-ups', data.dailyFollowupSendLimit, true, 'number')}
        `,
      )}

      ${renderFormSection(
        'Resposta e handoff',
        'Delay, divisao de mensagens, pausa humana e transferencia.',
        `
      ${renderField('responseDelayBaseMs', 'Delay base da resposta em ms', data.responseDelayBaseMs, true, 'number')}
      ${renderField('responseDelayPerCharMs', 'Delay por caractere em ms', data.responseDelayPerCharMs, true, 'number')}
      ${renderField('responseDelayMaxMs', 'Delay maximo por parte em ms', data.responseDelayMaxMs, true, 'number')}
      ${renderField('messageSplitMaxChars', 'Maximo de caracteres por parte', data.messageSplitMaxChars, true, 'number')}
      ${renderField('humanPauseHours', 'Pausa humana em horas', data.humanPauseHours, true, 'number')}
      ${renderField('handoffName', 'Responsavel humano', data.handoffName)}
      ${renderField('handoffPhone', 'WhatsApp do responsavel humano', data.handoffPhone)}
      ${renderTextArea('handoffMessageTemplate', 'Modelo de mensagem para handoff', data.handoffMessageTemplate, 4)}
        `,
      )}

      <div class="actions">
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
          <form method="post" action="/sdr-agents/${agent.id}/delete" data-inline onsubmit="return confirm('Tem certeza que deseja excluir este SDR?')"><button class="link-button" type="submit">Excluir</button></form>
        </td>
      </tr>`;
    })
    .join('');

  const table = agents.length
    ? `<div class="table-wrap"><table>
      <thead><tr><th>SDR</th><th>Empresa</th><th>IA</th><th>Status</th><th>Acoes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`
    : '<section class="empty-state"><h2>Nenhum SDR cadastrado</h2><p class="muted">Crie um SDR para conectar WhatsApp, IA e regras de envio.</p><a class="button" href="/sdr-agents/new">Novo SDR</a></section>';

  return renderLayout({
    title: 'SDRs - SDR Portal',
    body: `<main class="app-shell">
  <header class="topbar">
    <div>
      <h1>SDRs</h1>
      <p class="muted">Configure agentes, prompts, modelos, WhatsApp e regras de envio.</p>
    </div>
    <div class="actions">
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
