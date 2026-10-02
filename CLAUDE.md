# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SDR Portal is an internal Fastify app that operates AI-driven SDR (sales development) agents over WhatsApp via the UAZAPI gateway. It manages companies, SDR agents, leads, conversations, and runs scheduled outreach + AI replies. The UI is server-rendered HTML in Portuguese. Product planning lives in `PLANO_SDR_PORTAL.md`; the README has full route documentation and deploy notes.

## Dados de produção (leia antes de tentar o banco)

O ambiente da sessão recebe o `.env` de produção, mas **a `DATABASE_URL` não conecta de fora**:
o host dela é o nome de serviço interno do Docker (`sdr-portal_sdrportal`), então dá `ENOTFOUND`
— não é firewall nem credencial, e nenhum retry ou flag de `psql` resolve. O que responde é o
`APP_URL`. Para analisar conversas, o caminho é o usuário rodar `scripts/exportar-conversas.sh`
na VPS e anexar o pacote. Detalhes, alternativas, mapa das tabelas e armadilhas de leitura
(áudio vem em `transcription`, outbound pode estar duplicado): **`docs/ACESSO-AOS-DADOS.md`**.
Queries prontas: `docs/sql/conversas.sql`.

## Produção roda no EasyPanel (comando sempre para o Console de lá)

A VPS não é operada por `docker compose`. O app é um serviço do EasyPanel, e o que o usuário
tem à mão é o **Console** do serviço, que abre um shell **dentro do container**. Então:

- **Sempre entregue o comando pronto para colar nesse Console**, começando por `cd /app`.
  Nunca escreva `docker compose exec app ...`, `docker exec ...`, `ssh` nem caminho de host:
  lá dentro nada disso existe.
- A imagem é `node:22-alpine` com as devDependencies removidas (`npm prune --omit=dev`). Não
  há `tsx`, `typescript`, `drizzle-kit`, `vitest`, `git` nem `psql`. Só roda o que já está
  compilado: `npm run build` no Console **não funciona**, e por isso todo script de produção
  é chamado como `node dist/...`.
- O que existe no container (ver `Dockerfile`): `dist/`, `node_modules` de produção,
  `drizzle/`, `docs/prompts/` e `entrypoint.sh`. `scripts/` **não** é copiado — o
  `exportar-conversas.sh` não roda aí (precisa de `psql` e do repositório).
- As variáveis de ambiente do serviço já chegam ao shell do Console, então não é preciso
  exportar `DATABASE_URL`, `ENCRYPTION_KEY` ou `SESSION_SECRET`.
- **Mudança em código ou em `docs/prompts/` só chega ao container depois de um Deploy** no
  EasyPanel (rebuild a partir do `main`). Rodar o script antes do deploy grava no banco o
  texto ANTIGO. A ordem é sempre: merge → Deploy → Console.

Gravar no SDR os prompts versionados (o caso mais comum):

```bash
cd /app
node dist/src/db/apply-sdr-prompts.js --agent="Franc"            # dry-run: mostra o plano
node dist/src/db/apply-sdr-prompts.js --agent="Franc" --apply    # grava
```

Marcar no historico as automaticas da loja anteriores ao filtro (e devolver ao funil os leads
que so ouviram robo):

```bash
cd /app
node dist/src/db/backfill-auto-replies.js            # dry-run: mostra o plano
node dist/src/db/backfill-auto-replies.js --apply    # grava
```

Se o `first-message-variants.md` do SDR tem a secao `## Variantes no ar` (cada `### rotulo` com um bloco de codigo), o script grava essas variantes ativas e **pausa** as do banco que nao estao no arquivo — nunca apaga, porque o A/B precisa do historico de envios delas. Sem a secao, as variantes do banco ficam como estao. Toda mudanca que o script grava vai para o historico de configuracao do SDR.

