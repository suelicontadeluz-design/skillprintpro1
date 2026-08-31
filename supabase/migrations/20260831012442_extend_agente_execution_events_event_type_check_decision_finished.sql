-- Frente gps-microloops-23-membresia-fechamento: aceitar o evento terminal decision_finished
-- emitido pela edge agente-pipeline v69 (v4.5.0-correlacao). Preserva os 17 valores existentes.
-- Nao altera vw_cron_execucao_efeito, nao altera o emissor, nao altera fn_registrar_execution_event_correlacionado.
ALTER TABLE public.agente_execution_events
  DROP CONSTRAINT agente_execution_events_event_type_check;

ALTER TABLE public.agente_execution_events
  ADD CONSTRAINT agente_execution_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'context_loaded'::text,
    'decision_started'::text,
    'claude_called'::text,
    'approval_requested'::text,
    'approval_received'::text,
    'action_executed'::text,
    'crm_task_created'::text,
    'whatsapp_queued'::text,
    'meta_action_proposed'::text,
    'guardrail_blocked'::text,
    'conversion_attributed'::text,
    'conversion_attribution_started'::text,
    'conversion_attribution_finished'::text,
    'dry_run_completed'::text,
    'error'::text,
    'result_observation_conflict'::text,
    'campaign_created'::text,
    'decision_finished'::text
  ]));
