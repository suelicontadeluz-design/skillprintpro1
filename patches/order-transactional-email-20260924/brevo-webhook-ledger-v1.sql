create table if not exists public.brevo_transactional_webhook_events_v1(
  id uuid primary key default gen_random_uuid(),
  provider_event_id text,
  provider_message_id text,
  event_type text not null,
  recipient_email text,
  subject text,
  payload jsonb not null,
  reconciliation_status text not null default 'pending'
    check(reconciliation_status in ('pending','reconciled','unmatched','failed')),
  reconciliation_detail jsonb,
  received_at timestamptz not null default now(),
  reconciled_at timestamptz
);

create unique index if not exists uq_brevo_transactional_event_dedupe_v1
  on public.brevo_transactional_webhook_events_v1(
    coalesce(provider_message_id,''),
    event_type,
    coalesce((payload->>'ts_epoch'),''),
    coalesce((payload->>'ts_event'),'')
  );

alter table public.brevo_transactional_webhook_events_v1 enable row level security;
revoke all on public.brevo_transactional_webhook_events_v1 from anon,authenticated;
grant all on public.brevo_transactional_webhook_events_v1 to service_role;

create table if not exists public.brevo_transactional_webhook_config_v1(
  singleton boolean primary key default true check(singleton=true),
  webhook_id bigint,
  callback_url text not null,
  status text not null,
  provider_http_status integer,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

insert into public.brevo_transactional_webhook_config_v1(singleton,callback_url,status)
values(true,'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/brevo-transactional-webhook-v1','unknown')
on conflict(singleton) do nothing;

alter table public.brevo_transactional_webhook_config_v1 enable row level security;
revoke all on public.brevo_transactional_webhook_config_v1 from anon,authenticated;
grant all on public.brevo_transactional_webhook_config_v1 to service_role;