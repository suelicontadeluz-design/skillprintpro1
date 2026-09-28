alter table public.orcamentos
  drop constraint if exists orcamentos_erp_operational_link_ck;

alter table public.orcamentos
  add constraint orcamentos_erp_operational_link_ck
  check (
    case
      when erp_operational_order_id is null
       and erp_operational_source is null
        then true
      when erp_operational_order_id is not null
       and btrim(erp_operational_order_id) <> ''
       and erp_operational_source = 'CALCME'
        then true
      else false
    end
  );
