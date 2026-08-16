-- ROLLBACK da migration 20260816_marketing_touches_source_system_zapi_ingest.sql
-- Frente: marketing-touches-sem-escritor-ctwa
--
-- PRE-CONDICAO: rodar o rollback da EDGE primeiro (redeploy do zapi-ingest v121).
-- Se a edge v122 continuar publicada e este rollback for aplicado, as chamadas
-- passam a retornar {status:'rejeitado'} e o touch deixa de ser gravado — sem
-- derrubar o atendimento (a chamada e fail-safe), mas sem registrar midia.
--
-- ATENCAO: se ja existirem linhas com source_system='zapi_ingest', este
-- rollback FALHA (check constraint violation na revalidacao). Isso e proposital:
-- marketing_touches e append-only (trg_marketing_touches_no_delete /
-- _no_update / _no_truncate), entao a evidencia nao pode ser apagada para
-- forcar o rollback. Nesse caso, o rollback correto e SOMENTE o da edge.
--
-- Conferencia antes de rodar:
--   select count(*) from public.marketing_touches where source_system='zapi_ingest';
--   -- precisa ser 0

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
      'manual'
    ])
  );
