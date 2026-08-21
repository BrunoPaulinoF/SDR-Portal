# SDR Portal

Portal interno para operar agentes SDR via WhatsApp usando UAZAPI e IA.

O planejamento completo esta em `PLANO_SDR_PORTAL.md`.

## Stack inicial

- Node.js 22+
- TypeScript
- Fastify
- PostgreSQL
- Drizzle ORM
- pg-boss
- Docker

## Setup local

1. Instale dependencias:

```bash
npm install
```

2. Copie as variaveis de ambiente:

```bash
cp .env.example .env
```

3. Ajuste `DATABASE_URL` no `.env`.

Tambem ajuste `SESSION_SECRET` e `ENCRYPTION_KEY` com valores longos e seguros. A `ENCRYPTION_KEY` e usada para criptografar chaves de IA e tokens da UAZAPI salvos nos SDRs.

4. Gere e aplique migrations quando o banco estiver configurado:

```bash
npm run db:generate
npm run build
npm run db:migrate
```

5. Crie o usuario admin inicial:

```bash
ADMIN_NAME=Admin ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=senha_segura npm run admin:create
```

No Windows PowerShell:

```powershell
$env:ADMIN_NAME="Admin"; $env:ADMIN_EMAIL="admin@example.com"; $env:ADMIN_PASSWORD="senha_segura"; npm run admin:create
```

6. Rode em desenvolvimento:

```bash
npm run dev
```

7. Teste o healthcheck:

```bash
curl http://localhost:3000/health
```

## Scripts

