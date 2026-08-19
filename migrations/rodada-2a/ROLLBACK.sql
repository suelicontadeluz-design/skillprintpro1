-- ============================================================================
-- ROLLBACK COMPLETO DA RODADA 2A — 19/08/2026 — projeto ldrdtaibazplvrbwyrvx
-- Aplicar na ORDEM INVERSA das migrations. Cada bloco e independente.
-- Nenhum dado de producao e destruido: as colunas novas sao apenas esvaziadas.
-- ============================================================================

-- Fase 7 — instrumento de reuso de aprendizado
DROP FUNCTION IF EXISTS public.fn_agente_registrar_uso_aprendizado(uuid,uuid,text,text,text,boolean);
-- registros ja gravados (se houver) saem do contexto das decisoes:
-- UPDATE public.agente_decisoes_log
--    SET contexto = contexto - 'aprendizados_consultados'
--  WHERE contexto ? 'aprendizados_consultados';

-- Fase 5 — metas de Camila/Dora/Tiago  (restaura definicao anterior)
\i baseline/sql/view__vw_agente_metas_realizadas.sql

-- Fase 4 — elegibilidade por grao  (restaura definicao anterior)
\i baseline/sql/view__vw_resultado_comercial_decisoes.sql

-- Fase 3 — vinculo campanha
DROP FUNCTION IF EXISTS public.fn_r2a_vincular_observacoes_campanha(boolean,integer,integer);
-- nenhum link foi gravado nesta rodada; se algum vier a ser:
-- DELETE FROM public.decision_result_links
--  WHERE evidencia->>'origem' = 'fn_r2a_vincular_observacoes_campanha';

-- Fase 2 — backfill da identidade (desfaz apenas o que o backfill escreveu)
UPDATE public.agente_decisoes_log
   SET objeto_tipo = NULL, objeto_id = NULL
 WHERE objeto_tipo = 'campanha'
   AND objeto_id IS NOT DISTINCT FROM contexto->>'campaign_id';

-- Fase 2 — colunas e funcao
DROP INDEX IF EXISTS public.ix_adl_objeto;
ALTER TABLE public.agente_decisoes_log DROP COLUMN IF EXISTS objeto_tipo;
ALTER TABLE public.agente_decisoes_log DROP COLUMN IF EXISTS objeto_id;
DROP FUNCTION IF EXISTS public.fn_registrar_decisao_agente(
  text,text,text,integer,text,jsonb,jsonb,numeric,boolean,text,text,text,boolean,integer,text,text);
\i baseline/sql/func__fn_registrar_decisao_agente.sql

-- Fase 1 — agregado financeiro  (restaura definicao anterior)
DROP VIEW IF EXISTS public.vw_resultado_comercial_agentes;
\i baseline/sql/view__vw_resultado_comercial_agentes.sql

-- ============================================================================
-- Edge Function agente-insights: redeploy do conteudo de
--   baseline/edge/agente-insights/index.ts   (version 58 / v2.6.0)
-- ============================================================================
