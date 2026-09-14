-- DTF rendimento puro v1 — 2026-09-13
-- Responsabilidade: converter dimensoes da arte + quantidade de copias em metros tecnicos.
-- NAO consulta preco, faixa, proposta, catalogo comercial nem aplica minimo comercial.
-- Saida `metros_para_lancar_erp` e a quantidade tecnica arredondada que o chamador pode enviar ao ERP.

create or replace function public.fn_dtf_rendimento_por_arte_v1(
  p_produto text,
  p_largura_cm numeric,
  p_altura_cm numeric,
  p_quantidade integer,
  p_permitir_rotacao boolean default true
)
returns jsonb
language plpgsql
as $function$
declare
  v_cfg public.dtf_produto_config%rowtype;
  v_largura_filme numeric;
  v_largura_max numeric;
  v_gap numeric;
  v_seguranca numeric;
  v_arredondamento numeric;
  v_cap_a integer := 0;
  v_cap_b integer := 0;
  v_rows_a integer;
  v_rows_b integer;
  v_max_rows_a integer;
  v_remaining integer;
  v_total_rows integer;
  v_length_cm numeric;
  v_best_length_cm numeric := null;
  v_best_rows_a integer := 0;
  v_best_rows_b integer := 0;
  v_best_capacity integer := 0;
  v_metros_layout numeric;
  v_metros_seguranca numeric;
  v_metros_lancar numeric;
begin
  if p_produto is null or p_produto not in ('dtf_textil', 'dtf_uv') then
    return jsonb_build_object('ok', false, 'erro', 'produto_invalido', 'produto', p_produto);
  end if;
  if p_largura_cm is null or p_altura_cm is null or p_largura_cm <= 0 or p_altura_cm <= 0 then
    return jsonb_build_object('ok', false, 'erro', 'dimensoes_invalidas');
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    return jsonb_build_object('ok', false, 'erro', 'quantidade_invalida');
  end if;

  select * into v_cfg
  from public.dtf_produto_config
  where produto = p_produto;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'config_produto_nao_encontrada', 'produto', p_produto);
  end if;

  v_largura_filme := v_cfg.largura_filme_cm;
  v_largura_max := coalesce(v_cfg.largura_max_cm, v_cfg.largura_filme_cm);
  v_gap := coalesce(v_cfg.gap_cm, 0.5);
  v_seguranca := coalesce(v_cfg.margem_seguranca, 0);
  v_arredondamento := coalesce(nullif(v_cfg.arredondamento_m, 0), 0.1);

  -- Orientacao A: largura da arte atravessa a bobina; altura avanca no comprimento.
  if p_largura_cm <= v_largura_max then
    v_cap_a := floor((v_largura_filme + v_gap) / (p_largura_cm + v_gap))::integer;
  end if;

  -- Orientacao B: arte rotacionada 90 graus.
  if p_permitir_rotacao and p_altura_cm <= v_largura_max then
    v_cap_b := floor((v_largura_filme + v_gap) / (p_altura_cm + v_gap))::integer;
  end if;

  if v_cap_a < 1 and v_cap_b < 1 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'arte_nao_cabe_na_largura',
      'largura_filme_cm', v_largura_filme,
      'largura_max_cm', v_largura_max,
      'arte', jsonb_build_object('largura_cm', p_largura_cm, 'altura_cm', p_altura_cm)
    );
  end if;

  -- Enumera fileiras A e completa o restante com o minimo de fileiras B.
  -- Assim pode misturar orientacoes entre fileiras e escolher o menor avanco total.
  v_max_rows_a := case when v_cap_a > 0 then ceil(p_quantidade::numeric / v_cap_a)::integer else 0 end;

  for v_rows_a in 0..v_max_rows_a loop
    v_remaining := greatest(p_quantidade - (v_rows_a * v_cap_a), 0);

    if v_remaining = 0 then
      v_rows_b := 0;
    elsif v_cap_b > 0 then
      v_rows_b := ceil(v_remaining::numeric / v_cap_b)::integer;
    else
      continue;
    end if;

    v_total_rows := v_rows_a + v_rows_b;
    if v_total_rows <= 0 then
      continue;
    end if;

    -- Gap apenas ENTRE fileiras. O gap lateral entra no calculo da capacidade por fileira.
    v_length_cm :=
      (v_rows_a * p_altura_cm)
      + (v_rows_b * p_largura_cm)
      + (greatest(v_total_rows - 1, 0) * v_gap);

    if v_best_length_cm is null or v_length_cm < v_best_length_cm then
      v_best_length_cm := v_length_cm;
      v_best_rows_a := v_rows_a;
      v_best_rows_b := v_rows_b;
      v_best_capacity := (v_rows_a * v_cap_a) + (v_rows_b * v_cap_b);
    end if;
  end loop;

  if v_best_length_cm is null then
    return jsonb_build_object('ok', false, 'erro', 'layout_nao_encontrado');
  end if;

  v_metros_layout := v_best_length_cm / 100.0;
  v_metros_seguranca := v_metros_layout * (1.0 + v_seguranca);
  v_metros_lancar := ceil(v_metros_seguranca / v_arredondamento) * v_arredondamento;

  return jsonb_build_object(
    'ok', true,
    'versao', 'rendimento-puro-v1',
    'produto', p_produto,
    'entrada', jsonb_build_object(
      'largura_cm', p_largura_cm,
      'altura_cm', p_altura_cm,
      'quantidade_copias', p_quantidade,
      'permitir_rotacao', p_permitir_rotacao
    ),
    'config_fisica', jsonb_build_object(
      'largura_filme_cm', v_largura_filme,
      'largura_max_cm', v_largura_max,
      'gap_cm', v_gap,
      'margem_seguranca', v_seguranca,
      'arredondamento_m', v_arredondamento
    ),
    'layout', jsonb_build_object(
      'capacidade_fileira_sem_rotacao', v_cap_a,
      'capacidade_fileira_rotacionada', v_cap_b,
      'fileiras_sem_rotacao', v_best_rows_a,
      'fileiras_rotacionadas', v_best_rows_b,
      'capacidade_total_layout', v_best_capacity,
      'comprimento_layout_cm', round(v_best_length_cm, 3)
    ),
    'metros_layout', round(v_metros_layout, 3),
    'metros_com_seguranca', round(v_metros_seguranca, 3),
    'metros_para_lancar_erp', round(v_metros_lancar, 3),
    'aplica_minimo_comercial', false,
    'aplica_preco', false,
    'proximo_passo', 'enviar metros_para_lancar_erp ao ERP; ERP aplica minimo, faixa e preco'
  );
end;
$function$;

comment on function public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean)
is 'Calcula somente rendimento fisico DTF por dimensoes e copias; nao precifica. Saida canonica para handoff ao ERP.';

-- RPC interna: o runtime autorizado usa service_role. Nao expor diretamente a anon/authenticated.
revoke all on function public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean) from public;
revoke all on function public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean) from anon;
revoke all on function public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean) from authenticated;
grant execute on function public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean) to service_role;
