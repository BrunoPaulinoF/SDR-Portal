import type { Company, SdrAgent } from '../../db/schema.js';
import { lockedBasePromptPreview } from '../ai/sdr-base-prompt.js';
import { DEFAULT_SDR_PLAYBOOK, SDR_PLAYBOOK_LABELS, SDR_PLAYBOOKS, resolveSdrPlaybook } from '../ai/sdr-playbooks.js';
import { DEFAULT_LEAD_QUALIFICATION_PROMPT } from '../leads/lead-qualification-prompt.js';
import { reasoningEffortCatalogJson, reasoningEffortOptions } from '../ai/reasoning-effort.js';
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
  leadQualificationPrompt: string;
  followupPrompt: string;
  bumpPrompt: string;
  playbook: string;
  aiProvider: string;
  aiModel: string;
  aiTemperature: string;
  aiMaxOutputTokens: string;
  aiReasoningEffort: string;
  openaiApiKeyEncrypted: string;
  openrouterApiKeyEncrypted: string;
  deepseekApiKeyEncrypted: string;
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
  handoffName: string;
  handoffPhone: string;
  handoffMessageTemplate: string;
  demoContactName: string;
  demoContactPhone: string;
}

const exampleProductDescription = `Direcionamento estrategico gratuito com o Igor Moscheto, consultor empresarial senior da Kybernan Consultoria.

O telefonema e voltado para empresarios que querem ganhar clareza sobre crescimento, profissionalizar a gestao e reduzir a dependencia do dono no operacional.

O Igor usa sua experiencia com grandes corporacoes, empresas familiares e pequenos negocios para entender o momento atual da empresa e indicar um proximo passo estrategico.`;

const exampleOfferDescription = `Oferecemos um telefonema inicial gratuito com o Igor Moscheto para entender o momento da empresa e entregar um direcionamento estrategico.

A conversa inicial deve identificar se o lead vive gargalos de planejamento, crescimento desordenado, excesso de operacional ou dificuldade de fazer a empresa andar com mais autonomia.

Nao fale em agenda ou horarios. Se o lead demonstrar interesse, conduza para aceitar receber um telefonema do Igor ou do time para alinhar o melhor momento.`;

const exampleMainPrompt = `Voce e a Kyane, Head de Growth e Qualificacao da Kybernan Consultoria.

Objetivo:
Conversar com donos, socios e responsaveis por empresas para entender se existe dor relacionada a crescimento, falta de planejamento, excesso de operacional ou dependencia do dono.

Seu objetivo e conduzir a conversa ate o lead aceitar receber um telefonema do Igor Moscheto para um direcionamento estrategico inicial.

Etapas da conversa:
Na etapa permission, valide a abertura do lead e peca permissao para fazer uma pergunta simples sobre a empresa. Nao ofereca telefonema ainda.
Na etapa discovery, faca perguntas consultivas para entender crescimento, gestao, excesso de operacional, dependencia do dono ou falta de clareza estrategica. Faca uma pergunta por vez.
Na etapa solution, valide a dor com empatia e explique que a Kybernan ajuda empresarios a organizar crescimento, clarear prioridades e tomar decisoes melhores por meio de mentoria e direcionamento estrategico.
Na etapa handoff_offer, se o lead demonstrar interesse, duvida especifica ou necessidade clara, ofereca um telefonema inicial gratuito com o Igor Moscheto, consultor empresarial senior da Kybernan, para entender o cenario e indicar um proximo passo.
Na etapa handoff_done, se o handoff ja foi feito, responda apenas para esclarecer ou tranquilizar. Nao insista, nao tente vender de novo e nao force continuidade.
Na etapa not_interested, agradeca uma vez, deseje sucesso e pare de insistir.

Regras comerciais:
Fale como uma pessoa real no WhatsApp, com mensagens curtas e naturais.
Valide o que o lead disser antes de avancar.
Faca uma pergunta por vez.
Nao pressione o lead.
Nao fale em agenda, reuniao marcada ou horarios disponiveis.
Se perguntarem preco, explique que o telefonema inicial nao tem custo e que proposta comercial so faz sentido depois que o Igor entender o cenario.
Se o lead demonstrar interesse, diga que o Igor ou alguem do time pode ligar para alinhar o melhor momento.
Se o lead disser que nao tem interesse, agradeca e encerre sem insistir, usando mark_not_interested e disable_followup.
Se acionar handoff, use notify_handoff com um resumo objetivo do que o lead disse.

Tom:
Profissional, maduro, direto, consultivo e humano. Use emojis com moderacao, apenas quando fizer sentido.`;

