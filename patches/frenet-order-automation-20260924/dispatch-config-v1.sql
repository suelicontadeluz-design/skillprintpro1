create table if not exists public.frenet_dispatch_config_v1(
  id boolean primary key default true check(id=true),
  oneclick_enabled boolean not null default false,
  oneclick_max_brl numeric not null default 100 check(oneclick_max_brl>0),
  updated_at timestamptz not null default now()
);

insert into public.frenet_dispatch_config_v1(id,oneclick_enabled,oneclick_max_brl)
values(true,false,100)
on conflict(id) do nothing;

alter table public.frenet_dispatch_config_v1 enable row level security;
revoke all on public.frenet_dispatch_config_v1 from anon,authenticated;
grant select on public.frenet_dispatch_config_v1 to service_role;

create or replace function public.fn_frenet_dispatch_config_v1()
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
  select jsonb_build_object(
    'oneclick_enabled',oneclick_enabled,
    'oneclick_max_brl',oneclick_max_brl,
    'updated_at',updated_at
  )
  from public.frenet_dispatch_config_v1
  where id=true
$function$;

revoke all on function public.fn_frenet_dispatch_config_v1() from public;
grant execute on function public.fn_frenet_dispatch_config_v1() to service_role;
