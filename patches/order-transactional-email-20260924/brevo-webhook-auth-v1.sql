do $$
declare
  v_secret text;
begin
  if not exists(select 1 from vault.secrets where name='brevo_transactional_webhook_token_v1') then
    v_secret := encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(
      v_secret,
      'brevo_transactional_webhook_token_v1',
      'Token para autenticar callbacks transacionais Brevo',
      null
    );
  end if;
end $$;

create or replace function public.fn_brevo_transactional_webhook_auth_v1(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public','vault','pg_temp'
as $function$
  select coalesce(
    extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256')
    =
    extensions.digest(convert_to(coalesce((
      select decrypted_secret
      from vault.decrypted_secrets
      where name='brevo_transactional_webhook_token_v1'
      limit 1
    ),''),'UTF8'),'sha256'),
    false
  )
$function$;

create or replace function public.fn_brevo_transactional_webhook_token_v1()
returns text
language sql
stable
security definer
set search_path to 'public','vault','pg_temp'
as $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='brevo_transactional_webhook_token_v1'
  limit 1
$function$;

revoke all on function public.fn_brevo_transactional_webhook_auth_v1(text) from public;
revoke all on function public.fn_brevo_transactional_webhook_token_v1() from public;
grant execute on function public.fn_brevo_transactional_webhook_auth_v1(text) to service_role;
grant execute on function public.fn_brevo_transactional_webhook_token_v1() to service_role;