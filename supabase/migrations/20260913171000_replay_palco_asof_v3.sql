-- ============================================================================
-- Harness de replay v10 — E2 (palco as-of de verdade, versão 3)
--
-- Projeto: ldrdtaibazplvrbwyrvx (cérebro-vendas).  NÃO é o ERP.
--
-- O problema: `fn_replay_congelar_palco_v288` fotografa cada tabela em "hoje",
-- não em `replay_caso.as_of`. Medido em 13/09 sobre as 31 capturas existentes,
-- o palco continha compra POSTERIOR ao as_of em 20 casos — e em 4 deles
-- (3b3560fe, 769fb38a, 9c8a13d3, 3c91e46a) não havia compra nenhuma antes do
-- as_of: as 3, 2, 2 e 2 compras são todas posteriores. O guard
-- `cliente_comprador` estava descartando esses casos por um fato do futuro.
--
-- Esta migration cria:
--   fn_replay_palco_futuro_v1      — o auditor: conta carimbos > as_of no palco
--   fn_replay_congelar_palco_v3    — a captura com corte em as_of
--
-- Os palcos existentes NÃO são apagados nem alterados: a v3 grava numa
-- `versao_palco` nova. Nada aqui toca o núcleo do João nem edge alguma.
-- ============================================================================

-- (a migration roda dentro da transação do runner; sem BEGIN/COMMIT explícitos)

-- ─────────────────────────── classificação das coleções ───────────────────────────
-- EVENTO/LEAD: têm origem no tempo e são recortáveis em as_of. É sobre estas que o
--   critério de aceite (`0 eventos posteriores ao as_of`) incide.
-- REFERÊNCIA: catálogo e preço. Não existe histórico versionado delas neste banco;
--   recortá-las deixaria o replay sem tabela de preço e ele não rodaria. Ficam
--   congeladas inteiras e DECLARADAS — ver PENDENCIAS.md, item "referência sem as-of".

create or replace function public.replay_colecao_evento_v3(p_tabela text)
returns boolean language sql immutable as $$
  select p_tabela in ('pixel_events','orcamentos','vw_orcamento_calcme_vigente',
                      'leads_marketing','lead_identificadores','agente_noturno_estado');
$$;

comment on function public.replay_colecao_evento_v3(text) is
  'E2/v10. true para as coleções com origem no tempo, sujeitas ao corte em as_of. '
  'As demais (sistema_config, catalogo_produtos, dtf_*) são referência sem histórico.';

-- ─────────────────────────── o auditor ───────────────────────────

create or replace function public.fn_replay_palco_futuro_estado_v1(
  p_estado jsonb, p_as_of timestamptz
) returns jsonb
language sql stable as $$
  with linhas as (
    select t.key as tabela, l.ordinality - 1 as idx, l.value as linha
    from jsonb_each(coalesce(p_estado,'{}'::jsonb)) t,
         lateral jsonb_array_elements(t.value) with ordinality l
    where jsonb_typeof(t.value) = 'array'
  ),
  campos as (
    select ln.tabela, ln.idx, c.key as campo, c.value #>> '{}' as valor
    from linhas ln, lateral jsonb_each(ln.linha) c
    where jsonb_typeof(c.value) = 'string'
      and c.value #>> '{}' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
  ),
  futuros as (
    select tabela, campo, idx, valor, public.replay_colecao_evento_v3(tabela) as e_evento
    from campos
    where valor::timestamptz > p_as_of
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'eventos_posteriores',    coalesce((select count(*) from futuros where e_evento), 0),
    'referencia_posterior',   coalesce((select count(*) from futuros where not e_evento), 0),
    'por_campo', coalesce((
      select jsonb_agg(x order by x->>'tabela', x->>'campo')
      from (
        select jsonb_build_object(
          'tabela', tabela, 'campo', campo, 'classe', case when e_evento then 'evento' else 'referencia' end,
          'n', count(*), 'exemplo', min(valor)) as x
        from futuros group by tabela, campo, e_evento
      ) g), '[]'::jsonb));
$$;

comment on function public.fn_replay_palco_futuro_estado_v1(jsonb,timestamptz) is
  'E2/v10. Varre um `estado` de palco e conta TODO carimbo de tempo posterior ao as_of, '
  'separando coleção de evento (o que o aceite cobra = 0) de tabela de referência.';

