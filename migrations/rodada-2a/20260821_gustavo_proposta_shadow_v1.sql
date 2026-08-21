-- Gustavo: recebe handoff do Diego, avalia e registra proposta SHADOW.
-- Aplicada em producao como migration 20260821135317 gustavo_proposta_shadow_v1.
-- Zero efeito externo: nao chama Meta, nao cria aprovacao, nao envia WhatsApp.

create unique index if not exists uq_adl_gustavo_proposta_shadow_receipt
on public.agente_decisoes_log (origem_decision_id)
where agente_slug='agente-midia'
  and acao_executada='proposta_midia_shadow'
  and origem_decision_id is not null;

create or replace function public.fn_gustavo_processar_handoffs_shadow(p_diego_decision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  r record;
  v_rec jsonb;
  v_acao text;
  v_segmento text;
  v_status text;
  v_motivo text;
  v_requisitos jsonb;
  v_valor numeric;
  v_orc_max numeric;
  v_paralelo numeric;
  v_ativos int;
  v_experimento_id uuid;
  v_etapa text;
  v_audience_source text;
  v_audience_name text;
  v_budget_txt text;
  v_regra text;
  v_total int := 0;
  v_inseridas int := 0;
  v_suportadas int := 0;
  v_bloqueadas int := 0;
  v_condicionadas int := 0;
  v_prontas int := 0;
  v_rows int;
begin
  if p_diego_decision_id is null then
    raise exception 'diego_decision_id obrigatorio';
  end if;

  if not exists (
    select 1 from public.agente_decisoes_log d
    where d.id=p_diego_decision_id and d.agente_slug='agente-insights'
  ) then
    raise exception 'decisao do Diego nao encontrada';
  end if;

  select count(*) into v_ativos
  from public.dora_experimentos e
  where e.status not in ('concluido','cancelado','encerrado','rejeitado');

  for r in
    select d.id, d.objeto_tipo, d.objeto_id, d.decisao, d.contexto
    from public.agente_decisoes_log d
    where d.agente_slug='agente-midia'
      and d.acao_executada='avaliacao_input_diego_shadow'
      and d.origem_decision_id=p_diego_decision_id
      and d.dry_run is true
      and d.efeito_externo is false
      and d.objeto_id is not null
    order by (d.contexto->>'handoff_item')::int
  loop
    v_total := v_total + 1;
    v_rec := coalesce(r.decisao->'recomendacao','{}'::jsonb);
    v_acao := nullif(btrim(r.decisao->>'acao_diego'),'');
    v_segmento := nullif(btrim(v_rec->>'segmento'),'');
    v_status := 'nao_suportada_shadow_v1';
    v_motivo := 'Acao recebida e preservada, mas ainda nao possui politica shadow v1 de avaliacao.';
    v_requisitos := jsonb_build_array('definir_politica_shadow_para_acao');
    v_valor := null;
    v_orc_max := null;
    v_paralelo := null;
    v_experimento_id := null;
    v_etapa := null;
    v_audience_source := null;
    v_audience_name := null;
    v_regra := null;

    if v_acao='testar_segmento' and r.objeto_tipo='oportunidade' then
      v_suportadas := v_suportadas + 1;

      select x.etapa_portfolio, x.experimento_id
        into v_etapa, v_experimento_id
      from public.vw_dora_portfolio_loop x
      where x.oportunidade_id::text=r.objeto_id
      limit 1;

      select c.valor_minimo
        into v_orc_max
      from public.vw_criterios_midia c
      where c.tipo='teste' and c.metrica='orcamento_maximo'
        and c.segmento in (coalesce(v_segmento,'geral'),'geral')
      order by (c.segmento=coalesce(v_segmento,'geral')) desc
      limit 1;

      select c.valor_minimo
        into v_paralelo
      from public.vw_criterios_midia c
      where c.tipo='teste' and c.metrica='testes_simultaneos'
        and c.segmento in (coalesce(v_segmento,'geral'),'geral')
      order by (c.segmento=coalesce(v_segmento,'geral')) desc
      limit 1;

      v_budget_txt := v_rec#>>'{dados,verba_teste_sugerida_r}';
      if v_budget_txt is not null and v_budget_txt ~ '^[0-9]+([.][0-9]+)?$' and v_orc_max is not null then
        v_valor := least(v_budget_txt::numeric, v_orc_max);
        v_regra := 'min(verba_recomendada,criterio.orcamento_maximo)';
      elsif v_orc_max is not null and coalesce(v_paralelo,0)>0 then
        v_valor := round(v_orc_max / v_paralelo, 2);
        v_regra := 'criterio.orcamento_maximo/testes_simultaneos';
      end if;

      if v_orc_max is null or v_valor is null then
        v_status := 'bloqueada_sem_criterio_verba';
        v_motivo := 'Sinal aceito, mas nao existe criterio canonico suficiente para quantificar a verba do teste.';
        v_requisitos := jsonb_build_array('definir_criterio_verba_teste');
        v_bloqueadas := v_bloqueadas + 1;
      elsif v_paralelo is not null and v_ativos >= v_paralelo then
        v_status := 'bloqueada_capacidade_testes';
        v_motivo := format('Sinal aceito, verba shadow R$%s calculada, mas a capacidade de %s testes simultaneos esta ocupada.', v_valor, v_paralelo);
        v_requisitos := jsonb_build_array('aguardar_slot_experimento');
        v_bloqueadas := v_bloqueadas + 1;
      elsif v_experimento_id is null then
        v_status := 'condicionada_criar_experimento_dora';
        v_motivo := format('Sinal aceito para teste. Verba shadow R$%s calculada pela politica canonica; antes de qualquer Meta e obrigatorio abrir o experimento Dora.', v_valor);
        v_requisitos := jsonb_build_array('abrir_experimento_dora','registrar_limite_financeiro','definir_criterio_sucesso_e_morte');
        v_condicionadas := v_condicionadas + 1;
      else
        v_status := 'pronta_shadow_sem_execucao';
        v_motivo := format('Sinal aceito e experimento Dora existente. Verba shadow R$%s; permanece sem execucao externa.', v_valor);
        v_requisitos := '[]'::jsonb;
        v_prontas := v_prontas + 1;
      end if;

    elsif v_acao='criar_publico' and r.objeto_tipo='oportunidade' then
      v_suportadas := v_suportadas + 1;
      v_audience_source := coalesce(
        nullif(btrim(v_rec->>'audience_source'),''),
        nullif(btrim(v_rec#>>'{dados,audience_source}'),'')
      );

      if v_audience_source is not null then
        select a.name into v_audience_name
        from public.dim_audiences a
        where a.id::text=v_audience_source
          and a.negocio='skillprint'
          and a.delivery_status->>'code'='200'
        limit 1;
      end if;

      if v_audience_source is null or v_audience_name is null then
        v_status := 'bloqueada_sem_audience_source_canonica';
        v_motivo := 'Sinal comercial aceito, mas criar lookalike sem audience_source canonica seria ambiguo. Nenhuma fonte foi inferida por nome.';
        v_requisitos := jsonb_build_array('resolver_audience_source_canonica','validar_seed_do_segmento','registrar_id_meta_da_fonte');
        v_bloqueadas := v_bloqueadas + 1;
      else
        v_status := 'pronta_shadow_sem_execucao';
        v_motivo := format('Audience source canonica %s (%s) validada; proposta continua shadow e nao cria publico na Meta.', v_audience_source, v_audience_name);
        v_requisitos := '[]'::jsonb;
        v_prontas := v_prontas + 1;
      end if;
    end if;

    insert into public.agente_decisoes_log (
      id, agente_slug, contexto, decisao, acao_executada, resultado,
      nivel_autonomia_usado, impacto_financeiro, acerto,
      agent_version, dry_run, created_at, efeito_externo,
      execucao_sucesso, executed_at,
      origem_decision_id, autoria_decisao, autoria_ref,
      objeto_tipo, objeto_id
    ) values (
      gen_random_uuid(),
      'agente-midia',
      jsonb_build_object(
        'trigger','gustavo_shadow_proposta',
        'contrato','gustavo_proposta_shadow_v1',
        'source_receipt_id',r.id,
        'source_diego_decision_id',p_diego_decision_id,
        'execucao_habilitada',false,
        'efeito_externo_permitido',false,
        'criterios_verba',case when v_acao='testar_segmento' then jsonb_build_object(
          'orcamento_maximo_r',v_orc_max,
          'testes_simultaneos',v_paralelo,
          'experimentos_ativos',v_ativos,
          'regra_calculo',v_regra
        ) else null end
      ),
      jsonb_build_object(
        'executar',false,
        'acao_recebida',v_acao,
        'status_avaliacao',v_status,
        'acao_proposta',v_acao,
        'valor_proposto_r',v_valor,
        'alvo_tipo',r.objeto_tipo,
        'alvo_id',r.objeto_id,
        'segmento',v_segmento,
        'motivo_gustavo',v_motivo,
        'requisitos_pendentes',v_requisitos,
        'experimento_id',v_experimento_id,
        'etapa_portfolio',v_etapa,
        'audience_source',v_audience_source,
        'audience_source_name',v_audience_name,
        'impacto_estimado_origem_r',v_rec->'impacto_estimado_r',
        'recomendacao_origem',v_rec
      ),
      'proposta_midia_shadow',
      'proposta',
      0,
      null,
      null,
      'agente-midia-shadow-policy-v1',
      true,
      now(),
      false,
      null,
      null,
      r.id,
      'politica_sql',
      'fn_gustavo_processar_handoffs_shadow',
      r.objeto_tipo,
      r.objeto_id
    ) on conflict do nothing;

    get diagnostics v_rows = row_count;
    v_inseridas := v_inseridas + v_rows;
  end loop;

  return jsonb_build_object(
    'status','ok',
    'diego_decision_id',p_diego_decision_id,
    'recebimentos',v_total,
    'propostas_total',(select count(*) from public.agente_decisoes_log p
      join public.agente_decisoes_log h on h.id=p.origem_decision_id
      where p.agente_slug='agente-midia' and p.acao_executada='proposta_midia_shadow'
        and h.origem_decision_id=p_diego_decision_id),
    'propostas_inseridas_agora',v_inseridas,
    'acoes_suportadas',v_suportadas,
    'bloqueadas',v_bloqueadas,
    'condicionadas',v_condicionadas,
    'prontas_shadow',v_prontas,
    'execucao_real',false,
    'efeito_externo',false
  );
end
$function$;

revoke all on function public.fn_gustavo_processar_handoffs_shadow(uuid) from public;
grant execute on function public.fn_gustavo_processar_handoffs_shadow(uuid) to service_role, midia_shadow_owner;

-- Preserve the already-proven handoff implementation as an internal base, and expose
-- a wrapper under the same canonical name Diego already calls. The wrapper appends
-- Gustavo's shadow proposal metrics without changing Diego's Edge Function.
alter function public.fn_registrar_participantes_diego_shadow(text,uuid,uuid,text,jsonb)
rename to fn_registrar_participantes_diego_shadow_base;

create function public.fn_registrar_participantes_diego_shadow(
  p_run_id text,
  p_edge_execution_id uuid,
  p_agent_decision_id uuid,
  p_agent_version text,
  p_recomendacoes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','midia_shadow'
as $function$
declare
  v_base jsonb;
  v_prop jsonb;
begin
  v_base := public.fn_registrar_participantes_diego_shadow_base(
    p_run_id,p_edge_execution_id,p_agent_decision_id,p_agent_version,p_recomendacoes
  );
  v_prop := public.fn_gustavo_processar_handoffs_shadow(p_agent_decision_id);
  return coalesce(v_base,'{}'::jsonb) || jsonb_build_object('gustavo_propostas',v_prop);
end
$function$;

revoke all on function public.fn_registrar_participantes_diego_shadow(text,uuid,uuid,text,jsonb) from public;
grant execute on function public.fn_registrar_participantes_diego_shadow(text,uuid,uuid,text,jsonb) to service_role, midia_shadow_owner;

-- Operational proof for 21/08/2026:
-- Diego decision b282c767-14ed-4037-87f6-a154e95480a8 -> 2 receipts -> 2 Gustavo proposals.
-- 1 conditioned DTF test at R$250 (R$500 max / 2 simultaneous tests).
-- 1 blocked audience proposal because no canonical audience_source was supplied.
-- Replay: 0 duplicate proposals. External effects: 0.
