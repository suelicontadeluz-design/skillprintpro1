-- FreightAgent Phase 1 — canonical shipping state
-- 2026-09-15
-- Append-only, optimistic concurrency, fail-closed quote validation.

create table if not exists public.canonical_session_state (
  state_record_id uuid primary key default gen_random_uuid(),
  session_id text not null,
  state_version bigint not null check (state_version > 0),
  lead_id uuid null,
  phone text null,
  shipping_state jsonb not null,
  shipping_state_hash text not null,
  source_event text not null,
  source_turn_id uuid null,
  source_replay_case_id uuid null references public.replay_caso(id),
  is_replay boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint uq_canonical_session_state_version unique(session_id,state_version),
  constraint ck_canonical_shipping_schema check (shipping_state->>'schema_version' = 'shipping-state/v1'),
  constraint ck_canonical_shipping_status check (shipping_state->>'status' in ('EMPTY','ZIP_PROVIDED','VALID_QUOTE','QUOTE_SELECTED'))
);

create index if not exists idx_canonical_session_state_current on public.canonical_session_state(session_id,state_version desc);
create index if not exists idx_canonical_session_state_phone on public.canonical_session_state(phone,state_version desc) where phone is not null;
create index if not exists idx_canonical_session_state_lead on public.canonical_session_state(lead_id,state_version desc) where lead_id is not null;

alter table public.canonical_session_state enable row level security;
revoke all on table public.canonical_session_state from anon, authenticated;
grant select, insert on table public.canonical_session_state to service_role;

create or replace view public.vw_canonical_session_state_current_v1 as
select distinct on (session_id)
  state_record_id, session_id, state_version, lead_id, phone, shipping_state,
  shipping_state_hash, source_event, source_turn_id, source_replay_case_id, is_replay, created_at
from public.canonical_session_state
order by session_id, state_version desc, created_at desc;
revoke all on table public.vw_canonical_session_state_current_v1 from anon, authenticated;
grant select on table public.vw_canonical_session_state_current_v1 to service_role;

