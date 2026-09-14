-- Provas de regressao do rendimento puro DTF v1.
-- Nao escreve dados; apenas falha se o contrato numerico mudar.

do $test$
declare
  r jsonb;
begin
  r := public.fn_dtf_rendimento_por_arte_v1('dtf_textil',35,30,10,true);
  if coalesce((r->>'ok')::boolean,false) is not true or (r->>'metros_para_lancar_erp')::numeric <> 3.2 then
    raise exception '35x30 x10 esperado 3.2m, obtido %', r;
  end if;

  r := public.fn_dtf_rendimento_por_arte_v1('dtf_textil',20,10,10,true);
  if (r->>'metros_para_lancar_erp')::numeric <> 0.5 or (r#>>'{layout,fileiras_rotacionadas}')::integer <> 2 then
    raise exception '20x10 x10 com rotacao esperado 0.5m/2 fileiras, obtido %', r;
  end if;

  r := public.fn_dtf_rendimento_por_arte_v1('dtf_textil',20,10,10,false);
  if (r->>'metros_para_lancar_erp')::numeric <> 0.6 then
    raise exception '20x10 x10 sem rotacao esperado 0.6m, obtido %', r;
  end if;

  r := public.fn_dtf_rendimento_por_arte_v1('dtf_textil',60,60,1,true);
  if coalesce((r->>'ok')::boolean,true) is not false or r->>'erro' <> 'arte_nao_cabe_na_largura' then
    raise exception '60x60 deveria falhar fechado, obtido %', r;
  end if;

  if has_function_privilege('anon','public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean)','EXECUTE') then
    raise exception 'anon nao pode executar fn_dtf_rendimento_por_arte_v1';
  end if;
  if has_function_privilege('authenticated','public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean)','EXECUTE') then
    raise exception 'authenticated nao pode executar fn_dtf_rendimento_por_arte_v1';
  end if;
  if not has_function_privilege('service_role','public.fn_dtf_rendimento_por_arte_v1(text,numeric,numeric,integer,boolean)','EXECUTE') then
    raise exception 'service_role precisa executar fn_dtf_rendimento_por_arte_v1';
  end if;
end;
$test$;
