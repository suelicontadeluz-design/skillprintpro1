do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='order-email-brevo-dispatcher-1min' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
end $$;

select cron.schedule(
  'order-email-brevo-dispatcher-1min',
  '* * * * *',
  $cmd$
    select public.fn_http_post_log_vault_cron_secret_strict_v1(
      p_url := 'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/order-email-brevo-dispatcher-v1',
      p_body := '{"mode":"DISPATCH","limit":10}'::jsonb,
      p_jobid := (select jobid::int from cron.job where jobname='order-email-brevo-dispatcher-1min' limit 1),
      p_jobname := 'order-email-brevo-dispatcher-1min',
      p_origem := 'cron:order-email-brevo-dispatcher-1min',
      p_timeout_ms := 30000
    );
  $cmd$
);
