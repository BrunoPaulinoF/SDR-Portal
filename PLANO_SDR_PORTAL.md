# Plano do SDR Portal

## 1. Objetivo

Criar um portal interno para configurar e operar agentes SDR via WhatsApp, usando UAZAPI para conexao/envio/recebimento de mensagens e IA para conduzir conversas comerciais.

O sistema precisa permitir mais de uma empresa, mais de um SDR por empresa, cada SDR com sua propria instancia de WhatsApp, prompt, modelo de IA, horarios, cooldowns, follow-up e regras de atendimento.

O foco principal e a logica operacional. O frontend pode ser simples, leve e funcional.

## 2. Decisoes ja confirmadas

- O sistema sera hospedado em uma VPS pelo EasyPanel.
- O projeto sera versionado no GitHub e o EasyPanel puxara o deploy do repositorio.
- O portal tera login simples com usuario e senha.
- Cada SDR tera seu proprio WhatsApp e sua propria instancia/token da UAZAPI.
- O provedor principal de IA sera OpenAI.
- Tambem deve existir opcao de usar OpenRouter e escolher qualquer modelo disponivel/configurado.
- A transcricao de audio tentara usar a UAZAPI primeiro; se nao funcionar, o sistema deve ter fallback com OpenAI.
- A regra de transparencia sobre IA/automacao sera definida no prompt de cada SDR.
- O follow-up deve acontecer uma unica vez por lead contatado que nao respondeu.
- Se alguem responder manualmente pelo celular, a IA pausa temporariamente por 24 horas para aquele contato e depois pode voltar automaticamente.

## 3. Stack recomendada

### Aplicacao

- Node.js com TypeScript.
- Fastify para API/backend.
- Paginas HTML renderizadas no servidor usando EJS ou template similar.
- CSS simples, sem foco em UI sofisticada.

### Banco e fila

- PostgreSQL.
- Drizzle ORM para schema e migrations.
- pg-boss para fila persistente, agendamentos, retries e jobs em background.

### Bibliotecas previstas

- `xlsx` para importacao de Excel.
- `zod` para validacao de dados.
- `bcrypt` ou `argon2` para senha do portal.
- `pino` para logs estruturados.
- SDK oficial da OpenAI.
- Cliente HTTP simples para UAZAPI.
- Cliente HTTP para OpenRouter.

### Deploy

- Dockerfile.
- `.env.example`.
- Scripts `build`, `start`, `db:migrate`.
- Healthcheck HTTP.

## 4. Estrutura geral do produto

O portal sera composto por estes modulos:

- Autenticacao e usuarios internos.
- Cadastro de empresas.
- Cadastro de SDRs por empresa.
- Configuracao de IA por SDR.
- Configuracao de WhatsApp/UAZAPI por SDR.
- Importacao e CRUD de leads.
- Fila de mensagens iniciais.
- Fila de follow-up.
- Webhook da UAZAPI.
- Historico completo de conversas.
- Human handoff temporario.
- Logs tecnicos e logs de negocio.
- IA auxiliar dentro do portal para criar e ajustar prompts de SDR.
- Monitoramento basico de erros, jobs e eventos.

## 5. Modelo de dados inicial

### `users`

Usuarios que acessam o portal.

Campos principais:

- `id`
- `name`
- `email`
- `password_hash`
- `role`
- `created_at`
- `updated_at`

### `companies`

Empresas/clientes que terao SDRs proprios.

Campos principais:

- `id`
- `name`
- `legal_name`
- `cnpj`
- `segment`
- `description`
- `website_url`
- `default_handoff_name`
- `default_handoff_phone`
- `created_at`
- `updated_at`

### `sdr_agents`

SDRs configuraveis. Uma empresa pode ter varios SDRs.

Campos principais:

- `id`
- `company_id`
- `name`
- `display_name`
- `is_active`
- `product_name`
- `product_description`
- `offer_description`
- `prompt`
- `first_message_prompt`
- `followup_prompt`
- `ai_provider`
- `ai_model`
- `ai_temperature`
- `ai_max_output_tokens`
- `openai_api_key_encrypted`
- `openrouter_api_key_encrypted`
- `uazapi_base_url`
- `uazapi_instance_id`
- `uazapi_instance_token_encrypted`
- `uazapi_admin_token_encrypted`
- `whatsapp_number`
- `timezone`
- `send_window_start`
- `send_window_end`
- `send_days_of_week`
- `initial_cooldown_min_minutes`
- `initial_cooldown_max_minutes`
- `followup_after_hours`
- `followup_cooldown_min_minutes`
- `followup_cooldown_max_minutes`
- `daily_initial_send_limit`
- `daily_followup_send_limit`
- `response_delay_base_ms`
- `response_delay_per_char_ms`
- `response_delay_max_ms`
- `message_split_max_chars`
- `human_pause_hours`
- `created_at`
- `updated_at`