const exampleFirstMessagePrompt = `Crie uma primeira abordagem curta para {{companyName}}.

Contexto disponivel:
- Segmento: {{segment}}
- Produto: {{productName}}
- Pesquisa sobre o lead: {{researchSummary}}

Regras:
Seja natural, consultiva e humana.
Apresente-se como Kyane, da Kybernan Consultoria.
Use o contexto do lead para criar conexao sem parecer mensagem em massa.
Nao ofereca o telefonema logo na primeira frase.
Nao fale preco.
Faca apenas uma pergunta simples para iniciar a conversa.
Use no maximo 2 paragrafos curtos.`;

const exampleFollowupPrompt = `Crie um follow-up curto e educado para um lead que ja respondeu e precisa de retomada.

Regras:
Nao cobre resposta de forma agressiva.
Retome o contexto de crescimento, gestao e clareza estrategica de forma leve.
Nao fale em agenda ou horarios.
Faca uma pergunta simples.
Use no maximo 2 paragrafos curtos.`;

const exampleBumpPrompt = `Crie um segundo toque curto para um lead que nunca respondeu a primeira mensagem.

Regras:
Nao repita a primeira mensagem nem refaca a mesma pergunta com outras palavras.
Diga em uma frase concreta do que se trata.
Nao cobre a resposta que nao veio.
Termine com uma pergunta facil de responder.
Use no maximo 2 linhas curtas.`;

const exampleHandoffTemplate = `Novo lead interessado em telefonema com o Igor.

SDR: {{sdrName}}
Lead: {{companyName}}
WhatsApp: {{whatsappNumber}}
Produto: {{productName}}
Resumo: {{summary}}`;