- `npm run dev`: inicia servidor em modo watch.
- `npm run build`: compila TypeScript.
- `npm run start`: inicia aplicacao compilada.
- `npm run lint`: executa ESLint.
- `npm test`: executa testes.
- `npm run db:generate`: gera migrations do Drizzle.
- `npm run db:migrate`: aplica migrations compiladas.
- `npm run admin:create`: cria o usuario admin inicial usando `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
- `npm run sdr:prompts -- --agent="<id ou nome>"`: mostra o que os prompts versionados em `docs/prompts/<sdr>/` mudariam no SDR; com `--apply` grava (prompts, playbook e mensagem inicial fixa). Opcoes: `--dir`, `--playbook`.

## Portal

Rotas iniciais:

- `GET /login`: tela de login.
- `POST /login`: autentica usuario.
- `GET /dashboard`: painel interno protegido.
- `POST /logout`: encerra sessao.

Rotas de empresas:

- `GET /companies`: lista empresas.
- `GET /companies/new`: formulario de nova empresa.
- `POST /companies`: cria empresa.
- `GET /companies/:id/edit`: formulario de edicao.
- `POST /companies/:id`: atualiza empresa.
- `POST /companies/:id/delete`: exclui empresa.

Rotas de SDRs:

- `GET /sdr-agents`: lista SDRs.
- `GET /sdr-agents/new`: formulario de novo SDR.
- `POST /sdr-agents`: cria SDR.
- `GET /sdr-agents/:id/edit`: formulario de edicao.
- `POST /sdr-agents/:id`: atualiza SDR.
- `POST /sdr-agents/:id/toggle`: ativa ou desativa SDR.
- `POST /sdr-agents/:id/delete`: exclui SDR.

Rotas UAZAPI por SDR:

- `POST /sdr-agents/:id/uazapi/status`: testa status da instancia.
- `POST /sdr-agents/:id/uazapi/configure-webhook`: configura webhook da instancia usando `APP_URL`.
- `POST /sdr-agents/:id/uazapi/send-test`: envia mensagem de teste via `/send/text` com presenca `composing` antes do envio.

Para configurar webhook automaticamente, defina `APP_URL` com a URL publica HTTPS do EasyPanel. O webhook gerado segue o formato `/webhooks/uazapi/:sdrAgentId` e usa `WEBHOOK_SHARED_SECRET` como query string quando configurado.

Rotas de leads:

- `GET /leads`: lista leads.
- `GET /leads/new`: formulario de novo lead.
- `POST /leads`: cria lead.
- `GET /leads/:id/edit`: formulario de edicao.
- `POST /leads/:id`: atualiza lead.
- `POST /leads/:id/delete`: exclui lead.
- `GET /leads/import`: formulario de importacao Excel.
- `POST /leads/import`: importa arquivo `.xlsx`.

Colunas aceitas na importacao:

- WhatsApp: `numero_whatsapp`, `numero do whatsapp`, `whatsapp`, `telefone`, `celular`.
- Empresa: `nome_empresa`, `nome da empresa`, `empresa`, `razao_social`.
- Opcionais: `cnpj`, `nome_fantasia`, `segmento`, `cidade`, `estado`, `contato`.

Scheduler de mensagens iniciais:

- `POST /scheduler/initial-outreach/run`: executa manualmente uma rodada do disparo inicial.
- `SCHEDULER_ENABLED=true`: ativa o worker pg-boss em producao.
- `INITIAL_OUTREACH_CRON`: cron da rodada automatica, padrao `* * * * *`.
- `FOLLOWUP_CRON`: cron da rodada automatica de follow-up, padrao `*/5 * * * *`.
- `PENDING_REPLY_CRON`: cron da varredura de respostas pendentes, padrao `*/5 * * * *`.
- `PENDING_REPLY_AFTER_MS`: silencio tolerado antes de considerar a resposta perdida, padrao `180000` (3 min).
- `PENDING_REPLY_WINDOW_HOURS`: idade maxima da conversa que ainda recebe resposta atrasada, padrao `24`.
- `WEB_RESEARCH_ENDPOINT`: endpoint opcional para pesquisa/enriquecimento web antes da primeira mensagem.
- `WEB_RESEARCH_API_KEY`: token opcional enviado como `Bearer` para o endpoint de pesquisa.
- `WEB_RESEARCH_TIMEOUT_MS`: timeout da pesquisa web, padrao `8000`.

Regras atuais do disparo inicial:

- Processa apenas SDR ativo.
- Respeita timezone, dias da semana e janela de envio do SDR.
- Respeita limite diario de mensagens iniciais.
- Respeita cooldown minimo/maximo configurado.
- Seleciona apenas leads `pending`.
- Antes do envio, tenta pesquisar/enriquecer o lead e salva resultado em `lead_research`.
- Se houver resumo de pesquisa, `{{researchSummary}}` e `{{researchSources}}` ficam disponiveis no template da primeira mensagem.
- Se a pesquisa falhar ou nao retornar dados, usa a mensagem de fallback atual sem bloquear o envio.
- Envia uma mensagem simples via UAZAPI usando `/message/presence` e `/send/text`.
- Marca o lead como `initial_sent` e salva `first_message_sent_at` e `last_outbound_at`.
- Se follow-up estiver ativo no SDR, agenda `followup_due_at` usando `followup_after_hours`.
- Registra resultado em `job_logs`.

Resposta pendente (rede de seguranca do lead ignorado):

- `POST /scheduler/pending-reply/run`: executa manualmente uma varredura de leads sem resposta.
- O caminho normal e o webhook: a mensagem do lead chega, o buffer de rajada
  (`INBOUND_RESPONSE_BUFFER_MS`) espera e a IA responde. Esse caminho vive na memoria do
  processo, entao ele perde a resposta se o container reiniciar dentro da janela do buffer
  (deploy), se a geracao estourar as tentativas ou se a UAZAPI recusar o envio.
- Seleciona conversa cuja **ultima mensagem e do lead**, parada ha mais de
  `PENDING_REPLY_AFTER_MS` e dentro de `PENDING_REPLY_WINDOW_HOURS`. Se a IA tivesse
  respondido, a ultima mensagem seria dela — por isso nao ha risco de mensagem duplicada.
- Ignora midia sem texto util, lead com IA pausada, SDR inativo e conversa que ja teve duas
  geracoes de resposta para a mesma mensagem (o teto evita insistir com quem ficou em silencio
  de proposito, como robo de loja).
- Registra cada nova tentativa em `job_logs` com `job_name = pending-reply`.

Follow-up unico:

- `POST /scheduler/followup/run`: executa manualmente uma rodada de follow-up.
- Processa apenas SDR ativo com follow-up habilitado.
- Seleciona leads `initial_sent` com `followup_due_at` vencido, sem `followup_sent_at` e sem `followup_disabled_at`.
- Respeita janela de envio, limite diario e cooldown de follow-up do SDR.
- Envia uma unica mensagem por lead via UAZAPI usando `/message/presence` e `/send/text`.
- Marca o lead como `followup_sent`, salva `followup_sent_at`, `last_outbound_at` e desativa novo follow-up em `followup_disabled_at`.
- Se o lead responder antes do follow-up, o webhook salva `followup_disabled_at` e cancela o envio.

Webhook e conversas:

- `POST /webhooks/uazapi/:sdrAgentId`: recebe webhooks da UAZAPI.
- `GET /conversations`: caixa de conversas no estilo WhatsApp Web — lista de chats do SDR a esquerda e a conversa escolhida a direita. Aceita `?sdr=<id>` (SDR exibido), `?chat=<id>` (conversa aberta) e `?q=<texto>` (busca por nome, numero ou mensagem). Sem parametros abre o primeiro SDR que tem conversa, ja com o chat mais recente aberto.
- `GET /conversations/:id`: link antigo de conversa; redireciona para `GET /conversations?sdr=...&chat=...`.
- `GET /webhook-events`: exibe logs brutos dos webhooks recebidos.
- `GET /ai-runs`: exibe chamadas de IA com provider, modelo, proposito, tokens, latencia e erros.
- `GET /job-logs`: exibe execucoes do scheduler com job name, status, tentativa, payload e erros.
- `GET /leads/:id`: exibe detalhe completo do lead com dados, chamadas de IA e jobs associados.

Processamento atual do webhook:

- Salva payload bruto em `webhook_events` antes de processar.
- Normaliza número, texto, tipo da mensagem, `fromMe`, `wasSentByApi` e ID da mensagem.
- Cria lead automaticamente quando o número ainda não existe para o SDR.
- Cria ou atualiza conversa.
- Salva mensagem em `messages`.
- Quando recebe audio inbound, chama `/message/download` com `transcribe: true`, salva `messages.transcription` e usa o texto transcrito no historico da IA.
- Se a UAZAPI retornar link do audio sem transcricao e houver chave OpenAI disponivel, tenta transcrever direto pela OpenAI como fallback.
- Quando a mensagem é recebida do lead, marca o lead como `in_conversation` e desativa follow-up pendente.
- Quando detecta mensagem manual enviada pelo celular (`fromMe=true` e `wasSentByApi=false`), marca o lead como `human_paused`, define `human_paused_until` usando `human_pause_hours` do SDR e renova a pausa a cada nova mensagem humana.

Motor IA de resposta:

- Suporta `deepseek` (padrao, API oficial da DeepSeek), `openai` e `openrouter` conforme configurado no SDR.
- Usa o modelo configurado no SDR. Padrao para novos SDRs: `deepseek-v4-pro`.
- Usa chave criptografada do SDR ou fallback `DEEPSEEK_API_KEY`/`OPENAI_API_KEY`/`OPENROUTER_API_KEY` do ambiente conforme o provider.
- Exige resposta em JSON estrito com `mensagem_usuario`, `nao_responder`, `status_sugerido` e `actions`.
- O prompt do sistema mantem um prefixo estatico (instrucoes fixas + prompt do SDR) e move os dados variaveis do lead/etapa para o final, para maximizar o cache automatico de prompt do provedor e reduzir custo.
- Cada SDR escolhe um **playbook** (`consultivo` ou `convite`), que define o bloco de funil enviado logo depois das instrucoes fixas. `consultivo` (padrao) explica do que se trata, entende a rotina do lead e so entao chama humano; `convite` nao apresenta o produto, gera curiosidade e aciona o handoff no primeiro sim. As demais regras fixas sao iguais nos dois.
- Registra chamadas em `ai_runs` com input, output, JSON parseado, tokens, tokens de cache hit e latencia e erro quando houver.
- Ao receber mensagem inbound via webhook, se o SDR estiver ativo e tiver credenciais de IA/UAZAPI, gera resposta, envia via UAZAPI e salva a mensagem outbound no historico.
- Se `human_paused_until` ainda estiver no futuro, a IA nao responde. Ao vencer o horario, a IA volta automaticamente no proximo inbound do lead.
- Quando a IA retorna `notify_handoff` em `actions`, o sistema envia um resumo para o `handoff_phone` do SDR, marca o lead como `transferred`, salva `handoff_requested_at`/`handoff_summary` e desativa follow-up.
- O template `handoff_message_template` aceita `{{handoffName}}`, `{{companyName}}`, `{{whatsappNumber}}`, `{{leadWhatsapp}}`, `{{sdrName}}`, `{{productName}}` e `{{summary}}`.

Buffer e divisao de resposta:

- A `mensagem_usuario` retornada pela IA e dividida em partes usando `message_split_max_chars` do SDR.
- O delay de cada parte e calculado por `response_delay_base_ms + caracteres * response_delay_per_char_ms`.
- O delay e limitado por `response_delay_max_ms`.
- Antes de cada parte, o sistema envia presenca `composing` via UAZAPI com o delay calculado.
- Cada parte enviada e salva separadamente no historico da conversa.

IA auxiliar de prompt:

- `GET /prompt-assistant`: tela com selecao de SDR, briefing e geracao de prompt com IA.
- `POST /prompt-assistant/generate`: chama a IA com o briefing e o prompt atual do SDR para gerar um novo prompt.
- `POST /prompt-assistant/apply`: aplica o prompt gerado ao SDR selecionado.
- A IA gera prompts usando o modelo/provider/temperatura configurados no SDR e a chave correspondente do proprio SDR (ou o fallback do ambiente).
- O resultado e exibido para revisao e so e aplicado mediante confirmacao do usuario.

## Deploy no EasyPanel

### Seguranca

**Nunca comite chaves ou segredos no repositorio.** Use variaveis de ambiente no painel do EasyPanel.

Gere valores seguros localmente e cole no EasyPanel:

```bash
# Chave de criptografia (32+ caracteres)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Senha do admin
node -e "console.log(require('crypto').randomBytes(12).toString('hex'))"
```

### Variaveis obrigatorias no EasyPanel

| Variavel | Proposito |
|---|---|
| `DATABASE_URL` | Conexao com PostgreSQL |
| `SESSION_SECRET` | Assinatura de cookies (min 16 caracteres) |
| `ENCRYPTION_KEY` | Criptografia de tokens OpenAI/UAZAPI no banco (min 32 caracteres) |
| `APP_URL` | URL publica HTTPS (ex: `https://sdr.seudominio.com`) |