Observacao: o valor padrao de `timezone` deve ser `America/Sao_Paulo`.

### `leads`

Contatos/empresas que serao abordados.

Campos principais:

- `id`
- `company_id`
- `sdr_agent_id`
- `whatsapp_number`
- `cnpj`
- `company_name`
- `trade_name`
- `segment`
- `city`
- `state`
- `contact_name`
- `extra_data`
- `status`
- `source`
- `first_message_sent_at`
- `last_inbound_at`
- `last_outbound_at`
- `followup_due_at`
- `followup_sent_at`
- `followup_disabled_at`
- `human_paused_until`
- `ai_paused_at`
- `ai_pause_reason`
- `handoff_requested_at`
- `handoff_summary`
- `not_interested_at`
- `created_at`
- `updated_at`

Status previstos:

- `pending`
- `researching`
- `ready_to_contact`
- `initial_queued`
- `initial_sent`
- `in_conversation`
- `waiting_reply`
- `followup_queued`
- `followup_sent`
- `transferred`
- `not_interested`
- `human_paused`
- `paused`
- `error`

### `lead_imports`

Controle de importacoes por Excel.

Campos principais:

- `id`
- `company_id`
- `sdr_agent_id`
- `file_name`
- `total_rows`
- `success_rows`
- `error_rows`
- `mapping`
- `errors`
- `created_at`

### `conversations`

Uma conversa por lead e SDR.

Campos principais:

- `id`
- `company_id`
- `sdr_agent_id`
- `lead_id`
- `whatsapp_number`
- `status`
- `last_message_at`
- `created_at`
- `updated_at`

### `messages`

Historico completo das mensagens.

Campos principais:

- `id`
- `conversation_id`
- `lead_id`
- `sdr_agent_id`
- `direction`
- `sender_type`
- `whatsapp_message_id`
- `message_type`
- `text`
- `transcription`
- `media_url`
- `raw_payload`
- `sent_by_api`
- `from_me`
- `created_at`

Valores de `direction`:

- `inbound`
- `outbound`

Valores de `sender_type`:

- `lead`
- `ai`
- `human`
- `system`

### `webhook_events`

Logs brutos de tudo que chega da UAZAPI.

Campos principais:

- `id`
- `sdr_agent_id`
- `event_type`
- `message_type`
- `instance_id`
- `whatsapp_message_id`
- `from_number`
- `to_number`
- `from_me`
- `was_sent_by_api`
- `raw_headers`
- `raw_body`
- `normalized_body`
- `processing_status`
- `processing_error`
- `created_at`

Objetivo: permitir consultar no futuro exatamente como os webhooks chegaram para corrigir parsing, regras e bugs.

### `ai_runs`

Logs de chamadas de IA.

Campos principais:

- `id`
- `sdr_agent_id`
- `lead_id`
- `conversation_id`
- `provider`
- `model`
- `purpose`
- `input_messages`
- `output_text`
- `parsed_json`
- `error`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `latency_ms`
- `created_at`

Valores de `purpose`:

- `first_message_research`
- `first_message_generation`
- `reply_generation`
- `followup_generation`
- `audio_transcription`
- `prompt_assistant`
- `conversation_summary`

### `jobs_log`

Logs de jobs executados pela fila.

Campos principais:

- `id`
- `job_name`
- `job_key`
- `sdr_agent_id`
- `lead_id`
- `status`
- `attempt`
- `payload`
- `result`
- `error`
- `started_at`
- `finished_at`
- `created_at`

### `audit_logs`

Registro de acoes feitas no portal.

Campos principais:

- `id`
- `user_id`
- `entity_type`
- `entity_id`
- `action`
- `before_data`
- `after_data`
- `created_at`

## 6. Cadastro de empresas

O portal precisa ter uma tela para cadastrar empresas.

Cada empresa pode ter varios SDRs.

