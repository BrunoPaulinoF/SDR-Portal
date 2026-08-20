-- Queries de análise das conversas de um SDR.
--
-- Só leitura. Nenhuma delas escreve nada.
--
-- Cada bloco resolve o SDR pelo nome no CTE `sdr`, então dá para colar qualquer um solto num
-- cliente de SQL. Troque 'Mariana' pelo SDR que você quer analisar.
--
-- Contexto de por que este arquivo existe: docs/ACESSO-AOS-DADOS.md
-- Automação que roda tudo isso de uma vez: scripts/exportar-conversas.sh


-- 0) Quais SDRs existem, e com que configuração
select id,
       name,
       display_name,
       is_active,
       playbook,
       first_message_mode,
       ai_provider,
       ai_model,
       followup_enabled,
       followup_after_hours,
       demo_contact_name,
       handoff_name
from sdr_agents
order by name;


-- 1) O funil inteiro: leads por status e por etapa da conversa
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select status,
       conversation_stage,
       count(*) as leads
from leads
where sdr_agent_id = (select id from sdr)
group by status, conversation_stage
order by leads desc;


-- 2) A curva de abandono: quantas conversas morreram com N respostas do lead
--    (0 = nunca respondeu; 1 = respondeu a abertura e sumiu; e por aí vai)
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1),
por_conversa as (
  select c.id,
         count(*) filter (where m.direction = 'inbound')  as respostas_do_lead,
         count(*) filter (where m.direction = 'outbound') as mensagens_da_sdr
  from conversations c
  join leads l on l.id = c.lead_id
  left join messages m on m.conversation_id = c.id
  where l.sdr_agent_id = (select id from sdr)
  group by c.id
)
select respostas_do_lead,
       count(*)                          as conversas,
       round(avg(mensagens_da_sdr), 1)   as media_msgs_da_sdr
from por_conversa
group by respostas_do_lead
order by respostas_do_lead;


-- 3) Quem deu a última palavra em cada conversa parada
--    Muita conversa terminando em 'ai' = a SDR falou e ninguém respondeu.
--    Muita terminando em 'lead' = a SDR deixou o lead no vácuo (isso é bug, não desinteresse).
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1),
ultima as (
  select distinct on (m.conversation_id)
         m.conversation_id,
         m.direction,
         m.sender_type,
         m.created_at
  from messages m
  join leads l on l.id = m.lead_id
  where l.sdr_agent_id = (select id from sdr)
  order by m.conversation_id, m.created_at desc
)
select direction as ultima_direcao,
       sender_type as ultimo_autor,
       count(*) as conversas,
       count(*) filter (where created_at < now() - interval '48 hours') as paradas_ha_mais_de_48h
from ultima
group by direction, sender_type
order by conversas desc;


-- 4) Transcrição legível das conversas em que o lead respondeu
--    É esta que se lê para julgar a atuação da SDR. Ajuste o limit.
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1),
alvo as (
  select c.id
  from conversations c
  join leads l on l.id = c.lead_id
  where l.sdr_agent_id = (select id from sdr)
    and l.last_inbound_at is not null
  order by c.last_message_at desc nulls last
  limit 30
)
select m.conversation_id,
       coalesce(nullif(l.trade_name, ''), l.company_name) as lead,
       l.conversation_stage as etapa_atual,
       l.status,
       to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       case when m.direction = 'inbound' then 'LEAD' else upper(m.sender_type) end as quem,
       m.message_type as tipo,
       coalesce(nullif(m.text, ''), m.transcription, '(mídia sem texto)') as mensagem
from messages m
join alvo a on a.id = m.conversation_id
join leads l on l.id = m.lead_id
order by m.conversation_id, m.created_at;


-- 5) Vazamento de persona: a SDR se oferecendo como demonstração
--    Ela é do comercial, não é a IA de atendimento. Nada aqui deveria voltar resultado.
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       coalesce(nullif(l.trade_name, ''), l.company_name) as lead,
       m.text
from messages m
join leads l on l.id = m.lead_id
where l.sdr_agent_id = (select id from sdr)
  and m.direction = 'outbound'
  and m.text ~* '(eu mesma|testar comigo|teste comigo|faz um teste comigo|te mostro (aqui|agora|rapidinho)|manda(r)? (um )?[áa]udio (pra|para) mim|me manda(r)? (um )?[áa]udio|finge que (voc[êe]|tu)|faz de conta|simula(r)? (um )?pedido|pede (uma )?pizza (pra|para) mim)'
order by m.created_at desc;


-- 5b) Outras regras duras que a SDR não pode furar: preço, telefone, link, documento
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select case
         when m.text ~* '(r\$|mensalidade|por m[êe]s|plano \w+|desconto|reais)'   then 'preço'
         when m.text ~* '(wa\.me|https?://)'                                       then 'link'
         when m.text ~* '\d{4,5}[- ]?\d{4}'                                        then 'telefone'
         when m.text ~* '\d{2}\.?\d{3}\.?\d{3}/?\d{4}'                             then 'cnpj'
         else 'outro'
       end as regra_furada,
       count(*) as ocorrencias
from messages m
join leads l on l.id = m.lead_id
where l.sdr_agent_id = (select id from sdr)
  and m.direction = 'outbound'
  and m.sender_type = 'ai'
  and m.message_type <> 'contact'   -- o cartão de demonstração é do sistema, não é fala dela
  and m.text ~* '(r\$|mensalidade|por m[êe]s|desconto|wa\.me|https?://|\d{4,5}[- ]?\d{4})'
group by regra_furada
order by ocorrencias desc;