`--agent` aceita o id ou um pedaço do nome (com mais de um match ele lista os ids e não grava
nada). O **diretório sai do nome do SDR** (`Mariana` → `docs/prompts/mariana`), e o **playbook
fica como está** — passe `--dir=` ou `--playbook=consultivo|convite` só para sair disso de
propósito.

> Até 27/08 o script tinha `docs/prompts/insumosmart` e `convite` como padrão, então
> `--agent="Mariana" --apply` gravava os prompts da Insumo Smart na Mariana e trocava o funil
> dela. Ela passou a se apresentar como SDR da Insumo Smart para os leads da KyberFood. Se um
> SDR começar a falar como outro, é o primeiro lugar para olhar.

## Commands

```bash
npm run dev          # tsx watch on src/server.ts
npm run build        # tsc -> dist/ (prebuild wipes dist/)
npm run start        # run compiled dist/src/server.js
npm run lint         # eslint .
npm test             # vitest run (one-shot)
npx vitest run tests/health.test.ts   # single test file
npx vitest run -t "name substring"    # single test by name
npx vitest           # watch mode
npm run db:generate  # drizzle-kit generate (create migration from schema.ts)
npm run db:migrate   # runs COMPILED dist/src/db/migrate.js — build first
npm run admin:create # ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD -> compiled create-admin.js
npm run sdr:prompts -- --agent="<id|nome>" [--apply]  # grava docs/prompts/<sdr>/ no SDR (dry-run sem --apply)
```

Note: `db:migrate`, `admin:create` and `sdr:prompts` run **compiled** JS, so `npm run build` must precede them. Migrations are applied automatically by `entrypoint.sh` in Docker.

## Architecture

**Module layout.** Code is organized by feature under `src/modules/<feature>/`. Each feature typically follows the same quartet:
- `*-repository.ts` — defines the repository **interface** plus a `createMemory*Repository()` in-memory implementation used by tests.
- `db-*-repository.ts` — the Postgres/Drizzle implementation of that interface.
- `*-routes.ts` — `register*Routes(app, ...)` registers Fastify routes.
- `*-pages.ts` — returns HTML strings for server-rendered views.

**Dependency injection via `buildApp`.** `src/app.ts` wires everything. `buildApp(options)` accepts overrides for every repository/service/client so tests inject in-memory fakes. Selection rule: if an override is passed, use it; else if `NODE_ENV === 'test'` use the memory repo; else use a **lazy DB repository** (a wrapper that dynamically `import()`s the `db-*-repository` on each call, so the DB module — and its connection — is never loaded in tests). Follow this pattern when adding a new repository: interface + memory impl + db impl + `createLazyDb*Repository()` wrapper + a `buildApp` option.

**Two entrypoints.** `src/app.ts` builds the Fastify instance (no server, no scheduler) — this is what tests import. `src/server.ts` is the production entrypoint: it calls `buildApp`, listens, and starts the pg-boss schedulers with real DB-backed services.

**Database.** Drizzle ORM over `postgres` (postgres.js). Schema is the single source of truth in `src/db/schema.ts`; every table exports `$inferSelect`/`$inferInsert` types (`User`, `NewUser`, etc.) that the rest of the code consumes. SQL migrations live in `drizzle/` and are generated by `db:generate` — never hand-edit generated migration files; change `schema.ts` and regenerate.

**Config.** All environment access goes through `src/config/env.ts`, a Zod-validated singleton (`env`). Invalid env exits the process. In `test`, `DATABASE_URL`/`SESSION_SECRET`/`ENCRYPTION_KEY` are optional (fakes/defaults kick in); outside test they are required. Import `env` rather than reading `process.env` directly.

**Secrets.** OpenAI/OpenRouter/UAZAPI tokens are stored encrypted in the DB. `src/modules/security/secrets.ts` does AES-256-GCM with a key derived (`sha256`) from `ENCRYPTION_KEY`; format is `v1:iv:tag:ciphertext` (base64url). Always encrypt before persisting and decrypt at point of use.