Cada empresa tera dados institucionais que poderao ser usados pelos prompts dos SDRs.

Campos minimos no MVP:

- Nome da empresa.
- CNPJ.
- Segmento.
- Descricao do negocio.
- Site.
- Nome do responsavel humano padrao.
- WhatsApp do responsavel humano padrao.

## 7. Cadastro e configuracao de SDRs

Cada SDR deve ter uma tela propria com abas simples.

### Aba geral

- Nome interno.
- Nome que sera usado na conversa.
- Empresa vinculada.
- Produto/servico ofertado.
- Descricao da oferta.
- Ativo ou inativo.

### Aba WhatsApp/UAZAPI

- URL base da UAZAPI.
- Token admin, quando necessario.
- Token da instancia.
- ID/nome da instancia.
- Numero do WhatsApp.
- Botao para testar conexao.
- Botao para conectar ou reconectar instancia.
- Visualizacao de status da instancia.

### Aba IA

- Provedor: `openai` ou `openrouter`.
- Modelo: campo livre e/ou select com modelos comuns.
- Chave OpenAI.
- Chave OpenRouter.
- Temperatura.
- Limite de tokens de resposta.
- Prompt principal.
- Prompt da primeira mensagem.
- Prompt de follow-up.
- Botao para testar prompt com uma conversa simulada.

### Aba envio

- Janela de envio por horario.
- Dias da semana permitidos.
- Timezone, padrao `America/Sao_Paulo`.
- Cooldown minimo entre mensagens iniciais.
- Cooldown maximo entre mensagens iniciais.
- Limite diario de mensagens iniciais.
- Ativar/desativar envio automatico.

### Aba follow-up

- Ativar/desativar follow-up.
- Tempo apos primeira mensagem para follow-up.
- Cooldown minimo entre follow-ups.
- Cooldown maximo entre follow-ups.
- Limite diario de follow-ups.
- Prompt do follow-up.

Regra obrigatoria: follow-up so pode ser enviado uma unica vez por lead.

### Aba resposta/buffer

- Tempo base antes de responder.
- Tempo por caractere da resposta.
- Tempo maximo por parte.
- Tamanho maximo de cada parte da mensagem.
- Usar presenca `composing` antes de enviar.

### Aba handoff

- Nome do responsavel humano.
- Numero do responsavel humano.
- Texto/modelo de notificacao para o humano.
- Pausa temporaria em horas, padrao 24h.

## 8. Botao de ativar/desativar SDR

Cada SDR precisa ter um botao claro de `Ativar` ou `Desativar`.

Quando desativado:

- Nao envia novas mensagens iniciais.
- Nao envia follow-ups.
- Nao responde automaticamente webhooks recebidos.
- Continua salvando webhooks e mensagens para auditoria.
- Permite operacao manual e edicao de configuracoes.

Quando ativado:

- Volta a processar filas e webhooks.
- Deve respeitar horarios, cooldowns, pausas e limites diarios.

## 9. Importacao de leads via Excel

O sistema deve aceitar planilha com colunas como:

- `numero_whatsapp`
- `cnpj`
- `nome_empresa`
- `segmento`

Tambem deve aceitar aliases comuns:

- `telefone`
- `whatsapp`
- `celular`
- `cnpj`
- `empresa`
- `razao_social`
- `nome_fantasia`
- `setor`
- `segmento`
- `cidade`
- `estado`

Fluxo:

1. Usuario seleciona empresa e SDR.
2. Usuario envia Excel.
3. Sistema detecta colunas.
4. Usuario confirma mapeamento.
5. Sistema valida telefones e CNPJs.
6. Sistema mostra erros por linha.
7. Sistema importa registros validos.
8. Sistema evita duplicidade por `sdr_agent_id + whatsapp_number`.

## 10. CRUD de leads

Tela simples para:

- Listar leads.
- Filtrar por empresa, SDR, status e segmento.
- Criar lead manualmente.
- Editar lead.
- Excluir lead.
- Pausar/despausar IA para lead.
- Ver historico de conversa.
- Ver logs relacionados.

## 11. Primeira mensagem personalizada com pesquisa web

A primeira mensagem nao deve ser sempre generica.

Antes de enviar para um lead novo, o sistema deve executar um job de preparacao:

