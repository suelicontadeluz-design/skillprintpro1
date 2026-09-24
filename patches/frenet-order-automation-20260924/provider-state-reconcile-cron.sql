-- Reconcile provider state every 5 minutes as a fallback to webhooks.
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='frenet-provider-state-reconcile-5min' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
end $$;

select cron.schedule(
  'frenet-provider-state-reconcile-5min',
  '*/5 * * * *',
  $cmd$
    select public.fn_http_post_log_vault_cron_secret_strict_v1(
      p_url := 'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/frenet-provider-state-reconcile-v1',
      p_body := '{"limit":20}'::jsonb,
      p_jobid := (select jobid::int from cron.job where jobname='frenet-provider-state-reconcile-5min' limit 1),
      p_jobname := 'frenet-provider-state-reconcile-5min',
      p_origem := 'cron:frenet-provider-state-reconcile-5min',
      p_timeout_ms := 30000
    );
  $cmd$
);