**Auth.** Cookie-session only, no library store. `session.ts` serializes `{userId}` into a signed cookie (`@fastify/cookie`). `access.ts` exposes `getCurrentUser` / `requireUser` (redirects to `/login`); page routes call `requireUser` at the top. Passwords hashed with argon2 (`auth/password.ts`).

**Phone matching.** WhatsApp numbers are matched via `src/modules/phone/whatsapp-number.ts`, not raw string equality — `whatsappNumberVariants()` generates BR-number forms (with/without the 9th digit) so inbound webhooks resolve to the right lead. Use these helpers when looking up leads by number rather than comparing digits directly.

**Rendering.** No template engine. `src/modules/web/html.ts` provides `escapeHtml` and the layout/nav shell; `*-pages.ts` files build HTML via template literals. Always `escapeHtml` user-derived values. Static assets served via `web/assets.ts`.

**Telas (plano em `docs/analises/plano-telas-2026-10-02.md`).** Toda pagina carrega `/app.js` (`web/app-script.ts`), que so melhora o que o HTML ja faz:
- Salvar volta para a **propria tela** com `?salvo=1` (ou `?criado=1`), nunca para a lista: o script mostra o aviso "Alteracoes salvas", tira o parametro da URL e devolve a rolagem e as secoes `<details>` que estavam abertas. Rota nova de salvar segue o mesmo padrao.
- Formulario com `data-inline-result="<id>"` e enviado por `fetch` com `Accept: application/json` e o resultado aparece no elemento indicado. A rota responde JSON nesse caso e uma pagina de reserva no resto (ver `respond` em `uazapi/uazapi-routes.ts` e os textos em portugues de `uazapi/action-summary.ts`). O script so usa `textContent`.
- **Tela do SDR em abas** (`/sdr-agents/:id/edit?aba=`): Resumo, Conversa, Abordagem (= `/first-messages`), Envio, WhatsApp (o `/conectar` mostra a mesma barra), Voz, Avancado, Historico. Cada aba com formulario posta em `/sdr-agents/:id/aba/:aba`, e `mergeTabBody` (`sdr-agent-pages.ts`) junta os campos dela (`TAB_FIELDS`) com o SDR gravado antes de passar por `parseSdrAgentInput`: caixa ausente no POST = desligada, campo de texto ausente = fica o gravado, segredo em branco = mantem a chave. Campo novo do SDR precisa entrar em `TAB_FIELDS` e na aba certa, senao a tela nao consegue muda-lo.
- Lista grande pagina no banco: `/leads` usa `LeadRepository.search` (busca por nome ou pedaco do numero, filtros por SDR e situacao, 50 por pagina). O painel le mensagens, chamadas de IA e registros so do periodo escolhido e so as colunas que conta (`listMessageStats`, `listStats` a partir de `dashboardSince`) — `listAllMessages`/`list()` dessas tabelas trazem payload e prompt inteiros e nao servem para tela.

## Key domain flows

These live under `src/modules/scheduler/`, `webhooks/`, and `ai/`:

