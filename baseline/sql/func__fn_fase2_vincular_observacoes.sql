CREATE OR REPLACE FUNCTION public.fn_fase2_vincular_observacoes(p_limite integer DEFAULT 10, p_falha_proposital boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  LIMITE_TETO CONSTANT int := 50;
  v_lim int := LEAST(GREATEST(coalesce(p_limite,1),1), LIMITE_TETO);
  got boolean;
  c_id bigint;
  novo_id bigint;
  n_obs int := 0;
  n_pares int := 0;
  n_ins int := 0;
BEGIN
  got := pg_try_advisory_xact_lock(hashtext('fase2_decision_result_links'));
  IF NOT got THEN
    RETURN jsonb_build_object('ok', true, 'lock', false, 'cursor_avancou', false);
  END IF;

  SELECT valor_int INTO c_id
    FROM public.varredura_controle
   WHERE chave = 'result_links_obs_cursor'
     FOR UPDATE;

  IF c_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cursor_ausente');
  END IF;

  WITH lote AS (
    SELECT o.id, o.lead_id_fonte, o.ocorrido_em
      FROM public.result_observations o
     WHERE o.id > c_id
     ORDER BY o.id
     LIMIT v_lim
  ), pares AS (
    SELECT d.id AS decision_id,
           l.id AS observation_id,
           round((EXTRACT(EPOCH FROM (l.ocorrido_em - d.created_at)) / 3600.0)::numeric, 2) AS horas
      FROM lote l
      JOIN public.agente_decisoes_log d
        ON d.lead_id = l.lead_id_fonte::text
       AND d.created_at < l.ocorrido_em
     WHERE l.lead_id_fonte IS NOT NULL
  ), ins AS (
    INSERT INTO public.decision_result_links
      (decision_id, observation_id, horas_desde_decisao, proximidade_classe,
       dentro_janela_observacao, evidencia)
    SELECT p.decision_id, p.observation_id, p.horas,
           CASE WHEN p.horas <= 24   THEN 'ate_24h'
                WHEN p.horas <= 72   THEN 'ate_72h'
                WHEN p.horas <= 168  THEN 'ate_7d'
                WHEN p.horas <= 2160 THEN 'ate_90d'
                ELSE 'acima_90d' END,
           (p.horas <= 2160),
           jsonb_build_object('origem', 'fn_fase2_vincular_observacoes')
      FROM pares p
    ON CONFLICT (decision_id, observation_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM lote),
         (SELECT count(*) FROM pares),
         (SELECT count(*) FROM ins),
         (SELECT max(id) FROM lote)
    INTO n_obs, n_pares, n_ins, novo_id;

  IF p_falha_proposital THEN
    RAISE EXCEPTION 'fase2: falha proposital apos vinculo — tudo deve reverter junto';
  END IF;

  -- CURSOR: ultimo registro EFETIVAMENTE processado, nunca uma fotografia de tempo.
  IF novo_id IS NOT NULL THEN
    UPDATE public.varredura_controle
       SET valor_int = novo_id, atualizado_em = now()
     WHERE chave = 'result_links_obs_cursor'
       AND novo_id > valor_int;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'lock', true, 'limite_efetivo', v_lim,
    'cursor_anterior', c_id,
    'cursor_novo', coalesce(novo_id, c_id),
    'cursor_avancou', (novo_id IS NOT NULL),
    'observacoes_lidas', n_obs,
    'pares_candidatos', n_pares,
    'links_inseridos', n_ins,
    'idempotentes', n_pares - n_ins,
    'natureza', 'proximidade_temporal',
    'nao_prova', 'causalidade'
  );
END
$function$
