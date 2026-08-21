#!/usr/bin/env bash
#
# Exporta as conversas de um SDR para arquivos legíveis, para análise fora do portal.
#
# Só faz SELECT. Não escreve nada no banco e não põe segredo nenhum no pacote gerado.
#
# Precisa rodar de onde o banco é alcançável E onde exista psql — na prática, na VPS.
# O Console do container do portal não serve: a imagem não copia scripts/ nem tem psql.
# De uma sessão do Claude Code na web o host do banco não resolve; o porquê está em
# docs/ACESSO-AOS-DADOS.md.
#
# Uso:
#   ./scripts/exportar-conversas.sh --sdr "Mariana" --dias 30
#   ./scripts/exportar-conversas.sh --checar          # só testa a conexão e sai
#
# Conexão: usa $EXPORT_DATABASE_URL quando existir, senão $DATABASE_URL.

set -euo pipefail

SDR="Mariana"
DIAS=30
SAIDA=""
TZ_LEAD="America/Sao_Paulo"
SO_CHECAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --sdr)     SDR="${2:?--sdr precisa de um valor}"; shift 2 ;;
    --dias)    DIAS="${2:?--dias precisa de um valor}"; shift 2 ;;
    --saida)   SAIDA="${2:?--saida precisa de um valor}"; shift 2 ;;
    --tz)      TZ_LEAD="${2:?--tz precisa de um valor}"; shift 2 ;;
    --checar)  SO_CHECAR=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

case "$DIAS" in
  ''|*[!0-9]*) echo "--dias precisa ser um número inteiro (recebi: $DIAS)" >&2; exit 2 ;;
esac

DB_URL="${EXPORT_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Nem EXPORT_DATABASE_URL nem DATABASE_URL estão definidas." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql não encontrado no PATH. Instale o cliente do Postgres (postgresql-client)." >&2
  exit 1
fi

# psql -X ignora o ~/.psqlrc do usuário, para o output não vir formatado de um jeito inesperado.
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB_URL")

ERRO_CONEXAO="$(mktemp)"
trap 'rm -f "$ERRO_CONEXAO"' EXIT

if ! "${PSQL[@]}" -At -c 'select 1' >/dev/null 2>"$ERRO_CONEXAO"; then
  echo "Não consegui conectar no banco." >&2
  echo >&2
  sed 's/^/  /' "$ERRO_CONEXAO" >&2 || true
  echo >&2
  echo "Se o erro fala em 'could not translate host name', você está fora da rede Docker do" >&2
  echo "portal: o host da DATABASE_URL é um nome de serviço interno. Rode este script na VPS" >&2
  echo "ou no shell do container, ou veja as três opções em docs/ACESSO-AOS-DADOS.md." >&2
  exit 1
fi

SDR_ID="$("${PSQL[@]}" -At -c \
  "select id from sdr_agents where display_name ilike '${SDR//\'/\'\'}' or name ilike '%${SDR//\'/\'\'}%' order by display_name limit 1")"

if [ -z "$SDR_ID" ]; then
  echo "Nenhum SDR encontrado para \"$SDR\". Os que existem:" >&2
  "${PSQL[@]}" -c 'select name, display_name, is_active, playbook from sdr_agents order by name' >&2
  exit 1
fi

SDR_NOME="$("${PSQL[@]}" -At -c "select display_name from sdr_agents where id = '$SDR_ID'")"
echo "SDR: $SDR_NOME ($SDR_ID)"

if [ "$SO_CHECAR" = "1" ]; then
  echo "Conexão OK. Nada exportado (--checar)."
  exit 0
fi

SLUG="$(printf '%s' "$SDR_NOME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//')"
DIR="${SAIDA:-conversas-$SLUG-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$DIR"

Q=(-v "sdr=$SDR_ID" -v "dias=$DIAS" -v "tz=$TZ_LEAD")

echo "Exportando os últimos $DIAS dias para $DIR/ ..."

