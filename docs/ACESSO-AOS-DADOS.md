# Como ler as conversas de produção (para sessões do Claude Code)

> **Leia isto antes de dizer que não consegue acessar os dados.** Este arquivo existe para
> nenhuma sessão nova precisar redescobrir — nem o usuário precisar reexplicar — por que o
> banco não responde e qual é o caminho que funciona.

## TL;DR

| | |
| --- | --- |
| `DATABASE_URL` está no ambiente? | **Sim**, preenchida e válida. |
| Dá para conectar nela? | **Não**, de uma sessão do Claude Code na web. O host é interno do Docker. |
| O que funciona hoje | `APP_URL` (o portal) responde por HTTPS. |
| Caminho mais rápido para analisar conversas | o usuário roda `scripts/exportar-conversas.sh` na VPS e anexa os arquivos. |

## Por que a `DATABASE_URL` não conecta

O ambiente da sessão recebe o `.env` de produção inteiro — `DATABASE_URL`, `ENCRYPTION_KEY`,
`SESSION_SECRET`, chaves de IA, `WEBHOOK_SHARED_SECRET`, `ADMIN_*`. A `DATABASE_URL` é real,
mas o host dela é o nome de serviço interno do EasyPanel/Docker: `sdr-portal_sdrportal`, porta
5432, banco `sdrportal`, `sslmode=disable`.

Esse nome só resolve **dentro da rede Docker onde o container do portal roda**. De qualquer
outro lugar:

```
$ node -e 'require("node:dns").promises.lookup("sdr-portal_sdrportal").catch(e=>console.log(e.code))'
ENOTFOUND

$ psql "$DATABASE_URL" -c 'select 1'
psql: error: could not translate host name "sdr-portal_sdrportal" to address: Name or service not known
```

Não é firewall, não é credencial errada, não é TLS: é DNS. **Não existe flag de `psql`, proxy
ou retry que resolva isso.** Tentar de novo é desperdício de turno.

O que responde é o portal:

```
$ curl -s "$APP_URL/health"
{"status":"ok","uptime":161.5,"timestamp":"..."}
```

## As três formas de dar acesso, da melhor para a pior

### 1. Export gerado na VPS (recomendado)

Nada muda na infra e nada fica exposto. O usuário roda **na VPS** (onde o nome
`sdr-portal_sdrportal` resolve). Não serve o Console do container do portal: a imagem não leva
`scripts/` nem tem `psql` — ver a seção do EasyPanel no `CLAUDE.md`.

```bash
./scripts/exportar-conversas.sh --sdr "Mariana" --dias 30
```

Sai um `.tar.gz` com transcrições legíveis e CSVs. Ele anexa isso na conversa e a sessão lê os
arquivos direto. Nenhum segredo vai no pacote.

Se o script não estiver na VPS, as queries soltas estão em `docs/sql/conversas.sql` — dá para
colar no cliente de SQL do EasyPanel e exportar o resultado.

### 2. Banco alcançável de fora

Se a análise for virar rotina, vale expor o Postgres com TLS e um usuário **somente leitura**
(veja o bloco `create role` comentado no fim de `docs/sql/conversas.sql`). No EasyPanel,
publique a porta do Postgres e, de preferência, restrinja por IP.

Depois, coloque a URL externa numa variável **separada** — nunca sobrescreva a `DATABASE_URL`,
que é a do app:

```
EXPORT_DATABASE_URL=postgres://<usuario_leitura>:<senha>@<host-publico>:5432/sdrportal?sslmode=require
```

Os scripts deste repo já preferem `EXPORT_DATABASE_URL` quando ela existe.

> Peso da decisão: isso põe o banco de produção na internet. Só faz sentido com usuário
> read-only, TLS obrigatório e restrição de IP.

### 3. Login no portal pela própria sessão

`ADMIN_EMAIL` e `ADMIN_PASSWORD` estão no ambiente e `APP_URL` responde — em tese uma sessão
consegue logar em `POST /login` (campos `email` e `password`, cookie assinado
`sdr_portal_session`) e ler `/conversations` e `/ai-runs`.

**Isso funciona** — foi por aqui que o diagnóstico de 27/08 (SDR parado) saiu em minutos:

```bash
curl -s -c cookies.txt -X POST "$APP_URL/login" \
  --data-urlencode "email=$ADMIN_EMAIL" --data-urlencode "password=$ADMIN_PASSWORD"
curl -s -b cookies.txt "$APP_URL/job-logs" -o joblogs.html
```

