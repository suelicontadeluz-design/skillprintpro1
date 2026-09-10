-- P3 — previsibilidade de envio do João — 2026-09-10
-- Objetivo: um inbound pode gerar uma decisão; se o envio falhar, recuperar o mesmo texto
-- de forma idempotente antes de qualquer nova decisão. O sweep v1 permanece intacto.

create or replace function public.fn_joao_http_post_vault_v2(
  p_uri character varying,
  p_content character varying,
  p_content_type character varying default 'application/json'::character varying
)
returns public.http_response
language plpgsql
security definer
set search_path to 'public','vault'
as $function$
declare
  v_token text;
  v_resp public.http_response;
begin
  if p_uri not in (
    'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/agente-noturno',
    'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-sale-sync',
    'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-sale-sync-multi',
    'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-erp-order-read',
    'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-zapi-recovery-send'
  ) then
    raise exception 'joao vault helper v2: url not allowed';
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name='internal_edge_cron_shared_secret_v1'
   limit 1;

  if v_token is null or length(v_token)<32 then
    raise exception 'joao vault helper v2: secret unavailable';
  end if;

  select * into v_resp from public.http((
    'POST'::public.http_method,
    p_uri,
    array[
      public.http_header('Content-Type',coalesce(p_content_type,'application/json')),
      public.http_header('x-cron-secret',v_token)
    ]::public.http_header[],
    coalesce(p_content_type,'application/json'),
    coalesce(p_content,'{}')
  )::public.http_request);

  return v_resp;
end;
$function$;

create or replace function public.fn_joao_recovery_before_redecision_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '55s'
as $function$
declare
  r record;
  v_resp public.http_response;
  v_json jsonb;
  v_humano integer := 0;
  v_outbound integer := 0;
  v_recovery_ok integer := 0;
  v_recovery_fail integer := 0;
  v_examined integer := 0;
begin
  for r in
    select
      i.id as inbound_id,
      i.phone,
      i.created_at as inbound_created_at,
      d.id as decision_id,
      d.lead_id,
      d.decisao->>'mensagem' as mensagem
    from public.inbound_fora_horario i
    join lateral (
      select d.*
      from public.agente_decisoes_log d
      where d.agente_slug='agente-noturno'
        and d.contexto->'owned_inbound_ids' ? i.id::text
        and d.acao_executada='resposta_noturna_falhou_envio'
        and btrim(coalesce(d.decisao->>'mensagem',''))<>''
      order by d.created_at asc, d.id asc
      limit 1
    ) d on true
    where i.status='pendente'
      and i.created_at>=now()-interval '5 days'
    order by i.created_at asc
    limit 4
    for update of i skip locked
  loop
    v_examined := v_examined + 1;

    if exists (
      select 1
      from public.leads_marketing l
      join public.agente_exploracao_estado e on e.lead_id=l.lead_id
      where l.ph=r.phone
        and e.status='bloqueada_humano'
    ) then
      update public.inbound_fora_horario
         set status='humano_ativo',
             ultimo_erro=null,
             net_request_id=null,
             enfileirado_em=null
       where id=r.inbound_id and status='pendente';
      v_humano := v_humano + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.whatsapp_message_log w
      where w.phone=r.phone
        and lower(coalesce(w.direction,'')) in ('out','outbound','sent')
        and w.created_at>=r.inbound_created_at
    ) then
      update public.inbound_fora_horario
         set status='reprocessado',
             reprocessado_em=coalesce(reprocessado_em,now()),
             ultimo_erro=null,
             net_request_id=null,
             enfileirado_em=null
       where id=r.inbound_id and status='pendente';
      v_outbound := v_outbound + 1;
      continue;
    end if;

    begin
      perform public.http_set_curlopt('CURLOPT_TIMEOUT_MS','20000');
      select * into v_resp
      from public.fn_joao_http_post_vault_v2(
        'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/joao-zapi-recovery-send'::varchar,
        jsonb_build_object(
          'phone',r.phone,
          'message',r.mensagem,
          'idempotency_key','inbound:'||r.inbound_id::text,
          'lead_id',r.lead_id
        )::text::varchar,
        'application/json'::varchar
      );
      perform public.http_reset_curlopt();

      begin
        v_json := coalesce(v_resp.content,'{}')::jsonb;
      exception when others then
        v_json := '{}'::jsonb;
      end;

      if v_resp.status between 200 and 299 and coalesce((v_json->>'ok')::boolean,false)=true then
        update public.inbound_fora_horario
           set status='reprocessado',
               reprocessado_em=coalesce(reprocessado_em,now()),
               ultimo_erro='recovery_zapi_confirmed',
               net_request_id=null,
               enfileirado_em=null
         where id=r.inbound_id and status='pendente';
        v_recovery_ok := v_recovery_ok + 1;
      else
        update public.inbound_fora_horario
           set status='falha_envio_terminal',
               ultimo_erro=left(
                 'recovery_zapi_terminal_http_'||coalesce(v_resp.status::text,'null')||':'||coalesce(v_resp.content,''),
                 350
               ),
               net_request_id=null,
               enfileirado_em=null
         where id=r.inbound_id and status='pendente';
        v_recovery_fail := v_recovery_fail + 1;
      end if;
    exception when others then
      perform public.http_reset_curlopt();
      update public.inbound_fora_horario
         set status='falha_envio_terminal',
             ultimo_erro=left('recovery_zapi_exception:'||sqlerrm,350),
             net_request_id=null,
             enfileirado_em=null
       where id=r.inbound_id and status='pendente';
      v_recovery_fail := v_recovery_fail + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'examined',v_examined,
    'humanos_reconciliados',v_humano,
    'outbounds_reconciliados',v_outbound,
    'recovery_confirmed',v_recovery_ok,
    'recovery_terminal_fail',v_recovery_fail,
    'policy','one_inbound_one_decision_then_idempotent_recovery'
  );
end;
$function$;

create or replace function public.fn_joao_sweep_sync_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '175s'
as $function$
declare
  v_pre jsonb;
  v_main jsonb;
begin
  v_pre := public.fn_joao_recovery_before_redecision_v1();
  v_main := public.fn_joao_sweep_sync_v1();
  return v_main || jsonb_build_object('pre_redecision_recovery',v_pre,'sweep_wrapper','v2');
end;
$function$;

select cron.alter_job(
  job_id := 151,
  command := 'SELECT public.fn_joao_sweep_sync_v2();'
);

create or replace function public.fn_joao_human_skip_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status='pendente'
     and coalesce(new.ultimo_erro,'') like 'bridge_joao_sem_confirmacao_http_%_skip_humano_ativo%'
  then
    new.status := 'humano_ativo';
    new.net_request_id := null;
    new.enfileirado_em := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_01_joao_human_skip_terminal_v1 on public.inbound_fora_horario;
create trigger trg_01_joao_human_skip_terminal_v1
before update of status,ultimo_erro on public.inbound_fora_horario
for each row
execute function public.fn_joao_human_skip_terminal_v1();
