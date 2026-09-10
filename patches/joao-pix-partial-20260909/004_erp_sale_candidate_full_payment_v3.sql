-- ERP sale candidate v3 — cumulative payment aware
-- Keeps public function name for the canonical sync.
create or replace function public.fn_joao_erp_sale_candidate_v1(p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay record; v_orc record; v_phone text;
  v_payment_state jsonb; v_order_total numeric;
  v_total_count int; v_total_id uuid; v_total_op record;
  v_products jsonb:='[]'::jsonb; v_freights jsonb:='[]'::jsonb;
  v_prod_count int:=0; v_freight_count int:=0;
  v_item jsonb; v_family text; v_qty numeric; v_sources jsonb:='[]'::jsonb;
  v_items jsonb:='[]'::jsonb; v_product_sum numeric:=0; v_freight_sum numeric:=0;
  v_tipo_envio text; v_cep text; v_servico text;
begin
  select * into v_pay from public.mp_pix_cobrancas where payment_id=p_payment_id limit 1;
  if not found then return jsonb_build_object('ready',false,'code','PAYMENT_NOT_FOUND'); end if;
  if lower(coalesce(v_pay.status,''))<>'approved' or v_pay.paid_at is null then return jsonb_build_object('ready',false,'code','PAYMENT_NOT_APPROVED'); end if;
  if v_pay.orcamento_id is null then return jsonb_build_object('ready',false,'code','ORCAMENTO_REQUIRED'); end if;
  select * into v_orc from public.orcamentos where id=v_pay.orcamento_id;
  if not found then return jsonb_build_object('ready',false,'code','ORCAMENTO_NOT_FOUND'); end if;

  v_payment_state:=public.fn_joao_orcamento_payment_state_v1(v_pay.orcamento_id,now());
  if coalesce((v_payment_state->>'ok')::boolean,false)=false then
    return jsonb_build_object('ready',false,'code','PAYMENT_STATE_UNAVAILABLE','payment_state',v_payment_state);
  end if;
  if coalesce((v_payment_state->>'fully_paid')::boolean,false)=false then
    return jsonb_build_object(
      'ready',false,'code','PAYMENT_PARTIAL_NOT_SALE_READY','schema_version','joao-erp-sale-candidate/v3',
      'payment_id',p_payment_id,'orcamento_id',v_pay.orcamento_id,
      'order_total',(v_payment_state->>'order_total')::numeric,
      'paid_total',(v_payment_state->>'paid_total_raw')::numeric,
      'balance',(v_payment_state->>'balance')::numeric,
      'payment_state',v_payment_state
    );
  end if;
  v_order_total:=round((v_payment_state->>'order_total')::numeric,2);

  select regexp_replace(coalesce(ph,''),'[^0-9]','','g') into v_phone from public.leads_marketing where lead_id=v_pay.lead_id;
  if length(coalesce(v_phone,''))<10 then return jsonb_build_object('ready',false,'code','PHONE_REQUIRED'); end if;

  -- The canonical operation belongs to the ORDER and may be linked to an earlier installment.
  select count(*), (array_agg(o.id order by o.created_at desc))[1]
    into v_total_count, v_total_id
  from public.operacoes_financeiras o
  where o.payment_id in (
      select m.payment_id from public.mp_pix_cobrancas m where m.orcamento_id=v_pay.orcamento_id
    )
    and o.kind='total' and o.status='consumida' and o.revogada_em is null;

  if v_total_count=0 then
    -- Strict legacy compatibility, now using the full ORDER total rather than one installment.
    if v_orc.produto='dtf_textil' and coalesce(v_orc.metros,0)>0 then
      return jsonb_build_object('ready',true,'code','ERP_SALE_READY_LEGACY_DTF','schema_version','joao-erp-sale-candidate/v3',
        'payment_id',p_payment_id,'lead_id',v_pay.lead_id,'orcamento_id',v_pay.orcamento_id,'phone',v_phone,'paid_at',v_pay.paid_at,
        'items',jsonb_build_array(jsonb_build_object('family','dtf_textil','quantity',v_orc.metros,'amount',v_order_total,'source_tool','legacy_orcamento')),
        'families',jsonb_build_array('dtf_textil'),'valor_produtos',v_order_total,'valor_frete',0,'total',v_order_total,'tipo_envio','retirada',
        'proof',jsonb_build_object('legacy_orcamento_id',v_orc.id,'produto_label',v_orc.produto,'payment_state',v_payment_state));
    elsif v_orc.produto='dtf_uv' and coalesce(v_orc.valor_arte,0)>0 and coalesce(v_orc.metros,0)>0 then
      return jsonb_build_object('ready',true,'code','ERP_SALE_READY_LEGACY_DTF','schema_version','joao-erp-sale-candidate/v3',
        'payment_id',p_payment_id,'lead_id',v_pay.lead_id,'orcamento_id',v_pay.orcamento_id,'phone',v_phone,'paid_at',v_pay.paid_at,
        'items',jsonb_build_array(jsonb_build_object('family','dtf_uv','quantity',v_orc.metros,'amount',v_orc.valor_arte,'source_tool','legacy_orcamento')),
        'families',jsonb_build_array('dtf_uv'),'valor_produtos',v_orc.valor_arte,'valor_frete',coalesce(v_orc.valor_frete,0),'total',v_order_total,
        'tipo_envio',case when coalesce(v_orc.valor_frete,0)>0 then 'entrega' else 'retirada' end,'cep_destino',v_orc.cep_destino,'servico_frete',v_orc.servico_frete,
        'proof',jsonb_build_object('legacy_orcamento_id',v_orc.id,'produto_label',v_orc.produto,'payment_state',v_payment_state));
    end if;
    return jsonb_build_object('ready',false,'code','CANONICAL_TOTAL_REQUIRED_FOR_NON_DTF_LEGACY','orcamento_produto',v_orc.produto,'payment_state',v_payment_state);
  elsif v_total_count<>1 then
    return jsonb_build_object('ready',false,'code','CANONICAL_TOTAL_AMBIGUOUS','count',v_total_count,'payment_state',v_payment_state);
  end if;
  select * into v_total_op from public.operacoes_financeiras where id=v_total_id;

  select coalesce(jsonb_agg(jsonb_build_object('operation_id',o.id,'amount',coalesce((c.x->>'amount')::numeric,o.amount),'source_tool',o.source_tool,'components',o.components,'ord',c.ord,'child_status',o.status) order by c.ord) filter(where c.x->>'kind'='produto'),'[]'::jsonb),
         count(*) filter(where c.x->>'kind'='produto'),
         coalesce(jsonb_agg(jsonb_build_object('operation_id',o.id,'amount',coalesce((c.x->>'amount')::numeric,o.amount),'source_tool',o.source_tool,'components',o.components,'ord',c.ord,'child_status',o.status) order by c.ord) filter(where c.x->>'kind'='frete'),'[]'::jsonb),
         count(*) filter(where c.x->>'kind'='frete')
    into v_products,v_prod_count,v_freights,v_freight_count
  from jsonb_array_elements(coalesce(v_total_op.components->'componentes','[]'::jsonb)) with ordinality c(x,ord)
  join public.operacoes_financeiras o on o.id=(c.x->>'operation_id')::uuid;

  if v_prod_count<1 then return jsonb_build_object('ready',false,'code','PRODUCT_COMPONENT_REQUIRED'); end if;
  if v_freight_count>1 then return jsonb_build_object('ready',false,'code','FREIGHT_COMPONENT_AMBIGUOUS','count',v_freight_count); end if;

  for v_item in select * from jsonb_array_elements(v_products) loop
    v_family:=null; v_qty:=null;
    if v_item->>'source_tool' in ('calcular_dtf_metro','calcular_dtf_por_arte') then
      v_family:='dtf_textil'; v_qty:=coalesce(nullif(v_item->'components'->>'metros','')::numeric,0);
    elsif v_item->>'source_tool'='calcular_rendimento_uv' then
      v_family:='dtf_uv'; v_qty:=coalesce(nullif(v_item->'components'->>'consumo_m','')::numeric,0);
    elsif v_item->>'source_tool'='orcar_camisetas' then
      v_family:='camisetas'; v_qty:=coalesce(nullif(v_item->'components'->>'quantidade_total','')::numeric,0);
    else
      return jsonb_build_object('ready',false,'code','PRODUCT_COMPONENT_UNSUPPORTED','source_tool',v_item->>'source_tool','operation_id',v_item->>'operation_id','orcamento_produto',v_orc.produto);
    end if;
    if coalesce(v_qty,0)<=0 then return jsonb_build_object('ready',false,'code','PRODUCT_QUANTITY_INVALID','source_tool',v_item->>'source_tool'); end if;
    v_product_sum:=v_product_sum+(v_item->>'amount')::numeric;
    v_sources:=v_sources||jsonb_build_array(v_family);
    v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object('family',v_family,'quantity',v_qty));
  end loop;

  if v_freight_count=1 then
    v_freight_sum:=coalesce((v_freights->0->>'amount')::numeric,0);
    v_tipo_envio:='entrega'; v_cep:=regexp_replace(coalesce(nullif(v_orc.cep_destino,''),v_freights->0->'components'->>'cep',''),'[^0-9]','','g');
    v_servico:=coalesce(v_orc.servico_frete,v_freights->0->'components'->>'servico');
    if v_freight_sum<=0 or length(v_cep)<>8 or nullif(trim(coalesce(v_servico,'')),'') is null then return jsonb_build_object('ready',false,'code','DELIVERY_CANONICAL_DATA_REQUIRED','freight',v_freights,'cep',v_cep,'servico',v_servico); end if;
  else v_freight_sum:=0; v_tipo_envio:='retirada'; v_cep:=null; v_servico:=null; end if;

  if abs(round(v_product_sum+v_freight_sum,2)-round(coalesce(v_total_op.amount,0),2))>0.01
     or abs(round(coalesce(v_total_op.amount,0),2)-v_order_total)>0.01 then
    return jsonb_build_object('ready',false,'code','FINANCIAL_COMPONENT_DIVERGENCE','products',v_product_sum,'freight',v_freight_sum,'total_op',v_total_op.amount,'order_total',v_order_total,'payment_state',v_payment_state);
  end if;

  return jsonb_build_object('ready',true,'code','ERP_SALE_READY_V3','schema_version','joao-erp-sale-candidate/v3','payment_id',p_payment_id,'lead_id',v_pay.lead_id,'orcamento_id',v_pay.orcamento_id,'phone',v_phone,'paid_at',v_pay.paid_at,
    'items',v_items,'families',v_sources,'valor_produtos',round(v_product_sum,2),'valor_frete',round(v_freight_sum,2),'total',round(v_total_op.amount,2),'tipo_envio',v_tipo_envio,'cep_destino',v_cep,'servico_frete',v_servico,
    'proof',jsonb_build_object('total_operation_id',v_total_op.id,'total_components',v_total_op.components,'orcamento_produto_label',v_orc.produto,'payment_state',v_payment_state))
    || case when jsonb_array_length(v_items)=1 and v_items->0->>'family' in ('dtf_textil','dtf_uv') then jsonb_build_object(
      'produto',v_items->0->>'family','produto_descricao',case when v_items->0->>'family'='dtf_uv' then 'Filme DTF UV Impresso' else 'Filme DTF Têxtil Impresso' end,
      'quantidade',(v_items->0->>'quantity')::numeric,'valor_produto',(v_items->0->>'amount')::numeric
    ) else '{}'::jsonb end;
end;
$$;