- **Initial outreach** (`initial-outreach.ts`): picks `pending` leads for an active SDR, respects timezone/send-window/day-of-week/daily-limit/cooldown, optionally enriches via `lead-research-service.ts`, sends via UAZAPI, marks `initial_sent`, schedules `followup_due_at`.
- **Abordagem em duas mensagens** (`sdr_agents.second_message`, tela `Msg inicial`): preenchido o campo, o mesmo disparo manda a apresentacao e, logo depois, um segundo texto **fixo** (nao passa pela IA, aceita os placeholders das variantes, espacado pelo delay de digitacao do SDR). Vazio = abordagem de uma mensagem so, como era antes. A falha da segunda nao desfaz a primeira: o lead ja esta `initial_sent` e reabrir o ciclo reenviaria a apresentacao — o erro fica em `job_logs` com a chave `initial-second-<lead>`. Quem usa hoje e a Mariana: apresentacao curta na primeira, sistema + WhatsApp nativo + teste gratis de 3 dias na segunda (`docs/prompts/mariana/second-message.txt`). O `prompt.txt` dela precisa saber disso — a secao `O QUE O LEAD JA LEU ANTES DE VOCE` existe para a ETAPA 1 nao reapresentar o que a segunda mensagem acabou de dizer.
- **Follow-up** (`followup-outreach.ts`): up to `sdr_agents.followup_max_touches` messages per lead (default 1 = one second message, the old behaviour; `leads.followup_count` counts them, and `markFollowupSent` either schedules the next touch `followup_after_hours` later or closes the cadence on the last one), in **two modes** picked by `last_inbound_at`. `reengage` = `in_conversation` leads that replied and went cold; `bump` = `initial_sent` leads that **never** replied (they were invisible to the scheduler until the `findNextFollowupDueForSdr` filter was widened, even though `markInitialSent` always wrote their `followup_due_at`). The mode swaps the rule block in `followupSystemPrompt` and the SDR's editable text (`bumpPrompt`, falling back to `followupPrompt`), and is logged as `bump_message_generation` vs `followup_message_generation`. Guards, all in `findNextFollowupDueForSdr` + the service: the whole chat (every lead sharing the JID/LID/number) must be silent since `now - followup_after_hours`, and a newer lead for the same chat (e.g. created by `!reset`) disables the older thread. The message is always AI-generated — there is no generic fallback text. `buildFollowupMessage` distinguishes **`refused`** (the model's `nao_responder`, a verdict on this lead) from **`error`** (technical): a refusal calls `disableFollowup`, an error reschedules and bumps `followup_attempts`, and `MAX_FOLLOWUP_ATTEMPTS` ends it. Collapsing the two was what made a refused lead re-generate every hour forever. A send the UAZAPI refuses counts the same way (reschedule +60min, bump attempts) unless it is the account timelock — otherwise the refused lead stayed first in line and no other lead of the SDR got a follow-up. The sent follow-up is persisted in `messages` like any other outbound. Disparo e follow-up rodam dentro de `withAgentLock` (`scheduler/agent-lock.ts`): o cron e o botao "rodar agora" usam instancias diferentes do mesmo servico, e sem a trava os dois pegavam o mesmo lead no mesmo segundo. A trava e do processo — com mais de uma instancia do portal ela teria de ir para o banco.
- **Nao contatar** (`leads/contact-block-repository.ts`, tabela `contact_blocks`, tela `/leads/nao-contatar`): numero bloqueado vale para **todos** os SDRs e empresas, comparado por `whatsappNumberVariants`. Entra pelo botao "Nao contatar" na tela do lead (`source: portal:<email>`) ou pela acao `opt_out` da IA (`source: ia:<SDR>`), que o `SDR_BASE_PROMPT` reserva para pedido explicito de nao ser mais procurado — "nao tenho interesse" sozinho continua sendo `mark_not_interested`; os dois caminhos marcam o lead `not_interested`. A importacao pula o numero, o disparo inicial descarta o lead (`markDiscarded`, `job_logs` com `blocked-<lead>`) se o bloqueio veio depois da importacao, e o follow-up desliga o lead bloqueado antes de pagar a geracao. A importacao tambem pula o numero que ja existe no mesmo SDR (qualquer variante), em outro SDR da mesma empresa, ou que ja foi conferido como `invalid_phone` — outra empresa pode abordar a mesma loja.
- **Historico de configuracao** (`sdr-agents/config-history.ts`, tabela `sdr_config_changes`): cada mudanca de prompt, playbook, modelo, janela, limites, follow-up, handoff e variantes da `Msg inicial` grava antes/depois e quem mudou (`portal:<email>` ou `script:apply-sdr-prompts`). Segredo nenhum entra (`TRACKED_AGENT_FIELDS` e lista fechada). A aba Historico do SDR mostra as 40 ultimas.
- **Webhook ingestion** (`webhooks/uazapi-webhook-routes.ts` + `uazapi-normalizer.ts`): stores raw payload in `webhook_events`, normalizes, auto-creates leads, records `messages`, transcribes inbound audio (`audio/`), detects manual phone sends (`fromMe && !wasSentByApi`) to set `human_paused`. **Resposta automatica da loja** (menu, saudacao, horario, link de cardapio) e reconhecida por `conversations/store-auto-reply.ts` e gravada com `messages.auto_reply = true`: nao chama a IA, nao passa por `markInboundReceived` e por isso nao promove o lead a `in_conversation` nem reancora o follow-up — a regra equivalente existia so no prompt e o modelo respondia ao robo em 12 de 12 conversas (`docs/analises/mariana-2026-09-02.md`). Quem responde e a proxima mensagem, a de gente; no historico da IA a automatica aparece etiquetada por `aiHistoryText`. O detector erra de proposito para o lado de "e gente": ficar calado com uma pessoa esperando e pior do que gastar uma mensagem com um robo — recusa ("obrigado pelo contato, mas nao temos interesse") e recado para o dono vencem as frases de robo. Tambem viram automatica a **foto sem legenda antes de qualquer fala de gente** (`isStoreImage`: cardapio do dia, panfleto) e o **mesmo texto chegando em tres dias diferentes** (`isRepeatedBroadcast`: o bom-dia da transmissao). Foto numa conversa com gente continua pausando a IA (`pauseAi`, que tambem desliga o follow-up — `resumeAi` religa so o que a pausa desligou), mas agora avisa o WhatsApp de handoff com o link do chat (`leads/ai-pause-notice.ts`); antes a pausa era silenciosa e o lead ficava esquecido.
- **AI reply** (`ai/ai-response-service.ts`, `ai-client.ts`): supports `openai` and `openrouter`, per-SDR model/key, requires strict JSON output (`mensagem_usuario`, `nao_responder`, `status_sugerido`, `actions`), logs every call to `ai_runs`. O webhook nao chama a IA direto: pede a resposta a **fila `reply-conversation`** (`ai/reply-queue.ts` + `attachReplyQueue` em `pg-boss-scheduler.ts`, policy `short` = um pedido esperando por conversa). O job relê SDR, conversa e lead, confere pela `last_inbound_at` se o lead parou de digitar (senao volta para a fila pelo que falta, com teto de 4x `INBOUND_RESPONSE_BUFFER_MS`) e responde dentro da trava `reply:<conversa>`, a mesma do `pending-reply`. Sem retentativa: job que falha ou expira (10min) e coberto pelo `pending-reply`. Sem a fila ligada (teste, `SCHEDULER_ENABLED=false`, os segundos do boot) ou com ela recusando, vale `inbound-response-buffer.ts`, o debounce em memoria de antes — que um deploy no meio da espera apagava; `response-buffer.ts` splits/typing-delays outbound parts. A reply whose history went stale during generation (the lead wrote again, with text) is discarded before sending and logged with `SUPERSEDED_REPLY_ERROR` — the newer message's generation answers both; without this the lead got two replies a minute apart. **Handoff**: `markTransferred` runs before the notice, and `deliverHandoffNotice` tries 3x and always writes a `handoff-notify` row to `job_logs` (failed rows carry the summary); the dashboard alerts on failed notices and on `handoff_offer` leads idle for 2h+. **`scheduler/pending-reply.ts`** (safety net, 5min) only sees conversations whose last non-auto message is the lead's (`listAwaitingReply`) — counting the store auto-reply sent every menu to the AI twice.
- **Resposta em audio** (`audio/audio-reply.ts`, `audio/text-to-speech-client.ts`, `sdr_agents.audio_reply_mode`): `when_lead_sends_audio` responde com voz da ElevenLabs quando o bloco de mensagens que esta sendo respondido (tudo depois da nossa ultima) tem audio do lead; `always` responde sempre; `off` e o padrao. So `ai-response-service.ts` fala — abordagem e follow-up ficam em texto de proposito (audio de numero desconhecido gera denuncia). A decisao e tomada antes de chamar a IA e entra no FIM do prompt (`replyAsAudio` em `buildSdrSystemPrompt`), para nao quebrar o cache do bloco fixo. `speakableText` devolve `null` para link/telefone/e-mail/texto longo, e qualquer falha (ElevenLabs sem credito, UAZAPI recusando o arquivo) cai para texto: o audio nunca pode deixar o lead sem resposta. O audio vai como data URI MP3 em `/send/media` (`type: ptt`) e e gravado em `messages` com `message_type = 'ptt'` e o texto falado em `transcription`, igual ao audio que chega do lead.
- **Limite diario de prospeccao** (`daily_initial_send_limit`, 40 por padrao desde 08/09, ou a rampa do aquecimento quando ligada): vale so para o disparo ativo; responder quem escreve nao tem teto. O limite tambem nao e o teto real do dia — a janela dividida pelo cooldown medio e, e quando essa conta fica abaixo do limite o dashboard avisa (`dailySendCapacity` em `dashboard-view-model.ts`), porque limite inalcancavel na tela parece SDR parado. Foi exatamente esse o caso ate 10/09: com janela 15:00-21:00 (360min) e cooldown 5-15min (media 10) cabiam ~37, e os SDRs nunca chegavam aos 40 gravados pela migracao 0025. A migracao 0027 encurta o cooldown para 4-14min (media 9, ~41 em 360min) **so** nos SDRs em que a janela nao comportava o limite e em que o cooldown novo resolve — quem ja tinha folga fica como esta, porque apertar o espacamento sem necessidade e justamente o custo de canal abaixo. Limite alto tem custo de canal: foi com 40/dia que a Francielly levou `WHATSAPP_REACHOUT_TIMELOCK` em 27/08 (`docs/analises/francielly-2026-08-28.md`), e o `error 463` no `/job-logs` e o sinal de que passou do ponto. O que tirava a conta do lugar naquela epoca — 23% da base com numero inexistente — hoje nao chega a virar conversa: `initial-outreach.ts` consulta `/chat/check` antes de enviar.
- **Limites do WhatsApp** (`monitoring/channel-limits.ts`, tabela `sdr_channel_limits`, botao "Limites do WhatsApp" na tela do SDR): antes de pagar pesquisa e geracao, o disparo inicial pergunta `GET /instance/wa_messages_limits` (no maximo uma vez a cada 15min por SDR) e nao abre conversa nova enquanto o WhatsApp diz que nao pode — `reachout_timelock` ate o `until` dele, `new_chat_message_capping` esgotada ate o fim do ciclo, ou `can_send_new_messages: false` ate a proxima consulta. O bloqueio fica no banco: o recuo de `send-backoff.ts` e de memoria, e depois de um restart o disparo voltava a bater no bloqueio (cada tentativa contra bloqueio de qualidade reforca o motivo dele). Um envio recusado com `provider_code: 463` tambem grava (`recordSendRefusal`). Consulta que falha nao para o disparo, e `WHATSAPP_LIMITS_CHECK=false` desliga a trava inteira se a UAZAPI passar a responder errado. Follow-up nao consulta: conversa que ja existe continua saindo durante o timelock. Painel (coluna "Conversas novas" + alerta) e relatorio diario mostram ate quando.
- **Aquecimento de numero novo** (`sdr-agents/warmup.ts`, `sdr_agents.warmup_started_at`, caixa "Numero em aquecimento" no formulario): enquanto preenchido, o limite diario do disparo segue a rampa 10/dia (dias 1-3), 20 (ate o dia 7), 30 (ate o dia 14) e depois volta ao cadastrado — sempre o menor dos dois. Salvar o formulario com a caixa marcada mantem a data; desmarcar zera. `dailyInitialLimit` e a fonte do limite do dia para o disparo, o painel e o alerta de capacidade.
- **Monitor de conexao** (`monitoring/connection-monitor-service.ts`): tick de 5min (`CONNECTION_MONITOR_CRON`) + webhook `connection` (`webhooks/connection-event.ts`) leem `/instance/status` de cada SDR e avisam, por uma **instancia UAZAPI separada** cadastrada em `/monitoring`, os numeros configurados quando um WhatsApp cai. O alerta sai na transicao guardada em `sdr_connection_states` — sem essa memoria o tick mandaria a mesma mensagem 288 vezes por dia — e repete a cada `repeat_alert_minutes`. O status vem sempre de uma leitura nova da instancia (`checkWhatsappChannel`), nunca do payload do webhook. Cada transicao (e a primeira leitura de cada SDR) tambem vai para `sdr_connection_events`, o historico que alimenta a **Saude do WhatsApp** do painel (`monitoring/channel-health.ts`: % do horario de envio conectado em 7 dias, quedas, tempo para voltar; meta 95%). Sem monitor ligado nao ha historico.
- **Fila de leads** (`monitoring/lead-queue-monitor-service.ts`): tick de 15min (`LEAD_QUEUE_MONITOR_CRON`) conta os leads `pending` de cada SDR vigiado e avisa, pelos numeros do monitor, quando a fila chega ao limite de `leads_alert_threshold` (0 = zerou). Um aviso por esvaziamento: `sdr_connection_states.leads_alert_at` so volta a `null` quando a fila enche, e e isso que rearma o proximo. As colunas da fila e as da conexao dividem a linha, mas cada job escreve pelo seu caminho (`saveLeadQueueState` x `saveState`) — misturar apagaria a memoria do outro e o aviso voltaria a repetir.
- **Relatorio diario** (`monitoring/daily-report-service.ts`): tick de 15min (`DAILY_REPORT_CRON`) que so envia depois da hora cadastrada em `/monitoring` e uma vez por dia — a guarda e `monitor_settings.last_daily_report_on`, gravada por `markDailyReportSent` e **fora** de `saveSettings` (salvar a tela nao pode reabrir o envio do dia). Usa a instancia e os numeros do monitor de conexao. As tres contagens (`countDailyActivityForSdr`) repetem as definicoes do dashboard — `first_message_sent_at`, `last_inbound_at` e `handoff_requested_at` no dia — para a mensagem no WhatsApp nao divergir da tela. SDR desconectado na memoria do monitor (`sdr_connection_states`) ganha a linha "WhatsApp DESCONECTADO desde ..." — o relatorio de "0 prospectados" escondeu 30 dias de Francielly fora do ar.
- **Scheduling** (`pg-boss-scheduler.ts`): pg-boss cron jobs, only started when `SCHEDULER_ENABLED=true`. Manual triggers exist at `POST /scheduler/initial-outreach/run` and `POST /scheduler/followup/run`.

