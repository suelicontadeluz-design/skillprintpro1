-- R15 2026-08-25 — remove APENAS o teto de emissao do array `amostra`.
--
--   - least(greatest(coalesce(p_amostra,20),0),200) n_amostra
--   + least(greatest(coalesce(p_amostra,20),0),5000) n_amostra
--
-- baseline  md5(prosrc) = 8be3ea0aa38a813c40591138624904a8 (11564 bytes)
-- candidato md5(prosrc) = 4390732e59e29c7b0b63bceca2215828 (11565 bytes)  <- LIVE confere
--
-- n_amostra aparece em exatamente 2 pontos do corpo:
--   linha   4: a definicao acima
--   linha 141: `) y where ord <= (select n_amostra from cfg)`
-- onde `ord` = row_number() over (partition by braco order by md5(lead_id::text)),
-- atribuido na linha 126 — DEPOIS de elegibilidade, estratificacao e randomizacao.
-- O teto so corta linhas ja selecionadas.
--
-- Derivado do LIVE por pg_get_functiondef + replace, com assert de md5 nos dois lados.

DO $do$
DECLARE v_def text; v_novo text; v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';
  IF md5(v_src) <> '8be3ea0aa38a813c40591138624904a8' THEN
    RAISE EXCEPTION 'BASELINE MUDOU, ABORTANDO: %', md5(v_src);
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';

  v_novo := replace(v_def,
    'least(greatest(coalesce(p_amostra,20),0),200)',
    'least(greatest(coalesce(p_amostra,20),0),5000)');

  IF v_novo = v_def THEN RAISE EXCEPTION 'replace nao encontrou o teto, abortando'; END IF;
  EXECUTE v_novo;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_coorte';
  IF md5(v_src) <> '4390732e59e29c7b0b63bceca2215828' THEN
    RAISE EXCEPTION 'CANDIDATO DIVERGE DO PRE-COMPUTADO: % (len %)', md5(v_src), length(v_src);
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';
