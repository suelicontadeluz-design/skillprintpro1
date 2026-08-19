-- baseline pre-Rodada-2A (19/08/2026)
CREATE OR REPLACE VIEW public.vw_agente_metas_realizadas AS
 WITH janelas AS (
         SELECT now() - '7 days'::interval AS semana_inicio,
            date_trunc('month'::text, now()) AS mes_inicio,
            CURRENT_DATE AS hoje_inicio
        ), julia AS (
         SELECT count(*) FILTER (WHERE agente_decisoes_log.resultado = 'convertida'::text) AS conversoes_semana,
            count(*) FILTER (WHERE agente_decisoes_log.acao_executada = 'handoff_humano'::text) AS handoffs_semana,
            count(*) FILTER (WHERE agente_decisoes_log.acao_executada = 'fora_de_escopo'::text) AS fora_escopo,
            count(*) AS total_semana,
            round(100.0 * count(*) FILTER (WHERE agente_decisoes_log.resultado = 'convertida'::text)::numeric / NULLIF(count(*) FILTER (WHERE agente_decisoes_log.acao_executada <> 'fora_de_escopo'::text), 0)::numeric, 1) AS taxa_conversao_pct,
            round(100.0 * count(*) FILTER (WHERE agente_decisoes_log.acao_executada = 'fora_de_escopo'::text)::numeric / NULLIF(count(*), 0)::numeric, 1) AS fora_escopo_rate_pct
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-exploracao'::text AND agente_decisoes_log.created_at >= j.semana_inicio
        ), marcos AS (
         SELECT count(*) FILTER (WHERE agente_decisoes_log.resultado = 'convertida'::text) AS checkouts_recuperados,
            round(100.0 * count(*) FILTER (WHERE agente_decisoes_log.resultado = 'convertida'::text)::numeric / NULLIF(count(*), 0)::numeric, 1) AS taxa_recuperacao_pct,
            count(*) FILTER (WHERE agente_decisoes_log.nivel_autonomia_usado >= 1 AND agente_decisoes_log.resultado = 'convertida'::text) AS conversoes_pos_nivel1,
            count(*) AS decisoes_registradas,
            NULL::numeric AS taxa_acerto_nivel0_pct
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-fechamento'::text AND agente_decisoes_log.created_at >= j.semana_inicio
        ), rafael AS (
         SELECT ( SELECT count(*) AS count
                   FROM crm_tasks ct,
                    janelas j2
                  WHERE (ct.status = 'concluida'::text OR ct.resultado_final IS NOT NULL) AND ct.created_at >= j2.semana_inicio) AS tasks_executadas,
            ( SELECT count(*) AS count
                   FROM vw_fila_do_dia
                  WHERE vw_fila_do_dia.classificacao = ANY (ARRAY['quente'::text, 'fechamento'::text])) AS leads_sem_followup_48h
        ), handoff_abandonado AS (
         SELECT count(*) AS qtd
           FROM ( SELECT h.lead_id,
                    max(
                        CASE
                            WHEN f.direction = 'outbound'::text THEN f."timestamp"
                            ELSE NULL::timestamp with time zone
                        END) AS ult_out,
                    max(
                        CASE
                            WHEN f.direction = 'inbound'::text THEN f."timestamp"
                            ELSE NULL::timestamp with time zone
                        END) AS ult_in
                   FROM ( SELECT DISTINCT agente_decisoes_log.lead_id
                           FROM agente_decisoes_log
                          WHERE agente_decisoes_log.agente_slug = 'orquestrador'::text AND agente_decisoes_log.acao_executada = 'nenhum'::text AND (agente_decisoes_log.decisao ->> 'motivo'::text) ~~* '%handoff_humano%'::text AND agente_decisoes_log.created_at >= (now() - '7 days'::interval) AND agente_decisoes_log.lead_id IS NOT NULL) h
                     JOIN fact_conversations f ON f.lead_id::text = h.lead_id
                  GROUP BY h.lead_id) x
          WHERE x.ult_in > x.ult_out AND x.ult_out < (now() - '24:00:00'::interval)
        ), bruno AS (
         SELECT count(*) FILTER (WHERE agente_decisoes_log.acao_executada = 'mensagem_enviada'::text) AS mensagens_enviadas
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-conversacao'::text AND agente_decisoes_log.created_at >= j.semana_inicio
        ), luciana AS (
         SELECT round(100.0 * count(*) FILTER (WHERE leads_marketing.utm_source IS NOT NULL)::numeric / NULLIF(count(*), 0)::numeric, 1) AS pct_atribuidos
           FROM leads_marketing,
            janelas j
          WHERE leads_marketing.created_at >= j.semana_inicio
        ), isabela AS (
         SELECT count(*) AS objecoes_detectadas
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-objecoes'::text AND agente_decisoes_log.created_at >= j.semana_inicio AND agente_decisoes_log.acao_executada = 'sugestao_supervisionada'::text
        ), renata AS (
         SELECT count(*) AS aprendizados_alta_confianca
           FROM agente_memoria,
            janelas j
          WHERE agente_memoria.atualizado_em >= j.mes_inicio AND agente_memoria.confianca >= 0.7
        ), fabio AS (
         SELECT count(*) FILTER (WHERE agente_decisoes_log.acao_executada = 'alerta_enviado'::text) AS alertas_proativos,
            round(100.0 * count(*) FILTER (WHERE agente_decisoes_log.resultado <> ALL (ARRAY['falhou'::text, 'falha'::text, 'erro'::text, 'falha_critica'::text]))::numeric / NULLIF(count(*), 0)::numeric, 1) AS execucoes_sem_falha_pct
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-observacao'::text AND agente_decisoes_log.created_at >= j.semana_inicio
        ), caio AS (
         SELECT COALESCE(( SELECT sum(pe.value) AS sum
                   FROM pixel_events pe,
                    janelas j2
                  WHERE pe.event_name = 'Purchase'::text AND pe.event_time >= j2.mes_inicio AND (EXISTS ( SELECT 1
                           FROM agente_decisoes_log adl
                          WHERE adl.lead_id = pe.lead_id::text AND adl.agente_slug = 'orquestrador'::text))), 0::numeric) AS faturamento_influenciado,
            ( SELECT count(*) AS count
                   FROM agente_decisoes_log adl,
                    janelas j2
                  WHERE adl.agente_slug = 'orquestrador'::text AND adl.created_at >= j2.semana_inicio) AS leads_processados,
            ( SELECT round(100.0 * count(*) FILTER (WHERE (adl.acao_executada <> ALL (ARRAY['nenhum'::text, 'context_loading'::text])) OR adl.acao_executada = 'nenhum'::text AND ((adl.decisao ->> 'motivo'::text) ~~* 'guardrail caio:%'::text OR (adl.decisao ->> 'motivo'::text) ~~* 'filtro pre-claude:%'::text))::numeric / NULLIF(count(*), 0)::numeric, 1) AS round
                   FROM agente_decisoes_log adl,
                    janelas j2
                  WHERE adl.agente_slug = 'orquestrador'::text AND adl.created_at >= j2.semana_inicio) AS acionamentos_validos_pct
        ), gustavo AS (
         SELECT ( SELECT round(avg(vw_cac_por_segmento.cac), 0) AS round
                   FROM vw_cac_por_segmento
                  WHERE vw_cac_por_segmento.segmento = 'impressao_dtf_textil'::text) AS cac_dtf_textil,
            ( SELECT round(avg(NULLIF(vmc.roas_pixel, 0::numeric)), 2) AS round
                   FROM vw_agente_midia_campanhas vmc
                  WHERE vmc.status_real = 'ATIVA'::text AND vmc.roas_pixel IS NOT NULL) AS roas_medio_ativo,
            ( SELECT round(100.0 * count(*) FILTER (WHERE gustavo_meta_acoes.status = 'executado'::text)::numeric / NULLIF(count(*), 0)::numeric, 1) AS round
                   FROM gustavo_meta_acoes,
                    janelas j2
                  WHERE gustavo_meta_acoes.tipo = 'pausar'::text AND gustavo_meta_acoes.created_at >= j2.mes_inicio) AS campanhas_pausadas_corretamente_pct
        ), diego AS (
         SELECT count(*) AS recomendacoes_com_dados
           FROM agente_decisoes_log,
            janelas j
          WHERE agente_decisoes_log.agente_slug = 'agente-insights'::text AND agente_decisoes_log.created_at >= j.semana_inicio
        ), base AS (
         SELECT 'agente-exploracao'::text AS agente_slug,
            'conversoes_semana'::text AS kpi,
            'semanal'::text AS periodo,
            COALESCE(j.conversoes_semana, 0::bigint)::numeric AS realizado
           FROM julia j
        UNION ALL
         SELECT 'agente-exploracao'::text AS text,
            'handoffs_qualificados'::text AS text,
            'semanal'::text AS text,
            COALESCE(j.handoffs_semana, 0::bigint)::numeric AS "coalesce"
           FROM julia j
        UNION ALL
         SELECT 'agente-exploracao'::text AS text,
            'taxa_conversao'::text AS text,
            'semanal'::text AS text,
            COALESCE(j.taxa_conversao_pct, 0::numeric) AS "coalesce"
           FROM julia j
        UNION ALL
         SELECT 'agente-exploracao'::text AS text,
            'fora_de_escopo_rate'::text AS text,
            'semanal'::text AS text,
            COALESCE(j.fora_escopo_rate_pct, 0::numeric) AS "coalesce"
           FROM julia j
        UNION ALL
         SELECT 'agente-fechamento'::text AS text,
            'checkouts_recuperados'::text AS text,
            'semanal'::text AS text,
            COALESCE(m.checkouts_recuperados, 0::bigint)::numeric AS "coalesce"
           FROM marcos m
        UNION ALL
         SELECT 'agente-fechamento'::text AS text,
            'taxa_recuperacao_checkout'::text AS text,
            'semanal'::text AS text,
            COALESCE(m.taxa_recuperacao_pct, 0::numeric) AS "coalesce"
           FROM marcos m
        UNION ALL
         SELECT 'agente-fechamento'::text AS text,
            'conversoes_pos_nivel1'::text AS text,
            'semanal'::text AS text,
            COALESCE(m.conversoes_pos_nivel1, 0::bigint)::numeric AS "coalesce"
           FROM marcos m
        UNION ALL
         SELECT 'agente-fechamento'::text AS text,
            'decisoes_registradas'::text AS text,
            'semanal'::text AS text,
            COALESCE(m.decisoes_registradas, 0::bigint)::numeric AS "coalesce"
           FROM marcos m
        UNION ALL
         SELECT 'agente-fechamento'::text AS text,
            'taxa_acerto_nivel0'::text AS text,
            'semanal'::text AS text,
            m.taxa_acerto_nivel0_pct
           FROM marcos m
        UNION ALL
         SELECT 'agente-pipeline'::text AS text,
            'tasks_executadas'::text AS text,
            'semanal'::text AS text,
            COALESCE(r.tasks_executadas, 0::bigint)::numeric AS "coalesce"
           FROM rafael r
        UNION ALL
         SELECT 'agente-pipeline'::text AS text,
            'leads_sem_followup_48h'::text AS text,
            'semanal'::text AS text,
            COALESCE(r.leads_sem_followup_48h, 0::bigint)::numeric AS "coalesce"
           FROM rafael r
        UNION ALL
         SELECT 'agente-pipeline'::text AS text,
            'handoffs_abandonados_24h'::text AS text,
            'semanal'::text AS text,
            COALESCE(h.qtd, 0::bigint)::numeric AS "coalesce"
           FROM handoff_abandonado h
        UNION ALL
         SELECT 'agente-conversacao'::text AS text,
            'mensagens_enviadas'::text AS text,
            'semanal'::text AS text,
            COALESCE(b_1.mensagens_enviadas, 0::bigint)::numeric AS "coalesce"
           FROM bruno b_1
        UNION ALL
         SELECT 'agente-atribuicao'::text AS text,
            'leads_com_atribuicao'::text AS text,
            'semanal'::text AS text,
            COALESCE(l.pct_atribuidos, 0::numeric) AS "coalesce"
           FROM luciana l
        UNION ALL
         SELECT 'agente-objecoes'::text AS text,
            'objecoes_detectadas'::text AS text,
            'semanal'::text AS text,
            COALESCE(i.objecoes_detectadas, 0::bigint)::numeric AS "coalesce"
           FROM isabela i
        UNION ALL
         SELECT 'agente-memoria'::text AS text,
            'aprendizados_alta_confianca'::text AS text,
            'mensal'::text AS text,
            COALESCE(rn.aprendizados_alta_confianca, 0::bigint)::numeric AS "coalesce"
           FROM renata rn
        UNION ALL
         SELECT 'agente-observacao'::text AS text,
            'alertas_proativos'::text AS text,
            'semanal'::text AS text,
            COALESCE(f.alertas_proativos, 0::bigint)::numeric AS "coalesce"
           FROM fabio f
        UNION ALL
         SELECT 'agente-observacao'::text AS text,
            'execucoes_sem_falha'::text AS text,
            'semanal'::text AS text,
            COALESCE(f.execucoes_sem_falha_pct, 0::numeric) AS "coalesce"
           FROM fabio f
        UNION ALL
         SELECT 'orquestrador'::text AS text,
            'faturamento_influenciado'::text AS text,
            'mensal'::text AS text,
            round(COALESCE(c.faturamento_influenciado, 0::numeric)) AS round
           FROM caio c
        UNION ALL
         SELECT 'orquestrador'::text AS text,
            'leads_processados'::text AS text,
            'semanal'::text AS text,
            COALESCE(c.leads_processados, 0::bigint)::numeric AS "coalesce"
           FROM caio c
        UNION ALL
         SELECT 'orquestrador'::text AS text,
            'acionamentos_validos'::text AS text,
            'semanal'::text AS text,
            COALESCE(c.acionamentos_validos_pct, 0::numeric) AS "coalesce"
           FROM caio c
        UNION ALL
         SELECT 'agente-midia'::text AS text,
            'cac_dtf_textil'::text AS text,
            'mensal'::text AS text,
            COALESCE(g.cac_dtf_textil, 0::numeric) AS "coalesce"
           FROM gustavo g
        UNION ALL
         SELECT 'agente-midia'::text AS text,
            'roas_medio_ativo'::text AS text,
            'mensal'::text AS text,
            COALESCE(g.roas_medio_ativo, 0::numeric) AS "coalesce"
           FROM gustavo g
        UNION ALL
         SELECT 'agente-midia'::text AS text,
            'campanhas_pausadas_corretamente'::text AS text,
            'mensal'::text AS text,
            COALESCE(g.campanhas_pausadas_corretamente_pct, 0::numeric) AS "coalesce"
           FROM gustavo g
        UNION ALL
         SELECT 'agente-insights'::text AS text,
            'recomendacoes_com_dados'::text AS text,
            'semanal'::text AS text,
            COALESCE(d.recomendacoes_com_dados, 0::bigint)::numeric AS "coalesce"
           FROM diego d
        )
 SELECT b.agente_slug,
    b.kpi,
    COALESCE(am.valor_esperado, 0::numeric) AS meta,
    COALESCE(am.unidade, ''::text) AS unidade,
    b.periodo,
    b.realizado,
        CASE
            WHEN b.kpi = ANY (ARRAY['leads_sem_followup_48h'::text, 'fora_de_escopo_rate'::text, 'cac_dtf_textil'::text, 'handoffs_abandonados_24h'::text]) THEN
            CASE
                WHEN am.valor_esperado IS NULL OR am.valor_esperado = 0::numeric THEN 'sem_meta'::text
                WHEN b.realizado <= am.valor_esperado THEN 'ok'::text
                WHEN b.realizado <= (am.valor_esperado * 1.5) THEN 'parcial'::text
                ELSE 'abaixo'::text
            END
            ELSE
            CASE
                WHEN am.valor_esperado IS NULL OR am.valor_esperado = 0::numeric THEN 'sem_meta'::text
                WHEN b.realizado >= am.valor_esperado THEN 'ok'::text
                WHEN b.realizado >= (am.valor_esperado * 0.8) THEN 'parcial'::text
                ELSE 'abaixo'::text
            END
        END AS status,
        CASE
            WHEN am.valor_esperado IS NULL OR am.valor_esperado = 0::numeric THEN NULL::numeric
            WHEN b.kpi = ANY (ARRAY['leads_sem_followup_48h'::text, 'fora_de_escopo_rate'::text, 'cac_dtf_textil'::text, 'handoffs_abandonados_24h'::text]) THEN
            CASE
                WHEN b.realizado <= am.valor_esperado THEN 100::numeric
                ELSE round(100.0 * am.valor_esperado / b.realizado, 0)
            END
            ELSE LEAST(999::numeric, round(100.0 * b.realizado / am.valor_esperado, 0))
        END AS pct_atingido
   FROM base b
     LEFT JOIN agente_metas am ON am.agente_slug = b.agente_slug AND am.kpi = b.kpi AND am.ativo = true;