### Variaveis opcionais

| Variavel | Padrao | Proposito |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Chave DeepSeek fallback (provider padrao) |
| `OPENAI_API_KEY` | — | Chave OpenAI fallback |
| `OPENROUTER_API_KEY` | — | Chave OpenRouter fallback |
| `WEBHOOK_SHARED_SECRET` | — | Protege endpoint de webhook |
| `SCHEDULER_ENABLED` | `false` | Ativa pg-boss em producao |
| `WEB_RESEARCH_ENDPOINT` | — | Endpoint de pesquisa web |
| `ADMIN_NAME/EMAIL/PASSWORD` | — | Cria usuario admin na migracao |

### Servicos necessarios

1. **Aplicacao Node.js** via Docker (Dockerfile incluso).
2. **PostgreSQL** (pode usar o servico gerenciado do EasyPanel ou um container separado).
3. **Dominio publico HTTPS** para receber webhooks da UAZAPI.

### Configuracao no EasyPanel

1. Crie um servico **Docker** apontando para o repositorio GitHub.
2. Adicione as variaveis de ambiente obrigatorias no painel.
3. A porta interna do container e `3000` — mapeie para a porta desejada.
4. Configure o dominio HTTPS e aponte para a porta exposta.
5. O `entrypoint.sh` ja aplica migrations e cria admin na inicializacao.
6. Configure `APP_URL` com o dominio HTTPS para webhooks funcionarem.