# ---------------------------------------------------------------- transcrições
"${PSQL[@]}" "${Q[@]}" -At -o "$DIR/conversas.txt" <<'SQL'
with base as (
  select m.conversation_id,
         m.created_at,
         coalesce(nullif(l.trade_name, ''), l.company_name)                      as lead,
         l.conversation_stage                                                    as etapa,
         l.status                                                                as status,
         to_char(m.created_at at time zone :'tz', 'DD/MM HH24:MI')               as quando,
         case when m.direction = 'inbound' then 'LEAD' else upper(m.sender_type) end as quem,
         case when m.message_type = 'contact'
              then '(cartão de contato de demonstração enviado pelo sistema)'
              else coalesce(nullif(m.text, ''), m.transcription, '(mídia sem texto)') end as mensagem
  from messages m
  join leads l on l.id = m.lead_id
  where l.sdr_agent_id = :'sdr'::uuid
    and m.created_at > now() - (:'dias' || ' days')::interval
)
select case
         when lag(conversation_id) over (order by conversation_id, created_at)
              is distinct from conversation_id
         then E'\n\n===== ' || lead || '   [etapa: ' || etapa || ' | status: ' || status || E'] =====\n'
         else ''
       end
       || '[' || quando || '] ' || quem || ': ' || replace(mensagem, E'\n', ' / ')
from base
order by conversation_id, created_at;
SQL

# ------------------------------------------------------------------- resumo
"${PSQL[@]}" "${Q[@]}" -o "$DIR/resumo.txt" <<'SQL'
\qecho '== 1. Funil: leads por status e etapa =='
select status, conversation_stage, count(*) as leads
from leads where sdr_agent_id = :'sdr'::uuid
group by status, conversation_stage order by leads desc;

\qecho ''
\qecho '== 2. Curva de abandono: conversas por nº de respostas do lead =='
with por_conversa as (
  select c.id,
         count(*) filter (where m.direction = 'inbound')  as respostas_do_lead,
         count(*) filter (where m.direction = 'outbound') as mensagens_da_sdr
  from conversations c
  join leads l on l.id = c.lead_id
  left join messages m on m.conversation_id = c.id
  where l.sdr_agent_id = :'sdr'::uuid
  group by c.id
)
select respostas_do_lead, count(*) as conversas, round(avg(mensagens_da_sdr), 1) as media_msgs_da_sdr
from por_conversa group by respostas_do_lead order by respostas_do_lead;

\qecho ''
\qecho '== 3. Quem deu a última palavra (outbound parado = lead sumiu; inbound parado = SDR deixou no vácuo) =='
with ultima as (
  select distinct on (m.conversation_id) m.conversation_id, m.direction, m.sender_type, m.created_at
  from messages m join leads l on l.id = m.lead_id
  where l.sdr_agent_id = :'sdr'::uuid
  order by m.conversation_id, m.created_at desc
)
select direction as ultima_direcao, sender_type as ultimo_autor, count(*) as conversas,
       count(*) filter (where created_at < now() - interval '48 hours') as paradas_ha_mais_48h
from ultima group by direction, sender_type order by conversas desc;

\qecho ''
\qecho '== 4. Leads queimados e handoffs =='
select count(*) as leads_total,
       count(*) filter (where first_message_sent_at is not null) as abordados,
       count(*) filter (where last_inbound_at is not null) as responderam,
       count(*) filter (where not_interested_at is not null) as marcados_sem_interesse,
       count(*) filter (where followup_disabled_at is not null) as followup_desativado,
       count(*) filter (where followup_disabled_at is not null and last_inbound_at is null) as desativado_sem_o_lead_falar,
       count(*) filter (where not_interested_at is not null
                          and conversation_stage in ('permission','discovery')) as queimado_antes_de_saber_o_que_e,
       count(*) filter (where handoff_requested_at is not null) as handoffs
from leads where sdr_agent_id = :'sdr'::uuid;

\qecho ''
\qecho '== 5. Vazamento de persona: a SDR se oferecendo como demonstração (o certo é zero) =='
select to_char(m.created_at at time zone :'tz', 'DD/MM HH24:MI') as quando,
       coalesce(nullif(l.trade_name, ''), l.company_name) as lead, m.text
