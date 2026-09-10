-- Partial-aware payment status read — 2026-09-09
create or replace function public.fn_joao_pagamento_em_curso_v1(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_digits text;
  v_hash text;
  v_row record;
  v_state jsonb;
  v_result jsonb;
  v_paid numeric:=0;
  v_balance numeric:=0;
  v_total numeric:=0;
begin
  v_digits := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if length(v_digits)>11 then v_digits:=right(v_digits,11); end if;
  if length(v_digits)<10 then return jsonb_build_object('ok',false,'code','PHONE_INVALID'); end if;
  v_hash := encode(digest(v_digits,'sha256'),'hex');

  select x.* into v_row
  from (
    select m.orcamento_id,m.status as evidence_status,m.valor as evidence_value,
           coalesce(m.paid_at,m.updated_at,m.created_at) as evidence_at,
           m.paid_at,'mp_pix_cobrancas'::text as source
    from public.mp_pix_cobrancas m
    join public.leads_marketing l on l.lead_id=m.lead_id
    where right(regexp_replace(coalesce(l.ph,''),'[^0-9]','','g'),11)=v_digits
      and coalesce(m.updated_at,m.created_at)>=now()-interval '72 hours'

    union all

    select e.orcamento_id,
           case when e.resultado='CONFIRMADO' then 'approved' else 'unknown' end as evidence_status,
           e.valor_pago as evidence_value,
           e.created_at as evidence_at,
           e.created_at as paid_at,
           'cortex_pix_joao_bridge_events'::text as source
    from public.cortex_pix_joao_bridge_events e
    where right(regexp_replace(coalesce(e.phone,''),'[^0-9]','','g'),11)=v_digits
      and e.resultado='CONFIRMADO'
      and e.created_at>=now()-interval '72 hours'
  ) x
  order by x.evidence_at desc
  limit 1;

  if not found then
    v_result:=jsonb_build_object('ok',true,'code','NO_RECENT_PAYMENT_EVIDENCE','authority','cortex','window_hours',72);
  else
    v_state:=public.fn_joao_orcamento_payment_state_v1(v_row.orcamento_id,now());
    if coalesce((v_state->>'ok')::boolean,false)=false then
      v_result:=jsonb_build_object('ok',false,'code','PAYMENT_STATE_UNAVAILABLE','authority','cortex','source',v_row.source,'payment_state',v_state);
    else
      v_paid:=round(coalesce((v_state->>'paid_total_raw')::numeric,0),2);
      v_balance:=round(coalesce((v_state->>'balance')::numeric,0),2);
      v_total:=round(coalesce((v_state->>'order_total')::numeric,0),2);

      if coalesce((v_state->>'fully_paid')::boolean,false) then
        v_result:=jsonb_strip_nulls(jsonb_build_object(
          'ok',true,'code','PAYMENT_APPROVED','authority','cortex','source',v_row.source,
          'status','approved','valor',v_row.evidence_value,'paid_at',v_row.paid_at,
          'order_total',v_total,'total_pago',v_paid,'saldo',0,'fully_paid',true,'orcamento_id',v_row.orcamento_id,'window_hours',72
        ));
      elsif lower(coalesce(v_row.evidence_status,''))='pending' then
        v_result:=jsonb_strip_nulls(jsonb_build_object(
          'ok',true,'code','PAYMENT_PENDING','authority','cortex','source',v_row.source,
          'status','pending','valor',v_row.evidence_value,'order_total',v_total,'total_pago',v_paid,'saldo',v_balance,'fully_paid',false,'orcamento_id',v_row.orcamento_id,'window_hours',72
        ));
      elsif lower(coalesce(v_row.evidence_status,''))='cancelled' then
        v_result:=jsonb_strip_nulls(jsonb_build_object(
          'ok',true,'code','PAYMENT_CANCELLED','authority','cortex','source',v_row.source,
          'status','cancelled','valor',v_row.evidence_value,'order_total',v_total,'total_pago',v_paid,'saldo',v_balance,'fully_paid',false,'orcamento_id',v_row.orcamento_id,'window_hours',72
        ));
      elsif v_paid>0 then
        v_result:=jsonb_strip_nulls(jsonb_build_object(
          'ok',true,'code','PAYMENT_PARTIAL','authority','cortex','source',v_row.source,
          'status','partial','valor',v_row.evidence_value,'paid_at',v_row.paid_at,
          'order_total',v_total,'total_pago',v_paid,'saldo',v_balance,'fully_paid',false,'orcamento_id',v_row.orcamento_id,'window_hours',72
        ));
      else
        v_result:=jsonb_build_object('ok',true,'code','PAYMENT_STATE_UNKNOWN','authority','cortex','source',v_row.source,'status',coalesce(v_row.evidence_status,'unknown'),'window_hours',72,'payment_state',v_state);
      end if;
    end if;
  end if;

  insert into public.joao_cortex_payment_reads_v1(phone_hash,result_code,payment_status,source)
  values(v_hash,v_result->>'code',v_result->>'status',v_result->>'source');
  return v_result;
end;
$$;