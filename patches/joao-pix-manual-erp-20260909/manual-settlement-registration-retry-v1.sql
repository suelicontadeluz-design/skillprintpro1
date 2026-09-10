-- Retry manual full-settlement after canonical customer registration.
-- No cron. Scoped to the same lead and only receipt:* HOLDS caused by missing/incomplete client identity.
create or replace function public.fn_joao_manual_settlement_retry_for_lead_v1(
  p_lead_id uuid,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','net','vault','pg_temp'
as $$
declare
  v_anon text;
  v_cron text;
  v_row record;
  v_event_id uuid;
  v_req bigint;
  v_count int:=0;
  v_enqueued int:=0;
  v_items jsonb:='[]'::jsonb;
begin
  if p_lead_id is null then return jsonb_build_object('ok',false,'code','LEAD_ID_REQUIRED'); end if;

  for v_row in
    select payment_id,last_code,status,updated_at
    from public.joao_erp_sale_sync_v1
    where lead_id=p_lead_id
      and status='HOLD'
      and payment_id like 'receipt:%'
      and last_code in (
        'CORTEX_PERSON_NOT_FOUND',
        'CORTEX_PERSON_INCOMPLETE',
        'CLIENT_REQUIRED',
        'ERP_CLIENT_CREATED_BUT_NOT_RESOLVED'
      )
    order by updated_at desc
    limit 3
  loop
    v_count:=v_count+1;
    begin
      v_event_id:=substring(v_row.payment_id from 9)::uuid;
    exception when others then
      v_items:=v_items||jsonb_build_array(jsonb_build_object('payment_id',v_row.payment_id,'status','INVALID_EVENT_ID'));
      continue;
    end;

    if p_dry_run then
      v_items:=v_items||jsonb_build_array(jsonb_build_object('payment_id',v_row.payment_id,'event_id',v_event_id,'status','WOULD_RETRY','last_code',v_row.last_code));
      continue;
    end if;

    if v_anon is null then
      select decrypted_secret into v_anon from vault.decrypted_secrets where name='cortex_gate6c_supabase_anon_jwt' limit 1;
      select decrypted_secret into v_cron from vault.decrypted_secrets where name='internal_edge_cron_shared_secret_v1' limit 1;
      if coalesce(length(v_anon),0)<20 or coalesce(length(v_cron),0)<32 then
        return jsonb_build_object('ok',false,'code','INTERNAL_RETRY_SECRETS_UNAVAILABLE','matched',v_count,'enqueued',v_enqueued,'items',v_items);
      end if;
    end if;

    select net.http_post(
      url:='https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-manual-settlement-sync',
      headers:=jsonb_build_object(
        'content-type','application/json',
        'authorization','Bearer '||v_anon,
        'apikey',v_anon,
        'x-cron-secret',v_cron
      ),
      body:=jsonb_build_object('event_id',v_event_id),
      timeout_milliseconds:=120000
    ) into v_req;

    if v_req is not null then
      v_enqueued:=v_enqueued+1;
      insert into public.http_chamada_log(requisicao_id,jobname,origem,url)
      values(v_req,'joao-manual-settlement-registration-retry','fn_joao_manual_settlement_retry_for_lead_v1','https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-manual-settlement-sync')
      on conflict(requisicao_id) do nothing;
      v_items:=v_items||jsonb_build_array(jsonb_build_object('payment_id',v_row.payment_id,'event_id',v_event_id,'status','ENQUEUED','request_id',v_req,'last_code',v_row.last_code));
    else
      v_items:=v_items||jsonb_build_array(jsonb_build_object('payment_id',v_row.payment_id,'event_id',v_event_id,'status','ENQUEUE_FAILED','last_code',v_row.last_code));
    end if;
  end loop;

  return jsonb_build_object('ok',true,'code',case when p_dry_run then 'DRY_RUN' else 'DONE' end,'lead_id',p_lead_id,'matched',v_count,'enqueued',v_enqueued,'items',v_items);
end;
$$;

revoke all on function public.fn_joao_manual_settlement_retry_for_lead_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.fn_joao_manual_settlement_retry_for_lead_v1(uuid,boolean) to service_role;

create or replace function public.trg_joao_manual_settlement_retry_after_pessoa_v1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','pg_temp'
as $$
declare
  v_lead uuid;
begin
  begin
    v_lead:=nullif(new.metadata->>'lead_id','')::uuid;
  exception when others then
    return new;
  end;
  if v_lead is null then return new; end if;

  if exists(
    select 1 from public.joao_erp_sale_sync_v1 s
    where s.lead_id=v_lead
      and s.status='HOLD'
      and s.payment_id like 'receipt:%'
      and s.last_code in ('CORTEX_PERSON_NOT_FOUND','CORTEX_PERSON_INCOMPLETE','CLIENT_REQUIRED','ERP_CLIENT_CREATED_BUT_NOT_RESOLVED')
  ) then
    perform public.fn_joao_manual_settlement_retry_for_lead_v1(v_lead,false);
  end if;
  return new;
end;
$$;

revoke all on function public.trg_joao_manual_settlement_retry_after_pessoa_v1() from public,anon,authenticated;

drop trigger if exists trg_joao_manual_settlement_retry_after_pessoa_v1 on public.pessoas;
create trigger trg_joao_manual_settlement_retry_after_pessoa_v1
after insert on public.pessoas
for each row execute function public.trg_joao_manual_settlement_retry_after_pessoa_v1();