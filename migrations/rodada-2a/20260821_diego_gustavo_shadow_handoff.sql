-- Diego -> Gustavo: handoff shadow canonico, sem efeito externo
-- Produção: ldrdtaibazplvrbwyrvx
-- Aplicado em 21/08/2026 nas migrations:
--   20260821133723 diego_gustavo_shadow_handoff_canonico
--   20260821133902 diego_gustavo_shadow_identity_permissions
--   20260821133930 diego_gustavo_shadow_remove_agent_level_dependency
--   20260821134005 diego_gustavo_shadow_narrow_insert_grant
--
-- Contrato:
-- * preserva o livro midia_shadow de comparação por campaign_id;
-- * cria um recibo separado Diego -> Gustavo para campanha OU oportunidade;
-- * origem_decision_id liga o recibo à decisão do Diego;
-- * objeto_tipo/objeto_id carregam a identidade canônica;
-- * dry_run=true, efeito_externo=false e executar=false;
-- * não chama Meta, não cria aprovação e não envia WhatsApp.

create unique index if not exists uq_adl_diego_gustavo_shadow_item
on public.agente_decisoes_log (
  origem_decision_id,
  ((contexto->>'handoff_item'))
)
where agente_slug = 'agente-midia'
  and acao_executada = 'avaliacao_input_diego_shadow'
  and origem_decision_id is not null
  and (contexto->>'handoff_item') is not null;

grant select (id) on table public.dora_oportunidades to midia_shadow_owner;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='dora_oportunidades'
      and policyname='midia_shadow_owner_read_id'
  ) then
    execute 'create policy midia_shadow_owner_read_id on public.dora_oportunidades for select to midia_shadow_owner using (true)';
  end if;
end
$policy$;

grant insert (
  id, agente_slug, contexto, decisao, acao_executada, resultado,
  nivel_autonomia_usado, impacto_financeiro, acerto, agent_version,
  dry_run, created_at, efeito_externo, origem_decision_id,
  autoria_decisao, autoria_ref, objeto_tipo, objeto_id
) on table public.agente_decisoes_log to midia_shadow_owner;

