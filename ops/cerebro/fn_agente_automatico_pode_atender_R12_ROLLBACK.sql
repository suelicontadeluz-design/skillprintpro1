-- ROLLBACK R12 — volta fn_agente_automatico_pode_atender para a assinatura de 6 args.
-- de:   md5(prosrc) = d22ac0fd2e6d57c4fd183c717272ae59 (4058 bytes, 7 args)
-- para: md5(prosrc) = 716eace2fa6a736752496c8fe30de97e (3429 bytes, 6 args)
--
-- PROVADO em BEGIN/ROLLBACK em 2026-08-25: reconstroi o baseline byte-exato.
--
-- ORDEM OBRIGATORIA: rodar o rollback do EDGE (v12) ANTES deste. Se a funcao
-- voltar para 6 args enquanto o executor v13 ainda envia p_checar_optout_whatsapp,
-- o PostgREST devolve erro e o executor entra em rpc_error_fail_safe — a fila
-- para inteira (fail-closed, nao envia errado, mas para).

DO $do$
DECLARE live text; volta text; novo text; anchor text;
BEGIN
  SELECT prosrc INTO live FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_agente_automatico_pode_atender';
  IF md5(live) <> 'd22ac0fd2e6d57c4fd183c717272ae59' THEN
    RAISE EXCEPTION 'LIVE NAO E O ESPERADO, ABORTANDO: %', md5(live);
  END IF;

  anchor := E'\n  -- Guarda 2: status do lead bloqueado\n';
  novo := $q$
  -- Guarda 1.5 (NOVA, opt-in): opt-out de WhatsApp. SO vale para OUTBOUND.
  -- p_checar_optout_whatsapp DEFAULT false => inbound (agente-conversacao
  -- modoReativo, agente-fechamento modoReativo) nao ativa esta guarda.
  -- Escopo canal='whatsapp': hard bounce de email NAO bloqueia WhatsApp.
  -- revogado_em IS NULL: opt-out revogado deixa de valer.
  IF p_checar_optout_whatsapp AND EXISTS (
    SELECT 1 FROM crm_contact_optouts o
    WHERE o.lead_id = p_lead_id
      AND o.canal = 'whatsapp'
      AND o.revogado_em IS NULL
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'optout_whatsapp');
  END IF;
$q$;

  volta := replace(live, novo || anchor, anchor);
  IF md5(volta) <> '716eace2fa6a736752496c8fe30de97e' THEN
    RAISE EXCEPTION 'ROLLBACK NAO RECONSTROI O BASELINE: % (len %)', md5(volta), length(volta);
  END IF;

  EXECUTE 'DROP FUNCTION public.fn_agente_automatico_pode_atender(uuid,text,integer,boolean,boolean,boolean,boolean)';
  EXECUTE 'CREATE FUNCTION public.fn_agente_automatico_pode_atender('
        || 'p_lead_id uuid, p_phone text DEFAULT NULL::text, p_janela_humano_min integer DEFAULT 90, '
        || 'p_checar_recorrente boolean DEFAULT true, p_checar_purchase boolean DEFAULT true, '
        || 'p_respeitar_julia_pausa boolean DEFAULT true) '
        || 'RETURNS jsonb LANGUAGE plpgsql AS $function$' || volta || '$function$';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_agente_automatico_pode_atender(uuid,text,integer,boolean,boolean,boolean) TO anon, authenticated, service_role';
END $do$;

NOTIFY pgrst, 'reload schema';