create or replace function public.fn_replay_palco_futuro_v1(
  p_caso_id uuid default null, p_versao integer default null
) returns table (
  caso_id uuid, versao_palco integer, as_of timestamptz,
  eventos_posteriores bigint, referencia_posterior bigint, por_campo jsonb
)
language sql stable as $$
  select p.caso_id, p.versao_palco, p.as_of,
         (r ->> 'eventos_posteriores')::bigint,
         (r ->> 'referencia_posterior')::bigint,
         r -> 'por_campo'
  from public.replay_palco_congelado p,
       lateral public.fn_replay_palco_futuro_estado_v1(p.estado, p.as_of) r
  where (p_caso_id is null or p.caso_id = p_caso_id)
    and (p_versao  is null or p.versao_palco = p_versao)
  order by p.caso_id, p.versao_palco;
$$;

comment on function public.fn_replay_palco_futuro_v1(uuid,integer) is
  'E2/v10. Consulta objetiva do aceite: para a versão de palco pedida, quantos carimbos '
  'de tempo são posteriores ao as_of do caso. Tem de ser 0 em eventos_posteriores, 31/31.';

-- ─────────────────────────── clamp declarado ───────────────────────────
-- Linha que EXISTIA em as_of mas foi alterada depois: a linha fica (ela existia),
-- e todo carimbo posterior ao as_of vira as_of. `as_of` é o limite superior correto
-- para "última alteração conhecida até aqui" — é um teto, não um valor inventado.
-- O que foi alterado sai registrado em `hashes.reconstrucao_v3`.

