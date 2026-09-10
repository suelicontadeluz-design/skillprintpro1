-- PIX bridge preview v2 — partial-aware customer-facing canonical result
create or replace function public.fn_cortex_pix_joao_bridge_preview_v1(
  p_lead_id uuid,
  p_phone text,
  p_orcamento_id uuid,
  p_resultado text,
  p_valor_pago numeric,
  p_valor_orcamento numeric,
  p_confianca text default null
) returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := public.fn_normalize_phone_br(coalesce(p_phone,''));
  v_estado text;
  v_guard_pode boolean := true;
  v_guard_motivo text := 'ok';
  v_msg text;
  v_sistema_pausado boolean := false;
  v_state jsonb;
  v_total numeric:=coalesce(p_valor_orcamento,0);
  v_paid_before numeric:=0;
  v_projected numeric:=0;
  v_balance_after numeric:=0;
  v_full_after boolean:=false;
begin
  if p_lead_id is null or p_orcamento_id is null then
    return jsonb_build_object('eligible',false,'guard_pode',false,'guard_motivo','identidade_incompleta','effect_zero',true);
  end if;
  if p_resultado not in ('CONFIRMADO','DIVERGENTE') then
    return jsonb_build_object('eligible',false,'guard_pode',false,'guard_motivo','resultado_invalido','effect_zero',true);
  end if;

  select coalesce(valor_bool,false) into v_sistema_pausado from public.sistema_config where chave='sistema_pausado' limit 1;
  if coalesce(v_sistema_pausado,false) then
    v_guard_pode := false; v_guard_motivo := 'sistema_pausado_emergencia';
  elsif v_phone is null or v_phone='' then
    v_guard_pode := false; v_guard_motivo := 'phone_ausente';
  elsif public.fn_agente_pausado(v_phone) then
    v_guard_pode := false; v_guard_motivo := 'agente_pausado_ou_humano_recente';
  elsif exists (select 1 from public.crm_contact_optouts o where o.lead_id=p_lead_id and o.canal='whatsapp' and o.revogado_em is null) then
    v_guard_pode := false; v_guard_motivo := 'optout_whatsapp';
  else
    select status into v_estado from public.agente_exploracao_estado where lead_id=p_lead_id limit 1;
    if v_estado in ('bloqueada_humano','handoff_humano','fora_de_escopo','urgente') then
      v_guard_pode := false; v_guard_motivo := 'estado_humano_'||v_estado;
    elsif exists (select 1 from public.crm_tasks t where (t.lead_id=p_lead_id or (v_phone<>'' and t.phone=v_phone)) and t.status='pendente') then
      v_guard_pode := false; v_guard_motivo := 'tarefa_pendente_humano';
    end if;
  end if;

  if p_resultado='CONFIRMADO' then
    v_state:=public.fn_joao_orcamento_payment_state_v1(p_orcamento_id,now());
    if coalesce((v_state->>'ok')::boolean,false) then
      v_total:=coalesce((v_state->>'order_total')::numeric,v_total);
      v_paid_before:=coalesce((v_state->>'paid_total_raw')::numeric,0);
    end if;
    v_projected:=round(v_paid_before+coalesce(p_valor_pago,0),2);
    v_balance_after:=greatest(round(v_total-v_projected,2),0);
    v_full_after:=v_projected >= v_total-1.00;

    if v_full_after then
      v_msg := format(
        '[CORTEX_PIX_CANONICAL_RESULT] Pagamento CONFIRMADO pelo validador canonico do comprovante. Orcamento %s. Parcela confirmada R$ %s. Total pago acumulado apos esta evidencia R$ %s. Saldo R$ 0,00. O pagamento financeiro esta QUITADO. REGRA: nao diga que producao/impressao comecou nem que entrou na fila apenas por causa do pagamento; producao depende da aprovacao do layout.',
        p_orcamento_id::text,
        trim(to_char(coalesce(p_valor_pago,0),'FM999999990D00')),
        trim(to_char(v_projected,'FM999999990D00'))
      );
    else
      v_msg := format(
        '[CORTEX_PIX_CANONICAL_RESULT] PAGAMENTO PARCIAL CONFIRMADO pelo validador canonico do comprovante. Orcamento %s. Parcela confirmada R$ %s. Total pago acumulado apos esta evidencia R$ %s. Saldo restante R$ %s. REGRA: NAO diga que o pedido esta totalmente pago, NAO marque como quitado/WON e NAO diga que producao/impressao comecou. Confirme somente o valor recebido e informe o saldo quando pertinente.',
        p_orcamento_id::text,
        trim(to_char(coalesce(p_valor_pago,0),'FM999999990D00')),
        trim(to_char(v_projected,'FM999999990D00')),
        trim(to_char(v_balance_after,'FM999999990D00'))
      );
    end if;
  else
    v_msg := format(
      '[CORTEX_PIX_CANONICAL_RESULT] Comprovante analisado, mas o valor identificado R$ %s NAO pode ser aplicado com seguranca ao saldo deste pedido (total de referencia R$ %s). Nao marque pedido pago. Peca verificacao e, se necessario, escale humano.',
      trim(to_char(coalesce(p_valor_pago,0),'FM999999990D00')),
      trim(to_char(coalesce(p_valor_orcamento,0),'FM999999990D00'))
    );
  end if;

  return jsonb_build_object(
    'eligible',true,'guard_pode',v_guard_pode,'guard_motivo',v_guard_motivo,
    'resultado',p_resultado,'message',v_msg,'effect_zero',true,'bridge_version','pix-joao/v2-partial'
  );
end;
$$;