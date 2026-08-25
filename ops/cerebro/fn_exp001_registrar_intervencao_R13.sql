-- R13 2026-08-25 — idempotencia real do EXP-001: no maximo 1 intervencao por lead.
-- LIVE md5(prosrc) = 4b3c979bf5adf5484f302d5631d85b29 (3580 bytes)
--
-- NENHUMA tabela, coluna ou indice novo. A garantia ja existia no schema:
--   crm_campaigns.slug                                   UNIQUE  -> identidade do experimento
--   crm_campaign_audiences UNIQUE(campaign_id, lead_id)          -> identidade da intervencao
--   waba_disparos_lista    UNIQUE(campaign_audience_id)
--                          WHERE campaign_audience_id IS NOT NULL -> 1 disparo por intervencao,
--                                                                   SEM predicado de status,
--                                                                   logo sobrevive a 'enviado'

CREATE OR REPLACE FUNCTION public.fn_exp001_registrar_intervencao(
  p_lead_id uuid,
  p_enfileirar boolean DEFAULT false,
  p_mensagem text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  c_slug   constant text := 'EXP-001-REAQUECIMENTO-31-45D';
  v_camp   public.crm_campaigns%rowtype;
  v_aud_id uuid;
  v_novo   boolean := false;
  v_disp   uuid;
  v_enf    boolean := false;
  v_phone  text;
  v_nome   text;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lead_id_nulo');
  END IF;

  SELECT ph, coalesce(fn, fullname, 'Cliente') INTO v_phone, v_nome
  FROM public.leads_marketing WHERE lead_id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lead_inexistente');
  END IF;

  -- Identidade do experimento. slug e UNIQUE: cria uma vez, reusa sempre.
  INSERT INTO public.crm_campaigns (slug, nome, objetivo, canal, status, criado_por, descricao_publico)
  VALUES (c_slug, 'EXP-001 Reaquecimento 31-45d', 'reativacao', 'whatsapp', 'rascunho',
          'cerebro-exp001', 'Experimento causal EXP-001. Uma intervencao por lead, no maximo.')
  ON CONFLICT (slug) DO NOTHING;

  SELECT * INTO v_camp FROM public.crm_campaigns WHERE slug = c_slug;

  -- IDENTIDADE DA INTERVENCAO: UNIQUE(campaign_id, lead_id).
  -- Garantia atomica do indice, nao SELECT-depois-INSERT.
  INSERT INTO public.crm_campaign_audiences
    (campaign_id, lead_id, phone, canal_recomendado, motivo_inclusao, status_disparo)
  VALUES (v_camp.id, p_lead_id, v_phone, 'whatsapp', 'EXP-001 tratamento', 'pendente')
  ON CONFLICT (campaign_id, lead_id) DO NOTHING
  RETURNING id INTO v_aud_id;

  IF v_aud_id IS NOT NULL THEN
    v_novo := true;
  ELSE
    SELECT a.id INTO v_aud_id FROM public.crm_campaign_audiences a
    WHERE a.campaign_id = v_camp.id AND a.lead_id = p_lead_id;
  END IF;

  -- Enfileirar e um segundo passo, deliberado e travado.
  IF p_enfileirar THEN
    IF v_camp.status <> 'aprovada' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'resultado', CASE WHEN v_novo THEN 'intervencao_registrada' ELSE 'ja_registrado' END,
        'intervencao_id', v_aud_id, 'experiment_id', c_slug,
        'enfileirado', false, 'motivo_nao_enfileirou', 'experimento_nao_armado',
        'campanha_status', v_camp.status);
    END IF;
    IF p_mensagem IS NULL OR length(btrim(p_mensagem)) < 20 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_ausente',
        'intervencao_id', v_aud_id, 'enfileirado', false);
    END IF;

    -- UNIQUE(campaign_audience_id) WHERE NOT NULL: no maximo 1 disparo por
    -- intervencao, em QUALQUER status. Sobrevive a 'enviado'.
    INSERT INTO public.waba_disparos_lista
      (lead_id, name, phone, segmentacao, evento, template_atual, tipo_template,
       status, mensagem_personalizada, campaign_audience_id, origem_agente)
    VALUES (p_lead_id, v_nome, v_phone, 'exp001_reaquecimento', 'crm_campaign',
            'exp001', 'texto', 'pendente_envio', p_mensagem, v_aud_id, 'cerebro-exp001')
    ON CONFLICT (campaign_audience_id) WHERE campaign_audience_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_disp;

    IF v_disp IS NOT NULL THEN
      v_enf := true;
      UPDATE public.crm_campaign_audiences a SET disparo_id = v_disp WHERE a.id = v_aud_id;
    ELSE
      SELECT w.id INTO v_disp FROM public.waba_disparos_lista w WHERE w.campaign_audience_id = v_aud_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'resultado', CASE WHEN v_novo THEN 'intervencao_registrada' ELSE 'ja_registrado' END,
    'experiment_id', c_slug,
    'intervencao_id', v_aud_id,
    'disparo_id', v_disp,
    'enfileirado', v_enf,
    'ja_enfileirado', (p_enfileirar AND NOT v_enf AND v_disp IS NOT NULL)
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.fn_exp001_registrar_intervencao(uuid, boolean, text) TO service_role;
