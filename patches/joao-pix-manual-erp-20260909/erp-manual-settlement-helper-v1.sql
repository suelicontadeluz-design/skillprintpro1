-- ERP manual settlement helper v1
-- Single full-payment validated receipt only. Uses the existing proposal -> sale -> AR -> OP path.
create or replace function public.fn_joao_converter_proposta_quitada_manual_v1(
  p_proposta_id uuid,
  p_external_payment_id text,
  p_paid_at timestamptz,
  p_payment_total numeric,
  p_receiving_bank text,
  p_proof jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_prop public.propostas%rowtype;
  v_sale public.vendas%rowtype;
  v_cr public.contas_receber%rowtype;
  v_bank_id uuid;
  v_bank_n int;
  v_bank_key text;
  v_forma_id uuid;
  v_forma_n int;
  v_sale_count int;
  v_cr_count int;
  v_item_count int;
  v_bad_items int;
  v_expected numeric;
  v_lanc_id uuid;
  v_op jsonb;
  v_paid_date date;
  v_dry boolean := coalesce((p_proof->>'dry_run')::boolean,false);
begin
  if p_proposta_id is null then return jsonb_build_object('ok',false,'code','PROPOSTA_ID_REQUIRED'); end if;
  if nullif(btrim(coalesce(p_external_payment_id,'')),'') is null then return jsonb_build_object('ok',false,'code','EXTERNAL_PAYMENT_ID_REQUIRED'); end if;
  if p_external_payment_id not like 'receipt:%' then return jsonb_build_object('ok',false,'code','MANUAL_EXTERNAL_ID_REQUIRED'); end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then return jsonb_build_object('ok',false,'code','PAID_AT_INVALID'); end if;
  if coalesce(p_payment_total,0)<=0 then return jsonb_build_object('ok',false,'code','PAYMENT_TOTAL_INVALID'); end if;
  if coalesce(p_proof->>'payment_source','')<>'validated_receipt' then return jsonb_build_object('ok',false,'code','VALIDATED_RECEIPT_PROOF_REQUIRED'); end if;
  if coalesce((p_proof->>'proposal_receipt_canonical')::boolean,false)=false then return jsonb_build_object('ok',false,'code','CANONICAL_PROPOSAL_RECEIPT_PROOF_REQUIRED'); end if;
  v_paid_date := (p_paid_at at time zone 'America/Sao_Paulo')::date;

  select * into v_prop from public.propostas where id=p_proposta_id for update;
  if not found then return jsonb_build_object('ok',false,'code','ERP_PROPOSAL_NOT_FOUND'); end if;
  v_expected:=coalesce(v_prop.total_com_frete,v_prop.total,0);
  if abs(v_expected-p_payment_total)>0.01 then return jsonb_build_object('ok',false,'code','ERP_PROPOSAL_PAYMENT_DIVERGENCE','erp_total',v_expected,'payment_total',p_payment_total); end if;

  select * into v_sale from public.vendas where source_system='joao_cortex' and external_id=p_external_payment_id order by created_at limit 1;
  if found then
    if v_sale.proposta_id is distinct from v_prop.id or abs(coalesce(v_sale.total_com_frete,v_sale.total_liquido,0)-p_payment_total)>0.01 then
      return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT','venda_id',v_sale.id);
    end if;
    select * into v_cr from public.contas_receber where venda_id=v_sale.id order by created_at limit 1;
    v_op:=public.fn_joao_gerar_op_venda_v1(v_sale.id,p_external_payment_id);
    return jsonb_build_object('ok',true,'code','IDEMPOTENT_EXISTING','venda_id',v_sale.id,'numero_venda',v_sale.numero_venda,'proposta_id',v_prop.id,'numero_proposta',v_prop.numero_proposta,'conta_receber_id',v_cr.id,'lancamento_id',v_cr.lancamento_id,'op',v_op,'total',p_payment_total);
  end if;

  select count(*) into v_sale_count from public.vendas where proposta_id=v_prop.id;
  if v_prop.venda_id is not null or v_sale_count>0 then return jsonb_build_object('ok',false,'code','PROPOSAL_ALREADY_CONVERTED','proposta_id',v_prop.id,'venda_id',v_prop.venda_id); end if;
  if v_prop.status<>'em_aberto' then return jsonb_build_object('ok',false,'code','PROPOSAL_NOT_OPEN','status',v_prop.status); end if;

  select count(*),count(*) filter(where pi.produto_id is null or pi.origem_custo<>'motor' or coalesce(pi.contexto_execucao->>'canonical_item','false')<>'true')
    into v_item_count,v_bad_items from public.proposta_itens pi where pi.proposta_id=v_prop.id;
  if v_item_count=0 or v_bad_items>0 then return jsonb_build_object('ok',false,'code','CANONICAL_PROPOSAL_ITEMS_INVALID','item_count',v_item_count,'invalid_items',v_bad_items); end if;

  v_bank_key:=translate(lower(btrim(coalesce(p_receiving_bank,''))),'áàâãéêíóôõúç','aaaaeeiooouc');
  if v_bank_key like '%mercado%pago%' then v_bank_key:='mercado pago';
  elsif v_bank_key like '%itau%' then v_bank_key:='itau';
  elsif v_bank_key like '%bradesco%' then v_bank_key:='bradesco';
  elsif v_bank_key like '%c6%' then v_bank_key:='c6 bank';
  else return jsonb_build_object('ok',false,'code','RECEIVING_BANK_NOT_MAPPED','receiving_bank',p_receiving_bank); end if;

  select count(*) into v_bank_n from public.financeiro_contas_bancarias b where b.ativa=true and (
    (v_bank_key='mercado pago' and (lower(btrim(coalesce(b.nome,'')))='mercado pago' or lower(btrim(coalesce(b.banco,'')))='mercado pago')) or
    (v_bank_key='itau' and (translate(lower(coalesce(b.nome,'')),'áàâãéêíóôõúç','aaaaeeiooouc') like '%itau%' or translate(lower(coalesce(b.banco,'')),'áàâãéêíóôõúç','aaaaeeiooouc') like '%itau%')) or
    (v_bank_key='bradesco' and (lower(coalesce(b.nome,'')) like '%bradesco%' or lower(coalesce(b.banco,'')) like '%bradesco%')) or
    (v_bank_key='c6 bank' and (lower(coalesce(b.nome,'')) like '%c6%' or lower(coalesce(b.banco,'')) like '%c6%'))
  );
  if v_bank_n<>1 then return jsonb_build_object('ok',false,'code','RECEIVING_BANK_AMBIGUOUS_OR_MISSING','bank_key',v_bank_key,'count',v_bank_n); end if;
  select b.id into v_bank_id from public.financeiro_contas_bancarias b where b.ativa=true and (
    (v_bank_key='mercado pago' and (lower(btrim(coalesce(b.nome,'')))='mercado pago' or lower(btrim(coalesce(b.banco,'')))='mercado pago')) or
    (v_bank_key='itau' and (translate(lower(coalesce(b.nome,'')),'áàâãéêíóôõúç','aaaaeeiooouc') like '%itau%' or translate(lower(coalesce(b.banco,'')),'áàâãéêíóôõúç','aaaaeeiooouc') like '%itau%')) or
    (v_bank_key='bradesco' and (lower(coalesce(b.nome,'')) like '%bradesco%' or lower(coalesce(b.banco,'')) like '%bradesco%')) or
    (v_bank_key='c6 bank' and (lower(coalesce(b.nome,'')) like '%c6%' or lower(coalesce(b.banco,'')) like '%c6%'))
  ) limit 1;

  select count(*) into v_forma_n from public.formas_pagamento_config where ativa=true and lower(btrim(nome))='pix' and aplicavel_a in ('recebimento','ambos');
  if v_forma_n<>1 then return jsonb_build_object('ok',false,'code','PIX_PAYMENT_METHOD_AMBIGUOUS_OR_MISSING','count',v_forma_n); end if;
  select id into v_forma_id from public.formas_pagamento_config where ativa=true and lower(btrim(nome))='pix' and aplicavel_a in ('recebimento','ambos') limit 1;

  if v_dry then
    return jsonb_build_object('ok',true,'code','MANUAL_SETTLEMENT_READY_DRY_RUN','proposta_id',v_prop.id,'numero_proposta',v_prop.numero_proposta,'total',v_expected,'bank_key',v_bank_key,'bank_id',v_bank_id,'item_count',v_item_count,'dry_run',true);
  end if;

  update public.propostas set tipo_pagamento='Pix',quantidade_parcelas=1,forma_pagamento_config_id=v_forma_id,updated_at=now() where id=v_prop.id;
  perform public.fn_gate_parcelas_proposta(v_prop.id);
  perform public.fn_gate_frete_proposta(v_prop.id);
  perform public.gerar_venda_de_proposta(v_prop.id,null,null);

  select * into v_sale from public.vendas where proposta_id=v_prop.id order by created_at desc limit 1;
  if not found then raise exception 'joao_manual_paid_proposal_sale_not_created'; end if;
  if abs(coalesce(v_sale.total_com_frete,v_sale.total_liquido,0)-p_payment_total)>0.01 then raise exception 'joao_manual_paid_proposal_sale_total_divergence'; end if;

  update public.vendas set source_system='joao_cortex',external_id=p_external_payment_id,status_origem='comprovante_pix_validado',external_payload=jsonb_build_object('external_payment_id',p_external_payment_id,'paid_at',p_paid_at,'payment_source','validated_receipt','receiving_bank',v_bank_key,'proof',coalesce(p_proof,'{}'::jsonb),'erp_proposta_id',v_prop.id),conta_bancaria_id=v_bank_id,tipo_pagamento='Pix',quantidade_parcelas=1,forma_pagamento_id=v_forma_id,data_venda=v_paid_date,updated_at=now() where id=v_sale.id;
  update public.propostas set status='convertida',venda_id=v_sale.id,updated_at=now() where id=v_prop.id;

  select count(*) into v_cr_count from public.contas_receber where venda_id=v_sale.id;
  if v_cr_count<>1 then raise exception 'joao_manual_paid_proposal_expected_one_receivable_got_%',v_cr_count; end if;
  select * into v_cr from public.contas_receber where venda_id=v_sale.id order by created_at limit 1 for update;
  if abs(v_cr.valor-p_payment_total)>0.01 then raise exception 'joao_manual_paid_proposal_receivable_total_divergence'; end if;

  update public.contas_receber set source_system='joao_cortex',external_id=p_external_payment_id,status_origem='comprovante_pix_validado',external_payload=jsonb_build_object('external_payment_id',p_external_payment_id,'paid_at',p_paid_at,'payment_source','validated_receipt','receiving_bank',v_bank_key,'proof',coalesce(p_proof,'{}'::jsonb)),tipo_pagamento='Pix',data_emissao=v_paid_date,data_competencia=v_paid_date,data_vencimento=v_paid_date where id=v_cr.id;

  if v_cr.status not in ('Recebido','Pago') then v_lanc_id:=public.fn_baixa_contas_receber(v_cr.id,v_bank_id,'Pix',p_payment_total,v_paid_date,0,0,null); else v_lanc_id:=v_cr.lancamento_id; end if;
  select * into v_sale from public.vendas where id=v_sale.id;
  v_op:=public.fn_joao_gerar_op_venda_v1(v_sale.id,p_external_payment_id);

  return jsonb_build_object('ok',true,'code',case when coalesce((v_op->>'ok')::boolean,false) then 'MANUAL_SALE_PAYMENT_AND_OP_SYNCED' else 'MANUAL_SALE_PAYMENT_SYNCED_OP_HOLD' end,'proposta_id',v_prop.id,'numero_proposta',v_prop.numero_proposta,'venda_id',v_sale.id,'numero_venda',v_sale.numero_venda,'conta_receber_id',v_cr.id,'lancamento_id',v_lanc_id,'external_payment_id',p_external_payment_id,'total',p_payment_total,'receiving_bank',v_bank_key,'op',v_op);
exception when unique_violation then
  select * into v_sale from public.vendas where source_system='joao_cortex' and external_id=p_external_payment_id limit 1;
  if found then return jsonb_build_object('ok',true,'code','IDEMPOTENT_RACE_EXISTING','venda_id',v_sale.id,'numero_venda',v_sale.numero_venda); end if;
  raise;
end;
$$;
revoke all on function public.fn_joao_converter_proposta_quitada_manual_v1(uuid,text,timestamptz,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.fn_joao_converter_proposta_quitada_manual_v1(uuid,text,timestamptz,numeric,text,jsonb) to service_role;