### Migrations e admin

O container executa automaticamente ao iniciar:

1. Aguarda o banco ficar disponivel.
2. Aplica migrations pendentes (`npm run db:migrate`).
3. Cria usuario admin se as variaveis `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` estiverem definidas.
4. Inicia o servidor.

### Docker Compose local

Para testar localmente com PostgreSQL:

```bash
cp .env.example .env
# Edite .env com DB_PASSWORD e demais valores
docker compose up -d
```

### Healthcheck

```
GET /health
```

Retorna `{"status":"ok","uptime":...,"timestamp":"..."}`. O Dockerfile ja inclui `HEALTHCHECK`.

### Checklist de seguranca para producao

- [ ] `.env` **nunca** versionado (incluido no `.dockerignore`)
- [ ] `SESSION_SECRET` com 32+ caracteres aleatorios
- [ ] `ENCRYPTION_KEY` com 32+ bytes aleatorios (hex = 64 caracteres)
- [ ] `WEBHOOK_SHARED_SECRET` configurado e usado na URL do webhook UAZAPI
- [ ] `APP_URL` definido com HTTPS no EasyPanel
- [ ] Container roda como usuario `nodejs` (nao root)
- [ ] Healthcheck nao expoe dados sensiveis
- [ ] Tokens/chaves no banco estao criptografados com `ENCRYPTION_KEY`
- [ ] Logs nao imprimem tokens (headers com token sao redacted)
