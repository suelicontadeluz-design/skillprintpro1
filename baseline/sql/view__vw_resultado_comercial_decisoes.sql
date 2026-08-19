-- baseline pre-Rodada-2A (19/08/2026)
CREATE OR REPLACE VIEW public.vw_resultado_comercial_decisoes AS
 SELECT id AS decisao_id,
    agente_slug,
    created_at AS decisao_at,
    lead_id,
    acao_executada,
    resultado,
    agent_version,
    nivel_autonomia_usado,
    dry_run,
    converted_at,
    atribuicao_tipo,
    impacto_financeiro,
        CASE
            WHEN converted_at IS NOT NULL THEN (lead_id || '@'::text) || converted_at::text
            ELSE NULL::text
        END AS conversao_id,
    converted_at IS NOT NULL AS participou_conversao,
        CASE
            WHEN converted_at IS NULL THEN NULL::boolean
            WHEN atribuicao_tipo = 'assistida'::text THEN false
            ELSE true
        END AS credito_primario,
    lead_id IS NOT NULL AND lead_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text AND COALESCE(dry_run, false) = false AND (acao_executada <> ALL (ARRAY['context_loading'::text, 'simulado'::text, 'nenhum'::text])) AND resultado <> 'bloqueada_guardrail'::text AS elegivel_conversao,
        CASE
            WHEN lead_id IS NULL THEN 'sem_lead_id'::text
            WHEN lead_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text THEN 'lead_id_nao_uuid'::text
            WHEN COALESCE(dry_run, false) THEN 'dry_run'::text
            WHEN acao_executada = ANY (ARRAY['context_loading'::text, 'simulado'::text, 'nenhum'::text]) THEN 'acao_nao_comercial'::text
            WHEN resultado = 'bloqueada_guardrail'::text THEN 'guardrail'::text
            ELSE NULL::text
        END AS motivo_inelegivel
   FROM agente_decisoes_log adl;