1. Ler dados do lead: nome da empresa, CNPJ, segmento, cidade, site e campos extras.
2. Fazer uma pesquisa breve na web quando houver dados suficientes.
3. Extrair sinais simples, como atividade, nicho, localizacao, cardapio/servico, canais publicos ou informacoes institucionais.
4. Salvar resumo da pesquisa e fontes em `lead_research` ou em `extra_data`.
5. Gerar a primeira mensagem com IA usando o prompt do SDR e os dados pesquisados.
6. Se a pesquisa falhar ou demorar, usar fallback apenas com os dados da planilha.

Regras importantes:

- A pesquisa deve ter timeout.
- A mensagem deve ser curta e natural.
- Nao deve inventar informacoes.
- Se nao houver dado confiavel, a IA deve falar de forma mais geral.
- O resultado da pesquisa precisa ficar salvo para auditoria.

Tabela prevista: `lead_research`.

Campos principais:

- `id`
- `lead_id`
- `sdr_agent_id`
- `query`
- `summary`
- `sources`
- `status`
- `error`
- `created_at`

## 12. Fluxo de envio inicial

1. Scheduler procura SDRs ativos.
2. Confere se esta dentro da janela de envio em `America/Sao_Paulo`.
3. Confere limite diario.
4. Busca proximo lead `pending` ou `ready_to_contact`.
5. Se ainda nao houve pesquisa/preparacao, agenda job de pesquisa e geracao da primeira mensagem.
6. Calcula delay aleatorio entre cooldown minimo e maximo.
7. Envia presenca `composing`, se configurado.
8. Envia mensagem via `/send/text` da UAZAPI.
9. Salva mensagem em `messages`.
10. Atualiza lead para `initial_sent` ou `waiting_reply`.
11. Agenda follow-up se estiver ativo.

O sistema nao deve enviar nova mensagem inicial para lead que ja recebeu mensagem.

## 13. Webhook da UAZAPI

Endpoint previsto:

`POST /webhooks/uazapi/:sdrAgentId`

Eventos minimos:

- `messages`
- `connection`

Configuracao recomendada na UAZAPI:

- Usar modo simples do webhook.
- `excludeMessages`: `wasSentByApi` e `isGroupYes`.

Observacao importante:

- Nao excluir `fromMeYes`, porque mensagens enviadas manualmente pelo celular precisam chegar no webhook para ativar pausa temporaria.

Processamento:

1. Salvar payload bruto em `webhook_events` antes de qualquer regra.
2. Normalizar evento.
3. Identificar SDR pela URL/token/instancia.
4. Identificar numero do contato.
5. Criar lead/conversa se nao existir.
6. Salvar mensagem.
7. Se for mensagem manual enviada pelo celular, ativar human pause por 24h.
8. Se for mensagem recebida do lead, cancelar follow-up pendente.
9. Se SDR estiver ativo e lead nao estiver pausado, chamar motor de IA.
10. Registrar resultado, erro ou decisao de nao responder.

## 14. Leads que chamam sem estar na lista

Se alguem chamar o WhatsApp do SDR e nao existir na lista:

1. Criar lead automaticamente com origem `inbound_unknown`.
2. Criar conversa.
3. Salvar mensagem recebida.
4. Usar prompt do SDR para atender normalmente.
5. O lead deve aparecer no portal para edicao/complemento dos dados.

## 15. Historico completo e contexto da IA

O banco deve salvar todo o historico de conversas sem apagar.

Ao chamar a IA:

- Incluir dados da empresa.
- Incluir dados do SDR.
- Incluir dados do lead.
- Incluir pesquisa web salva, se existir.
- Incluir mensagens recentes da conversa.
- Incluir resumo da conversa quando a conversa ficar grande.

Observacao tecnica:

- Nenhum modelo de IA tem contexto infinito real.
- O sistema deve salvar tudo, mas enviar para a IA a maior janela possivel dentro do limite do modelo.
- Quando passar do limite, criar/atualizar resumo da conversa e manter as mensagens mais recentes completas.

## 16. Motor de IA

O motor de IA sera responsavel por:

- Gerar primeira mensagem personalizada.
- Responder leads.
- Gerar follow-up unico.
- Criar resumo para handoff humano.
- Classificar intencoes basicas.
- Decidir acoes como pausar, transferir, desligar follow-up ou marcar sem interesse.

### Provedores suportados

OpenAI:

- Usar SDK oficial.
- Campo `model` configuravel por SDR.
- Exemplos de modelo: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`.

OpenRouter:

- Usar API compativel com chat/completions.
- Campo `model` livre por SDR.
- Exemplo: `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, ou outro disponivel na conta.