Lead lifecycle is a `status` string field (`pending` → `initial_sent` → `in_conversation` / `followup_sent` / `human_paused` / `transferred` / etc.); the `markX` methods on `LeadRepository` are the only intended way to transition it.

**Depois do handoff** o resultado nao e status: sao as colunas `meeting_at`, `trial_started_at`, `won_at`, `lost_at` + `lost_reason`, marcadas por quem atendeu no painel "Depois do handoff" da tela do lead (`POST /leads/:id/desfecho`, regras em `leads/lead-outcome.ts`; cliente e perdido se excluem). O aviso de handoff leva o link dessa tela (`{{leadUrl}}`, ou no fim do texto). O painel monta o **funil da safra** (`buildCohortFunnel`: dos abordados no periodo, quantos tiveram resposta de gente, ouviram a proposta, handoff, reuniao, teste, cliente) e cobra handoff de mais de 3 dias sem desfecho. Na `Msg inicial`, `first-message-variants/ab-verdict.ts` so declara variante vencedora com 150 envios por variante ativa e teste de duas proporcoes p < 0,05.

## Conventions

- ESM throughout (`"type": "module"`, `moduleResolution: NodeNext`) — **relative imports must use the `.js` extension** even for `.ts` sources (e.g. `import { env } from './config/env.js'`).
- TS `strict` + `noUncheckedIndexedAccess` are on; array/record indexing yields `T | undefined`.
- ESLint bans `console` except `console.error` (`no-console`); use the Fastify logger (`app.log` / `request.log`) or `process.stderr` for structured output.
- Add tests as `tests/*.test.ts` (vitest, `globals: false` so import `describe/it/expect` from `vitest`). Prefer testing pure logic and services against memory repositories rather than the DB.
- SQL dos repositorios `db-*` se testa em `tests/banco-de-verdade.test.ts`, contra um Postgres **descartavel** (a suite apaga as tabelas): `TEST_DATABASE_URL=postgres://... npx vitest run tests/banco-de-verdade.test.ts`. Sem a variavel a suite fica `skipped`. Numa sessao do Claude Code da para subir um local com `/usr/lib/postgresql/16/bin/initdb` + `pg_ctl` como usuario nao-root (o Postgres recusa rodar como root).
- UI strings and DB text values are Portuguese; match existing wording/spelling (including unaccented forms already in the codebase) rather than "correcting" them.

