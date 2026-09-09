-- Canonicaliza a mensagem outbound do João quando o callback do Z-API confirma o envio.
-- Regra fail-safe baseada em tráfego real de 09/09/2026:
-- 167/167 callbacks analisados casaram com exatamente 1 provisório source='joao'; 0 ambíguos.
-- Mantém a linha source='zapi' (prova do provider / messageId / 7C) e remove apenas o provisório idêntico.

create or replace function public.fn_fact_conversations_canonicalize_joao_provider_echo_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate_id uuid;
  v_candidates integer := 0;
begin
  if new.source <> 'zapi'
     or new.direction <> 'outbound'
     or new.lead_id is null
     or coalesce(new.raw_payload->>'type', '') <> 'ReceivedCallback'
     or coalesce(new.raw_payload->>'fromMe', 'false') <> 'true'
     or coalesce(new.raw_payload->>'fromApi', 'false') <> 'true'
     or coalesce(new.raw_payload->>'status', '') <> 'SENT'
     or nullif(new.raw_payload->>'messageId', '') is null
     or coalesce(new.message_text, '') not like '*João Barros:*%'
  then
    return new;
  end if;

  select count(*), min(j.id)
    into v_candidates, v_candidate_id
  from public.fact_conversations j
  where j.source = 'joao'
    and j.direction = 'outbound'
    and j.lead_id = new.lead_id
    and j.message_text = new.message_text
    and j.timestamp between new.timestamp - interval '30 seconds'
                        and new.timestamp + interval '2 seconds';

  -- Fail-safe: só canonicaliza quando existe exatamente um provisório inequívoco.
  if v_candidates = 1 and v_candidate_id is not null then
    delete from public.fact_conversations
    where id = v_candidate_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fact_conversations_canonicalize_joao_provider_echo_v1
  on public.fact_conversations;

create trigger trg_fact_conversations_canonicalize_joao_provider_echo_v1
after insert on public.fact_conversations
for each row
execute function public.fn_fact_conversations_canonicalize_joao_provider_echo_v1();
