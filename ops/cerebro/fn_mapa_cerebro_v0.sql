-- ============================================================================
-- public.fn_mapa_cerebro_v0()
-- MAPA V0 do Cerebro - interface unica READ-ONLY do estado conhecido da empresa.
--
-- Contrato:
--   - LANGUAGE sql, STABLE  -> o Postgres recusa qualquer DML dentro dela.
--   - SECURITY INVOKER (default) -> nao eleva privilegio.
--   - Nao cria, nao altera e nao chama nada volatil.
--   - Toda metrica declara fonte, atualizado_em e confianca.
--   - O que nao pode ser provado sai como DESCONHECIDO, nunca preenchido.
--
-- Fontes vivas usadas: meta_comercial, pixel_events, leads_marketing,
--   meta_ads_insights, lead_score_comercial, vw_margem_por_produto, agentes,
--   agente_decisoes_log, mensagem_envio, agente_aprovacoes, frentes,
--   frentes_espera, cerebro_futuro, gustavo_meta_acoes,
--   crm_email_send_attempts, canva_arte_exportacoes, metas_crescimento (so
--   para expor contradicao - nunca como verdade).
-- ============================================================================
-- ============================================================================
-- PROVA DE DEPLOY (25/08/2026)
--   Publicado em: projeto ldrdtaibazplvrbwyrvx, migration fn_mapa_cerebro_v0
--   Catalogo LIVE: LANGUAGE sql | STABLE | SECURITY INVOKER | search_path=public
--   prosrc LIVE: 29855 chars, 497 linhas
--   Identidade candidato x publicado (comentarios removidos, espacos colapsados):
--     md5 = 81fe1d3e29aebdca7e5e7c14aed6d6a9 / 27354 chars  -> BATE nos dois lados
--   Diferenca remanescente arquivo x LIVE: apenas comentarios de secao e 5 linhas
--   em branco, que a normalizacao remove e que nao afetam execucao.
--   Testes T1..T10: todos passaram (inclusive T9 - pg_current_xact_id_if_assigned()
--   permanece NULL apos a chamada, logo nenhuma escrita ocorreu).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_mapa_cerebro_v0()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
with
p as (
  select
    date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date as mes_ini,
    (date_trunc('month', (now() at time zone 'America/Sao_Paulo')))::timestamp
      at time zone 'America/Sao_Paulo' as mes_ini_tz,
    (now() at time zone 'America/Sao_Paulo')::date as hoje,
    now() - interval '30 days' as d30
),
mc as (select m.* from meta_comercial m, p where m.referencia_mes = p.mes_ini limit 1),
mg as (
  select max(g.faturamento_realizado) fat, max(g.meta_faturamento) meta
  from metas_crescimento g, p where g.referencia = p.mes_ini
),
px as (
  select count(*) filter (where e.event_name='Purchase') compras,
         round(coalesce(sum(e.value) filter (where e.event_name='Purchase'),0)::numeric,2) receita,
         max(e.ingested_at) ult_ingest
  from pixel_events e, p where e.event_time >= p.mes_ini_tz
),
px90 as (
  select round(percentile_cont(0.5) within group (order by e.value)::numeric,2) mediana,
         round(avg(e.value)::numeric,2) media, count(*) n
  from pixel_events e
  where e.event_name='Purchase' and e.event_time > now() - interval '90 days'
),
lds as (select count(*) n, max(l.created_at) ult from leads_marketing l, p where l.created_at >= p.mes_ini_tz),
ads as (
  select round(coalesce(sum(a.spend),0)::numeric,2) gasto, count(distinct a.ad_id) ads,
         max(a.date) ult_dia, max(a.updated_at) sync
  from meta_ads_insights a, p where a.date >= p.mes_ini
),
ads_prev as (
  select round(coalesce(sum(a.spend),0)::numeric,2) gasto
  from meta_ads_insights a, p
  where a.date >= (p.mes_ini - interval '1 month')::date and a.date < p.mes_ini
),
toc as (
  select distinct m.lead_id from mensagem_envio m, p
  where m.criado_em > p.d30 and m.autor_tipo='agente'
    and m.provider_message_id is not null and m.lead_id is not null
),
funil as (
  select coalesce(l.classificacao,'sem_classificacao') classe, count(*) leads,
         count(*) filter (where t.lead_id is not null) tocados
  from lead_score_comercial l left join toc t on t.lead_id = l.lead_id
  group by 1
),
funil_j as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'classificacao', classe, 'leads', leads, 'tocados_30d', tocados,
           'cobertura_pct', round(100.0*tocados/nullif(leads,0),1)
         ) order by leads desc),'[]'::jsonb) j,
         max(leads) filter (where classe='quente') q_leads,
         max(tocados) filter (where classe='quente') q_toc,
         max(leads) filter (where classe='fechamento') f_leads,
         max(tocados) filter (where classe='fechamento') f_toc
  from funil
),
sc as (select max(updated_at) ult, count(*) total from lead_score_comercial),
marg as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'familia', v.produto, 'receita_acumulada', v.receita, 'ticket_medio', v.ticket_medio,
           'custo_metro', v.custo_metro, 'margem_pct_pior', v.margem_pct_pior,
           'margem_pct_melhor', v.margem_pct_melhor, 'observacao', v.obs
         ) order by v.receita desc),'[]'::jsonb) j,
         count(*) filter (where v.custo_metro is null) sem_custo,
         round(coalesce(sum(v.receita) filter (where v.custo_metro is null),0)::numeric,2) receita_sem_custo,
         round(coalesce(sum(v.receita),0)::numeric,2) receita_total
  from vw_margem_por_produto v
),
dcs as (
  select d.agente_slug slug,
         count(*) filter (where d.created_at > p.d30) dec30,
         count(*) filter (where d.created_at > p.d30 and d.efeito_externo) ef30,
         count(*) filter (where d.created_at > p.d30 and d.converted_at is not null) conv30,
         max(d.created_at) ult
  from agente_decisoes_log d, p group by 1
),
env as (
  select m.autor_id slug, count(*) envios30, count(distinct m.lead_id) leads30, max(m.criado_em) ult
  from mensagem_envio m, p
  where m.criado_em > p.d30 and m.autor_tipo='agente' and m.provider_message_id is not null
  group by 1
),
-- Provas independentes por canal, SEMPRE com janela de 30 dias.
-- Sem a janela, uma unica execucao antiga contaria como efeito externo recente
-- e o mapa mentiria no futuro, mesmo estando correto hoje.
prova as (
  select 'agente-midia'::text slug,
         (select count(*) from gustavo_meta_acoes g, p
           where g.executado_em is not null and g.executado_em > p.d30) n,
         'gustavo_meta_acoes.executado_em (janela 30d)'::text fonte
  union all
  select 'agente-campanhas-crm',
         (select count(*) from crm_email_send_attempts c, p
           where c.finished_at is not null and c.finished_at > p.d30),
         'crm_email_send_attempts.finished_at (janela 30d)'
  union all
  select 'agente-criativo',
         (select count(*) from canva_arte_exportacoes k, p
           where k.completed_at is not null and k.completed_at > p.d30),
         'canva_arte_exportacoes.completed_at (janela 30d)'
),
cap_ag as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'capacidade', a.slug,
    'nome', a.nome,
    'tipo', 'agente',
    'time', a.time,
    'declarada', jsonb_build_object(
      'valor', (a.status='ativo'),
      'fonte', 'agentes',
      'prova', 'cadastro status='||coalesce(a.status,'null')
        ||', edge_function='||coalesce(a.edge_function,'AUSENTE')),
    'operacional', jsonb_build_object(
      'valor', (a.status='ativo' and coalesce(a.dry_run_ativo,false)=false and coalesce(d.dec30,0)>0),
      'fonte', 'agente_decisoes_log + agentes.dry_run_ativo',
      'decisoes_30d', coalesce(d.dec30,0),
      'dry_run', coalesce(a.dry_run_ativo,false),
      'ultima_decisao', d.ult),
    'comprovada', jsonb_build_object(
      'valor', (coalesce(e.envios30,0)>0 or coalesce(d.ef30,0)>0 or coalesce(pr.n,0)>0),
      'fonte', 'mensagem_envio.provider_message_id | agente_decisoes_log.efeito_externo | prova de canal',
      'envios_reais_30d', coalesce(e.envios30,0),
      'leads_tocados_30d', coalesce(e.leads30,0),
      'efeito_externo_log_30d', coalesce(d.ef30,0),
      'prova_canal', case when pr.slug is null then null
                          else jsonb_build_object('fonte', pr.fonte, 'execucoes_30d', pr.n) end,
      'nota', case
        when coalesce(e.envios30,0)>0 and coalesce(d.ef30,0)=0
          then 'efeito_externo=0 no log, mas ha envio real com provider_message_id: o campo esta subnotificado'
        when coalesce(d.dec30,0)>0 and coalesce(e.envios30,0)=0 and coalesce(d.ef30,0)=0 and coalesce(pr.n,0)=0
          then 'decide mas nao ha prova independente de efeito externo em 30d'
        else null end),
    'conversoes_vinculadas_30d', coalesce(d.conv30,0),
    'confianca', case
      when coalesce(e.envios30,0)>0 then 'alta'
      when coalesce(d.ef30,0)>0 or coalesce(pr.n,0)>0 then 'media'
      when coalesce(d.dec30,0)>0 then 'baixa'
      else 'desconhecida' end
  ) order by coalesce(e.envios30,0) desc, coalesce(d.dec30,0) desc),'[]'::jsonb) j
  from agentes a
  left join dcs d on d.slug = a.slug
  left join env e on e.slug = a.slug
  left join prova pr on pr.slug = a.slug
),
cap_infra as (
  select jsonb_build_array(
    jsonb_build_object('capacidade','whatsapp_envio','tipo','canal',
      'declarada', jsonb_build_object('valor',true,'fonte','mensagem_envio'),
      'operacional', jsonb_build_object('valor',(select count(*)>0 from mensagem_envio m, p where m.criado_em>p.d30),'fonte','mensagem_envio'),
      'comprovada', jsonb_build_object('valor',(select count(*)>0 from mensagem_envio m, p where m.criado_em>p.d30 and m.provider_message_id is not null),
        'fonte','mensagem_envio.provider_message_id',
        'envios_30d',(select count(*) from mensagem_envio m, p where m.criado_em>p.d30 and m.provider_message_id is not null)),
      'confianca','alta'),
    jsonb_build_object('capacidade','meta_ads_leitura','tipo','integracao',
      'declarada', jsonb_build_object('valor',true,'fonte','meta_ads_insights'),
      'operacional', jsonb_build_object('valor',(select sync > now()-interval '3 days' from ads),'fonte','meta_ads_insights.updated_at'),
      'comprovada', jsonb_build_object('valor',(select ult_dia is not null from ads),'fonte','meta_ads_insights.date','ultimo_dia',(select ult_dia from ads)),
      'confianca','alta'),
    jsonb_build_object('capacidade','meta_ads_escrita','tipo','integracao',
      'declarada', jsonb_build_object('valor',true,'fonte','gustavo_meta_acoes (tabela existe) + edge gustavo-meta-actions'),
      'operacional', jsonb_build_object('valor',(select count(*)>0 from gustavo_meta_acoes),'fonte','gustavo_meta_acoes'),
      'comprovada', jsonb_build_object('valor',(select count(*)>0 from gustavo_meta_acoes g, p where g.executado_em > p.d30),
        'fonte','gustavo_meta_acoes.executado_em (janela 30d)',
        'execucoes_30d',(select count(*) from gustavo_meta_acoes g, p where g.executado_em > p.d30),
        'execucoes_total',(select count(*) from gustavo_meta_acoes where executado_em is not null),
        'nota','nenhuma acao de escrita no Meta registrada: capacidade declarada, execucao nao comprovada'),
      'confianca','alta'),
    jsonb_build_object('capacidade','email_brevo','tipo','integracao',
      'declarada', jsonb_build_object('valor',true,'fonte','crm_email_send_attempts + edges tiago-brevo-*'),
      'operacional', jsonb_build_object('valor',(select count(*)>0 from crm_email_send_attempts),'fonte','crm_email_send_attempts'),
      'comprovada', jsonb_build_object('valor',(select count(*)>0 from crm_email_send_attempts c, p where c.finished_at > p.d30),
        'fonte','crm_email_send_attempts.finished_at (janela 30d)',
        'execucoes_30d',(select count(*) from crm_email_send_attempts c, p where c.finished_at > p.d30),
        'tentativas_total',(select count(*) from crm_email_send_attempts)),
      'confianca','media'),
    jsonb_build_object('capacidade','canva_export','tipo','integracao',
      'declarada', jsonb_build_object('valor',true,'fonte','canva_arte_exportacoes + edges canva-*'),
      'operacional', jsonb_build_object('valor',(select count(*)>0 from canva_arte_exportacoes),'fonte','canva_arte_exportacoes'),
      'comprovada', jsonb_build_object('valor',(select count(*)>0 from canva_arte_exportacoes k, p where k.completed_at > p.d30),
        'fonte','canva_arte_exportacoes.completed_at (janela 30d)',
        'execucoes_30d',(select count(*) from canva_arte_exportacoes k, p where k.completed_at > p.d30),
        'exportacoes_total',(select count(*) from canva_arte_exportacoes)),
      'confianca','media'),
    jsonb_build_object('capacidade','erp_operacional','tipo','sistema',
      'declarada', jsonb_build_object('valor',true,'fonte','11 edge functions erp-* e ~40 funcoes SQL de ERP'),
      'operacional', jsonb_build_object('valor',false,'fonte','pg_class',
        'prova','tabelas vendas/estoque/producao/contas nao existem neste projeto; fn_baixa_estoque_venda referencia vendas%ROWTYPE inexistente'),
      'comprovada', jsonb_build_object('valor',false,'fonte','DESCONHECIDO'),
      'confianca','alta')
  ) j
),
apr as (
  select count(*) total,
         count(*) filter (where status='expirado') expirados,
         count(*) filter (where status='aprovado') aprovados,
         count(*) filter (where status='rejeitado') rejeitados,
         max(created_at) filter (where status='aprovado') ult_aprovado
  from agente_aprovacoes
),
fr as (
  select count(*) total,
         count(*) filter (where estado='bloqueada') bloqueadas,
         count(*) filter (where estado='em_andamento') em_andamento,
         count(*) filter (where impacto_mes_estimado is not null) com_impacto,
         max(atualizada_em) ult
  from frentes
),
esp as (
  select count(*) abertas,
         count(*) filter (where tipo in ('decisao_humana','acao_humana')) humanas,
         min(aberta_em) mais_antiga
  from frentes_espera where encerrada_em is null
),
aut as (
  select count(*) total30,
         count(*) filter (where autor_tipo='agente') com_agente,
         count(*) filter (where autor_tipo is distinct from 'agente') sem_autor
  from mensagem_envio m, p where m.criado_em > p.d30
),
midia_dec as (select coalesce(dec30,0) n from dcs where slug='agente-midia'),
garg_raw as (
  select 'G1' codigo,
    'Fila de aprovacao humana expirada' descricao,
    jsonb_build_object('total',a.total,'expiradas',a.expirados,'aprovadas',a.aprovados,
      'pct_expirado',round(100.0*a.expirados/nullif(a.total,0),0),
      'ultima_aprovacao',a.ult_aprovado) evidencia,
    'agente_aprovacoes' fonte, 'alta' gravidade, 'alta' confianca,
    'agentes em dry_run nao tem caminho de saida: a saida depende de aprovacao humana' efeito_potencial,
    (a.expirados > a.aprovados) ativo
  from apr a
  union all
  select 'G2','Oportunidades quentes/fechamento sem cobertura comprovada',
    jsonb_build_object('quentes',f.q_leads,'quentes_tocados',f.q_toc,
      'fechamento',f.f_leads,'fechamento_tocados',f.f_toc),
    'lead_score_comercial x mensagem_envio(provider_message_id)','alta','media',
    'lead qualificado sem contato nao converte; impacto financeiro NAO estimado (conversao quente->venda nao medida, ver U9)',
    (coalesce(f.q_toc,0) < coalesce(f.q_leads,0) or coalesce(f.f_toc,0) < coalesce(f.f_leads,0))
  from funil_j f
  union all
  select 'G3','Midia decide mas nao ha execucao comprovada',
    jsonb_build_object('decisoes_30d',md.n,
      'acoes_meta_executadas_30d',(select count(*) from gustavo_meta_acoes g, p where g.executado_em > p.d30),
      'acoes_meta_executadas_total',(select count(*) from gustavo_meta_acoes where executado_em is not null),
      'gasto_mes',(select gasto from ads),'gasto_mes_anterior',(select gasto from ads_prev)),
    'agente_decisoes_log + gustavo_meta_acoes + meta_ads_insights','alta','alta',
    'capacidade de midia instalada e sem efeito comprovado; variacao de gasto NAO atribuida a causa (ver U10)',
    (md.n > 0 and (select count(*) from gustavo_meta_acoes where executado_em is not null) = 0)
  from midia_dec md
  union all
  select 'G4','Backlog quase sem impacto economico declarado',
    jsonb_build_object('frentes_total',f.total,'com_impacto_estimado',f.com_impacto,
      'pct_com_impacto',round(100.0*f.com_impacto/nullif(f.total,0),1)),
    'frentes.impacto_mes_estimado','alta','alta',
    'GPS ordena o backlog sem saber quanto vale cada frente',
    (f.com_impacto * 10 < f.total)
  from fr f
  union all
  select 'G5','Esperas humanas abertas bloqueando frentes',
    jsonb_build_object('esperas_abertas',e.abertas,'dependem_de_humano',e.humanas,
      'mais_antiga',e.mais_antiga,'frentes_bloqueadas',(select bloqueadas from fr)),
    'frentes_espera + frentes','media','alta',
    'trabalho parado aguardando decisao ou acao de pessoa',
    (e.humanas > 0)
  from esp e
  union all
  select 'G6','Autoria de envio perdida',
    jsonb_build_object('envios_30d',u.total30,'com_autor_agente',u.com_agente,'sem_autor',u.sem_autor,
      'pct_sem_autor',round(100.0*u.sem_autor/nullif(u.total30,0),0)),
    'mensagem_envio.autor_tipo','alta','alta',
    'impossivel atribuir resultado a capacidade; tambem faz a cobertura de contato (G2) parecer pior do que talvez seja',
    (u.sem_autor * 2 > u.total30)
  from aut u
  union all
  select 'G7','Margem desconhecida em familia de receita relevante',
    jsonb_build_object('familias_sem_custo',m.sem_custo,'receita_sem_custo',m.receita_sem_custo,
      'receita_coberta_pela_view',m.receita_total,
      'pct_receita_sem_margem',round(100.0*m.receita_sem_custo/nullif(m.receita_total,0),1)),
    'vw_margem_por_produto','media','alta',
    'decisao de mix, desconto e prioridade de campanha sem base de margem',
    (m.sem_custo > 0)
  from marg m
),
garg as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'codigo',codigo,'descricao',descricao,'evidencia',evidencia,'fonte',fonte,
    'gravidade',gravidade,'confianca',confianca,'efeito_potencial',efeito_potencial
  ) order by case gravidade when 'alta' then 1 when 'media' then 2 else 3 end, codigo),'[]'::jsonb) j
  from garg_raw where ativo
),
rel as (
  select jsonb_build_array(
    jsonb_build_object('origem','meta_ads.campanha','destino','lead',
      'tipo','parcial','fonte','meta_ads_insights + leads_marketing',
      'prova','volume de gasto e volume de leads existem, mas nao ha chave confiavel campanha->lead (tabelas atribuicao_* vazias)',
      'confianca','baixa'),
    jsonb_build_object('origem','criativo','destino','campanha',
      'tipo','hipotese','fonte','canva_arte_exportacoes + dim_ads',
      'prova','nenhum vinculo persistido entre arte exportada e anuncio publicado',
      'confianca','nula'),
    jsonb_build_object('origem','lead','destino','lead_score_comercial',
      'tipo','comprovada','fonte','leads_marketing + lead_score_comercial',
      'prova','vinculo por lead_id','confianca','alta'),
    jsonb_build_object('origem','lead_score_comercial','destino','atendimento',
      'tipo','comprovada','fonte','mensagem_envio',
      'prova','vinculo por lead_id com provider_message_id (prova de envio real)','confianca','alta'),
    jsonb_build_object('origem','atendimento','destino','venda',
      'tipo','hipotese','fonte','mensagem_envio + pixel_events',
      'prova','apenas precedencia temporal; nenhum vinculo causal persistido',
      'confianca','baixa'),
    jsonb_build_object('origem','venda','destino','receita_observada',
      'tipo','comprovada','fonte','pixel_events.Purchase -> meta_comercial',
      'prova','fn_atualizar_meta_comercial le exatamente pixel_events_br Purchase',
      'confianca','alta',
      'ressalva','receita observada por pixel, nao por caixa/contabilidade'),
    jsonb_build_object('origem','venda','destino','margem',
      'tipo','parcial','fonte','vw_margem_por_produto',
      'prova','margem calculada apenas para familias com custo cadastrado e apenas para deals won_ (subconjunto das compras)',
      'confianca','media')
  ) j
),
cf as (select count(*) abertas, max(updated_at) ult from cerebro_futuro where status='aberto'),
inc as (
  select jsonb_build_array(
    jsonb_build_object('id','U1','pergunta','Qual a receita contabil real do mes?',
      'por_que_importa','todo objetivo do V0 usa proxy de pixel; se o pixel duplica ou perde venda de balcao, o gap e ficcao',
      'confianca_atual','baixa','fonte_faltante','ERP / CalcMe / conciliacao bancaria',
      'acao_minima_para_descobrir','reconciliar um mes ja fechado: pixel x CalcMe x extrato',
      'registro_previo','cerebro_futuro: "Reconciliar vendas reais (CalcMe 289 vs pixel 238)"'),
    jsonb_build_object('id','U2','pergunta','Qual a margem real da empresa?',
      'por_que_importa','parte relevante da receita coberta pela view nao tem custo cadastrado',
      'confianca_atual','baixa','fonte_faltante','custo_unitario em catalogo_produtos para as familias sem custo',
      'acao_minima_para_descobrir','cadastrar custo da familia de maior ticket',
      'familias_sem_custo',(select coalesce(jsonb_agg(v.produto),'[]'::jsonb) from vw_margem_por_produto v where v.custo_metro is null)),
    jsonb_build_object('id','U3','pergunta','Qual o caixa da empresa?',
      'por_que_importa','objetivo de caixa nao tem nenhuma fonte neste projeto',
      'confianca_atual','nula','fonte_faltante','sistema financeiro',
      'acao_minima_para_descobrir','definir a fonte antes de prometer o bloco de caixa'),
    jsonb_build_object('id','U4','pergunta','Qual a capacidade produtiva e a ociosidade?',
      'por_que_importa','capacidade operacional e objetivo declarado do MAPA',
      'confianca_atual','nula','fonte_faltante','producao/PCP (repo skillprint-erp)',
      'acao_minima_para_descobrir','decidir se o ERP entra no escopo do mapa'),
    jsonb_build_object('id','U5','pergunta','Qual o estoque?',
      'por_que_importa','restricao fisica direta sobre entrega',
      'confianca_atual','nula','fonte_faltante','estoque (repo skillprint-erp)',
      'acao_minima_para_descobrir','idem U4'),
    jsonb_build_object('id','U6','pergunta','Qual o contrato confiavel de efeito externo?',
      'por_que_importa','agente_decisoes_log.efeito_externo e subnotificado e nao serve como medida unica',
      'confianca_atual','media','fonte_faltante','definicao unica de efeito por canal, preenchida por todos os agentes',
      'acao_minima_para_descobrir','comparar efeito_externo com prova de canal por agente (ja exposto no bloco capacidades)'),
    jsonb_build_object('id','U7','pergunta','Quem enviou as mensagens sem autor?',
      'por_que_importa','sem autoria nao se atribui resultado a capacidade, e a cobertura de contato fica distorcida',
      'confianca_atual','baixa','fonte_faltante','carimbo de autoria no ingest do canal',
      'acao_minima_para_descobrir','medir a lacuna por canal antes de atribuir qualquer resultado',
      'envios_sem_autor_30d',(select sem_autor from aut)),
    jsonb_build_object('id','U8','pergunta','Os crons ativos produzem efeito de negocio?',
      'por_que_importa','execucao tecnica bem sucedida nao prova missao cumprida',
      'confianca_atual','baixa','fonte_faltante','log de negocio por job',
      'acao_minima_para_descobrir','nao concluir nada hoje: sucesso tecnico e silencio sao indistinguiveis'),
    jsonb_build_object('id','U9','pergunta','Qual a atribuicao campanha -> lead -> venda?',
      'por_que_importa','e a cadeia causal central do negocio e a unica que permitiria estimar impacto de rota',
      'confianca_atual','baixa','fonte_faltante','vinculo persistido de atribuicao ponta a ponta',
      'acao_minima_para_descobrir','medir taxa de conversao quente->venda antes de escolher rota'),
    jsonb_build_object('id','U10','pergunta','A variacao de gasto de midia causou variacao de receita?',
      'por_que_importa','e a decisao de maior valor financeiro observavel no periodo',
      'confianca_atual','baixa','fonte_faltante','contrafactual / experimento controlado',
      'acao_minima_para_descobrir','nao afirmar causalidade; tratar como correlacao registrada',
      'gasto_mes',(select gasto from ads),'gasto_mes_anterior',(select gasto from ads_prev),
      'receita_mes',(select receita from px))
  ) j
),
contr as (
  select jsonb_build_array(
    jsonb_build_object('codigo','C1','descricao','meta_comercial e metas_crescimento discordam do realizado do mes',
      'meta_comercial_realizado',(select faturamento_realizado from mc),
      'metas_crescimento_realizado',(select fat from mg),
      'resolucao_adotada','meta_comercial e a verdade do V0; metas_crescimento nao e usada'),
    jsonb_build_object('codigo','C2','descricao','efeito_externo=0 no log para agentes com envio real comprovado',
      'agentes',(select coalesce(jsonb_agg(a.slug order by a.slug),'[]'::jsonb)
                 from agentes a join env e on e.slug=a.slug
                 left join dcs d on d.slug=a.slug
                 where coalesce(e.envios30,0)>0 and coalesce(d.ef30,0)=0),
      'resolucao_adotada','comprovada nao depende de efeito_externo; usa prova independente por canal'),
    jsonb_build_object('codigo','C3','descricao','agente decide sem edge_function cadastrada: o cadastro nao descreve como executa',
      'agentes',(select coalesce(jsonb_agg(a.slug order by a.slug),'[]'::jsonb)
                 from agentes a join dcs d on d.slug=a.slug
                 where a.edge_function is null and coalesce(d.dec30,0)>0),
      'resolucao_adotada','exposto; nao corrigido nesta fase'),
    jsonb_build_object('codigo','C4','descricao','org_metas declara metas ativas mas org_meta_resultados nunca recebeu um realizado',
      'org_metas_ativas',(select count(*) from org_metas where ativo),
      'org_metas_ativas_vencidas',(select count(*) from org_metas where ativo and periodo_fim < current_date),
      'org_meta_resultados',(select count(*) from org_meta_resultados),
      'resolucao_adotada','org_metas fora do V0')
  ) j
),
fontes as (
  select jsonb_build_object(
    'meta_comercial',(select updated_at from mc),
    'pixel_events',(select ult_ingest from px),
    'leads_marketing',(select ult from lds),
    'meta_ads_insights',(select sync from ads),
    'lead_score_comercial',(select ult from sc),
    'agente_decisoes_log',(select max(ult) from dcs),
    'mensagem_envio',(select max(ult) from env),
    'frentes',(select ult from fr)
  ) vivas,
  jsonb_build_object(
    'cerebro_futuro',(select ult from cf),
    'agente_aprovacoes_ultima_aprovacao',(select ult_aprovado from apr),
    'org_metas','nao usada no V0 (metas ativas com periodo vencido)',
    'sistema_mapa','nao usada no V0 (ultima_revisao congelada, cobre ~7% das edges)',
    'metas_crescimento','nao usada como verdade (apenas exposta em contradicoes)'
  ) stale
)

