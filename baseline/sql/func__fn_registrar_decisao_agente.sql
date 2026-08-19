CREATE OR REPLACE FUNCTION public.fn_registrar_decisao_agente(p_agente_slug text, p_acao_executada text, p_resultado text, p_nivel_autonomia integer DEFAULT 0, p_lead_id text DEFAULT NULL::text, p_contexto jsonb DEFAULT '{}'::jsonb, p_decisao jsonb DEFAULT '{}'::jsonb, p_impacto_financeiro numeric DEFAULT NULL::numeric, p_acerto boolean DEFAULT NULL::boolean, p_feedback text DEFAULT NULL::text, p_agent_version text DEFAULT NULL::text, p_prompt_version text DEFAULT NULL::text, p_dry_run boolean DEFAULT false, p_tempo_ms integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_decision_id UUID;
  v_resultado   TEXT;
  v_agente_ok   BOOLEAN;
BEGIN
  -- Valida se agente existe (não quebra, só loga warning)
  SELECT EXISTS(SELECT 1 FROM agentes WHERE slug = p_agente_slug) INTO v_agente_ok;

  -- Normaliza resultado para o enum padronizado
  v_resultado := CASE p_resultado
    WHEN 'sucesso'   THEN 'executada'
    WHEN 'falha'     THEN 'falhou'
    WHEN 'pendente'  THEN 'pendente_aprovacao'
    WHEN 'aprovado'  THEN 'aprovada'
    WHEN 'rejeitado' THEN 'rejeitada'
    ELSE p_resultado
  END;

  -- Garante que resultado está no enum (fallback seguro)
  IF v_resultado NOT IN (
    'proposta','pendente_aprovacao','aprovada','rejeitada',
    'executada','falhou','convertida','expirada','bloqueada_guardrail',
    'sucesso','falha','pendente','aprovado','rejeitado'
  ) THEN
    v_resultado := 'executada';
  END IF;

  -- Insere a decisão
  INSERT INTO agente_decisoes_log (
    id, agente_slug, lead_id, contexto, decisao,
    acao_executada, resultado, nivel_autonomia_usado,
    impacto_financeiro, acerto, feedback,
    agent_version, prompt_version, dry_run,
    tempo_execucao_ms, created_at
  ) VALUES (
    gen_random_uuid(),
    p_agente_slug,
    p_lead_id,
    COALESCE(p_contexto, '{}'::JSONB),
    COALESCE(p_decisao, '{}'::JSONB),
    p_acao_executada,
    v_resultado,
    COALESCE(p_nivel_autonomia, 0),
    p_impacto_financeiro,
    p_acerto,
    p_feedback,
    p_agent_version,
    p_prompt_version,
    COALESCE(p_dry_run, FALSE),
    p_tempo_ms,
    NOW()
  )
  RETURNING id INTO v_decision_id;

  RETURN v_decision_id;

EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra a execução do agente por falha no log
  RAISE WARNING 'fn_registrar_decisao_agente falhou para %: %', p_agente_slug, SQLERRM;
  RETURN NULL;
END;
$function$