### Saida esperada da IA SDR

A IA deve responder em JSON estrito para o backend interpretar.

Formato base previsto:

```json
{
  "mensagem_usuario": "texto para enviar ao lead",
  "nao_responder": false,
  "status_sugerido": "waiting_reply",
  "actions": []
}
```

Acoes previstas:

- `notify_handoff`
- `disable_followup`
- `mark_not_interested`
- `pause_ai`
- `create_conversation_summary`

O backend deve validar o JSON. Se a IA retornar texto invalido, registrar erro e tentar uma correcao automatica uma vez.

## 17. Prompt configuravel por SDR

O portal precisa permitir editar:

- Prompt principal.
- Prompt da primeira mensagem.
- Prompt de follow-up.
- Regras de estilo.
- Regras de transferencia.
- Regras de objeção.
- Regras sobre identidade/IA/automacao.
- Dados do produto/servico.
- FAQ.

O sistema deve envolver o prompt do usuario com um prompt tecnico fixo para garantir:

- JSON valido.
- Respeito ao status do lead.
- Nao responder quando `nao_responder` for verdadeiro.
- Nao inventar dados.
- Acionar acoes esperadas.
- Evitar loop infinito de agradecimentos.

## 18. IA auxiliar de configuracao de prompt dentro do portal

O portal tera uma IA interna focada em ajudar a criar, revisar e ajustar prompts de SDR.

Objetivo:

- Ajudar o usuario a criar prompts melhores.
- Entender o funcionamento tecnico do SDR Portal.
- Explicar quais variaveis podem ser usadas.
- Sugerir etapas de abordagem.
- Ajustar tom de voz.
- Criar FAQ e regras de objeção.
- Revisar o prompt buscando falhas, ambiguidades e riscos.

Capacidades planejadas:

- Ler documentacao interna do projeto.
- Ler estrutura permitida do codigo.
- Consultar exemplos de configuracao.
- Pesquisar brevemente na web sobre o mercado/produto do SDR.
- Pesquisar conceitos de SDR, abordagem comercial, follow-up e qualificacao.
- Gerar prompt final pronto para salvar no SDR.

Limites no MVP:

- A IA auxiliar nao deve editar codigo automaticamente.
- A IA auxiliar pode sugerir alteracoes no prompt e preencher campos mediante confirmacao do usuario.
- Toda interacao deve ser logada em `ai_runs` com `purpose = prompt_assistant`.

Tela prevista:

- Campo de briefing do negocio.
- Campo para objetivo do SDR.
- Campo para tom de voz.
- Campo para publico-alvo.
- Botao `Gerar prompt`.
- Botao `Revisar prompt atual`.
- Botao `Aplicar no SDR`.

## 19. Audio e transcricao

Quando o lead enviar audio:

1. Salvar webhook bruto.
2. Identificar mensagem como audio.
3. Chamar `/message/download` da UAZAPI com `transcribe: true`.
4. Se a UAZAPI retornar transcricao, salvar em `messages.transcription`.
5. Se falhar, baixar audio e transcrever com OpenAI.
6. Salvar erro se ambos falharem.
7. Enviar a transcricao para o motor de IA como mensagem do lead.

## 20. Buffer de resposta e divisao de mensagens

A resposta da IA deve ser dividida em partes curtas.

Configuracoes por SDR:

- `response_delay_base_ms`
- `response_delay_per_char_ms`
- `response_delay_max_ms`
- `message_split_max_chars`

Fluxo:

1. IA gera `mensagem_usuario`.
2. Backend divide a mensagem em partes curtas.
3. Para cada parte, calcula delay: `base + caracteres * ms_por_caractere`.
4. Limita pelo maximo configurado.
5. Envia presenca `composing` via `/message/presence`.
6. Aguarda delay.
7. Envia parte via `/send/text`.
8. Salva cada parte no historico.

## 21. Human handoff temporario

Quando uma mensagem manual for enviada pelo celular no mesmo chat:

1. Detectar pelo webhook como `fromMe = true` e nao enviada pela API.
2. Marcar lead como `human_paused`.
3. Definir `human_paused_until = agora + 24h`, ou valor configurado no SDR.
4. Cancelar/respeitar jobs pendentes de resposta automatica durante esse periodo.
5. Continuar salvando mensagens.
6. Ao vencer o prazo, despausar automaticamente.