create or replace function public.fn_joao_shipping_session_id_v1(p_lead_id uuid, p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_lead_id is not null then 'lead:' || p_lead_id::text
    when length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')) between 10 and 15
      then 'phone:' || regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
    else null
  end
$$;

create or replace function public.fn_joao_shipping_state_current_v1(p_session_id text)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select case when c.state_record_id is null then
    jsonb_build_object(
      'ok',true,'found',false,'session_id',p_session_id,'state_version',0,
      'shipping_state',jsonb_build_object(
        'schema_version','shipping-state/v1','status','EMPTY','zip_code',null,
        'quote_snapshot_id',null,'quotes','[]'::jsonb,'selected_quote',null
      )
    )
  else
    jsonb_build_object(
      'ok',true,'found',true,'session_id',c.session_id,'state_version',c.state_version,
      'shipping_state',c.shipping_state,'shipping_state_hash',c.shipping_state_hash,'created_at',c.created_at
    )
  end
  from (select 1) x
  left join lateral (
    select * from public.canonical_session_state s
    where s.session_id=p_session_id
    order by s.state_version desc,s.created_at desc limit 1
  ) c on true
$$;

create or replace function public.fn_joao_shipping_state_apply_v1(
  p_session_id text,
  p_expected_version bigint,
  p_proposal jsonb,
  p_lead_id uuid default null,
  p_phone text default null,
  p_source_turn_id uuid default null,
  p_source_replay_case_id uuid default null,
  p_is_replay boolean default false,
  p_as_of timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session text := btrim(coalesce(p_session_id,''));
  v_action text := upper(btrim(coalesce(p_proposal->>'action','')));
  v_cur record;
  v_current jsonb := jsonb_build_object('schema_version','shipping-state/v1','status','EMPTY','zip_code',null,'quote_snapshot_id',null,'quotes','[]'::jsonb,'selected_quote',null);
  v_current_version bigint := 0;
  v_next jsonb;
  v_next_version bigint;
  v_zip text;
  v_old_zip text;
  v_quote_id uuid;
  v_quote public.joao_freight_quote_snapshots%rowtype;
  v_selected jsonb;
  v_selected_count int := 0;
  v_service text;
  v_price numeric;
  v_hash text;
  v_record uuid;
  v_phone text;
  v_lead uuid;
begin
  if v_session='' or length(v_session)>180 then
    return jsonb_build_object('ok',false,'code','SESSION_ID_INVALID','external_effect',false);
  end if;
  if jsonb_typeof(coalesce(p_proposal,'null'::jsonb))<>'object'
     or coalesce(p_proposal->>'schema_version','')<>'freight-state-proposal/v1' then
    return jsonb_build_object('ok',false,'code','PROPOSAL_SCHEMA_INVALID','external_effect',false);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shipping-state:'||v_session,0));
  select * into v_cur
  from public.canonical_session_state
  where session_id=v_session
  order by state_version desc,created_at desc limit 1;
  if found then
    v_current:=v_cur.shipping_state;
    v_current_version:=v_cur.state_version;
    v_phone:=v_cur.phone;
    v_lead:=v_cur.lead_id;
  end if;

  if coalesce(p_expected_version,0)<>v_current_version then
    return jsonb_build_object('ok',false,'code','STATE_VERSION_CONFLICT','expected_version',p_expected_version,'actual_version',v_current_version,'external_effect',false);
  end if;

  v_old_zip:=regexp_replace(coalesce(v_current->>'zip_code',''),'[^0-9]','','g');

  if v_action='ZIP_PROVIDED' then
    v_zip:=regexp_replace(coalesce(p_proposal->>'zip_code',''),'[^0-9]','','g');
    if v_zip !~ '^[0-9]{8}$' then
      return jsonb_build_object('ok',false,'code','ZIP_INVALID','state_version',v_current_version,'external_effect',false);
    end if;
    if v_old_zip ~ '^[0-9]{8}$' and v_old_zip<>v_zip
       and coalesce((p_proposal->>'explicit_customer_change')::boolean,false) is not true then
      return jsonb_build_object('ok',false,'code','ZIP_CHANGE_REQUIRES_EXPLICIT_CUSTOMER','canonical_zip',v_old_zip,'proposed_zip',v_zip,'state_version',v_current_version,'external_effect',false);
    end if;
    if v_old_zip=v_zip and coalesce(v_current->>'status','EMPTY') in ('ZIP_PROVIDED','VALID_QUOTE','QUOTE_SELECTED') then
      v_next:=v_current;
    else
      v_next:=jsonb_build_object(
        'schema_version','shipping-state/v1','status','ZIP_PROVIDED','zip_code',v_zip,
        'quote_snapshot_id',null,'quotes','[]'::jsonb,'selected_quote',null,
        'zip_source',coalesce(nullif(p_proposal->>'source',''),'FRETE_AGENT'),
        'zip_confirmed_at',to_char(p_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      );
    end if;

  elsif v_action='QUOTE_RECORDED' then
    begin v_quote_id:=nullif(p_proposal->>'quote_snapshot_id','')::uuid; exception when others then v_quote_id:=null; end;
    if v_quote_id is null then
      return jsonb_build_object('ok',false,'code','QUOTE_SNAPSHOT_REQUIRED','state_version',v_current_version,'external_effect',false);
    end if;
    select * into v_quote from public.joao_freight_quote_snapshots where quote_id=v_quote_id;
    if not found then return jsonb_build_object('ok',false,'code','QUOTE_SNAPSHOT_NOT_FOUND','quote_snapshot_id',v_quote_id,'external_effect',false); end if;

    v_zip:=regexp_replace(coalesce(v_quote.cep_destino,''),'[^0-9]','','g');
    if v_zip !~ '^[0-9]{8}$' or jsonb_typeof(v_quote.opcoes)<>'array' or jsonb_array_length(v_quote.opcoes)=0 then
      return jsonb_build_object('ok',false,'code','QUOTE_SNAPSHOT_INVALID','quote_snapshot_id',v_quote_id,'external_effect',false);
    end if;
    if v_old_zip ~ '^[0-9]{8}$' and v_old_zip<>v_zip then
      return jsonb_build_object('ok',false,'code','QUOTE_ZIP_DIVERGES_FROM_CANONICAL','canonical_zip',v_old_zip,'quote_zip',v_zip,'external_effect',false);
    end if;
    if p_lead_id is not null and v_quote.lead_id<>p_lead_id then
      return jsonb_build_object('ok',false,'code','QUOTE_LEAD_DIVERGENCE','external_effect',false);
    end if;
    if nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'') is not null
       and regexp_replace(v_quote.phone,'[^0-9]','','g')<>regexp_replace(p_phone,'[^0-9]','','g') then
      return jsonb_build_object('ok',false,'code','QUOTE_PHONE_DIVERGENCE','external_effect',false);
    end if;
    if exists(
      select 1 from jsonb_array_elements(v_quote.opcoes) o
      where coalesce((o->>'preco')::numeric,0)<=0 or btrim(coalesce(o->>'servico',''))=''
    ) then
      return jsonb_build_object('ok',false,'code','QUOTE_OPTION_INVALID','external_effect',false);
    end if;

    v_phone:=coalesce(nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),''),v_quote.phone,v_phone);
    v_lead:=coalesce(p_lead_id,v_quote.lead_id,v_lead);
    v_next:=jsonb_build_object(
      'schema_version','shipping-state/v1','status','VALID_QUOTE','zip_code',v_zip,
      'quote_snapshot_id',v_quote.quote_id,'quotes',v_quote.opcoes,'selected_quote',null,
      'quoted_at',to_char(v_quote.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'quote_hash',v_quote.quote_hash,'quote_source_tool',v_quote.source_tool
    );

  elsif v_action='QUOTE_SELECTED' then
    if coalesce(v_current->>'status','') not in ('VALID_QUOTE','QUOTE_SELECTED')
       or jsonb_typeof(v_current->'quotes')<>'array' or jsonb_array_length(v_current->'quotes')=0 then
      return jsonb_build_object('ok',false,'code','VALID_QUOTE_REQUIRED','state_version',v_current_version,'external_effect',false);
    end if;
    v_service:=lower(btrim(coalesce(p_proposal->>'service','')));
    begin v_price:=nullif(p_proposal->>'price','')::numeric; exception when others then v_price:=null; end;
    select count(*),(jsonb_agg(o.value order by o.ordinality)->0)
      into v_selected_count,v_selected
    from jsonb_array_elements(v_current->'quotes') with ordinality o(value,ordinality)
    where (v_service<>'' and lower(btrim(coalesce(o.value->>'servico','')))=v_service)
       or (v_price is not null and abs(coalesce((o.value->>'preco')::numeric,0)-v_price)<=0.005);
    if v_selected_count<>1 then
      return jsonb_build_object('ok',false,'code',case when v_selected_count=0 then 'QUOTE_SELECTION_NOT_FOUND' else 'QUOTE_SELECTION_AMBIGUOUS' end,'matches',v_selected_count,'external_effect',false);
    end if;
    v_next:=v_current || jsonb_build_object(
      'status','QUOTE_SELECTED','selected_quote',v_selected,
      'selected_at',to_char(p_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
  else
    return jsonb_build_object('ok',false,'code','ACTION_NOT_ALLOWED','action',v_action,'external_effect',false);
  end if;

  if regexp_replace(coalesce(v_next->>'zip_code',''),'[^0-9]','','g') !~ '^[0-9]{8}$' then
    return jsonb_build_object('ok',false,'code','INVARIANT_ZIP_REQUIRED','external_effect',false);
  end if;
  if v_next->>'status' in ('VALID_QUOTE','QUOTE_SELECTED') then
    if jsonb_typeof(v_next->'quotes')<>'array' or jsonb_array_length(v_next->'quotes')=0 or nullif(v_next->>'quote_snapshot_id','') is null then
      return jsonb_build_object('ok',false,'code','INVARIANT_VALID_QUOTE_INCOMPLETE','external_effect',false);
    end if;
  end if;
  if v_next->>'status'='QUOTE_SELECTED' and (v_next->'selected_quote') is null then
    return jsonb_build_object('ok',false,'code','INVARIANT_SELECTED_QUOTE_REQUIRED','external_effect',false);
  end if;

  if v_next=v_current then
    return jsonb_build_object('ok',true,'code','IDEMPOTENT','session_id',v_session,'state_version',v_current_version,'shipping_state',v_current,'external_effect',false);
  end if;

  v_next_version:=v_current_version+1;
  v_hash:=public.fn_authority_sha256_jsonb_v1(v_next);
  insert into public.canonical_session_state(
    session_id,state_version,lead_id,phone,shipping_state,shipping_state_hash,source_event,source_turn_id,source_replay_case_id,is_replay,created_at
  ) values(
    v_session,v_next_version,coalesce(p_lead_id,v_lead),coalesce(nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),''),v_phone),
    v_next,v_hash,v_action,p_source_turn_id,p_source_replay_case_id,p_is_replay,p_as_of
  ) returning state_record_id into v_record;

  return jsonb_build_object('ok',true,'code','STATE_COMMITTED','state_record_id',v_record,'session_id',v_session,'state_version',v_next_version,'shipping_state',v_next,'shipping_state_hash',v_hash,'external_effect',false);
end;
$$;

create or replace function public.fn_joao_shipping_render_v1(p_session_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_cur jsonb; v_state jsonb; v_status text; v_zip text; v_selected jsonb;
  v_quotes jsonb; v_text text; v_first jsonb; v_expected numeric; r jsonb; v_days int;
begin
  v_cur:=public.fn_joao_shipping_state_current_v1(p_session_id);
  v_state:=v_cur->'shipping_state';
  v_status:=coalesce(v_state->>'status','EMPTY');
  v_zip:=regexp_replace(coalesce(v_state->>'zip_code',''),'[^0-9]','','g');
  v_quotes:=coalesce(v_state->'quotes','[]'::jsonb);
  v_selected:=v_state->'selected_quote';

  if v_status='QUOTE_SELECTED' and v_selected is not null then
    v_expected:=(v_selected->>'preco')::numeric;
    begin v_days:=nullif(v_selected->>'prazo_dias','')::int; exception when others then v_days:=null; end;
    v_text:=format('Frete %s: R$ %s%s',v_selected->>'servico',replace(to_char(v_expected,'FM999999990.00'),'.',','),case when v_days is not null then format(' — %s %s',v_days,case when v_days=1 then 'dia útil' else 'dias úteis' end) else '' end);
  elsif v_status='VALID_QUOTE' and jsonb_array_length(v_quotes)>0 then
    v_first:=v_quotes->0;
    v_expected:=(v_first->>'preco')::numeric;
    v_text:=format('Para o CEP %s-%s, tenho estas opções de frete:',substr(v_zip,1,5),substr(v_zip,6,3));
    for r in select value from jsonb_array_elements(v_quotes) loop
      begin v_days:=nullif(r->>'prazo_dias','')::int; exception when others then v_days:=null; end;
      v_text:=v_text||E'\n• '||coalesce(r->>'servico','Frete')||': R$ '||replace(to_char((r->>'preco')::numeric,'FM999999990.00'),'.',',')||case when v_days is not null then ' — '||v_days||case when v_days=1 then ' dia útil' else ' dias úteis' end else '' end;
    end loop;
    v_text:=v_text||E'\nQual você prefere?';
  elsif v_status='ZIP_PROVIDED' then
    v_text:=format('Já tenho seu CEP %s-%s. Vou usar esse CEP para calcular o frete.',substr(v_zip,1,5),substr(v_zip,6,3));
    v_expected:=null;
  else
    v_text:=''; v_expected:=null;
  end if;

  return jsonb_build_object(
    'ok',true,'session_id',p_session_id,'state_version',v_cur->'state_version','status',v_status,
    'text',v_text,'expected_rendered_price',v_expected,
    'must_not_ask_zip',(v_zip ~ '^[0-9]{8}$'),'render_source','CANONICAL_SESSION_STATE','external_effect',false
  );
end;
$$;

revoke all on function public.fn_joao_shipping_session_id_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.fn_joao_shipping_state_current_v1(text) from public,anon,authenticated;
revoke all on function public.fn_joao_shipping_state_apply_v1(text,bigint,jsonb,uuid,text,uuid,uuid,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.fn_joao_shipping_render_v1(text) from public,anon,authenticated;
grant execute on function public.fn_joao_shipping_session_id_v1(uuid,text) to service_role;
grant execute on function public.fn_joao_shipping_state_current_v1(text) to service_role;
grant execute on function public.fn_joao_shipping_state_apply_v1(text,bigint,jsonb,uuid,text,uuid,uuid,boolean,timestamptz) to service_role;
grant execute on function public.fn_joao_shipping_render_v1(text) to service_role;