create or replace function public.fn_registrar_participantes_diego_shadow(
  p_run_id text,
  p_edge_execution_id uuid,
  p_agent_decision_id uuid,
  p_agent_version text,
  p_recomendacoes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'midia_shadow'
as $function$
declare
  v_data_utc text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  v_avaliacoes int;
  v_inseridas int;
  v_correlacionadas int;
  v_recs_recebidas int;
  v_recs_com_id int;
  v_recs_sem_id int;
  v_handoff_inseridas int := 0;
  v_handoff_total int := 0;
  v_handoff_correlacionadas int := 0;
  v_handoff_sem_identidade int := 0;
begin
  if p_run_id <> 'obs:cron:' || v_data_utc then
    raise exception 'run_id invalido: esperado obs:cron:%', v_data_utc;
  end if;
  if p_edge_execution_id is null or p_agent_decision_id is null then
    raise exception 'ids de execucao e decisao sao obrigatorios';
  end if;
  if coalesce(btrim(p_agent_version), '') = '' then
    raise exception 'agent_version obrigatoria';
  end if;
  if p_recomendacoes is null or jsonb_typeof(p_recomendacoes) <> 'array' then
    raise exception 'p_recomendacoes deve ser array jsonb';
  end if;
  if not exists (
    select 1 from public.agente_execution_log e
     where e.id = p_edge_execution_id and e.agente_slug = 'agente-insights'
  ) then
    raise exception 'execucao do Diego nao encontrada';
  end if;
  if not exists (
    select 1 from public.agente_decisoes_log d
     where d.id = p_agent_decision_id and d.agente_slug = 'agente-insights'
  ) then
    raise exception 'decisao do Diego nao encontrada';
  end if;

  select count(*) into v_avaliacoes
    from midia_shadow.avaliacao a where a.evaluation_run_id = p_run_id;
  if v_avaliacoes = 0 then
    raise exception 'run shadow % ainda nao existe', p_run_id;
  end if;

  select count(*),
         count(*) filter (where nullif(x.value->>'campaign_id','') is not null),
         count(*) filter (where nullif(x.value->>'campaign_id','') is null)
    into v_recs_recebidas, v_recs_com_id, v_recs_sem_id
    from jsonb_array_elements(p_recomendacoes) x(value);

  -- Livro original: comparação do Diego contra avaliações de CAMPANHA.
  with recs as (
    select distinct on (x.value->>'campaign_id')
           x.value->>'campaign_id' as campaign_id,
           x.value as recomendacao
      from jsonb_array_elements(p_recomendacoes) with ordinality x(value, ord)
     where nullif(x.value->>'campaign_id','') is not null
     order by x.value->>'campaign_id', x.ord
  ), ins as (
    insert into midia_shadow.participante (
      avaliacao_id, agente_slug, papel, dominio,
      edge_execution_id, agent_decision_id, agent_version, decisao_em,
      fonte_correlacao, status_correlacao, acao_bruta, acao_normalizada,
      classe_divergencia, recomendacao
    )
    select
      a.avaliacao_id, 'agente-insights', 'recomendador', 'orcamento',
      p_edge_execution_id, p_agent_decision_id, p_agent_version, now(),
      'evaluation_run_id+campaign_id',
      case when r.recomendacao is null then 'sem_correspondencia' else 'correlacionado' end,
      coalesce(r.recomendacao->>'acao', 'nenhuma_recomendacao'),
      case
        when r.recomendacao is null then null
        when r.recomendacao->>'acao' = 'pausar_campanha' then 'pausar'
        when r.recomendacao->>'acao' = 'escalar_orcamento' then 'escalar'
        else 'nao_aplicavel'
      end,
      case
        when r.recomendacao is null and a.acao_shadow = 'abster' then 'abstencao_shadow'
        when r.recomendacao is null then null
        when a.acao_shadow = 'abster' then 'abstencao_shadow'
        when r.recomendacao->>'acao' in ('pausar_campanha','escalar_orcamento') then 'direcao_oposta'
        else 'nao_comparavel'
      end,
      r.recomendacao
    from midia_shadow.avaliacao a
    left join recs r on r.campaign_id = a.campaign_id
    where a.evaluation_run_id = p_run_id
    on conflict on constraint uq_participante do nothing
    returning (recomendacao is not null) as correlacionada
  )
  select count(*), count(*) filter (where correlacionada)
    into v_inseridas, v_correlacionadas from ins;

  -- Handoff separado: campanha e oportunidade têm identidades diferentes.
  with itens as (
    select ord::int as item_no,
           x.value as recomendacao,
           nullif(btrim(x.value->>'acao'), '') as acao,
           nullif(btrim(x.value->>'campaign_id'), '') as campaign_id,
           nullif(btrim(x.value->>'oportunidade_id'), '') as oportunidade_id
      from jsonb_array_elements(p_recomendacoes) with ordinality x(value, ord)
  ), resolvidos as (
    select i.*,
           case
             when i.acao in ('escalar_orcamento','pausar_campanha','criar_criativo')
              and i.campaign_id is not null
              and exists (select 1 from public.meta_ads_insights c where c.campaign_id::text = i.campaign_id)
               then 'campanha'
             when i.acao in ('criar_publico','testar_segmento')
              and i.oportunidade_id is not null
              and exists (select 1 from public.dora_oportunidades o where o.id::text = i.oportunidade_id)
               then 'oportunidade'
             when i.campaign_id is not null
              and exists (select 1 from public.meta_ads_insights c where c.campaign_id::text = i.campaign_id)
               then 'campanha'
             when i.oportunidade_id is not null
              and exists (select 1 from public.dora_oportunidades o where o.id::text = i.oportunidade_id)
               then 'oportunidade'
             else null
           end as objeto_tipo_resolvido,
           case
             when i.acao in ('escalar_orcamento','pausar_campanha','criar_criativo')
              and i.campaign_id is not null
              and exists (select 1 from public.meta_ads_insights c where c.campaign_id::text = i.campaign_id)
               then i.campaign_id
             when i.acao in ('criar_publico','testar_segmento')
              and i.oportunidade_id is not null
              and exists (select 1 from public.dora_oportunidades o where o.id::text = i.oportunidade_id)
               then i.oportunidade_id
             when i.campaign_id is not null
              and exists (select 1 from public.meta_ads_insights c where c.campaign_id::text = i.campaign_id)
               then i.campaign_id
             when i.oportunidade_id is not null
              and exists (select 1 from public.dora_oportunidades o where o.id::text = i.oportunidade_id)
               then i.oportunidade_id
             else null
           end as objeto_id_resolvido
      from itens i
  ), ins_handoff as (
    insert into public.agente_decisoes_log (
      id, agente_slug, contexto, decisao, acao_executada, resultado,
      nivel_autonomia_usado, impacto_financeiro, acerto,
      agent_version, dry_run, created_at, efeito_externo,
      origem_decision_id, autoria_decisao, autoria_ref,
      objeto_tipo, objeto_id
    )
    select
      gen_random_uuid(),
      'agente-midia',
      jsonb_build_object(
        'trigger', 'diego_shadow_handoff',
        'contrato', 'diego_gustavo_shadow_v2',
        'run_id', p_run_id,
        'source_edge_execution_id', p_edge_execution_id,
        'source_agent_decision_id', p_agent_decision_id,
        'source_agent_version', p_agent_version,
        'handoff_item', r.item_no,
        'status_correlacao', case when r.objeto_id_resolvido is not null then 'correlacionado' else 'sem_identidade_canonica' end,
        'execucao_habilitada', false,
        'efeito_externo_permitido', false
      ),
      jsonb_build_object(
        'acao_diego', r.acao,
        'recomendacao', r.recomendacao,
        'recebida_por_gustavo_shadow', true,
        'executar', false
      ),
      'avaliacao_input_diego_shadow',
      'executada',
      0,
      null,
      null,
      null,
      true,
      now(),
      false,
      p_agent_decision_id,
      'politica_sql',
      'fn_registrar_participantes_diego_shadow',
      r.objeto_tipo_resolvido,
      r.objeto_id_resolvido
    from resolvidos r
    where not exists (
      select 1
        from public.agente_decisoes_log d
       where d.agente_slug = 'agente-midia'
         and d.acao_executada = 'avaliacao_input_diego_shadow'
         and d.origem_decision_id = p_agent_decision_id
         and d.contexto->>'handoff_item' = r.item_no::text
    )
    returning 1
  )
  select count(*) into v_handoff_inseridas from ins_handoff;

  select count(*),
         count(*) filter (where d.objeto_id is not null),
         count(*) filter (where d.objeto_id is null)
    into v_handoff_total, v_handoff_correlacionadas, v_handoff_sem_identidade
    from public.agente_decisoes_log d
   where d.agente_slug = 'agente-midia'
     and d.acao_executada = 'avaliacao_input_diego_shadow'
     and d.origem_decision_id = p_agent_decision_id;

  return jsonb_build_object(
    'status', 'ok',
    'run_id', p_run_id,
    'avaliacoes', v_avaliacoes,
    'inseridas', v_inseridas,
    'ja_existiam', v_avaliacoes - v_inseridas,
    'recomendacoes_recebidas', v_recs_recebidas,
    'recomendacoes_com_campaign_id', v_recs_com_id,
    'recomendacoes_sem_campaign_id', v_recs_sem_id,
    'participantes_correlacionados', v_correlacionadas,
    'gustavo_shadow_recebido', (v_handoff_total > 0 or v_recs_recebidas = 0),
    'gustavo_shadow_itens_total', v_handoff_total,
    'gustavo_shadow_inseridos_agora', v_handoff_inseridas,
    'gustavo_shadow_correlacionados', v_handoff_correlacionadas,
    'gustavo_shadow_sem_identidade', v_handoff_sem_identidade,
    'gustavo_execucao_real', false
  );
end
$function$;

insert into public.agente_relacionamentos (
  agente_origem, agente_destino, tipo_relacao, descricao, implementado, criado_em
)
select
  'agente-insights',
  'agente-midia',
  'alimenta',
  'Handoff shadow canonico: recomendacoes do Diego sao recebidas pelo Gustavo via fn_registrar_participantes_diego_shadow, ligadas por origem_decision_id e objeto_tipo/objeto_id. Nao autoriza nem executa acao na Meta; promocao para execucao real exige canario separado.',
  true,
  now()
where not exists (
  select 1 from public.agente_relacionamentos
  where agente_origem='agente-insights'
    and agente_destino='agente-midia'
    and tipo_relacao='alimenta'
);