create or replace function public.fn_replay_palco_clampar_v3(p_linhas jsonb, p_as_of timestamptz)
returns jsonb
language plpgsql immutable as $function$
declare
  v_out   jsonb := '[]'::jsonb;
  v_linha jsonb;
  v_nova  jsonb;
  v_k     text;
  v_v     jsonb;
  v_t     timestamptz;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    return coalesce(p_linhas, '[]'::jsonb);
  end if;

  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_nova := v_linha;
    for v_k, v_v in select key, value from jsonb_each(v_linha) loop
      if jsonb_typeof(v_v) = 'string'
         and (v_v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}' then
        begin
          v_t := (v_v #>> '{}')::timestamptz;
        exception when others then
          v_t := null;
        end;
        if v_t is not null and v_t > p_as_of then
          v_nova := jsonb_set(v_nova, array[v_k], to_jsonb(p_as_of));
        end if;
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(v_nova);
  end loop;
  return v_out;
end
$function$;

comment on function public.fn_replay_palco_clampar_v3(jsonb,timestamptz) is
  'E2/v10. Trava em as_of os carimbos de tempo posteriores de linhas que já existiam. '
  'Não apaga linha e não inventa valor: as_of é teto, não estimativa.';

-- ─────────────────────────── a captura v3 ───────────────────────────

create or replace function public.fn_replay_congelar_palco_v3(
  p_caso_id uuid, p_por text, p_versao integer default 3
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_caso        record;
  v_estado      jsonb;
  v_rpc         jsonb := '{}'::jsonb;
  v_hashes      jsonb := '{}'::jsonb;
  v_tmp         jsonb;
  v_estado_cru  jsonb;
  v_etapa_asof  text;
  v_etapa_fonte text;
  v_antes       jsonb;
  v_depois      jsonb;
  k             text;
begin
  select * into v_caso from public.replay_caso where id = p_caso_id;
  if not found then
    raise exception 'caso_inexistente: %', p_caso_id;
  end if;

  if exists (select 1 from public.replay_palco_congelado
              where caso_id = p_caso_id and versao_palco = p_versao) then
    raise exception 'palco_ja_existe: caso % ja tem versao_palco=%. As versoes anteriores nunca sao sobrescritas.',
      p_caso_id, p_versao;
  end if;

  -- ── agente_noturno_estado: reconstruído, não fotografado ──
  -- A tabela tem 5 colunas e 4 delas são reconstruíveis em as_of:
  --   phone/lead_id  = do próprio caso
  --   slots          = replay_caso.slots_antes (o estado ANTES do turno, que é o as_of)
  --   updated_at     = as_of (teto)
  -- `etapa` só existe historicamente quando agente_decisoes_log registrou; quando não
  -- registrou, a linha viva é mantida e isso fica DECLARADO em hashes.reconstrucao_v3.
  select d.decisao ->> 'etapa' into v_etapa_asof
    from public.agente_decisoes_log d
   where d.lead_id = v_caso.lead_id::text
     and d.created_at <= v_caso.as_of
     and d.decisao ? 'etapa'
   order by d.created_at desc
   limit 1;
  v_etapa_fonte := case when v_etapa_asof is null then 'linha_viva_nao_reconstruivel'
                        else 'agente_decisoes_log_ate_as_of' end;

  select coalesce(jsonb_agg(
           to_jsonb(t)
           || jsonb_build_object(
                'slots', coalesce(v_caso.slots_antes, to_jsonb(t) -> 'slots'),
                'etapa', coalesce(v_etapa_asof, t.etapa),
                'updated_at', to_jsonb(least(t.updated_at, v_caso.as_of)))), '[]'::jsonb)
    into v_tmp
    from public.agente_noturno_estado t
   where t.phone = v_caso.phone;

  -- Sem linha viva: o lead existia, o estado ainda não. Palco vazio é o correto.
  v_estado := jsonb_build_object('agente_noturno_estado', v_tmp);

  -- ── coleções de evento: corte de EXISTÊNCIA em as_of ──

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.leads_marketing t
   where t.lead_id = v_caso.lead_id and t.created_at <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object(
    'leads_marketing', public.fn_replay_palco_clampar_v3(v_tmp, v_caso.as_of));

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.orcamentos t
   where t.lead_id = v_caso.lead_id and t.created_at <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object(
    'orcamentos', public.fn_replay_palco_clampar_v3(v_tmp, v_caso.as_of));

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.vw_orcamento_calcme_vigente t
   where t.lead_id = v_caso.lead_id
     and coalesce(t.extraido_em, t.document_timestamp) <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object(
    'vw_orcamento_calcme_vigente', public.fn_replay_palco_clampar_v3(v_tmp, v_caso.as_of));

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.lead_identificadores t
   where t.lead_id = v_caso.lead_id and t.created_at <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object(
    'lead_identificadores', public.fn_replay_palco_clampar_v3(v_tmp, v_caso.as_of));

  -- pixel_events: o corte que estava faltando. O evento tem de ter ACONTECIDO e ter
  -- sido INGERIDO até o as_of — senão o João daquele instante não o enxergava.
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.pixel_events t
   where t.lead_id = v_caso.lead_id
     and t.event_time <= v_caso.as_of
     and coalesce(t.ingested_at, t.event_time) <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object(
    'pixel_events', public.fn_replay_palco_clampar_v3(v_tmp, v_caso.as_of));

  -- ── referência: congelada inteira, com corte de existência onde ele existe ──
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp from public.sistema_config t;
  v_estado := v_estado || jsonb_build_object('sistema_config', v_tmp);

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.catalogo_produtos t
   where t.created_at is null or t.created_at <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object('catalogo_produtos', v_tmp);

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp from public.dtf_precos_faixa t;
  v_estado := v_estado || jsonb_build_object('dtf_precos_faixa', v_tmp);
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp
    from public.dtf_uv_degraus t
   where t.created_at is null or t.created_at <= v_caso.as_of;
  v_estado := v_estado || jsonb_build_object('dtf_uv_degraus', v_tmp);
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tmp from public.dtf_produto_config t;
  v_estado := v_estado || jsonb_build_object('dtf_produto_config', v_tmp);

  v_estado := v_estado || jsonb_build_object('agente_noturno_lock', '[]'::jsonb);

  -- ── RPCs de contexto ──
  -- ATENÇÃO: fn_contexto_comercial_do_lead e fn_agente_pausado leem o banco VIVO;
  -- não há versão as-of delas. A saída continua sendo a de hoje e isso fica declarado.
  begin
    v_rpc := v_rpc || jsonb_build_object('fn_contexto_comercial_do_lead',
             to_jsonb(public.fn_contexto_comercial_do_lead(v_caso.lead_id)));
  exception when others then
    v_rpc := v_rpc || jsonb_build_object('fn_contexto_comercial_do_lead',
             jsonb_build_object('_erro_captura', SQLERRM));
  end;
  begin
    v_rpc := v_rpc || jsonb_build_object('fn_contexto_aprendizados',
             to_jsonb(public.fn_contexto_aprendizados('agente-noturno', null)));
  exception when others then
    v_rpc := v_rpc || jsonb_build_object('fn_contexto_aprendizados',
             jsonb_build_object('_erro_captura', SQLERRM));
  end;
  begin
    v_rpc := v_rpc || jsonb_build_object('fn_agente_pausado',
             to_jsonb(public.fn_agente_pausado(v_caso.phone)));
  exception when others then
    v_rpc := v_rpc || jsonb_build_object('fn_agente_pausado',
             jsonb_build_object('_erro_captura', SQLERRM));
  end;

  -- ── hashes + declaração de reconstrução ──
  for k in select jsonb_object_keys(v_estado) loop
    v_hashes := v_hashes || jsonb_build_object(
      k, encode(extensions.digest(convert_to(v_estado -> k #>> '{}', 'UTF8'), 'sha256'), 'hex'));
  end loop;

  -- o que o palco v3 teria contido sem o corte, para o antes/depois ficar no registro
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_estado_cru
    from public.pixel_events t where t.lead_id = v_caso.lead_id;

  v_antes  := public.fn_replay_palco_futuro_estado_v1(
                jsonb_build_object('pixel_events', v_estado_cru), v_caso.as_of);
  v_depois := public.fn_replay_palco_futuro_estado_v1(v_estado, v_caso.as_of);

  v_hashes := v_hashes || jsonb_build_object(
    'overlay_slots_antes', (v_caso.slots_antes is not null),
    'reconstrucao_v3', jsonb_build_object(
      'regra', 'corte de existencia em as_of nas colecoes de evento + clamp declarado dos carimbos posteriores',
      'agente_noturno_estado', jsonb_build_object(
        'slots_de', 'replay_caso.slots_antes',
        'etapa_fonte', v_etapa_fonte,
        'etapa_valor', coalesce(v_etapa_asof, '(linha viva)'),
        'updated_at_de', 'least(linha_viva.updated_at, as_of)'),
      'pixel_events', jsonb_build_object(
        'corte', 'event_time <= as_of and coalesce(ingested_at,event_time) <= as_of',
        'linhas_vivas', jsonb_array_length(v_estado_cru),
        'linhas_no_palco', jsonb_array_length(v_estado -> 'pixel_events'),
        'carimbos_futuros_antes_do_corte', v_antes -> 'eventos_posteriores'),
      'referencia_sem_as_of', jsonb_build_array(
        'sistema_config','catalogo_produtos','dtf_precos_faixa','dtf_uv_degraus','dtf_produto_config'),
      'rpc_sem_as_of', jsonb_build_array(
        'fn_contexto_comercial_do_lead','fn_contexto_aprendizados','fn_agente_pausado'),
      'auditoria_pos_captura', v_depois));

  insert into public.replay_palco_congelado
    (caso_id, versao_palco, as_of, capturado_por, estado, rpc_saidas, hashes)
  values
    (p_caso_id, p_versao, v_caso.as_of, p_por, v_estado, v_rpc, v_hashes);

  return jsonb_build_object(
    'ok', true,
    'caso_id', p_caso_id,
    'versao_palco', p_versao,
    'as_of', v_caso.as_of,
    'tabelas', (select count(*) from jsonb_object_keys(v_estado)),
    'rpc_saidas', (select count(*) from jsonb_object_keys(v_rpc)),
    'eventos_posteriores', v_depois -> 'eventos_posteriores',
    'referencia_posterior', v_depois -> 'referencia_posterior',
    'pixel_events_descartados',
      jsonb_array_length(v_estado_cru) - jsonb_array_length(v_estado -> 'pixel_events'),
    'etapa_fonte', v_etapa_fonte);
end
$function$;

comment on function public.fn_replay_congelar_palco_v3(uuid,text,integer) is
  'E2/v10. Captura o palco cortando em replay_caso.as_of, não em "hoje". '
  'Recusa sobrescrever versão existente: os palcos anteriores ficam intactos.';

