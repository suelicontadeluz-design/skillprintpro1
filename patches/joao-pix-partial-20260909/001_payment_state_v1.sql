-- PIX partial-payment canonical state — 2026-09-09
-- No new table: derives order total, approved Mercado Pago payments,
-- confirmed manual receipt evidence, balance and overpayment from existing canonical sources.

create or replace function public.fn_joao_orcamento_payment_state_v1(
  p_orcamento_id uuid,
  p_as_of timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric;
  v_mp numeric := 0;
  v_manual numeric := 0;
  v_raw numeric := 0;
  v_applied numeric := 0;
  v_balance numeric := 0;
  v_overpaid numeric := 0;
  v_fully_paid boolean := false;
begin
  select valor_total into v_total
  from public.orcamentos
  where id = p_orcamento_id;

  if not found then
    return jsonb_build_object('ok',false,'code','ORCAMENTO_NOT_FOUND','orcamento_id',p_orcamento_id);
  end if;

  v_total := round(coalesce(v_total,0),2);
  if v_total <= 0 then
    return jsonb_build_object('ok',false,'code','ORDER_TOTAL_INVALID','orcamento_id',p_orcamento_id,'order_total',v_total);
  end if;

  select coalesce(sum(round(coalesce(m.valor,0),2)),0)
    into v_mp
  from public.mp_pix_cobrancas m
  where m.orcamento_id = p_orcamento_id
    and lower(coalesce(m.status,'')) = 'approved'
    and coalesce(m.paid_at,m.updated_at,m.created_at) <= coalesce(p_as_of,now());

  -- Manual receipt confirmations live in the existing Cortex PIX bridge.
  -- If a matching Mercado Pago approval exists within 24h for the same amount,
  -- treat the receipt as evidence of that provider payment rather than a second payment.
  select coalesce(sum(round(coalesce(e.valor_pago,0),2)),0)
    into v_manual
  from public.cortex_pix_joao_bridge_events e
  where e.orcamento_id = p_orcamento_id
    and e.resultado = 'CONFIRMADO'
    and e.created_at <= coalesce(p_as_of,now())
    and coalesce(e.source_evidence->>'edge_function','') like 'comprovante-pix-worker/%'
    and not exists (
      select 1
      from public.mp_pix_cobrancas m
      where m.orcamento_id = e.orcamento_id
        and lower(coalesce(m.status,'')) = 'approved'
        and abs(round(coalesce(m.valor,0),2) - round(coalesce(e.valor_pago,0),2)) <= 0.01
        and abs(extract(epoch from (coalesce(m.paid_at,m.updated_at,m.created_at) - e.created_at))) <= 86400
    );

  v_mp := round(coalesce(v_mp,0),2);
  v_manual := round(coalesce(v_manual,0),2);
  v_raw := round(v_mp + v_manual,2);
  v_applied := least(v_raw,v_total);
  v_balance := greatest(round(v_total-v_raw,2),0);
  v_overpaid := greatest(round(v_raw-v_total,2),0);
  v_fully_paid := v_raw >= (v_total - 1.00);

  return jsonb_build_object(
    'ok',true,
    'code',case when v_fully_paid then 'PAID_FULL' when v_raw>0 then 'PAID_PARTIAL' else 'UNPAID' end,
    'orcamento_id',p_orcamento_id,
    'order_total',v_total,
    'paid_mp',v_mp,
    'paid_manual',v_manual,
    'paid_total_raw',v_raw,
    'paid_applied',v_applied,
    'balance',v_balance,
    'overpaid',v_overpaid,
    'fully_paid',v_fully_paid,
    'as_of',coalesce(p_as_of,now())
  );
end;
$$;

revoke all on function public.fn_joao_orcamento_payment_state_v1(uuid,timestamptz) from public;
revoke all on function public.fn_joao_orcamento_payment_state_v1(uuid,timestamptz) from anon;
revoke all on function public.fn_joao_orcamento_payment_state_v1(uuid,timestamptz) from authenticated;
grant execute on function public.fn_joao_orcamento_payment_state_v1(uuid,timestamptz) to service_role;
