-- R16 2026-08-25 — guarda de braco em fn_exp001_registrar_intervencao.
-- baseline  md5(prosrc) = 4b3c979bf5adf5484f302d5631d85b29 (3580 bytes)
-- candidato md5(prosrc) = f18172cd15b57676e77e0940e3618a0e (4065 bytes, +485)  <- LIVE confere
--
-- Fecha o unico caminho pelo qual um lead do braco CONTROLE poderia entrar na
-- audiencia (e, com a campanha aprovada, na fila) do EXP-001.

DO $do$
DECLARE v_def text; v_novo text; v_src text; anc text; ins text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_registrar_intervencao';
  IF md5(v_src) <> '4b3c979bf5adf5484f302d5631d85b29' THEN
    RAISE EXCEPTION 'BASELINE MUDOU, ABORTANDO: %', md5(v_src);
  END IF;
  anc := E'\n  -- Identidade do experimento. slug e UNIQUE: cria uma vez, reusa sempre.\n';
  ins := $q$
  -- GUARDA DE BRACO: o CONTROLE do EXP-001 nunca entra na audiencia nem na fila.
  -- O braco e derivado da MESMA formula deterministica usada por fn_exp001_coorte,
  -- entao nao depende de flag mutavel, de status nem de disciplina humana.
  IF (get_byte(decode(md5(p_lead_id::text || c_slug),'hex'),0) & 1) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lead_e_do_braco_controle',
      'experiment_id', c_slug, 'braco', 'CONTROLE', 'enfileirado', false);
  END IF;
$q$;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_registrar_intervencao';
  v_novo := replace(v_def, anc, ins || anc);
  IF v_novo = v_def THEN RAISE EXCEPTION 'ancora nao encontrada, abortando'; END IF;
  EXECUTE v_novo;
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_exp001_registrar_intervencao';
  IF md5(v_src) <> 'f18172cd15b57676e77e0940e3618a0e' THEN
    RAISE EXCEPTION 'CANDIDATO DIVERGE: % (len %)', md5(v_src), length(v_src);
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';
