-- ============================================================================
-- public.fn_exp001_coorte(p_amostra int)
-- EXP-001-REAQUECIMENTO-31-45D - coorte elegivel e randomizada. READ-ONLY.
-- NAO ENVIA NADA. NAO ENFILEIRA. NAO MARCA LEAD.
--
-- Historico: a v1 desta funcao servia a hipotese "proatividade cria conversa em
-- quem nunca conversou". Essa populacao foi refutada em 25/08/2026: apos corrigir
-- fn_score_lead_campanha (bugs inserido_em e status='open'), a politica so libera
-- leads que JA conversaram e esfriaram - media de 10,6 inbounds. A hipotese foi
-- reescrita para a populacao real em vez de forcar a populacao a hipotese.
--
-- A JANELA 31-45 DIAS NAO E ARBITRARIA. E a interseccao de duas regras que ja
-- existiam: o gate de coorte exige >=31 dias sem atividade, e fn_score_lead_campanha
-- classifica como 'morno' quem tem ultimo inbound <=45 dias. Fora dela o lead ou
-- esta ativo (<=30d) ou e 'frio' e bloqueado pela politica (>45d).
-- ============================================================================
-- ============================================================================
-- PROVA DE DEPLOY v2 (25/08/2026)
--   Migrations: fn_exp001_coorte_v2_reaquecimento_31_45d
--             + fn_exp001_coorte_v2_balanceamento_por_estrato
--   LIVE: LANGUAGE sql | STABLE | SECURITY INVOKER | search_path=public
--   md5(prosrc) = 8be3ea0aa38a813c40591138624904a8, igual ao hash calculado
--     ANTES do segundo deploy aplicando so as duas adicoes ao corpo publicado.
--   Identidade arquivo x LIVE (normalizada):
--     md5 = 033462313fcfeace902560492c7f3192 / 10.767 chars -> BATE.
--   T1..T14 passaram. T12: pg_current_xact_id_if_assigned() = NULL apos a chamada.
--   T14: hash_divisao estavel = 88c97e412502289ea24e8c048c1be11a
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_exp001_coorte(p_amostra integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with
cfg as (select 'EXP-001-REAQUECIMENTO-31-45D'::text experimento_id,
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
    max(f.created_at) filter (where f.direction='inbound') ultimo_inbound
  from fact_conversations f where f.lead_id is not null group by 1
),
pur as (
  select p.lead_id, count(*) compras_total, max(p.event_time) ultima_compra,
    round(sum(p.value)::numeric,2) receita_historica,
    count(*) filter (where p.value>0 and p.event_time >= now()-interval '60 days') compras_60d
  from pixel_events p where p.event_name='Purchase' and p.lead_id is not null group by 1
),
prop30 as (select distinct lead_id from propostas_rd
           where created_at_rd >= now()-interval '30 days' and lead_id is not null),
chk30 as (select distinct lead_id from pixel_events
          where event_name='InitiateCheckout' and event_time >= now()-interval '30 days' and lead_id is not null),
task_pend as (select distinct lead_id from crm_tasks where status='pendente' and lead_id is not null),
-- bloqueio / atendimento ativo, nas TRES tabelas de estado que existem
bloq as (
  select lead_id from julia_modos_lead where modo like 'bloqueada%' or modo='pausada'
  union select lead_id from agente_conversacao_estado
    where status in ('bloqueada_humano','handoff_humano','em_progresso')
  union select lead_id from agente_exploracao_estado
    where status in ('bloqueada_humano','handoff_humano','bloqueada_purchase','aguardando_confirmacao')
),
-- leads que o cron vigia-leads-mornos-diario ainda alcanca: contaminacao evitavel
alvo_vigia as (
  select ae.lead_id from agente_exploracao_estado ae
  where ae.trocas >= 5 and ae.status = 'em_progresso'
    and (current_date - ae.updated_at::date) between 3 and 30
),
optout as (select lead_id from crm_contact_optouts where revogado_em is null),
base as (
  select l.lead_id, t.telefone, l.created_at, l.utm_source, l.utm_campaign_id,
    coalesce(l.is_organic,false) organico,
    extract(epoch from (now()-l.created_at))/86400 idade_dias,
    c.inbound_total, c.outbound_total, c.ultimo_inbound,
    extract(day from now()-c.ultimo_inbound)::int inb_dias,
    coalesce(p.compras_total,0) compras_total,
    coalesce(p.receita_historica,0) receita_historica,
    s.classificacao score_atual,
    (pr.lead_id is not null) tem_proposta30,
    (k.lead_id is not null) tem_checkout30,
    (tp.lead_id is not null) tem_task_pendente
  from leads_marketing l
  join tel  t on t.lead_id = l.lead_id
  join conv c on c.lead_id = l.lead_id
  left join pur p on p.lead_id = l.lead_id
  left join lead_score_comercial s on s.lead_id = l.lead_id
  left join prop30 pr on pr.lead_id = l.lead_id
  left join chk30  k on k.lead_id = l.lead_id
  left join task_pend tp on tp.lead_id = l.lead_id
  where c.ultimo_inbound is not null
    and extract(day from now()-c.ultimo_inbound)::int between 31 and 45
    and c.ultima_atividade < now()-interval '30 days'
    and coalesce(p.compras_60d,0) = 0
    and not exists (select 1 from optout o where o.lead_id = l.lead_id)
    and not exists (select 1 from bloq  b where b.lead_id = l.lead_id)
    and not exists (select 1 from alvo_vigia v where v.lead_id = l.lead_id)
),
-- separacao: o EXP principal testa UMA pergunta. Outros motivos de liberacao saem fora.
principal as (
  select b.*, case when (get_byte(decode(md5(b.lead_id::text || (select experimento_id from cfg)),'hex'),0) & 1)=0
                   then 'CONTROLE' else 'TRATAMENTO' end braco
  from base b
  where not b.tem_proposta30 and not b.tem_checkout30 and not b.tem_task_pendente
),
fora as (
  select case when tem_task_pendente then 'task_pendente'
              when tem_proposta30 then 'proposta_recente_rd'
              else 'checkout_30d' end motivo, count(*) n
  from base where tem_proposta30 or tem_checkout30 or tem_task_pendente
  group by 1
),
resumo as (
  select count(*) total, count(*) filter (where braco='TRATAMENTO') n_trat,
         count(*) filter (where braco='CONTROLE') n_ctrl from principal
),
-- O braco vem de hash puro do lead_id: imutavel, nao muda se a coorte mudar.
-- O preco disso e variancia de contagem com n pequeno. Publicada, nao escondida.
estratos as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'estrato', faixa, 'n', n, 'tratamento', trat, 'controle', n-trat,
    'pct_tratamento', round(100.0*trat/n,1)) order by faixa),'[]'::jsonb) j
  from (
    select case when inb_dias between 31 and 35 then '31-35d'
                when inb_dias between 36 and 40 then '36-40d' else '41-45d' end faixa,
           count(*) n, count(*) filter (where braco='TRATAMENTO') trat
    from principal group by 1
  ) e
),
balanco as (
  select coalesce(jsonb_object_agg(braco, obj),'{}'::jsonb) j from (
    select braco, jsonb_build_object(
      'n', count(*),
      'dias_desde_ultimo_inbound_media', round(avg(inb_dias)::numeric,2),
      'dias_desde_ultimo_inbound_mediana', round(percentile_cont(0.5) within group (order by inb_dias)::numeric,1),
      'inbounds_historicos_media', round(avg(inbound_total)::numeric,2),
      'outbounds_historicos_media', round(avg(outbound_total)::numeric,2),
      'idade_lead_media_dias', round(avg(idade_dias)::numeric,1),
      'pct_organico', round(100.0*count(*) filter (where organico)/count(*),2),
      'pct_com_campanha', round(100.0*count(*) filter (where utm_campaign_id is not null)/count(*),2),
      'pct_ja_comprou', round(100.0*count(*) filter (where compras_total>0)/count(*),2),
      'ticket_historico_medio', round(avg(receita_historica) filter (where compras_total>0)::numeric,2),
      'pct_com_score_atual', round(100.0*count(*) filter (where score_atual is not null)/count(*),2),
      'fontes', (select jsonb_object_agg(coalesce(us,'(null)'), q) from
                 (select utm_source us, count(*) q from principal p2 where p2.braco=p1.braco group by 1) z)
    ) obj from principal p1 group by braco
  ) x
),
amostra as (
  select coalesce(jsonb_agg(j order by braco, ord),'[]'::jsonb) j from (
    select braco, row_number() over (partition by braco order by md5(lead_id::text)) ord,
      jsonb_build_object(
        'lead_id', lead_id,
        'telefone_mascarado', substr(telefone,1,4)||'*****'||right(telefone,4),
        'braco', braco,
        'dias_desde_ultimo_inbound', inb_dias,
        'inbounds_historicos', inbound_total,
        'outbounds_historicos', outbound_total,
        'idade_lead_dias', round(idade_dias::numeric,0),
        'origem', jsonb_build_object('utm_source',utm_source,'campanha',utm_campaign_id,'organico',organico),
        'compra_previa', jsonb_build_object('ja_comprou',compras_total>0,'compras',compras_total,
                                            'receita_historica',receita_historica),
        'score_atual', jsonb_build_object('valor',score_atual,'aviso','classificacao_atual_nao_historica')
      ) j
    from principal
  ) y where ord <= (select n_amostra from cfg)
)
select jsonb_build_object(
  'versao','fn_exp001_coorte/2',
  'experiment_id',(select experimento_id from cfg),
  'hipotese','Contato proativo aumenta a probabilidade de retomada de conversa em leads que ja conversaram e estao inativos ha 31-45 dias.',
  'nao_afirma', jsonb_build_array(
    'nao afirma efeito sobre venda',
    'nao afirma causalidade antes do teste',
    'nao extrapola para leads que nunca conversaram'),
  'gerado_em', now(),
  'envia_mensagem', false,
  'natureza','READ-ONLY: descreve quem entraria no teste e em qual grupo. Nao envia, nao enfileira, nao marca.',
  'risco_canal', jsonb_build_object(
    'status','RISCO_CANAL_NAO_VALIDADO',
    'impede_envio', true,
    'motivos', jsonb_build_array(
      'o mesmo numero atende clientes ativos',
      'mecanismo de opt-out quase nunca exercitado em volume',
      'BotConversa nao confirma entrega: retorno vazio, identidade so pelo eco posterior da Z-API',
      'canal nao-oficial pode sofrer bloqueio ou restricao')),
  'populacao', jsonb_build_object(
    'nome','REAQUECIMENTO_31_45D',
    'janela_origem','interseccao de regras ja existentes: gate de coorte exige >=31 dias sem atividade; fn_score_lead_campanha classifica morno ate 45 dias. Nao e janela arbitraria.',
    'criterios', jsonb_build_array(
      'ultimo inbound entre 31 e 45 dias (fact_conversations.created_at, mesma coluna da politica)',
      'teve conversa real anterior (inbound_total >= 1 por construcao)',
      'nenhuma atividade em fact_conversations nos ultimos 30 dias',
      'sem compra nos ultimos 60 dias (regra cliente_ativo da politica)',
      'telefone de 13 digitos unico e sem colisao entre leads',
      'sem opt-out ativo',
      'sem bloqueio ou atendimento ativo em julia_modos_lead, agente_conversacao_estado e agente_exploracao_estado',
      'fora do alcance do cron vigia-leads-mornos-diario (trocas>=5, em_progresso, parado 3-30 dias)')),
  'resumo',(select jsonb_build_object('total_elegivel',total,'tratamento',n_trat,'controle',n_ctrl,
     'desbalanceamento_pct',round(100.0*abs(n_trat-n_ctrl)/nullif(total,0),3)) from resumo),
  'randomizacao', jsonb_build_object(
    'metodo','get_byte(decode(md5(lead_id::text || experiment_id),''hex''),0) & 1',
    'deterministica', true, 'usa_random', false,
    'nota','experiment_id mudou em relacao a v1, entao a divisao foi recalculada do zero',
    'hash_divisao',(select md5(string_agg(lead_id::text||':'||braco, ',' order by lead_id)) from principal)),
  'balanceamento',(select j from balanco),
  'balanceamento_por_estrato', jsonb_build_object(
    'faixas',(select j from estratos),
    'metodo_randomizacao','hash puro do lead_id: o braco de um lead nunca muda, mesmo se a coorte for recalculada. Nao usa ranking, que trocaria bracos quando um lead sai da janela.',
    'hash_e_nao_enviesado','verificado em 25/08/2026: sobre os 15.983 leads de leads_marketing o mesmo hash produz 50,01% tratamento',
    'alerta','com n desta ordem o sorteio simples produz desbalanceamento de contagem por acaso. A analise DEVE ser estratificada por faixa de dias, e nao apenas comparar totais.'),
  'baseline_espontaneo', jsonb_build_object(
    'medido_em','2026-08-25',
    'metodo','coorte historica ancorada em T0 = now()-35d, leads com ultimo inbound 31-45 dias antes de T0, excluindo os que receberam outbound de qualquer origem na janela de observacao',
    'n_historico',593,'n_sem_contaminacao',566,
    'retorno_24h_pct',0.000,'retorno_72h_pct',0.000,'retorno_7d_pct',0.000,
    'venda_7d_pct',0.000,'venda_30d_pct',0.000,
    'contaminacao_outbound_30d_pct',4.6,
    'nota','zero absoluto em todas as metricas: esta populacao nao retorna nem compra sozinha em 30 dias. Baseline recalculado para esta populacao, NAO reaproveitado da base fria.'),
  'metricas', jsonb_build_object(
    'primaria', jsonb_build_object('nome','retomou_conversa_72h',
      'definicao','>=1 inbound em fact_conversations posterior ao instante da intervencao, em ate 72h'),
    'secundarias', jsonb_build_array('retomou_conversa_7d','venda_7d','venda_30d','receita_observada',
      'tempo_ate_primeiro_inbound','optout','bloqueio'),
    'ressalva','Purchase significa deal ganho no RD CRM, nao caixa. Ver U1 do MAPA.'),
  'fora_exp001_motivo',(select coalesce(jsonb_object_agg(motivo,n),'{}'::jsonb) from fora),
  'amostra',(select j from amostra)
);
$function$;
