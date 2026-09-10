-- Tighten João PIX guard v1: partial/deposit charge amount must also be customer-visible and accepted.
create or replace function public.fn_joao_pix_charge_guard_v1(
  p_orcamento_id uuid,
  p_lead_id uuid,
  p_as_of timestamptz default now()
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_orc public.orcamentos%rowtype;
  v_prod text;
  v_is_shirt boolean := false;
  v_total numeric;
  v_expected_charge numeric;
  v_total_br text;
  v_charge_br text;
  v_quote_at timestamptz;
  v_quote_text text;
  v_charge_at timestamptz;
  v_charge_text text;
  v_accept_after timestamptz;
  v_accept_at timestamptz;
  v_accept_text text;
  v_latest_inbound_at timestamptz;
  v_latest_inbound text;
  v_regenerate boolean := false;
  v_pending_id text;
  v_pending_status text;
  v_pending_value numeric;
  v_pending_exp timestamptz;
  v_status text;
begin
  if p_orcamento_id is null or p_lead_id is null or p_as_of is null then
    return jsonb_build_object('ok',false,'status','INVALID_INPUT','executable',false);
  end if;
  select * into v_orc from public.orcamentos where id=p_orcamento_id and lead_id=p_lead_id;
  if not found then return jsonb_build_object('ok',false,'status','ORCAMENTO_NOT_FOUND_OR_LEAD_MISMATCH','executable',false); end if;
  if v_orc.status <> 'enviado' then return jsonb_build_object('ok',false,'status','ORCAMENTO_STATUS_NOT_CHARGEABLE','orcamento_status',v_orc.status,'executable',false); end if;
  v_total := round(coalesce(v_orc.valor_total,0)::numeric,2);
  if v_total <= 0 then return jsonb_build_object('ok',false,'status','ORCAMENTO_TOTAL_INVALID','executable',false); end if;
  v_prod := lower(regexp_replace(coalesce(v_orc.produto,''),'[^a-zA-Z0-9áàâãéêíóôõúç]+','_','g'));
  v_is_shirt := v_prod ~ 'camiseta';
  if v_is_shirt then
    v_expected_charge := round(v_total*0.50,2);
    if v_orc.valor_cobranca is not null and abs(round(v_orc.valor_cobranca::numeric,2)-v_expected_charge)>0.01 then
      return jsonb_build_object('ok',false,'status','HOLD_SHIRT_DEPOSIT_POLICY_MISMATCH','executable',false,'product',v_orc.produto,'order_total',v_total,'configured_charge',round(v_orc.valor_cobranca::numeric,2),'expected_charge',v_expected_charge,'deposit_pct',50);
    end if;
  else
    v_expected_charge := round(coalesce(v_orc.valor_cobranca,v_total)::numeric,2);
  end if;
  v_total_br := replace(to_char(v_total,'FM999999990.00'),'.',',');
  v_charge_br := replace(to_char(v_expected_charge,'FM999999990.00'),'.',',');

  select c.created_at,c.message_text into v_quote_at,v_quote_text
  from public.fact_conversations c
  where c.lead_id=p_lead_id and c.direction='outbound' and c.source in ('joao','zapi')
    and c.created_at<=p_as_of and c.created_at>=p_as_of-interval '14 days'
    and c.message_text ilike '%João Barros%' and c.message_text ilike '%'||v_total_br||'%'
    and c.message_text ~* '(total|pedido[^\n]{0,70}r\$|r\$[^\n]{0,70}(por[[:space:]]+pe[cç]a|por[[:space:]]+unidade|cada)|sinal[^\n]{0,70}r\$)'
    and c.message_text !~* '(desconsidere|valor[[:space:]]+incorreto|n[aã]o[[:space:]]+pague)'
  order by c.created_at desc limit 1;

  if v_quote_at is null then
    v_status := 'HOLD_CUSTOMER_PRICE_NOT_PRESENTED';
  else
    v_accept_after := v_quote_at;
    if abs(v_expected_charge-v_total)>0.01 then
      select c.created_at,c.message_text into v_charge_at,v_charge_text
      from public.fact_conversations c
      where c.lead_id=p_lead_id and c.direction='outbound' and c.source in ('joao','zapi')
        and c.created_at>=v_quote_at and c.created_at<=p_as_of
        and c.message_text ilike '%João Barros%'
        and c.message_text ilike '%'||v_charge_br||'%'
        and c.message_text ~* '(sinal|entrada|50[[:space:]]*%|cinquenta[[:space:]]+por[[:space:]]+cento|metade)'
        and c.message_text !~* '(desconsidere|valor[[:space:]]+incorreto|n[aã]o[[:space:]]+pague)'
      order by c.created_at desc limit 1;
      if v_charge_at is null then
        v_status := 'HOLD_CUSTOMER_CHARGE_AMOUNT_NOT_PRESENTED';
      else
        v_accept_after := greatest(v_quote_at,v_charge_at);
      end if;
    end if;

    if v_status is null then
      select c.created_at,c.message_text into v_accept_at,v_accept_text
      from public.fact_conversations c
      where c.lead_id=p_lead_id and c.direction='inbound' and c.source='zapi'
        and c.created_at>v_accept_after and c.created_at<=p_as_of
        and c.message_text ~* '(^|[^[:alpha:]])(sim|correto|correta|confirmo|confirmado|pode|fechado|pix|cart[aã]o|gera|gerar|mande|manda|mandar|vou[[:space:]]+pagar|pagar)([^[:alpha:]]|$)'
      order by c.created_at desc limit 1;
      if v_accept_at is null then v_status:='HOLD_CUSTOMER_PRICE_NOT_ACCEPTED'; else v_status:='READY'; end if;
    end if;
  end if;

  select c.created_at,c.message_text into v_latest_inbound_at,v_latest_inbound
  from public.fact_conversations c
  where c.lead_id=p_lead_id and c.direction='inbound' and c.source='zapi' and c.created_at<=p_as_of
  order by c.created_at desc limit 1;
  if v_latest_inbound_at>=p_as_of-interval '20 minutes' then
    v_regenerate := coalesce(v_latest_inbound,'') ~* '((pix|c[oó]digo).{0,35}(n[aã]o[[:space:]]+(est[aá][[:space:]]+dando|d[aá]|funciona|vai|foi)|expir|vence|venceu|inv[aá]lid)|((manda|mande|gera|gere|envia|envie).{0,30}(outro|novo).{0,20}(pix|c[oó]digo))|((outro|novo).{0,20}(pix|c[oó]digo)))';
  end if;
  select p.payment_id,p.status,p.valor,p.expiracao into v_pending_id,v_pending_status,v_pending_value,v_pending_exp
  from public.mp_pix_cobrancas p where p.orcamento_id=p_orcamento_id and p.status='pending' order by p.created_at desc limit 1;

  return jsonb_build_object(
    'ok',v_status='READY','status',v_status,'executable',v_status='READY',
    'orcamento_id',p_orcamento_id,'lead_id',p_lead_id,'product',v_orc.produto,'is_shirt',v_is_shirt,
    'order_total',v_total,'expected_charge',v_expected_charge,'deposit_pct',case when v_is_shirt then 50 else null end,
    'customer_price_presented_at',v_quote_at,'customer_price_text',left(v_quote_text,500),
    'customer_charge_presented_at',v_charge_at,'customer_charge_text',left(v_charge_text,500),
    'customer_acceptance_at',v_accept_at,'customer_acceptance_text',left(v_accept_text,300),
    'latest_inbound_at',v_latest_inbound_at,'regenerate_requested',v_regenerate,
    'pending_payment',case when v_pending_id is null then null else jsonb_build_object('payment_id',v_pending_id,'status',v_pending_status,'value',v_pending_value,'expires_at',v_pending_exp) end,
    'effect_class','PAYMENT_PREFLIGHT_GUARD','authority_granted',true,'as_of',p_as_of
  );
end;
$$;
revoke all on function public.fn_joao_pix_charge_guard_v1(uuid,uuid,timestamptz) from public;
revoke all on function public.fn_joao_pix_charge_guard_v1(uuid,uuid,timestamptz) from anon;
revoke all on function public.fn_joao_pix_charge_guard_v1(uuid,uuid,timestamptz) from authenticated;
grant execute on function public.fn_joao_pix_charge_guard_v1(uuid,uuid,timestamptz) to service_role;
