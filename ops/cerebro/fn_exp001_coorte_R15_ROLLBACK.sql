-- ROLLBACK R15 — devolve o teto de emissao a 200 por braco.
-- de:   4390732e59e29c7b0b63bceca2215828 (11565 bytes)
-- para: 8be3ea0aa38a813c40591138624904a8 (11564 bytes)
-- PROVADO em BEGIN/ROLLBACK: reconstroi o baseline byte-exato e `amostra` volta a 400.

DO $do$
DECLARE v_def text; v_novo text; v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';
  IF md5(v_src) <> '4390732e59e29c7b0b63bceca2215828' THEN
    RAISE EXCEPTION 'LIVE NAO E O ESPERADO, ABORTANDO: %', md5(v_src);
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';

  v_novo := replace(v_def,
    'least(greatest(coalesce(p_amostra,20),0),5000)',
    'least(greatest(coalesce(p_amostra,20),0),200)');

  IF v_novo = v_def THEN RAISE EXCEPTION 'replace nao encontrou o teto, abortando'; END IF;
  EXECUTE v_novo;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';
  IF md5(v_src) <> '8be3ea0aa38a813c40591138624904a8' THEN
    RAISE EXCEPTION 'ROLLBACK NAO RECONSTROI BASELINE: %', md5(v_src);
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';
