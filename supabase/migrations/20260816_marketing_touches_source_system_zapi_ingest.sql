-- Frente: marketing-touches-sem-escritor-ctwa (trilha midia, P1)
-- Projeto: ldrdtaibazplvrbwyrvx (cerebro)
--
-- MOTIVO
-- public.marketing_touches tem o CHECK ck_source_system restrito a 7 valores, e
-- NENHUM deles representa o caminho real de entrada do CTWA (o webhook da Z-API
-- tratado pela edge zapi-ingest). Sem esta ampliacao, qualquer chamada de
-- fn_registrar_marketing_touch vinda do zapi-ingest cai no bloco
-- "WHEN check_violation" e retorna {status: 'rejeitado'} — ou seja, o patch da
-- edge viraria um no-op silencioso.
--
-- Lista ANTES (baseline, para rollback exato):
--   'inbound_fora_horario','capi_eventos_log','pixel_events',
--   'lead_ads_externo','woocommerce','kiwify','manual'
--
-- Lista DEPOIS: a mesma + 'zapi_ingest'.
--
-- NATUREZA: estritamente aditiva (ampliacao de dominio). Nenhum valor existente
-- deixa de ser aceito. A tabela tem 0 linhas nesta data, entao nao ha
-- revalidacao de dados historicos.
--
-- ORDEM DE APLICACAO: esta migration ANTES do deploy da edge zapi-ingest v122.
-- A ordem e segura porque nada escreve na tabela ate a edge ser publicada.

alter table public.marketing_touches
  drop constraint ck_source_system;

alter table public.marketing_touches
  add constraint ck_source_system check (
    source_system = any (array[
      'inbound_fora_horario',
      'capi_eventos_log',
      'pixel_events',
      'lead_ads_externo',
      'woocommerce',
      'kiwify',
      'manual',
      'zapi_ingest'
    ])
  );
