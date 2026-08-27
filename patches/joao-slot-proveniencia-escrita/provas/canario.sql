-- CANARIO DA FASE 1 (v4.37.0, Edge 180). Somente leitura.
-- Marco zero do deploy: 2026-08-27 03:36:50+00.

-- 1. ADOCAO: os turnos ja estao rodando a versao nova?
select agent_version, count(*) as turnos, min(created_at) as primeiro, max(created_at) as ultimo
from joao_slots_observacao
where created_at >= timestamptz '2026-08-27 03:36:50+00'
group by 1 order by 2 desc;

-- 2. A PORTA EM ACAO: slot critico recusado por falta de proveniencia.
--    payload traz {slot, valor, motivo} de cada recusa.
select created_at, error_message, payload
from error_log
where function_name = 'agente-noturno'
  and error_message in ('slot_critico_sem_proveniencia', 'slot_produto_fora_do_vocabulario')
  and created_at >= timestamptz '2026-08-27 03:36:50+00'
order by created_at desc;

-- 3. RECUSAS POR SLOT E MOTIVO (agregado).
select r->>'slot' as slot, r->>'motivo' as motivo, count(*) as n
from error_log e, lateral jsonb_array_elements(e.payload->'rejeitados') r
where e.function_name = 'agente-noturno'
  and e.error_message = 'slot_critico_sem_proveniencia'
  and e.created_at >= timestamptz '2026-08-27 03:36:50+00'
group by 1, 2 order by n desc;

-- 4. MUDANCAS LEGITIMAS ACEITAS: produto/quantidade que PASSARAM a porta.
select count(*) filter (where slots_antes->>'produto' is null and slots_depois->>'produto' is not null) as produto_criado,
       count(*) filter (where slots_antes->>'produto' is not null and slots_depois->>'produto' is not null
                          and slots_antes->>'produto' <> slots_depois->>'produto')                      as produto_trocado,
       count(*) filter (where slots_antes->>'quantidade' is null and slots_depois->>'quantidade' is not null) as quantidade_criada,
       count(*) filter (where slots_depois->>'modalidade_logistica' is not null)                          as modalidade_persistida,
       count(*)                                                                                          as turnos
from joao_slots_observacao
where created_at >= timestamptz '2026-08-27 03:36:50+00';

-- 5. CONTAMINACAO RESIDUAL: produto preenchido que o vocabulario nao reconhece.
select slots_depois->>'produto' as token, count(*) as n
from joao_slots_observacao
where created_at >= timestamptz '2026-08-27 03:36:50+00'
  and slots_depois->>'produto' is not null and produto_macro is null
group by 1 order by n desc;

-- 6. REGRESSAO: erros novos depois do deploy que nao existiam nas 24h anteriores.
with depois as (
  select error_message, count(*) n from error_log
  where function_name='agente-noturno' and created_at >= timestamptz '2026-08-27 03:36:50+00'
  group by 1
), antes as (
  select distinct error_message from error_log
  where function_name='agente-noturno'
    and created_at >= timestamptz '2026-08-27 03:36:50+00' - interval '24 hours'
    and created_at <  timestamptz '2026-08-27 03:36:50+00'
)
select d.error_message, d.n, (a.error_message is not null) as ja_existia_antes
from depois d left join antes a using (error_message)
order by ja_existia_antes, d.n desc;

-- 7. FINANCEIRO/LOGISTICA: as guardas anteriores seguem estaveis?
select error_message, count(*) as n
from error_log
where function_name='agente-noturno'
  and created_at >= timestamptz '2026-08-27 03:36:50+00'
  and error_message ~ 'pix|autorizacao|operation_id|preco|frete|cep|correios|rendimento|calcme'
group by 1 order by n desc;

-- 8. LATENCIA do turno (ms), antes x depois.
select case when created_at >= timestamptz '2026-08-27 03:36:50+00' then 'depois' else 'antes' end as fase,
       count(*) as turnos, round(avg(duracao_ms)) as media_ms,
       percentile_disc(0.95) within group (order by duracao_ms) as p95_ms
from agente_decisoes_log
where agente_slug='agente-noturno' and duracao_ms is not null
  and created_at >= timestamptz '2026-08-27 03:36:50+00' - interval '24 hours'
group by 1;
