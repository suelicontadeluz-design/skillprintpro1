-- Canonical operational link: main budget -> Skillprint ERP public.vendas.id.
-- Cross-project existence validation is performed by the internal writer before
-- calling this local, transaction-safe RPC.

ALTER TABLE public.orcamentos
  DROP CONSTRAINT IF EXISTS orcamentos_erp_operational_link_ck;

ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_erp_operational_link_ck
  CHECK (
    CASE
      WHEN erp_operational_order_id IS NULL
       AND erp_operational_source IS NULL THEN true
      WHEN erp_operational_order_id IS NOT NULL
       AND btrim(erp_operational_order_id) <> ''
       AND erp_operational_source = 'SKILLPRINT_ERP' THEN true
      ELSE false
    END
  );

DROP INDEX IF EXISTS public.idx_orcamentos_erp_operational_link;

CREATE UNIQUE INDEX idx_orcamentos_erp_operational_order_unique
  ON public.orcamentos (erp_operational_source, erp_operational_order_id)
  WHERE erp_operational_order_id IS NOT NULL;

COMMENT ON CONSTRAINT orcamentos_erp_operational_link_ck ON public.orcamentos IS
  'Allows only a fully-null link or SKILLPRINT_ERP public.vendas.id.';

CREATE OR REPLACE FUNCTION public.fn_vincular_orcamento_operacional_v1(
  p_orcamento_id uuid,
  p_vendas_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_orcamento public.orcamentos%ROWTYPE;
  v_vendas_id text;
BEGIN
  IF p_orcamento_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORCAMENTO_ID_REQUIRED');
  END IF;

  IF p_vendas_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ERP_VENDAS_ID_REQUIRED');
  END IF;

  v_vendas_id := p_vendas_id::text;

  SELECT * INTO v_orcamento
  FROM public.orcamentos
  WHERE id = p_orcamento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORCAMENTO_NOT_FOUND');
  END IF;

  IF v_orcamento.erp_operational_order_id = v_vendas_id
     AND v_orcamento.erp_operational_source = 'SKILLPRINT_ERP' THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_LINKED');
  END IF;

  IF v_orcamento.erp_operational_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'LINK_CONFLICT');
  END IF;

  BEGIN
    UPDATE public.orcamentos
    SET erp_operational_order_id = v_vendas_id,
        erp_operational_source = 'SKILLPRINT_ERP'
    WHERE id = p_orcamento_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('success', false, 'code', 'ORDER_ALREADY_LINKED');
  END;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'LINKED_SUCCESSFULLY',
    'orcamento_id', p_orcamento_id,
    'erp_operational_order_id', v_vendas_id,
    'erp_operational_source', 'SKILLPRINT_ERP'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_vincular_orcamento_operacional_v1(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_vincular_orcamento_operacional_v1(uuid, uuid) TO service_role;