-- 6) A mensagem enviada está gravada duas vezes?
--    O app grava o outbound com whatsapp_message_id NULL; a UAZAPI ecoa a mesma mensagem no
--    webhook e ela é gravada de novo, com id preenchido. Não há dedupe.
--    Se as duas colunas tiverem ordem de grandeza parecida, está duplicando — e a janela de
--    20 mensagens que a IA lê cai pela metade.
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select count(*) filter (where m.whatsapp_message_id is null)     as gravadas_pelo_app,
       count(*) filter (where m.whatsapp_message_id is not null) as gravadas_pelo_webhook
from messages m
join leads l on l.id = m.lead_id
where l.sdr_agent_id = (select id from sdr)
  and m.direction = 'outbound';

-- 6b) A prova direta: mesmo texto, mesma conversa, mais de uma linha
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select m.conversation_id,
       left(m.text, 80) as trecho,
       count(*) as vezes
from messages m
join leads l on l.id = m.lead_id
where l.sdr_agent_id = (select id from sdr)
  and m.direction = 'outbound'
  and m.text is not null
group by m.conversation_id, m.text
having count(*) > 1
order by vezes desc
limit 20;


-- 7) Leads queimados: quantos morreram antes de saber o que a KyberFood é
--    'permission' e 'discovery' = ele ainda não tinha ouvido a proposta.
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select count(*)                                                                as leads_total,
       count(*) filter (where first_message_sent_at is not null)                as abordados,
       count(*) filter (where last_inbound_at is not null)                      as responderam,
       count(*) filter (where not_interested_at is not null)                    as marcados_sem_interesse,
       count(*) filter (where followup_disabled_at is not null)                 as followup_desativado,
       count(*) filter (where followup_disabled_at is not null
                          and last_inbound_at is null)                          as desativado_sem_o_lead_falar,
       count(*) filter (where not_interested_at is not null
                          and conversation_stage in ('permission', 'discovery')) as queimado_antes_de_saber_o_que_e,
       count(*) filter (where handoff_requested_at is not null)                 as handoffs
from leads
where sdr_agent_id = (select id from sdr);

-- 7b) O texto da conversa nos leads queimados cedo — para ver se era recusa mesmo ou adiamento
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1),
queimados as (
  select id, company_name, trade_name
  from leads
  where sdr_agent_id = (select id from sdr)
    and not_interested_at is not null
    and conversation_stage in ('permission', 'discovery')
  limit 40
)
select coalesce(nullif(q.trade_name, ''), q.company_name) as lead,
       to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       case when m.direction = 'inbound' then 'LEAD' else 'SDR' end as quem,
       coalesce(nullif(m.text, ''), m.transcription, '(mídia)') as mensagem
from messages m
join queimados q on q.id = m.lead_id
order by q.company_name, m.created_at;


-- 8) Saúde das chamadas de IA por finalidade
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select purpose,
       count(*)                                                as chamadas,
       count(*) filter (where error is not null)               as com_erro,
       round(avg(latency_ms) / 1000.0, 1)                      as latencia_media_s,
       percentile_disc(0.5) within group (order by latency_ms) as latencia_mediana_ms,
       sum(total_tokens)                                       as tokens,
       sum(prompt_cache_hit_tokens)                            as tokens_em_cache
from ai_runs
where sdr_agent_id = (select id from sdr)
  and created_at > now() - interval '30 days'
group by purpose
order by chamadas desc;

-- 8b) Os erros em si
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       purpose,
       left(error, 200) as erro
from ai_runs
where sdr_agent_id = (select id from sdr)
  and error is not null
order by created_at desc
limit 50;


-- 9) Cartão de demonstração: quantos foram enviados e o que aconteceu depois
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1),
enviados as (
  select distinct m.conversation_id, m.lead_id, m.created_at as enviado_em
  from messages m
  join leads l on l.id = m.lead_id
  where l.sdr_agent_id = (select id from sdr)
    and m.message_type = 'contact'
    and m.direction = 'outbound'
)
select count(*) as cartoes_enviados,
       count(*) filter (
         where exists (
           select 1 from messages r
           where r.conversation_id = e.conversation_id
             and r.direction = 'inbound'
             and r.created_at > e.enviado_em
         )
       ) as com_resposta_depois,
       count(*) filter (where l.handoff_requested_at is not null) as viraram_handoff
from enviados e
join leads l on l.id = e.lead_id;


-- 10) Handoffs: o resumo que o Igor recebeu
with sdr as (select id from sdr_agents where display_name ilike 'Mariana' limit 1)
select to_char(handoff_requested_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as quando,
       coalesce(nullif(trade_name, ''), company_name) as lead,
       conversation_stage,
       handoff_summary
from leads
where sdr_agent_id = (select id from sdr)
  and handoff_requested_at is not null
order by handoff_requested_at desc;


-- ---------------------------------------------------------------------------
-- Usuário somente leitura, se você optar por expor o banco (opção 2 do
-- docs/ACESSO-AOS-DADOS.md). Rode como superusuário e escolha uma senha forte.
--
--   create role claude_leitura login password '<troque>';
--   grant connect on database sdrportal to claude_leitura;
--   grant usage on schema public to claude_leitura;
--   grant select on all tables in schema public to claude_leitura;
--   alter default privileges in schema public grant select on tables to claude_leitura;
--
-- Esse papel não enxerga nada além de select, mas ainda alcança as colunas
-- *_encrypted. Se isso incomodar, restrinja o grant tabela a tabela.
-- ---------------------------------------------------------------------------