Se o humano continuar enviando mensagens, renovar a pausa por mais 24h.

## 22. Transferencia para humano

Quando a IA identificar que precisa transferir:

1. Gerar resumo do lead e da conversa.
2. Enviar mensagem ao responsavel humano configurado.
3. Marcar lead como `transferred`.
4. Desativar follow-up para esse lead.
5. Pausar IA para evitar conflito.

O envio ao responsavel humano pode usar a mesma instancia WhatsApp do SDR via `/send/text`.

## 23. Follow-up unico

Regra principal:

- Cada lead pode receber no maximo um follow-up automatico depois da primeira mensagem.

Fluxo:

1. Apos a primeira mensagem, se follow-up estiver ativo, definir `followup_due_at`.
2. Se o lead responder antes, cancelar follow-up e marcar `followup_disabled_at`.
3. Quando chegar o horario, scheduler verifica janela, cooldown e limite diario.
4. Envia follow-up usando prompt especifico.
5. Define `followup_sent_at`.
6. Nunca agenda outro follow-up para o mesmo lead.

O follow-up nao pode ser enviado para todos ao mesmo tempo. Deve usar fila gradual, cooldown aleatorio e limite diario.

## 24. Horario, cooldown e limites

Todas as rotinas de envio devem respeitar:

- Timezone `America/Sao_Paulo`.
- Janela de envio configurada por SDR.
- Dias da semana permitidos.
- Cooldown minimo e maximo.
- Sorteio aleatorio entre minimo e maximo.
- Limite diario por SDR.
- Status ativo/inativo do SDR.
- Status do lead.
- Pausas manuais ou automaticas.

Se estiver fora da janela, o job deve ser reagendado para a proxima janela valida.

## 25. Logs e observabilidade

Logs sao parte central do projeto.

Precisamos conseguir consultar no futuro:

- Payload bruto de webhook.
- Payload normalizado de webhook.
- Erros de parsing.
- Mensagens enviadas.
- Respostas da UAZAPI.
- Chamadas de IA.
- Prompt usado.
- Modelo usado.
- Tokens e latencia.
- Jobs executados.
- Jobs com erro.
- Alteracoes feitas no portal.
- Motivo de cada pausa/handoff.

Telas previstas:

- Logs de webhook.
- Logs de IA.
- Logs de fila/jobs.
- Logs por lead.
- Logs por SDR.

Politica inicial:

- Salvar logs detalhados no banco.
- Nao salvar chaves/tokens em logs.
- Permitir filtros por data, SDR, lead, evento e status.

## 26. Seguranca

Regras minimas:

- Login obrigatorio no portal.
- Hash de senha.
- Cookies HTTP-only.
- Tokens e chaves criptografados no banco.
- `.env` nunca versionado.
- Webhook com URL dificil e/ou token de assinatura proprio.
- Sanitizar upload de Excel.
- Validar entrada com Zod.
- Nao expor stack trace no frontend.
- Redigir tokens em logs.

## 27. Integracao UAZAPI

Arquivo de documentacao local:

- `uazapi-openapi-spec.yaml`

Endpoints importantes ja identificados:

- `POST /instance/init` para criar instancia.
- `POST /instance/connect` para conectar WhatsApp.
- `GET /instance/status` para consultar status.
- `POST /send/text` para enviar texto.
- `POST /send/media` para enviar midia/audio.
- `POST /message/download` para baixar/transcrever audio.
- `POST /message/presence` para indicar digitando/gravando.
- `POST /webhook` para configurar webhook.

Decisao inicial:

- Para mensagens de SDR, usar envio controlado pelo nosso backend com `/send/text`, nao campanha em massa da UAZAPI.
- Isso permite controlar lead por lead, cooldown, follow-up, handoff, logs e horarios.

## 28. Paginas do portal no MVP

- Login.
- Dashboard simples.
- Empresas.
- Formulario de empresa.
- SDRs.
- Formulario/configuracao de SDR.
- Leads.
- Importar leads.
- Detalhe do lead com conversa.
- Logs de webhook.
- Logs de IA.
- Logs de jobs.
- IA auxiliar de prompt.

## 29. Variaveis de ambiente previstas

