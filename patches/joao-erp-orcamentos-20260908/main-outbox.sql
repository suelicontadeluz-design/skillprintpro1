-- Durable outbox for João -> ERP quote synchronization.

begin;

create table if not exists public.joao_orcamento_erp_outbox (
  operation_id uuid primary key references public.operacoes_financeiras(id) on delete cascade,
  lead_id uuid not null,
  status text not null default 'pending' check (status in ('pending','processing','retry','synced')),
  attempts integer not null default 0,
  worker text,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_joao_orcamento_erp_outbox_pending
  on public.joao_orcamento_erp_outbox(status,next_attempt_at,created_at);

create or replace function public.fn_joao_orcamento_outbox_enqueue_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_elegivel boolean := false;
begin
  if new.kind='produto' and new.source_tool = any(array[
    'calcular_dtf_metro',
    'calcular_dtf_por_arte',
    'calcular_dtf_uv_metro',
    'calcular_rendimento_uv',
    'orcar_camisetas',
    'calcular_copo',
    'preco_de_ficha'
  ]::text[]) then
    v_elegivel := true;
  elsif new.kind='total' and new.source_tool='fn_compor_total' then
    select exists (
      select 1
      from jsonb_array_elements(coalesce(new.components->'componentes','[]'::jsonb)) c
      join public.operacoes_financeiras o
        on o.id=(c->>'operation_id')::uuid
      where c->>'kind'='produto'
        and o.source_tool = any(array[
          'calcular_dtf_metro',
          'calcular_dtf_por_arte',
          'calcular_dtf_uv_metro',
          'calcular_rendimento_uv',
          'orcar_camisetas',
          'calcular_copo',
          'preco_de_ficha'
        ]::text[])
    ) into v_elegivel;
  end if;

  if v_elegivel then
    insert into public.joao_orcamento_erp_outbox(operation_id,lead_id)
    values(new.id,new.lead_id)
    on conflict(operation_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_joao_orcamento_outbox_enqueue_v1 on public.operacoes_financeiras;
create trigger trg_joao_orcamento_outbox_enqueue_v1
after insert on public.operacoes_financeiras
for each row execute function public.fn_joao_orcamento_outbox_enqueue_v1();

create or replace function public.fn_joao_orcamento_outbox_claim_v1(p_worker text,p_limit integer default 25)
returns table(operation_id uuid,lead_id uuid,attempt integer)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  return query
  with picked as (
    select q.operation_id
    from public.joao_orcamento_erp_outbox q
    where q.status in ('pending','retry')
      and q.next_attempt_at <= now()
    order by q.created_at,q.operation_id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  ), upd as (
    update public.joao_orcamento_erp_outbox q
       set status='processing',
           attempts=q.attempts+1,
           worker=p_worker,
           claimed_at=now(),
           updated_at=now()
      from picked p
     where q.operation_id=p.operation_id
    returning q.operation_id,q.lead_id,q.attempts
  )
  select u.operation_id,u.lead_id,u.attempts from upd u;
end;
$$;

create or replace function public.fn_joao_orcamento_outbox_complete_v1(p_operation_id uuid,p_worker text)
returns boolean
language sql
security definer
set search_path=public,pg_temp
as $$
  update public.joao_orcamento_erp_outbox
     set status='synced',synced_at=now(),last_error=null,updated_at=now()
   where operation_id=p_operation_id
     and (worker=p_worker or status='synced')
  returning true;
$$;

create or replace function public.fn_joao_orcamento_outbox_fail_v1(p_operation_id uuid,p_worker text,p_error text)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_attempts integer;
begin
  select attempts into v_attempts
  from public.joao_orcamento_erp_outbox
  where operation_id=p_operation_id;

  update public.joao_orcamento_erp_outbox
     set status='retry',
         last_error=left(coalesce(p_error,'erro_desconhecido'),800),
         next_attempt_at=now()+make_interval(mins=>least(60,greatest(1,power(2,least(coalesce(v_attempts,1)-1,5))::int))),
         updated_at=now()
   where operation_id=p_operation_id
     and worker=p_worker;
  return found;
end;
$$;

create or replace function public.fn_joao_orcamento_outbox_recover_v1()
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_n integer;
begin
  update public.joao_orcamento_erp_outbox
     set status='retry',
         next_attempt_at=now(),
         worker=null,
         updated_at=now(),
         last_error=coalesce(last_error,'claim expirado recuperado')
   where status='processing'
     and claimed_at < now()-interval '5 minutes';
  get diagnostics v_n=row_count;
  return v_n;
end;
$$;

revoke all on function public.fn_joao_orcamento_outbox_claim_v1(text,integer) from public;
revoke all on function public.fn_joao_orcamento_outbox_complete_v1(uuid,text) from public;
revoke all on function public.fn_joao_orcamento_outbox_fail_v1(uuid,text,text) from public;
revoke all on function public.fn_joao_orcamento_outbox_recover_v1() from public;
grant execute on function public.fn_joao_orcamento_outbox_claim_v1(text,integer) to service_role;
grant execute on function public.fn_joao_orcamento_outbox_complete_v1(uuid,text) to service_role;
grant execute on function public.fn_joao_orcamento_outbox_fail_v1(uuid,text,text) to service_role;
grant execute on function public.fn_joao_orcamento_outbox_recover_v1() to service_role;

commit;

-- Runtime schedule (installed live as cron job joao-erp-orcamento-sync-2min):
-- select cron.schedule(
--   'joao-erp-orcamento-sync-2min',
--   '*/2 * * * *',
--   $cron$select public.fn_http_post_log_vault_cron_secret_strict_v1(
--     p_url := 'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-orcamento-sync',
--     p_body := '{}'::jsonb,
--     p_jobid := (select jobid::int from cron.job where jobname='joao-erp-orcamento-sync-2min'),
--     p_jobname := 'joao-erp-orcamento-sync-2min',
--     p_origem := 'cron:joao-erp-orcamento-sync-2min',
--     p_timeout_ms := 30000
--   );$cron$
-- );