## AI prompt ordering (prompt caching)

**Whenever you create or change any AI prompt (system or user), order its content from most stable to least stable.** LLM providers (OpenAI, Gemini, OpenRouter, Anthropic) cache the longest identical *prefix* of a prompt and bill cache hits at ~10–25% of normal input price. Any byte change invalidates everything after it, so the stable content must physically come first for the cache to help. Ordering, from top to bottom:

1. **Global / base rules** — identical across every SDR and lead (e.g. `SDR_BASE_PROMPT`, output-format rules, funnel stages). Never touch this region per request.
2. **Per-SDR config** — stable across all of one SDR's conversations (product, offer, the SDR's editable `customPrompt`, SDR name).
3. **Per-lead / volatile context** — changes every request (lead name, WhatsApp number, conversation stage, timestamps, IDs). Always last.

Rules:
- **Never interpolate volatile values (lead name/number, timestamps, UUIDs, per-request IDs) into the stable region** — it makes the whole prompt uncached.
- Keep the stable prefix **byte-identical** across requests (no `Date.now()`, no reordered fields, deterministic serialization).
- The stable prefix must reach the provider's minimum to cache (OpenAI: ~1024 tokens; Gemini/Anthropic: lower). Below that, nothing caches.
- `buildSdrSystemPrompt` in `src/modules/ai/sdr-base-prompt.ts` is the reference: base first, then context. Preserve this stable→volatile order when editing it, and prefer moving per-SDR fields (offer, `customPrompt`) *above* per-lead fields.

## SDR playbooks

The funnel is **not** part of `SDR_BASE_PROMPT`. `src/modules/ai/sdr-playbooks.ts` holds one funnel block per playbook (`consultivo`, `convite`), selected by the `playbook` column on `sdr_agents` and appended by `buildSdrSystemPrompt` right after the common rules. `consultivo` is the default and the behaviour every existing SDR keeps; `convite` is the curiosity-first funnel that hands off on the first yes.

When adding a rule to the prompt, decide which layer it belongs to: universal rules (jailbreak, output format, internal commands, bot detection, postponement vs. refusal) go in `SDR_BASE_PROMPT`; anything about stages, what to reveal when, or how to treat a "no" belongs to a playbook block. A rule written into the wrong layer will contradict the other playbook — that is exactly what the split exists to prevent. `initial-outreach.ts` also branches on the playbook for the first-message prompt (the `convite` opener does no web search and pitches nothing).