```env
NODE_ENV=production
PORT=3000
APP_URL=https://seudominio.com
DATABASE_URL=postgres://user:password@host:5432/db
SESSION_SECRET=trocar
ENCRYPTION_KEY=trocar_com_32_bytes_ou_mais
DEFAULT_TIMEZONE=America/Sao_Paulo
OPENAI_API_KEY=
OPENROUTER_API_KEY=
WEBHOOK_SHARED_SECRET=trocar
LOG_LEVEL=info
```

As chaves globais podem ser usadas como fallback, mas cada SDR tambem podera ter suas proprias chaves.

## 30. Estrutura inicial de pastas

```txt
src/
  app.ts
  server.ts
  config/
  db/
    schema.ts
    migrations/
  modules/
    auth/
    companies/
    sdr-agents/
    leads/
    imports/
    conversations/
    webhooks/
    ai/
    uazapi/
    scheduler/
    logs/
    prompt-assistant/
  views/
  public/
    styles.css
```

## 31. Fases de construcao

### Fase 1 - Base do projeto

Entregas:

- Criar projeto Node.js + TypeScript.
- Configurar Fastify.
- Configurar Dockerfile.
- Configurar `.env.example`.
- Configurar Postgres/Drizzle.
- Criar healthcheck.
- Criar README inicial.

Criterio de aceite:

- App sobe localmente.
- Healthcheck responde.
- Build passa.

### Fase 2 - Autenticacao e layout simples

Entregas:

- Login simples.
- Sessao com cookie seguro.
- Usuario admin inicial via seed ou comando.
- Layout base HTML/CSS.

Criterio de aceite:

- Usuario consegue logar e sair.
- Rotas internas exigem login.

### Fase 3 - Empresas

Entregas:

- CRUD de empresas.
- Auditoria basica de criacao/edicao/exclusao.

Criterio de aceite:

- Criar, editar, listar e excluir empresa.

### Fase 4 - SDRs e configuracoes

Entregas:

- CRUD de SDRs por empresa.
- Botao ativar/desativar.
- Configuracao de prompt.
- Configuracao de IA OpenAI/OpenRouter/modelo.
- Configuracao UAZAPI.
- Configuracao horario/cooldown/follow-up/buffer/handoff.

Criterio de aceite:

- Uma empresa pode ter varios SDRs.
- Cada SDR salva suas configuracoes completas.
- SDR desativado nao processa automacoes.

### Fase 5 - Cliente UAZAPI

Entregas:

- Cliente HTTP para UAZAPI.
- Teste de status da instancia.
- Envio de texto.
- Configuracao de webhook.
- Presenca `composing`.

Criterio de aceite:

- Portal consegue testar conexao e enviar mensagem manual de teste.

### Fase 6 - Leads e importacao Excel

Entregas:

- CRUD de leads.
- Upload Excel.
- Mapeamento de colunas.
- Validacao.
- Relatorio de importacao.
- Prevencao de duplicados.

Criterio de aceite:

- Importar uma planilha e visualizar leads no portal.

### Fase 7 - Fila e scheduler de mensagens iniciais

Entregas:

- Configurar pg-boss.
- Job de selecao de proximo lead.
- Respeitar SDR ativo, horario, cooldown e limite diario.
- Enviar primeira mensagem simples sem pesquisa web ainda.

Criterio de aceite:

- Sistema envia mensagens iniciais aos poucos e marca lead como contatado.

### Fase 8 - Webhook e historico de conversas

Entregas:

- Endpoint de webhook.
- Log bruto em `webhook_events`.
- Normalizacao de mensagens.
- Criacao automatica de lead desconhecido.
- Historico de conversa.
- Cancelamento de follow-up quando lead responde.

Criterio de aceite:

- Mensagens recebidas aparecem no portal com payload bruto consultavel.

### Fase 9 - Motor IA de resposta

Entregas:

- Integracao OpenAI.
- Integracao OpenRouter.
- Escolha de modelo por SDR.
- Prompt principal configuravel.
- Validacao de JSON da IA.
- Logs em `ai_runs`.

Criterio de aceite:

- SDR responde automaticamente uma mensagem recebida respeitando prompt e status.

### Fase 10 - Buffer e divisao de resposta

Entregas:

- Dividir resposta em partes curtas.
- Calcular delay por caractere.
- Enviar presenca antes da mensagem.
- Salvar cada parte enviada.

Criterio de aceite:

- Respostas longas sao enviadas em partes com atraso configuravel.

### Fase 11 - Audio

Status: concluida.