select jsonb_build_object(
  'versao','fn_mapa_cerebro_v0/1',
  'atualizado_em', now(),

  'objetivos', jsonb_build_object(
    'principal', case when (select count(*) from mc)=0 then
      jsonb_build_object('estado','DESCONHECIDO','motivo','sem linha em meta_comercial para o mes corrente')
    else (select jsonb_build_object(
      'kpi','faturamento_mensal',
      'periodo', jsonb_build_object('inicio',m.referencia_mes,
        'fim',(m.referencia_mes + interval '1 month' - interval '1 day')::date,'tipo','mensal'),
      'meta_faturamento', m.meta_faturamento,
      'faturamento_realizado', m.faturamento_realizado,
      'gap_faturamento', m.gap_faturamento,
      'meta_vendas', m.meta_vendas,
      'vendas_realizadas', m.vendas_realizadas,
      'gap_vendas', m.gap_vendas,
      'status_meta', m.status_meta,
      'fonte','meta_comercial',
      'atualizado_em', m.updated_at,
      'confianca','media',
      'ressalva_obrigatoria','faturamento_realizado deriva de pixel_events.Purchase via fn_atualizar_meta_comercial(). NAO e receita de caixa nem contabil. Ver incerteza U1.'
    ) from mc m) end,
    'nao_usados', jsonb_build_object(
      'org_metas','fora do V0: metas ativas sao KPI de processo de agente e org_meta_resultados esta vazia',
      'metas_crescimento','fora do V0: realizado zerado/desatualizado para o mes corrente'),
    'objetivos_sem_fonte', jsonb_build_array(
      jsonb_build_object('kpi','margem_lucro','estado','PARCIAL','motivo','margem existe so para familias com custo cadastrado','ver','U2'),
      jsonb_build_object('kpi','caixa','estado','DESCONHECIDO','motivo','sem fonte financeira neste projeto','ver','U3'),
      jsonb_build_object('kpi','capacidade_operacional','estado','DESCONHECIDO','motivo','producao/PCP fora deste projeto','ver','U4'))
  ),

  'estado', jsonb_build_object(
    'receita_observada_pixel', (select jsonb_build_object('valor',receita,'unidade','BRL',
       'fonte','pixel_events.Purchase (mes corrente, BRT)','atualizado_em',ult_ingest,'confianca','media',
       'ressalva','evento de marketing, nao receita contabil') from px),
    'vendas_observadas_pixel', (select jsonb_build_object('valor',compras,'unidade','compras',
       'fonte','pixel_events.Purchase','atualizado_em',ult_ingest,'confianca','media') from px),
    'ticket_90d', (select jsonb_build_object('mediana',mediana,'media',media,'n',n,
       'fonte','pixel_events.Purchase 90d','confianca','media',
       'nota','distribuicao assimetrica: usar mediana para estimativa conservadora') from px90),
    'leads_novos_mes', (select jsonb_build_object('valor',n,'fonte','leads_marketing',
       'atualizado_em',ult,'confianca','alta') from lds),
    'gasto_midia_meta', (select jsonb_build_object('valor',gasto,'unidade','BRL','ads_distintos',ads,
       'ultimo_dia_com_dado',ult_dia,'mes_anterior',(select gasto from ads_prev),
       'fonte','meta_ads_insights','atualizado_em',sync,'confianca','alta',
       'ressalva','variacao entre meses e correlacao; causa nao estabelecida (U10)') from ads),
    'funil_cobertura', (select jsonb_build_object('distribuicao',j,
       'fonte','lead_score_comercial x mensagem_envio(provider_message_id), janela 30d',
       'atualizado_em',(select ult from sc),'confianca','media',
       'ressalva','cobertura conta apenas envios com autor_tipo=agente; envios sem autoria (U7) podem subestima-la') from funil_j),
    'margem_por_familia', (select jsonb_build_object('familias',j,
       'familias_sem_custo',sem_custo,'receita_sem_margem',receita_sem_custo,'receita_coberta',receita_total,
       'fonte','vw_margem_por_produto','confianca','media',
       'ressalva','acumulado sem janela de periodo e restrito a deals won_ elegiveis BCG: e subconjunto da receita, nao a receita da empresa') from marg),
    'producao', jsonb_build_object('estado','FORA_DO_ESCOPO','motivo','sem tabela de producao neste projeto','ver','U4'),
    'estoque', jsonb_build_object('estado','FORA_DO_ESCOPO','motivo','sem tabela de estoque neste projeto','ver','U5'),
    'caixa', jsonb_build_object('estado','FORA_DO_ESCOPO','motivo','sem fonte financeira neste projeto','ver','U3')
  ),

  'capacidades', (select j from cap_ag) || (select j from cap_infra),
  'gargalos', (select j from garg),
  'relacoes', (select j from rel),
  'incertezas', (select j from inc),

  'qualidade_mapa', jsonb_build_object(
    'escopo','sem ERP operacional completo: producao, estoque, PCP, fiscal e caixa nao estao representados de forma confiavel neste V0',
    'fontes_vivas',(select vivas from fontes),
    'fontes_stale',(select stale from fontes),
    'contradicoes',(select j from contr),
    'lacunas_criticas', jsonb_build_array(
      'receita e proxy de pixel, nao caixa (U1)',
      'nenhuma taxa de conversao medida entre etapa do funil e venda (U9)',
      'nenhuma cadeia causal economica persistida ponta a ponta',
      'metade da operacao (producao/estoque/fiscal/caixa) fora deste projeto'),
    'cobertura_estimativa', jsonb_build_object(
      'blocos_com_fonte_viva',5,'blocos_totais',6,
      'bloco_sem_fonte','relacoes: nenhuma aresta economica causal persistida; publicadas com rotulo de prova',
      'perguntas_do_mapa_respondidas_com_prova',3,'perguntas_do_mapa',9),
    'confianca_global','media',
    'veredito','MAPA_PARCIAL'
  )
);
$function$;
