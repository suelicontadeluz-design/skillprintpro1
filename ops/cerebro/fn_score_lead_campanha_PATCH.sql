CREATE OR REPLACE FUNCTION public.fn_score_lead_campanha(p_lead_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tem_compra_recente      BOOLEAN := FALSE;
  v_tem_inbound_recente     BOOLEAN := FALSE;
  v_tem_checkout_abandonado BOOLEAN := FALSE;
  v_tem_negociacao_ativa    BOOLEAN := FALSE;
  v_tem_orcamento           BOOLEAN := FALSE;
  v_inbound_dias            INT;
BEGIN
  -- Compra nos últimos 60 dias = cliente ativo
  SELECT EXISTS(
    SELECT 1 FROM pixel_events
    WHERE lead_id = p_lead_id AND event_name = 'Purchase' AND value > 0
      AND event_time >= NOW() - INTERVAL '60 days'
  ) INTO v_tem_compra_recente;
  IF v_tem_compra_recente THEN RETURN 'cliente_ativo'; END IF;

  -- Quantos dias desde última mensagem inbound
  SELECT COALESCE(
    EXTRACT(DAY FROM NOW() - MAX(created_at))::INT, 9999
  ) INTO v_inbound_dias
  FROM fact_conversations
  WHERE lead_id = p_lead_id AND direction = 'inbound';

  -- Checkout abandonado nos últimos 30 dias = quente
  SELECT EXISTS(
    SELECT 1 FROM pixel_events
    WHERE lead_id = p_lead_id AND event_name = 'InitiateCheckout'
      AND event_time >= NOW() - INTERVAL '30 days'
  ) INTO v_tem_checkout_abandonado;

  -- Tarefa aberta de negociação
  SELECT EXISTS(
    SELECT 1 FROM crm_tasks
    WHERE lead_id = p_lead_id AND status = 'pendente'
  ) INTO v_tem_negociacao_ativa;

  -- Orçamento enviado recente
  SELECT EXISTS(
    SELECT 1 FROM propostas_rd
    WHERE lead_id = p_lead_id
      AND created_at_rd >= NOW() - INTERVAL '30 days'
  ) INTO v_tem_orcamento;

  -- Classificação por sinal
  IF v_tem_checkout_abandonado OR v_tem_negociacao_ativa THEN
    RETURN 'quente';
  ELSIF v_tem_orcamento OR v_inbound_dias <= 14 THEN
    RETURN 'quente';
  ELSIF v_inbound_dias <= 45 THEN
    RETURN 'morno';
  ELSIF v_inbound_dias <= 180 THEN
    RETURN 'frio';
  ELSE
    RETURN 'frio';  -- sem histórico ou muito antigo = frio
  END IF;
END;
$function$;
