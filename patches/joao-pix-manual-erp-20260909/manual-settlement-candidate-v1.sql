-- Manual receipt -> ERP settlement candidate v1
-- Fail-closed: only a single full-payment validated receipt may convert a proposal.
-- Multi-part manual payments stay in Cortex until ERP partial-receipt support exists.
create or replace function public.fn_joao_erp_manual_settlement_candidate_v1(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path='public','pg_temp'
as $$
declare
  v_e public.cortex_pix_joao_bridge_events%rowtype;
  v_o public.orcamentos%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_prop_count int := 0;
  v_prop_id uuid;
  v_receipt_id uuid;
  v_receipt_created timestamptz;
  v_bank_raw text;
  v_bank text;
  v_source text;
  v_conf text;
begin
  if p_event_id is null then
    return jsonb_build_object('ready',false,'code','EVENT_ID_REQUIRED');
  end if;

  select * into v_e from public.cortex_pix_joao_bridge_events where id=p_event_id;
  if not found then return jsonb_build_object('ready',false,'code','EVENT_NOT_FOUND'); end if;
  if v_e.resultado <> 'CONFIRMADO' then return jsonb_build_object('ready',false,'code','RECEIPT_NOT_CONFIRMED'); end if;

  v_source := coalesce(v_e.source_evidence->>'edge_function','');
  if v_source not like 'comprovante-pix-worker/v7%' then
    return jsonb_build_object('ready',false,'code','RECEIPT_SOURCE_NOT_ELIGIBLE','source',v_source);
  end if;

  v_conf := lower(coalesce(v_e.confianca,''));
  if v_conf not in ('alta','high') then
    return jsonb_build_object('ready',false,'code','RECEIPT_CONFIDENCE_NOT_HIGH','confidence',v_e.confianca);
  end if;

  select * into v_o from public.orcamentos where id=v_e.orcamento_id and lead_id=v_e.lead_id;
  if not found then return jsonb_build_object('ready',false,'code','ORCAMENTO_NOT_FOUND_OR_LEAD_MISMATCH'); end if;

  v_before := public.fn_joao_orcamento_payment_state_v1(v_o.id, v_e.created_at - interval '1 microsecond');
  v_after  := public.fn_joao_orcamento_payment_state_v1(v_o.id, v_e.created_at + interval '1 microsecond');
  if coalesce((v_before->>'ok')::boolean,false)=false or coalesce((v_after->>'ok')::boolean,false)=false then
    return jsonb_build_object('ready',false,'code','PAYMENT_STATE_UNAVAILABLE','before',v_before,'after',v_after);
  end if;

  -- This bridge is deliberately limited to one-shot manual settlement.
  if coalesce((v_before->>'paid_total_raw')::numeric,0) > 0.01 then
    return jsonb_build_object('ready',false,'code','MANUAL_MULTI_PART_NOT_SUPPORTED_IN_ERP','before',v_before,'after',v_after);
  end if;
  if coalesce((v_after->>'fully_paid')::boolean,false)=false then
    return jsonb_build_object('ready',false,'code','MANUAL_PAYMENT_NOT_FULL_SETTLEMENT','before',v_before,'after',v_after);
  end if;
  if abs(round(coalesce(v_e.valor_pago,0),2)-round(coalesce(v_o.valor_total,0),2)) > 1.00 then
    return jsonb_build_object('ready',false,'code','MANUAL_RECEIPT_NOT_SINGLE_FULL_AMOUNT','receipt_amount',v_e.valor_pago,'order_total',v_o.valor_total);
  end if;

  v_bank_raw := btrim(coalesce(v_e.source_evidence->>'receiving_bank',''));
  v_bank := translate(lower(v_bank_raw),'áàâãéêíóôõúç','aaaaeeiooouc');
  if v_bank like '%mercado%pago%' then v_bank := 'mercado pago';
  elsif v_bank like '%itau%' then v_bank := 'itau';
  elsif v_bank like '%bradesco%' then v_bank := 'bradesco';
  elsif v_bank like '%c6%' then v_bank := 'c6 bank';
  else return jsonb_build_object('ready',false,'code','RECEIVING_BANK_NOT_MAPPED','receiving_bank',nullif(v_bank_raw,'')); end if;

  select count(distinct r.proposta_id), (array_agg(distinct r.proposta_id))[1],
         (array_agg(r.receipt_id order by r.created_at desc))[1],
         max(r.created_at)
    into v_prop_count,v_prop_id,v_receipt_id,v_receipt_created
  from public.joao_erp_proposal_receipts_v1 r
  where r.lead_id=v_o.lead_id
    and r.canonical=true
    and abs(round(coalesce(r.expected_customer_total_brl,0),2)-round(coalesce(v_o.valor_total,0),2))<=0.01
    and r.created_at between v_o.created_at-interval '10 minutes' and v_o.created_at+interval '10 minutes';

  if v_prop_count=0 then
    return jsonb_build_object('ready',false,'code','CANONICAL_ERP_PROPOSAL_RECEIPT_NOT_FOUND','orcamento_id',v_o.id);
  elsif v_prop_count<>1 then
    return jsonb_build_object('ready',false,'code','CANONICAL_ERP_PROPOSAL_RECEIPT_AMBIGUOUS','count',v_prop_count,'orcamento_id',v_o.id);
  end if;

  return jsonb_build_object(
    'ready',true,
    'code','ERP_MANUAL_SETTLEMENT_READY_V1',
    'schema_version','joao-erp-manual-settlement-candidate/v1',
    'event_id',v_e.id,
    'external_payment_id','receipt:'||v_e.id::text,
    'lead_id',v_e.lead_id,
    'orcamento_id',v_o.id,
    'order_total',round(v_o.valor_total,2),
    'paid_at',v_e.created_at,
    'receiving_bank',v_bank,
    'receiving_bank_raw',v_bank_raw,
    'recipient_name',v_e.source_evidence->>'recipient_name',
    'proposta_id',v_prop_id,
    'proposal_receipt_id',v_receipt_id,
    'proposal_receipt_created_at',v_receipt_created,
    'payment_state_before',v_before,
    'payment_state_after',v_after,
    'source_evidence',v_e.source_evidence
  );
end;
$$;

revoke all on function public.fn_joao_erp_manual_settlement_candidate_v1(uuid) from public, anon, authenticated;
grant execute on function public.fn_joao_erp_manual_settlement_candidate_v1(uuid) to service_role;