from messages m join leads l on l.id = m.lead_id
where l.sdr_agent_id = :'sdr'::uuid and m.direction = 'outbound'
  and m.text ~* '(eu mesma|testar comigo|teste comigo|te mostro (aqui|agora|rapidinho)|manda(r)? (um )?[áa]udio (pra|para) mim|me manda(r)? (um )?[áa]udio|finge que (voc[êe]|tu)|faz de conta|simula(r)? (um )?pedido)'
order by m.created_at desc;

\qecho ''
\qecho '== 6. Outbound duplicado? (colunas parecidas = a UAZAPI está ecoando e o app grava 2x) =='
select count(*) filter (where m.whatsapp_message_id is null)     as gravadas_pelo_app,
       count(*) filter (where m.whatsapp_message_id is not null) as gravadas_pelo_webhook
from messages m join leads l on l.id = m.lead_id
where l.sdr_agent_id = :'sdr'::uuid and m.direction = 'outbound';

\qecho ''
\qecho '== 7. Chamadas de IA por finalidade (últimos 30 dias) =='
select purpose, count(*) as chamadas, count(*) filter (where error is not null) as com_erro,
       round(avg(latency_ms)/1000.0, 1) as latencia_media_s,
       sum(total_tokens) as tokens, sum(prompt_cache_hit_tokens) as tokens_em_cache
from ai_runs where sdr_agent_id = :'sdr'::uuid and created_at > now() - interval '30 days'
group by purpose order by chamadas desc;

\qecho ''
\qecho '== 8. Cartão de demonstração: enviados x respondidos x handoff =='
with enviados as (
  select distinct m.conversation_id, m.lead_id, m.created_at as enviado_em
  from messages m join leads l on l.id = m.lead_id
  where l.sdr_agent_id = :'sdr'::uuid and m.message_type = 'contact' and m.direction = 'outbound'
)
select count(*) as cartoes_enviados,
       count(*) filter (where exists (
         select 1 from messages r where r.conversation_id = e.conversation_id
           and r.direction = 'inbound' and r.created_at > e.enviado_em)) as com_resposta_depois,
       count(*) filter (where l.handoff_requested_at is not null) as viraram_handoff
from enviados e join leads l on l.id = e.lead_id;
SQL

# --------------------------------------------------------------------- CSVs
"${PSQL[@]}" "${Q[@]}" <<SQL
\copy (select m.conversation_id, m.lead_id, m.created_at, m.direction, m.sender_type, m.message_type, m.text, m.transcription, (m.whatsapp_message_id is not null) as veio_do_webhook from messages m join leads l on l.id = m.lead_id where l.sdr_agent_id = '$SDR_ID' and m.created_at > now() - interval '$DIAS days' order by m.conversation_id, m.created_at) to '$DIR/mensagens.csv' csv header
\copy (select id, company_name, trade_name, segment, city, state, status, conversation_stage, source, first_message_sent_at, last_inbound_at, last_outbound_at, followup_sent_at, followup_disabled_at, not_interested_at, handoff_requested_at, handoff_summary from leads where sdr_agent_id = '$SDR_ID' order by created_at) to '$DIR/leads.csv' csv header
\copy (select created_at, purpose, provider, model, error, latency_ms, prompt_tokens, completion_tokens, total_tokens, prompt_cache_hit_tokens, output_text from ai_runs where sdr_agent_id = '$SDR_ID' and created_at > now() - interval '$DIAS days' order by created_at) to '$DIR/ai_runs.csv' csv header
SQL

TAR="$DIR.tar.gz"
tar -czf "$TAR" "$DIR"

echo
echo "Pronto:"
ls -la "$DIR"
echo
echo "Pacote para anexar na conversa: $TAR"
echo
echo "Confira antes de enviar: os CSVs trazem texto de conversa real com nome e telefone de"
echo "lead. Nenhum segredo do .env vai junto — nada aqui lê coluna *_encrypted."