O retorno é HTML server-rendered; as tabelas de `/job-logs` e `/ai-runs` saem com um
`re.findall(r'<tr>(.*?)</tr>')` e viram contagem por dia/SDR em poucas linhas de Python.

Para **por que um SDR parou**, este é o caminho mais rápido, melhor que a opção 1:

| Página | O que responde |
| --- | --- |
| `/job-logs` | o erro exato do disparo, por SDR e por lead, minuto a minuto |
| `/ai-runs` | quanta IA foi gasta e em quê (delata geração que nunca virou envio) |
| `/sdr-agents/<id>/conectar` | estado da instância UAZAPI, com `lastDisconnect` e `lastDisconnectReason` |

Para análise de **conteúdo de conversa** em volume, a opção 1 continua melhor: o HTML das
conversas é pesado e frágil de raspar.

## Onde os dados moram

| Tabela | O que tem | Colunas que importam na análise |
| --- | --- | --- |
| `sdr_agents` | um por SDR (Mariana, Francielly) | `id`, `name`, `display_name`, `playbook`, `prompt`, `followup_prompt`, `demo_contact_name` |
| `leads` | um por contato abordado | `status`, `conversation_stage`, `first_message_sent_at`, `last_inbound_at`, `followup_disabled_at`, `not_interested_at`, `handoff_requested_at` |
| `conversations` | uma thread por lead | `lead_id`, `last_message_at` |
| `messages` | **as mensagens** | `direction` (`inbound`/`outbound`), `sender_type` (`lead`/`ai`/`human`), `message_type`, `text`, `transcription`, `whatsapp_message_id` |
| `ai_runs` | toda chamada de IA | `purpose`, `input_messages` (o prompt inteiro), `output_text`, `error`, `latency_ms`, `prompt_cache_hit_tokens` |
| `webhook_events` | payload cru da UAZAPI | só para depurar ingestão |

Notas que evitam conclusão errada:

- **Áudio do lead vem em `transcription`, não em `text`.** Contagem que olhe só `text` perde as
  mensagens de áudio. Use `coalesce(text, transcription)`.
- **`message_type = 'contact'`** é o cartão da pizzaria de demonstração, não uma fala da SDR.
- **`whatsapp_message_id is null` = gravada pelo app; preenchida = veio pelo webhook.** Como o
  app grava o outbound localmente *e* a UAZAPI ecoa a mesma mensagem de volta, pode haver
  duplicata. A query 6 de `docs/sql/conversas.sql` mede isso.
- **O `status` do lead é string livre**: `pending`, `initial_sent`, `in_conversation`,
  `followup_sent`, `human_paused`, `transferred`, `not_interested`.
- `conversation_stage` segue o funil: `permission`, `discovery`, `solution`, `handoff_offer`,
  `handoff_done`, `not_interested`.
- Nunca leia colunas `*_encrypted`: são segredos e não servem para análise.

## O que NÃO fazer

- Não tente conectar na `DATABASE_URL` esperando que funcione "na próxima" — o motivo é DNS.
- Não desligue verificação de TLS nem mexa em `HTTPS_PROXY` para tentar alcançar o banco.
- Não copie segredo do ambiente (`ENCRYPTION_KEY`, `SESSION_SECRET`, chaves de IA, senha do
  banco) para arquivo, commit, PR ou mensagem.
- Não escreva no banco de produção. Toda análise aqui é `select`.

## Quando o SDR "parou": leia os três em ordem

Um SDR pode parar sem nenhum erro visível na tela de conversas. A ordem que resolve:

1. **`/job-logs`** — se houver linha `failed` repetindo, o motivo está ali. `UAZAPI ... HTTP 503`
   em tudo, para um SDR só, com o outro SDR enviando normal, é instância deslogada — não é
   queda da UAZAPI.
2. **`/sdr-agents/<id>/conectar`** — confirma: `status: disconnected` e, no bloco de
   diagnóstico, `lastDisconnectReason`. `401: logged out from another device` significa que
   alguém removeu o aparelho em *WhatsApp → Aparelhos conectados*. **Só se resolve relendo o
   QR code nessa mesma tela**, com o celular que atende.
3. **`/dashboard`** — desde 27/08 o SDR liberado que não envia há horas aparece como
   **Parado** (não mais como "Pronto"), e o alerta no topo diz o nome dele.
