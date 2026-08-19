-- baseline pre-Rodada-2A (19/08/2026)
CREATE OR REPLACE VIEW public.vw_resultado_comercial_agentes AS
 WITH j AS (
         SELECT t.dias
           FROM ( VALUES (7), (30), (90)) t(dias)
        )
 SELECT d.agente_slug,
    j.dias AS janela_dias,
    count(*) AS decisoes_totais,
    count(*) FILTER (WHERE d.elegivel_conversao) AS decisoes_elegiveis,
    count(*) FILTER (WHERE d.participou_conversao) AS decisoes_com_resultado_observavel,
    round(100.0 * count(*) FILTER (WHERE d.participou_conversao)::numeric / NULLIF(count(*) FILTER (WHERE d.elegivel_conversao), 0)::numeric, 1) AS pct_cobertura_resultado,
    count(DISTINCT d.conversao_id) AS conversoes_distintas,
    count(DISTINCT d.conversao_id) FILTER (WHERE d.credito_primario) AS conversoes_primarias,
    count(*) FILTER (WHERE d.credito_primario) AS decisoes_primarias,
    count(*) FILTER (WHERE d.credito_primario = false) AS decisoes_assistidas,
    count(DISTINCT d.lead_id) FILTER (WHERE d.elegivel_conversao) AS leads_distintos_elegiveis,
    COALESCE(sum(d.impacto_financeiro) FILTER (WHERE d.credito_primario), 0::numeric) AS impacto_primario,
    COALESCE(sum(d.impacto_financeiro) FILTER (WHERE d.credito_primario = false), 0::numeric) AS impacto_assistido_registrado,
    COALESCE(sum(d.impacto_financeiro), 0::numeric) AS impacto_total_atribuido,
    count(*) FILTER (WHERE d.participou_conversao AND COALESCE(d.impacto_financeiro, 0::numeric) = 0::numeric) AS conversoes_sem_valor_financeiro,
    round(100.0 * count(*) FILTER (WHERE d.participou_conversao)::numeric / NULLIF(count(*) FILTER (WHERE d.elegivel_conversao), 0)::numeric, 1) AS pct_decisoes_com_conversao,
    round(100.0 * count(*) FILTER (WHERE d.credito_primario)::numeric / NULLIF(count(*) FILTER (WHERE d.participou_conversao), 0)::numeric, 1) AS pct_decisoes_primarias,
    round(100.0 * count(DISTINCT d.conversao_id)::numeric / NULLIF(count(DISTINCT d.lead_id) FILTER (WHERE d.elegivel_conversao), 0)::numeric, 1) AS conversoes_por_100_leads,
    round(COALESCE(sum(d.impacto_financeiro), 0::numeric) / NULLIF(count(*) FILTER (WHERE d.elegivel_conversao), 0)::numeric, 2) AS receita_atribuida_por_decisao,
    min(d.converted_at) AS primeira_conversao,
    max(d.converted_at) AS ultima_conversao
   FROM j
     JOIN vw_resultado_comercial_decisoes d ON d.decisao_at >= (now() - ((j.dias || ' days'::text)::interval))
  GROUP BY d.agente_slug, j.dias;
