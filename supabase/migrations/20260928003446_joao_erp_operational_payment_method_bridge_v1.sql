alter table public.orcamentos
  add column if not exists erp_operational_order_id text,
  add column if not exists erp_operational_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orcamentos_erp_operational_link_ck'
      and conrelid = 'public.orcamentos'::regclass
  ) then
    alter table public.orcamentos
      add constraint orcamentos_erp_operational_link_ck
      check (
        (
          erp_operational_order_id is null
          and erp_operational_source is null
        )
        or (
          erp_operational_order_id is not null
          and btrim(erp_operational_order_id) <> ''
          and erp_operational_source = 'CALCME'
        )
      );
  end if;
end
$$;

create index if not exists idx_orcamentos_erp_operational_link
  on public.orcamentos (erp_operational_source, erp_operational_order_id)
  where erp_operational_order_id is not null;

alter table public.mp_pix_cobrancas
  add column if not exists payment_method text not null default 'UNKNOWN';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mp_pix_cobrancas_payment_method_ck'
      and conrelid = 'public.mp_pix_cobrancas'::regclass
  ) then
    alter table public.mp_pix_cobrancas
      add constraint mp_pix_cobrancas_payment_method_ck
      check (payment_method in ('PIX', 'CARD_CHECKOUT', 'UNKNOWN'));
  end if;
end
$$;

create or replace function public.fn_mp_pix_payment_method_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.payment_method is distinct from old.payment_method then
    raise exception using
      errcode = '23514',
      message = 'payment_method is immutable; create a new payment record';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_mp_pix_payment_method_immutable() from public;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_mp_pix_payment_method_immutable'
      and tgrelid = 'public.mp_pix_cobrancas'::regclass
      and not tgisinternal
  ) then
    create trigger trg_mp_pix_payment_method_immutable
      before update of payment_method on public.mp_pix_cobrancas
      for each row
      execute function public.fn_mp_pix_payment_method_immutable();
  end if;
end
$$;