Entregas:

- Detectar audio no webhook.
- Transcrever via UAZAPI.
- Fallback de transcricao via OpenAI.
- Enviar transcricao para IA.

Criterio de aceite:

- Audio recebido vira texto no historico e pode ser respondido pela IA.

### Fase 12 - Follow-up unico

Status: concluida.

Entregas:

- Agendamento apos primeira mensagem.
- Envio unico por lead.
- Respeitar horario, cooldown e limite diario.
- Cancelar se houver resposta.
- Desligar definitivamente apos enviar.

Criterio de aceite:

- Lead sem resposta recebe apenas um follow-up.

### Fase 13 - Human handoff temporario

Status: concluida.

Entregas:

- Detectar mensagem manual enviada pelo celular.
- Pausar IA por 24h ou valor configurado.
- Renovar pausa se humano continuar falando.
- Despausar automaticamente ao vencer.

Criterio de aceite:

- IA nao interfere enquanto humano esta conversando.

### Fase 14 - Transferencia para humano

Status: concluida.

Entregas:

- Acao `notify_handoff` da IA.
- Resumo do lead/conversa.
- Envio de mensagem ao responsavel humano.
- Marcar lead como transferido.
- Desativar follow-up.

Criterio de aceite:

- Quando a IA decide transferir, o humano recebe resumo e o lead para de receber automacoes.

### Fase 15 - Primeira mensagem com pesquisa web

Status: concluida.

Entregas:

- Job de pesquisa breve por lead.
- Salvamento de fontes/resumo.
- Geracao de primeira mensagem personalizada.
- Fallback sem pesquisa.

Criterio de aceite:

- Primeira mensagem usa dados reais encontrados ou fallback seguro.

### Fase 16 - IA auxiliar de prompt

Status: concluida.

Entregas:

- Tela de IA auxiliar.
- Geracao de prompt com base em briefing.
- Revisao do prompt atual.
- Pesquisa web opcional.
- Aplicar prompt no SDR mediante confirmacao.

Criterio de aceite:

- Usuario consegue gerar/revisar prompt pelo portal e salvar no SDR.

### Fase 17 - Logs e telas de diagnostico

Status: concluida.

Entregas:

- Tela de logs de webhook.
- Tela de logs de IA.
- Tela de jobs.
- Tela de logs por lead.
- Filtros basicos.

Criterio de aceite:

- E possivel diagnosticar erro olhando payload bruto, chamada IA e job correspondente.

### Fase 18 - Deploy EasyPanel

Status: concluida.

Entregas:

- Dockerfile final.
- README de deploy.
- Configuracao de variaveis.
- Comando de migration.
- Preparacao para GitHub.

Criterio de aceite:

- Projeto roda no EasyPanel com Postgres e URL publica para webhook.

## 32. Ordem sugerida para desenvolvimento

Prioridade pratica:

1. Base + banco + login.
2. Empresas + SDRs.
3. UAZAPI + leads + importacao.
4. Scheduler inicial.
5. Webhook + historico.
6. IA de resposta.
7. Follow-up + handoff.
8. Audio + pesquisa web.
9. IA auxiliar de prompt.
10. Logs finais + deploy.

## 33. Riscos conhecidos

- Formato real dos webhooks pode variar; por isso salvar payload bruto e essencial.
- WhatsApp pode bloquear comportamento agressivo; por isso cooldown, janela, limite diario e follow-up unico sao obrigatorios.
- UAZAPI pode falhar em transcricao; por isso fallback OpenAI.
- Modelos de IA podem retornar JSON invalido; por isso validar e registrar erro.
- Pesquisa web pode trazer dados errados; por isso usar timeout, fontes e regra de nao inventar.
- Contexto infinito nao existe; por isso salvar tudo no banco e usar resumo quando necessario.
- EasyPanel precisa de URL publica HTTPS estavel para webhooks.

## 34. Pendencias para decidir durante a implementacao

- Nome oficial do projeto/repositorio.
- Modelos padrao OpenAI e OpenRouter.
- Limite diario padrao de mensagens por SDR.
- Cooldown padrao minimo e maximo.
- Janela padrao de envio.
- Texto padrao do follow-up.
- Formato exato da mensagem enviada ao humano no handoff.
- Se o portal tera apenas um usuario admin ou varios usuarios internos.
- Qual servico/ferramenta sera usado para pesquisa web em producao.
