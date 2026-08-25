-- R12 2026-08-25 — gate de opt-out WhatsApp SO para OUTBOUND
-- baseline  md5(prosrc) = 716eace2fa6a736752496c8fe30de97e (3429 bytes)
-- candidato md5(prosrc) = d22ac0fd2e6d57c4fd183c717272ae59 (4058 bytes, +629)
-- DROP+CREATE e obrigatorio: CREATE OR REPLACE com 7 args cria OVERLOAD e as
-- chamadas de 6 args nomeados das 4 edges quebram com 42725 'is not unique'.

DROP FUNCTION IF EXISTS public.fn_agente_automatico_pode_atender(uuid,text,integer,boolean,boolean,boolean);

CREATE FUNCTION public.fn_agente_automatico_pode_atender(
  p_lead_id uuid,
  p_phone text DEFAULT NULL::text,
  p_janela_humano_min integer DEFAULT 90,
  p_checar_recorrente boolean DEFAULT true,
  p_checar_purchase boolean DEFAULT true,
  p_respeitar_julia_pausa boolean DEFAULT true,
  p_checar_optout_whatsapp boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_estado record;
  v_phone text;
  v_eh_recorrente boolean;
  v_humano_atendendo boolean;
  v_sistema_pausado boolean;
  v_julia_ativa boolean;
  v_atende_recorrentes boolean;
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN
    SELECT ph INTO v_phone FROM leads_marketing WHERE lead_id = p_lead_id LIMIT 1;
  ELSE
    v_phone := p_phone;
  END IF;

  -- Guarda 0: sistema globalmente pausado
  SELECT COALESCE(valor_bool, false) INTO v_sistema_pausado
  FROM sistema_config WHERE chave = 'sistema_pausado' LIMIT 1;
  IF v_sistema_pausado THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'sistema_pausado_emergencia');
  END IF;

  -- Guarda 1: Julia pausada significa pausa GLOBAL
  IF p_respeitar_julia_pausa THEN
    SELECT COALESCE(ativa, true) INTO v_julia_ativa
    FROM julia_config ORDER BY id DESC LIMIT 1;
    IF NOT v_julia_ativa THEN
      RETURN jsonb_build_object('pode', false, 'motivo', 'agentes_proativos_pausados');
    END IF;
  END IF;

  -- Guarda 1.5 (NOVA, opt-in): opt-out de WhatsApp. SO vale para OUTBOUND.
  -- p_checar_optout_whatsapp DEFAULT false => inbound (agente-conversacao
  -- modoReativo, agente-fechamento modoReativo) nao ativa esta guarda.
  -- Escopo canal='whatsapp': hard bounce de email NAO bloqueia WhatsApp.
  -- revogado_em IS NULL: opt-out revogado deixa de valer.
  IF p_checar_optout_whatsapp AND EXISTS (
    SELECT 1 FROM crm_contact_optouts o
    WHERE o.lead_id = p_lead_id
      AND o.canal = 'whatsapp'
      AND o.revogado_em IS NULL
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'optout_whatsapp');
  END IF;

  -- Guarda 2: status do lead bloqueado
  SELECT status INTO v_estado FROM agente_exploracao_estado WHERE lead_id = p_lead_id;
  IF v_estado.status IS NOT NULL AND v_estado.status IN (
    'bloqueada_humano', 'bloqueada_purchase', 'handoff_humano',
    'fora_de_escopo', 'urgente', 'qualificado'
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'estado_bloqueado_' || v_estado.status);
  END IF;

  -- Guarda 3: tarefa pendente na CRM
  IF EXISTS (
    SELECT 1 FROM crm_tasks 
    WHERE (phone = v_phone OR lead_id = p_lead_id) 
      AND status = 'pendente'
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'tarefa_pendente_humano');
  END IF;

  -- Guarda 4: cliente recorrente
  IF p_checar_recorrente THEN
    SELECT fn_lead_eh_recorrente(p_lead_id) INTO v_eh_recorrente;
    IF v_eh_recorrente THEN
      SELECT COALESCE(julia_atende_recorrentes, false) INTO v_atende_recorrentes
        FROM julia_config ORDER BY id DESC LIMIT 1;
      IF NOT COALESCE(v_atende_recorrentes, false) THEN
        RETURN jsonb_build_object('pode', false, 'motivo', 'cliente_recorrente');
      END IF;
    END IF;
  END IF;

  -- Guarda 5: purchase recente (24h)
  IF p_checar_purchase AND EXISTS (
    SELECT 1 FROM pixel_events
    WHERE lead_id = p_lead_id
      AND event_name = 'Purchase'
      AND event_time >= now() - interval '24 hours'
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'purchase_recente_24h');
  END IF;

  -- Guarda 6 (REVISTA): humano atendeu = mensagem COM ASSINATURA "*Nome:*" nas ultimas N min
  -- Whitelist de assinaturas humanas reais. Robos NUNCA assinam assim.
  IF v_phone IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM fact_conversations
      WHERE phone = v_phone
        AND direction = 'outbound'
        AND created_at >= now() - (p_janela_humano_min || ' minutes')::interval
        AND (
          message_text ILIKE '*Tamires%' OR
          message_text ILIKE '*Helen%' OR
          message_text ILIKE '*Alessandro%' OR
          message_text ILIKE '*Gabriel%' OR
          message_text ILIKE '*Daniel%' OR
          message_text ILIKE '*Edson%' OR
          message_text ILIKE '*Kezia%'
        )
    ) INTO v_humano_atendendo;
    
    IF v_humano_atendendo THEN
      RETURN jsonb_build_object('pode', false, 'motivo', 'humano_atendendo_' || p_janela_humano_min || 'min');
    END IF;
  END IF;

  RETURN jsonb_build_object('pode', true, 'motivo', 'ok');
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_agente_automatico_pode_atender(uuid,text,integer,boolean,boolean,boolean,boolean) TO anon, authenticated, service_role;
