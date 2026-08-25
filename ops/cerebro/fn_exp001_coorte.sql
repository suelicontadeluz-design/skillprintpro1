-- ============================================================================
-- public.fn_exp001_coorte(p_amostra int)
-- EXP-001 - coorte elegivel e randomizada. READ-ONLY. NAO ENVIA NADA.
--
-- Contrato:
--   - LANGUAGE sql, STABLE -> o Postgres recusa DML dentro dela.
--   - SECURITY INVOKER. Nao chama nenhuma funcao VOLATILE nem SECURITY DEFINER.
--   - Nao envia mensagem, nao enfileira, nao marca lead. So le e devolve jsonb.
--
-- Por que NAO chama fn_guardrail_whatsapp_campaign():
--   ela e VOLATILE + SECURITY DEFINER. Chama-la aqui quebraria a estabilidade
--   (T11) e elevaria privilegio. A regra e REPLICADA em leitura, em duas
--   versoes, e a divergencia entre elas e publicada.
--
-- Politica vigente x corrigida:
--   fn_score_lead_campanha() usa propostas_rd.inserido_em, que e a data em que a
--   linha entrou NESTE banco (sync), nao a data da proposta no RD
--   (created_at_rd). Em 25/08/2026: 9.080 propostas com inserido_em nos ultimos
--   30 dias, mas apenas 1.233 criadas no RD nesse periodo - 7.847 sao backfill.
--   Efeito: leads dormentes ha meses sao classificados 'quente' e liberados para
--   WhatsApp. A funcao devolve os dois calculos lado a lado e NAO escolhe por voce.
-- ============================================================================
-- ============================================================================
-- PROVA DE DEPLOY (25/08/2026)
--   Migration: fn_exp001_coorte (projeto ldrdtaibazplvrbwyrvx)
--   LIVE: LANGUAGE sql | STABLE | SECURITY INVOKER | search_path=public
--   prosrc 8.573 chars. Identidade arquivo x LIVE (normalizada):
--     md5 = bd09bcb7a81ee39284625cfc12e5bc32 / 7.978 chars -> BATE nos dois lados
--   T1..T12 passaram. T10: pg_current_xact_id_if_assigned() = NULL apos a chamada.
--   T11: hash_divisao estavel = fb6f020a27982f6d71b7e3c6610135fb
--   T12: prosrc nao contem INSERT INTO / UPDATE SET / DELETE FROM / PERFORM /
--        EXECUTE / net.http / DDL. Os termos "WhatsApp" e "disparo" so aparecem
--        dentro de strings de documentacao.
--   Performance: ~29s em cache frio, ~1s depois.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_exp001_coorte(p_amostra integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with
cfg as (select 'exp-proatividade-001'::text experimento_id,
               least(greatest(coalesce(p_amostra,20),0),200) n_amostra),
tel_colidido as (
  select telefone from lead_identificadores
  where telefone is not null and length(telefone)=13 and telefone <> '0000000000000'
  group by 1 having count(distinct lead_id) > 1
),
tel as (
  select i.lead_id, min(i.telefone) telefone
  from lead_identificadores i
  where i.telefone is not null and length(i.telefone)=13 and i.telefone <> '0000000000000'
    and i.telefone not in (select telefone from tel_colidido)
  group by i.lead_id having count(distinct i.telefone) = 1
),
conv as (
  select f.lead_id,
    count(*) filter (where f.direction='inbound')  inbound_total,
    count(*) filter (where f.direction='outbound') outbound_total,
    max(f."timestamp") ultima_atividade,
    max(f.created_at) filter (where f.direction='inbound') ultimo_inbound_created
  from fact_conversations f where f.lead_id is not null group by 1
),
pur as (
  select p.lead_id, count(*) compras_total, max(p.event_time) ultima_compra,
    count(*) filter (where p.value>0 and p.event_time >= now()-interval '60 days') compras_60d
  from pixel_events p where p.event_name='Purchase' and p.lead_id is not null group by 1
),
prop as (
  select pr.lead_id,
    count(*) filter (where pr.inserido_em   >= now()-interval '30 days') prop_sync_30d,
    count(*) filter (where pr.created_at_rd >= now()-interval '30 days') prop_real_30d
  from propostas_rd pr where pr.lead_id is not null group by 1
),
chk as (
  select p.lead_id from pixel_events p
  where p.event_name='InitiateCheckout' and p.event_time >= now()-interval '30 days' and p.lead_id is not null
  group by 1
),
bloq as (
  select lead_id from julia_modos_lead where modo like 'bloqueada%' or modo='pausada'
  union select lead_id from agente_conversacao_estado
    where status in ('bloqueada_humano','handoff_humano','em_progresso')
),
optout as (select lead_id from crm_contact_optouts where revogado_em is null),
elegivel as (
  select l.lead_id, t.telefone, l.created_at, l.utm_source, l.utm_campaign_id,
    coalesce(l.is_organic,false) organico,
    extract(epoch from (now()-l.created_at))/86400 idade_dias,
    coalesce(c.inbound_total,0) inbound_total, coalesce(c.outbound_total,0) outbound_total,
    coalesce(p.compras_total,0) compras_total, coalesce(p.compras_60d,0) compras_60d,
    coalesce(pp.prop_sync_30d,0) prop_sync_30d, coalesce(pp.prop_real_30d,0) prop_real_30d,
    (k.lead_id is not null) checkout_30d,
    coalesce(extract(day from now()-c.ultimo_inbound_created)::int, 9999) inb_dias,
    s.classificacao score_atual,
    (get_byte(decode(md5(l.lead_id::text || (select experimento_id from cfg)),'hex'),0) & 1) braco_bit
  from leads_marketing l
  join tel t on t.lead_id = l.lead_id
  left join conv c on c.lead_id = l.lead_id
  left join pur  p on p.lead_id = l.lead_id
  left join prop pp on pp.lead_id = l.lead_id
  left join chk  k on k.lead_id = l.lead_id
  left join lead_score_comercial s on s.lead_id = l.lead_id
  where l.created_at < now()-interval '30 days'
    and (c.ultima_atividade is null or c.ultima_atividade < now()-interval '30 days')
    and (p.ultima_compra   is null or p.ultima_compra   < now()-interval '30 days')
    and not exists (select 1 from optout o where o.lead_id = l.lead_id)
    and not exists (select 1 from bloq  b where b.lead_id = l.lead_id)
),
marcado as (
  select e.*,
    case when braco_bit=0 then 'CONTROLE' else 'TRATAMENTO' end braco,
    case when compras_60d>0 then 'cliente_ativo'
         when prop_sync_30d>0 or checkout_30d or inb_dias<=14 then 'quente'
         when inb_dias<=45 then 'morno' else 'frio' end pol_vigente,
    case when compras_60d>0 then 'cliente_ativo'
         when prop_real_30d>0 or checkout_30d or inb_dias<=14 then 'quente'
         when inb_dias<=45 then 'morno' else 'frio' end pol_corrigida
  from elegivel e
),
resumo as (
  select count(*) total,
    count(*) filter (where braco='TRATAMENTO') n_trat,
    count(*) filter (where braco='CONTROLE')   n_ctrl,
    count(*) filter (where pol_vigente  not in ('frio','cliente_ativo')) liberados_politica_vigente,
    count(*) filter (where pol_corrigida not in ('frio','cliente_ativo')) liberados_politica_corrigida,
    count(*) filter (where pol_vigente='quente' and pol_corrigida='frio') falsos_quentes_por_backfill
  from marcado
),
balanco as (
  select coalesce(jsonb_object_agg(braco, obj),'{}'::jsonb) j from (
    select braco, jsonb_build_object(
      'n', count(*),
      'pct_organico', round(100.0*count(*) filter (where organico)/count(*),2),
      'pct_com_campanha', round(100.0*count(*) filter (where utm_campaign_id is not null)/count(*),2),
      'idade_media_dias', round(avg(idade_dias)::numeric,1),
      'idade_mediana_dias', round(percentile_cont(0.5) within group (order by idade_dias)::numeric,1),
      'pct_ja_comprou', round(100.0*count(*) filter (where compras_total>0)/count(*),2),
      'pct_ja_conversou', round(100.0*count(*) filter (where inbound_total>0 or outbound_total>0)/count(*),2),
      'inbound_medio', round(avg(inbound_total)::numeric,2),
      'pct_com_score_atual', round(100.0*count(*) filter (where score_atual is not null)/count(*),2),
      'pct_liberado_politica_corrigida', round(100.0*count(*) filter (where pol_corrigida not in ('frio','cliente_ativo'))/count(*),2)
    ) obj from marcado group by braco
  ) x
),
amostra as (
  select coalesce(jsonb_agg(j order by braco, ord),'[]'::jsonb) j from (
    select braco, row_number() over (partition by braco order by md5(lead_id::text)) ord,
      jsonb_build_object(
        'lead_id', lead_id,
        'telefone_mascarado', substr(telefone,1,4)||'*****'||right(telefone,4),
        'braco', braco,
        'idade_dias', round(idade_dias::numeric,0),
        'origem', jsonb_build_object('utm_source',utm_source,'campanha',utm_campaign_id,'organico',organico),
        'historico', jsonb_build_object('inbound_total',inbound_total,'outbound_total',outbound_total,
                                        'ultimo_inbound_dias', case when inb_dias=9999 then null else inb_dias end),
        'compra_previa', jsonb_build_object('ja_comprou',compras_total>0,'compras_total',compras_total),
        'score_atual', jsonb_build_object('valor',score_atual,'aviso','classificacao_atual_nao_historica'),
        'politica_whatsapp', jsonb_build_object(
          'vigente', pol_vigente, 'corrigida', pol_corrigida,
          'divergente', (pol_vigente is distinct from pol_corrigida),
          'liberado_se_corrigida', (pol_corrigida not in ('frio','cliente_ativo'))),
        'gates_aplicados', jsonb_build_object(
          'idade_min_30d',true,'sem_atividade_30d',true,'telefone_unico_valido',true,
          'sem_optout',true,'sem_compra_30d',true,'sem_bloqueio_ou_handoff',true,'sem_duplicidade',true),
        'motivo_elegibilidade','lead dormente ha 30+ dias com telefone unico valido, sem optout, sem compra recente, sem bloqueio ativo'
      ) j
    from marcado
  ) y where ord <= (select n_amostra from cfg)
)
select jsonb_build_object(
  'versao','fn_exp001_coorte/1',
  'experimento_id',(select experimento_id from cfg),
  'gerado_em', now(),
  'envia_mensagem', false,
  'natureza','READ-ONLY: esta funcao apenas descreve quem entraria no teste e em qual grupo. Nao envia, nao enfileira, nao marca.',
  'randomizacao', jsonb_build_object(
    'metodo','get_byte(decode(md5(lead_id::text || experimento_id),''hex''),0) & 1',
    'deterministica', true, 'usa_random', false,
    'hash_divisao',(select md5(string_agg(lead_id::text||':'||braco, ',' order by lead_id)) from marcado)),
  'resumo',(select jsonb_build_object(
     'total_elegivel',total,'tratamento',n_trat,'controle',n_ctrl,
     'desbalanceamento_pct', round(100.0*abs(n_trat-n_ctrl)/nullif(total,0),3),
     'liberados_politica_vigente',liberados_politica_vigente,
     'liberados_politica_corrigida',liberados_politica_corrigida,
     'falsos_quentes_por_backfill',falsos_quentes_por_backfill) from resumo),
  'balanceamento',(select j from balanco),
  'amostra',(select j from amostra),
  'alerta_politica', jsonb_build_object(
    'descricao','fn_score_lead_campanha() usa propostas_rd.inserido_em (data de sync) em vez de created_at_rd (data real da proposta no RD). Isso classifica leads dormentes como quente e os libera para WhatsApp.',
    'severidade','alta',
    'escopo','afeta a politica de disparo em producao, nao apenas este experimento',
    'nao_corrigido_aqui','esta funcao apenas expoe a divergencia; nada foi alterado')
);
$function$;
