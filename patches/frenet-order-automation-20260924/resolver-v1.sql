create or replace function public.fn_frenet_resolve_service_for_erp_v1(
  p_phone text,
  p_cep text,
  p_service text,
  p_price numeric default null,
  p_quote_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_cep text:=regexp_replace(coalesce(p_cep,''),'[^0-9]','','g');
  v_service text:=public.fn_joao_freight_service_canon_v1(p_service);
  v_q public.joao_freight_quote_snapshots%rowtype;
  v_opt jsonb;
begin
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if length(v_cep)<>8 or v_service is null then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;

  if p_quote_id is not null then
    select * into v_q
    from public.joao_freight_quote_snapshots q
    where q.quote_id=p_quote_id
    limit 1;
  else
    select * into v_q
    from public.joao_freight_quote_snapshots q
    where regexp_replace(coalesce(q.phone,''),'[^0-9]','','g')=v_phone
      and regexp_replace(coalesce(q.cep_destino,''),'[^0-9]','','g')=v_cep
      and exists(
        select 1
        from jsonb_array_elements(coalesce(q.opcoes,'[]'::jsonb)) o
        where public.fn_joao_freight_service_canon_v1(o->>'servico')=v_service
          and (p_price is null or p_price<=0 or abs(coalesce((o->>'preco')::numeric,0)-p_price)<=0.05)
      )
    order by q.quoted_at desc
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok',false,'code','CANONICAL_QUOTE_NOT_FOUND');
  end if;

  select o into v_opt
  from jsonb_array_elements(coalesce(v_q.opcoes,'[]'::jsonb)) o
  where public.fn_joao_freight_service_canon_v1(o->>'servico')=v_service
    and (p_price is null or p_price<=0 or abs(coalesce((o->>'preco')::numeric,0)-p_price)<=0.05)
  order by abs(coalesce((o->>'preco')::numeric,0)-coalesce(p_price,(o->>'preco')::numeric,0))
  limit 1;

  if v_opt is null then
    return jsonb_build_object('ok',false,'code','SERVICE_NOT_IN_QUOTE','quote_id',v_q.quote_id);
  end if;

  return jsonb_build_object(
    'ok',true,'code','RESOLVED','quote_id',v_q.quote_id,
    'service_code',v_opt->>'codigo','service_description',v_opt->>'servico',
    'carrier',v_opt->>'transportadora','price',nullif(v_opt->>'preco','')::numeric,
    'deadline_days',nullif(v_opt->>'prazo_dias','')::integer,'quoted_at',v_q.quoted_at
  );
end;
$function$;

revoke all on function public.fn_frenet_resolve_service_for_erp_v1(text,text,text,numeric,uuid) from public;
grant execute on function public.fn_frenet_resolve_service_for_erp_v1(text,text,text,numeric,uuid) to service_role;
