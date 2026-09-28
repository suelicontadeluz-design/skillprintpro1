CREATE OR REPLACE FUNCTION public.fn_cortex_erp_stage_revision_v1(
  p_orcamento_id uuid,
  p_change_kind text,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb,
  p_review_context jsonb DEFAULT '{}'::jsonb,
  p_operations jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, cortex_erp
AS $$
DECLARE
  v_revision_id uuid;
  v_source text;
  v_order_id text;
  v_operation jsonb;
  v_sequence integer := 0;
  v_amount numeric(18,2);
BEGIN
  IF p_orcamento_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORCAMENTO_ID_REQUIRED');
  END IF;
  IF p_change_kind NOT IN ('REPLACE_FILE', 'ADD_FILE') THEN
    RETURN jsonb_build_object('success', false, 'code', 'CHANGE_KIND_INVALID');
  END IF;
  IF jsonb_typeof(p_before_snapshot) <> 'object'
     OR jsonb_typeof(p_after_snapshot) <> 'object'
     OR jsonb_typeof(COALESCE(p_review_context, '{}'::jsonb)) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'code', 'SNAPSHOT_INVALID');
  END IF;
  IF jsonb_typeof(COALESCE(p_operations, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'OPERATIONS_INVALID');
  END IF;

  SELECT erp_operational_source, erp_operational_order_id
    INTO v_source, v_order_id
  FROM public.orcamentos
  WHERE id = p_orcamento_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORCAMENTO_NOT_FOUND');
  END IF;
  IF v_source <> 'SKILLPRINT_ERP' OR v_order_id IS NULL OR btrim(v_order_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'MISSING_OPERATIONAL_LINK');
  END IF;

  BEGIN
    INSERT INTO cortex_erp.orcamento_revisoes (orcamento_id, review_context)
    VALUES (p_orcamento_id, COALESCE(p_review_context, '{}'::jsonb))
    RETURNING id INTO v_revision_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'code', 'REVISION_ALREADY_ACTIVE');
  END;

  INSERT INTO cortex_erp.orcamento_revisao_itens (
    revisao_id, sequence_no, change_kind, before_snapshot, after_snapshot
  ) VALUES (
    v_revision_id, 1, p_change_kind, p_before_snapshot, p_after_snapshot
  );

  FOR v_operation IN SELECT value FROM jsonb_array_elements(COALESCE(p_operations, '[]'::jsonb))
  LOOP
    v_sequence := v_sequence + 1;
    IF jsonb_typeof(v_operation) <> 'object'
       OR v_operation->>'operation_kind' NOT IN ('CANCEL_PENDING_PAYMENT', 'CREATE_FULL_PAYMENT', 'CREATE_DELTA_PAYMENT') THEN
      RAISE EXCEPTION 'invalid revision operation at sequence %', v_sequence USING ERRCODE = '23514';
    END IF;
    IF v_operation ? 'amount_brl' THEN
      IF v_operation->>'amount_brl' !~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'invalid operation amount at sequence %', v_sequence USING ERRCODE = '23514';
      END IF;
      v_amount := (v_operation->>'amount_brl')::numeric(18,2);
    ELSE
      v_amount := NULL;
    END IF;

    INSERT INTO cortex_erp.orcamento_revisao_operacoes (
      revisao_id, sequence_no, operation_kind, amount_brl, payload
    ) VALUES (
      v_revision_id, v_sequence, v_operation->>'operation_kind', v_amount, v_operation
    );
  END LOOP;

  UPDATE cortex_erp.orcamento_revisoes
  SET state = 'STAGED'
  WHERE id = v_revision_id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REVISION_STAGED',
    'revision_id', v_revision_id,
    'erp_operational_source', v_source,
    'erp_operational_order_id', v_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cortex_erp_stage_revision_v1(uuid, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cortex_erp_stage_revision_v1(uuid, text, jsonb, jsonb, jsonb, jsonb) TO service_role;