const fieldHelp: Partial<Record<keyof SdrAgentFormData, string>> = {
  aiMaxOutputTokens: 'Limite aproximado de tokens que a IA pode gerar. Para WhatsApp, 800 a 2000 costuma ser suficiente; modelos reasoning podem usar mais internamente.',
  aiReasoningEffort: 'Quanto o modelo raciocina antes de responder. Cada provedor tem a sua escala, entao as opcoes mudam junto com o provedor: DeepSeek usa low/high/max (padrao high), a OpenAI usa minimal/low/medium/high (xhigh e max so em modelos 5.6+) e o OpenRouter repassa a escala do modelo. Deixe em "Padrao do modelo" para nao enviar o parametro. Mais esforco custa mais tokens e demora mais.',
  aiModel: 'Modelo usado por este SDR. Padrao: deepseek-v4-pro (via API direta da DeepSeek, custo baixo e cache automatico). Pode trocar por outro modelo compativel quando quiser.',
  aiProvider: 'Escolha onde a IA sera chamada. DeepSeek usa a API oficial da DeepSeek (recomendado). OpenAI usa sua chave OpenAI; OpenRouter usa sua chave OpenRouter.',
  aiTemperature: 'Controla variacao/criatividade. Para SDR, valores baixos como 0.3 a 0.6 tendem a ser mais consistentes. Modelos com raciocinio ligado (como o deepseek-v4-pro) ignoram este campo.',
  dailyFollowupSendLimit: 'Maximo de follow-ups enviados por este SDR em um dia.',
  dailyInitialSendLimit: 'Maximo de primeiras mensagens enviadas por este SDR em um dia.',
  displayName: 'Nome que a IA usa ao se apresentar na conversa. Ex: Kyane.',
  playbook: 'Estrategia de conversa. Consultivo: a IA diz do que se trata, entende a rotina do lead e so depois chama o humano. Convite: a IA nao apresenta o produto, so gera curiosidade e passa o lead para o humano no primeiro sim.',
  leadQualificationPrompt: 'Prompt usado antes da primeira mensagem para decidir se o lead deve ser abordado ou descartado. A IA deve retornar qualified=false apenas quando houver baixo fit claro.',
  followupAfterHours: 'Quantidade de horas apos a primeira mensagem para tentar o follow-up unico, somente se o lead ja respondeu.',
  followupCooldownMaxMinutes: 'Intervalo maximo entre follow-ups automaticos.',
  followupCooldownMinMinutes: 'Intervalo minimo entre follow-ups automaticos.',
  followupEnabled: 'Quando ativo, o sistema tenta enviar um unico follow-up somente para leads que ja responderam.',
  followupPrompt: 'Instrucao usada pela IA para criar o follow-up de quem respondeu e esfriou. O sistema nao envia este texto literalmente.',
  bumpPrompt: 'Instrucao do segundo toque em quem nunca respondeu a abordagem. Deixe vazio para usar o prompt de follow-up tambem nesse caso.',
  handoffMessageTemplate: 'Mensagem enviada ao responsavel humano quando a IA solicita transferencia.',
  demoContactName: 'Nome que aparece no cartao de contato que a IA envia para o lead testar (deixe vazio para desativar).',
  demoContactPhone: 'WhatsApp que vai dentro do cartao de contato, com DDI e DDD. Ex.: 5519997353221.',
  handoffName: 'Nome do responsavel ou time que recebe handoffs.',
  handoffPhone: 'WhatsApp que recebera avisos de transferencia para humano.',
  initialCooldownMaxMinutes: 'Tempo maximo aleatorio entre primeiras mensagens.',
  initialCooldownMinMinutes: 'Tempo minimo aleatorio entre primeiras mensagens para evitar disparos muito proximos.',
  messageSplitMaxChars: 'Tamanho maximo de cada parte quando a resposta for dividida em varias mensagens.',
  name: 'Nome interno para organizacao. Nao precisa ser o nome que aparece para o lead.',
  offerDescription: 'Explique a oferta comercial, promessa, diferenciais e quando chamar humano.',
  openaiApiKeyEncrypted: 'Chave OpenAI especifica deste SDR. Preencha apenas se usar provider OpenAI. Se ficar vazio, usa a chave global do ambiente quando existir.',
  openrouterApiKeyEncrypted: 'Chave OpenRouter especifica deste SDR. Preencha apenas se usar provider OpenRouter. Se ficar vazio, usa a chave global do ambiente quando existir.',
  deepseekApiKeyEncrypted: 'Chave DeepSeek especifica deste SDR. Preencha apenas se usar provider DeepSeek. Se ficar vazio, usa a chave global do ambiente quando existir.',
  productDescription: 'Descreva o produto/servico para a IA entender o que vende, para quem vende e os diferenciais.',
  productName: 'Nome curto do produto ou servico. Ex: Direcionamento estrategico com Igor Moscheto.',
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
  leadQualificationPrompt: DEFAULT_LEAD_QUALIFICATION_PROMPT,
  followupPrompt: exampleFollowupPrompt,
  bumpPrompt: exampleBumpPrompt,
  playbook: DEFAULT_SDR_PLAYBOOK,
  aiProvider: 'deepseek',
  aiModel: 'deepseek-v4-pro',
  aiTemperature: '0.4',
  aiMaxOutputTokens: '800',
  aiReasoningEffort: 'default',
  openaiApiKeyEncrypted: '',
  openrouterApiKeyEncrypted: '',
  deepseekApiKeyEncrypted: '',
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
  dailyInitialSendLimit: '25',
  dailyFollowupSendLimit: '50',
  responseDelayBaseMs: '1200',
  responseDelayPerCharMs: '35',
  responseDelayMaxMs: '12000',
  messageSplitMaxChars: '450',
  handoffName: '',
  handoffPhone: '',
  handoffMessageTemplate: exampleHandoffTemplate,
  demoContactName: '',
  demoContactPhone: '',
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
    leadQualificationPrompt: agent.leadQualificationPrompt ?? DEFAULT_LEAD_QUALIFICATION_PROMPT,
    followupPrompt: agent.followupPrompt ?? '',
    bumpPrompt: agent.bumpPrompt ?? '',
    playbook: resolveSdrPlaybook(agent.playbook),
    aiProvider: agent.aiProvider,
    aiModel: agent.aiModel,
    aiTemperature: String(agent.aiTemperature),
    aiMaxOutputTokens: String(agent.aiMaxOutputTokens),
    aiReasoningEffort: agent.aiReasoningEffort,
    openaiApiKeyEncrypted: '',
    openrouterApiKeyEncrypted: '',
    deepseekApiKeyEncrypted: '',
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
    handoffName: agent.handoffName ?? '',
    handoffPhone: agent.handoffPhone ?? '',
    handoffMessageTemplate: agent.handoffMessageTemplate ?? '',
    demoContactName: agent.demoContactName ?? '',
    demoContactPhone: agent.demoContactPhone ?? '',
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
  const providers = ['deepseek', 'openai', 'openrouter'];
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

function renderReasoningEffortSelect(provider: string, selected: string): string {
  const options = reasoningEffortOptions(provider)
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');

  // Cada provider tem a sua escala, entao as opcoes trocam junto com o provedor escolhido.
  return `<div class="field">
    ${renderLabel('aiReasoningEffort', 'Esforco de raciocinio')}
    <select id="aiReasoningEffort" name="aiReasoningEffort" required>${options}</select>
    <script>
      (function () {
        var catalogo = ${reasoningEffortCatalogJson()};
        var provedor = document.getElementById('aiProvider');
        var esforco = document.getElementById('aiReasoningEffort');
        if (!provedor || !esforco) return;
        provedor.addEventListener('change', function () {
          var anterior = esforco.value;
          var lista = catalogo[provedor.value] || [];
          esforco.innerHTML = '';
          lista.forEach(function (item) {
            var opcao = document.createElement('option');
            opcao.value = item.value;
            opcao.textContent = item.label;
            if (item.value === anterior) opcao.selected = true;
            esforco.appendChild(opcao);
          });
          // Nivel que nao existe na escala nova volta para o padrao do modelo.
          if (!lista.some(function (item) { return item.value === anterior; })) esforco.value = 'default';
        });
      })();
    </script>
  </div>`;
}

function renderSecretHint(): string {
  return '<p class="muted field-full">Campos de chave/token ficam em branco na edicao. Preencha apenas quando quiser substituir o valor salvo.</p>';
}

function renderPlaybookSelect(selected: string): string {
  const options = SDR_PLAYBOOKS.map(
    (playbook) =>
      `<option value="${playbook}"${playbook === selected ? ' selected' : ''}>${escapeHtml(SDR_PLAYBOOK_LABELS[playbook])}</option>`,
  ).join('');

  return `<div class="field field-full">
    ${renderLabel('playbook', 'Playbook de conversa')}
    <select id="playbook" name="playbook" required>${options}</select>
  </div>`;
}

function renderLockedBasePrompt(playbook: string): string {
  return `<div class="field field-full locked-prompt">
    <div class="locked-prompt-header">
      <label>Instrucoes fixas do SDR</label>
      <span>Nao editavel</span>
    </div>
    <p class="muted">Estas regras sempre sao enviadas para a IA, junto com o funil do playbook selecionado acima. Salve para ver o texto do outro playbook. Use o prompt editavel abaixo apenas para produto, publico, tom e regras comerciais especificas.</p>
    <pre>${escapeHtml(lockedBasePromptPreview(playbook))}</pre>
  </div>`;
}


/**
 * Estado da conexao no topo da secao de WhatsApp. No SDR novo nao ha instancia nem id,
 * entao mostra so a explicacao de que o portal vai criar uma.
 */
function renderConnectionSummary(agent?: SdrAgent): string {
  if (!agent) {
    return `<div class="connection-summary field-full">
      <p><strong>Instancia ainda nao criada.</strong></p>
      <p class="muted">Ao salvar, o portal cria a instancia na UAZAPI e leva voce direto para a tela do QR code.</p>
    </div>`;
  }

  if (!agent.uazapiBaseUrl || !agent.uazapiInstanceTokenEncrypted) {
    return `<div class="connection-summary field-full">
      <p><strong>Sem instancia configurada.</strong></p>
      <p class="muted">Preencha a configuracao manual abaixo, ou crie um SDR novo para o portal provisionar sozinho.</p>
    </div>`;
  }

  return `<div class="connection-summary field-full">
    <p><strong>Instancia:</strong> ${escapeHtml(agent.uazapiInstanceId ?? 'sem identificador')}</p>
    <p class="muted">Para ler o QR code ou mandar o link de conexao para outra pessoa, use o botao abaixo.</p>
    <a class="button" href="/sdr-agents/${agent.id}/conectar">Conectar / ver QR code</a>
  </div>`;
}

function renderFormSection(title: string, description: string, content: string, open = false): string {
  return `<details class="form-section"${open ? ' open' : ''}>
    <summary>${escapeHtml(title)}<span>${escapeHtml(description)}</span></summary>
    <div class="form-section-body"><div class="form-grid">${content}</div></div>
  </details>`;
}

function renderFlowSection(step: number, title: string, description: string, content: string, open = false): string {
  return `<details class="form-section form-section-flow"${open ? ' open' : ''}>
    <summary><span class="flow-badge">${step}</span>${escapeHtml(title)}<span>${escapeHtml(description)}</span></summary>
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
        'Modelo de IA',
        'Provedor, modelo, temperatura e chaves de API usadas por este SDR.',
        `
      ${renderProviderSelect(data.aiProvider)}
      ${renderField('aiModel', 'Modelo', data.aiModel, true)}
      ${renderField('aiTemperature', 'Temperatura', data.aiTemperature, true, 'number')}
      ${renderField('aiMaxOutputTokens', 'Maximo de tokens de saida', data.aiMaxOutputTokens, true, 'number')}
      ${renderReasoningEffortSelect(data.aiProvider, data.aiReasoningEffort)}
      ${renderField('deepseekApiKeyEncrypted', 'Chave DeepSeek', data.deepseekApiKeyEncrypted, false, 'password')}
      ${renderField('openaiApiKeyEncrypted', 'Chave OpenAI', data.openaiApiKeyEncrypted, false, 'password')}
      ${renderField('openrouterApiKeyEncrypted', 'Chave OpenRouter', data.openrouterApiKeyEncrypted, false, 'password')}
      ${renderSecretHint()}
        `,
        true,
      )}

      <p class="flow-intro">Fluxo de conversa do SDR: os 3 prompts abaixo seguem a ordem em que a IA realmente os usa. A primeira mensagem enviada ao lead e configurada na tela <a href="/sdr-agents">Msg inicial</a>.</p>

      ${renderFlowSection(
        1,
        'Qualificacao do lead',
        'Roda antes da primeira mensagem e decide se este lead deve ser abordado ou descartado.',
        `
      ${renderTextArea('leadQualificationPrompt', 'Prompt de qualificacao e descarte do lead', data.leadQualificationPrompt, 10)}
        `,
        true,
      )}

      ${renderFlowSection(
        2,
        'Conversa principal',
        'Conduz o restante da conversa depois que o lead responde: persona, tom, objecoes e regras comerciais.',
        `
      ${renderPlaybookSelect(data.playbook)}
      ${renderLockedBasePrompt(data.playbook)}
      ${renderTextArea('prompt', 'Prompt editavel do SDR', data.prompt, 10)}
        `,
        true,
      )}

      ${renderFlowSection(
        3,
        'Follow-up',
        'Escreve a unica mensagem de volta: retomada para quem respondeu e sumiu, segundo toque para quem nunca respondeu.',
        `
      ${renderTextArea('followupPrompt', 'Prompt de follow-up (quem respondeu e esfriou)', data.followupPrompt, 5)}
      ${renderTextArea('bumpPrompt', 'Prompt do segundo toque (quem nunca respondeu)', data.bumpPrompt, 5)}
        `,
      )}

      ${renderFormSection(
        'WhatsApp',
        'Conexao da instancia usada por este SDR.',
        `
      ${renderConnectionSummary(agent)}
      ${renderField('whatsappNumber', 'Numero WhatsApp', data.whatsappNumber)}
      <details class="advanced-block field-full">
        <summary>Configuracao manual da instancia (avancado)</summary>
        <p class="muted">So use se precisar apontar este SDR para uma instancia que ja existe, ou trocar um token expirado. Ao criar um SDR novo o portal cuida disso sozinho.</p>
        ${renderField('uazapiBaseUrl', 'URL base UAZAPI', data.uazapiBaseUrl)}
        ${renderField('uazapiInstanceId', 'ID ou nome da instancia', data.uazapiInstanceId)}
        ${renderField('uazapiInstanceTokenEncrypted', 'Token da instancia', data.uazapiInstanceTokenEncrypted, false, 'password')}
        ${renderField('uazapiAdminTokenEncrypted', 'Token admin UAZAPI', data.uazapiAdminTokenEncrypted, false, 'password')}
      </details>
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
        'Regras de envio do follow-up',
        'Quando e com que frequencia a tentativa automatica de follow-up pode ser enviada.',
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
        'Delay, divisao de mensagens, transferencia e contato de demonstracao. A pausa da IA e liberada em Conversas.',
        `
      ${renderField('responseDelayBaseMs', 'Delay base da resposta em ms', data.responseDelayBaseMs, true, 'number')}
      ${renderField('responseDelayPerCharMs', 'Delay por caractere em ms', data.responseDelayPerCharMs, true, 'number')}
      ${renderField('responseDelayMaxMs', 'Delay maximo por parte em ms', data.responseDelayMaxMs, true, 'number')}
      ${renderField('messageSplitMaxChars', 'Maximo de caracteres por parte', data.messageSplitMaxChars, true, 'number')}
      ${renderField('handoffName', 'Responsavel humano', data.handoffName)}
      ${renderField('handoffPhone', 'WhatsApp do responsavel humano', data.handoffPhone)}
      ${renderTextArea('handoffMessageTemplate', 'Modelo de mensagem para handoff', data.handoffMessageTemplate, 4)}
      ${renderField('demoContactName', 'Nome do contato de demonstracao', data.demoContactName)}
      ${renderField('demoContactPhone', 'WhatsApp do contato de demonstracao', data.demoContactPhone)}
        `,
      )}

      <div class="actions">
        <button type="submit">Salvar SDR</button>
        <a class="button button-secondary" href="/sdr-agents">Cancelar</a>
      </div>
    </form>`;
}

export function renderSdrAgentsListPage(
  agents: SdrAgent[],
  companies: Company[],
  error?: string,
  /** SDR cuja exclusao falhou: ganha a opcao de sair do portal sem apagar a instancia. */
  failedDeleteAgentId?: string,
): string {
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
          <a href="/sdr-agents/${agent.id}/first-messages">Msg inicial</a>
          <a href="/sdr-agents/${agent.id}/conectar">Conectar</a>
          <form method="post" action="/sdr-agents/${agent.id}/toggle" data-inline><button class="link-button" type="submit">${toggleLabel}</button></form>
          <form method="post" action="/sdr-agents/${agent.id}/delete" data-inline onsubmit="return confirm('Excluir este SDR? A instancia dele na UAZAPI tambem sera apagada.')"><button class="link-button" type="submit">Excluir</button></form>
          ${
            agent.id === failedDeleteAgentId
              ? `<form method="post" action="/sdr-agents/${agent.id}/delete" data-inline onsubmit="return confirm('Excluir so do portal? A instancia continua na UAZAPI e precisara ser apagada por la.')"><input type="hidden" name="manterInstancia" value="1"><button class="link-button link-danger" type="submit">Excluir sem apagar a instancia</button></form>`
              : ''
          }
        </td>
      </tr>`;
    })
    .join('');

  const errorHtml = error ? `<div class="alert-error">${escapeHtml(error)}</div>` : '';
  const table = agents.length
    ? `${errorHtml}<div class="table-wrap"><table>
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
      <a class="button" href="/sdr-agents/${agent.id}/conectar">Conectar / ver QR code</a>
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
