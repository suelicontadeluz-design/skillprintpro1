CREATE SCHEMA IF NOT EXISTS cortex_erp;

CREATE TABLE cortex_erp.orcamento_revisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE RESTRICT,
  erp_operational_source text NOT NULL,
  erp_operational_order_id text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING_STAGING',
  review_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_acceptance jsonb,
  financial_exception_kind text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz,
  CONSTRAINT orcamento_revisoes_state_ck CHECK (state IN (
    'PENDING_STAGING',
    'STAGED',
    'AWAITING_CLIENT_ACCEPTANCE',
    'COMMITTED',
    'AWAITING_FINANCIAL_EXCEPTION',
    'FAILED_NEEDS_HUMAN'
  )),
  CONSTRAINT orcamento_revisoes_link_ck CHECK (
    erp_operational_source = 'SKILLPRINT_ERP'
    AND btrim(erp_operational_order_id) <> ''
  ),
  CONSTRAINT orcamento_revisoes_exception_kind_ck CHECK (
    financial_exception_kind IS NULL
    OR financial_exception_kind IN ('CREDIT', 'REFUND')
  )
);

CREATE INDEX orcamento_revisoes_orcamento_idx
  ON cortex_erp.orcamento_revisoes (orcamento_id, created_at DESC);

CREATE INDEX orcamento_revisoes_state_idx
  ON cortex_erp.orcamento_revisoes (state, created_at ASC)
  WHERE state NOT IN ('COMMITTED', 'FAILED_NEEDS_HUMAN');

CREATE UNIQUE INDEX orcamento_revisoes_one_active_per_orcamento_uq
  ON cortex_erp.orcamento_revisoes (orcamento_id)
  WHERE state NOT IN ('COMMITTED', 'FAILED_NEEDS_HUMAN');

CREATE TABLE cortex_erp.orcamento_revisao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id uuid NOT NULL REFERENCES cortex_erp.orcamento_revisoes(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  change_kind text NOT NULL CHECK (change_kind IN ('REPLACE_FILE', 'ADD_FILE')),
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT orcamento_revisao_itens_sequence_uq UNIQUE (revisao_id, sequence_no)
);

CREATE TABLE cortex_erp.orcamento_revisao_operacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id uuid NOT NULL REFERENCES cortex_erp.orcamento_revisoes(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  operation_kind text NOT NULL CHECK (operation_kind IN (
    'CANCEL_PENDING_PAYMENT',
    'CREATE_FULL_PAYMENT',
    'CREATE_DELTA_PAYMENT'
  )),
  operation_state text NOT NULL DEFAULT 'PLANNED' CHECK (operation_state IN ('PLANNED', 'VOID')),
  amount_brl numeric(18,2),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT orcamento_revisao_operacoes_sequence_uq UNIQUE (revisao_id, sequence_no)
);

CREATE TABLE cortex_erp.orcamento_revisao_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id uuid NOT NULL REFERENCES cortex_erp.orcamento_revisoes(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  before_state text,
  after_state text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX orcamento_revisao_auditoria_revisao_idx
  ON cortex_erp.orcamento_revisao_auditoria (revisao_id, created_at ASC);

ALTER TABLE cortex_erp.orcamento_revisoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex_erp.orcamento_revisao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex_erp.orcamento_revisao_operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex_erp.orcamento_revisao_auditoria ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION cortex_erp.fn_revisao_require_operational_link_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, cortex_erp, public
AS $$
DECLARE
  v_source text;
  v_order_id text;
BEGIN
  SELECT erp_operational_source, erp_operational_order_id
    INTO v_source, v_order_id
  FROM public.orcamentos
  WHERE id = NEW.orcamento_id;

  IF NOT FOUND OR v_source IS NULL OR v_order_id IS NULL THEN
    RAISE EXCEPTION 'operational link required for revision' USING ERRCODE = '23514';
  END IF;

  IF v_source <> 'SKILLPRINT_ERP' OR btrim(v_order_id) = '' THEN
    RAISE EXCEPTION 'invalid operational source for revision' USING ERRCODE = '23514';
  END IF;

  NEW.erp_operational_source := v_source;
  NEW.erp_operational_order_id := v_order_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cortex_erp.fn_revisao_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, cortex_erp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING_STAGING' THEN
      RAISE EXCEPTION 'revision must start in PENDING_STAGING' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state IN ('COMMITTED', 'FAILED_NEEDS_HUMAN') THEN
    RAISE EXCEPTION 'terminal revision is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.erp_operational_source IS DISTINCT FROM OLD.erp_operational_source
     OR NEW.erp_operational_order_id IS DISTINCT FROM OLD.erp_operational_order_id THEN
    RAISE EXCEPTION 'operational link snapshot is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.state = OLD.state THEN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.state = 'PENDING_STAGING' AND NEW.state IN ('STAGED', 'FAILED_NEEDS_HUMAN')) OR
    (OLD.state = 'STAGED' AND NEW.state IN ('AWAITING_CLIENT_ACCEPTANCE', 'AWAITING_FINANCIAL_EXCEPTION', 'FAILED_NEEDS_HUMAN')) OR
    (OLD.state = 'AWAITING_CLIENT_ACCEPTANCE' AND NEW.state IN ('COMMITTED', 'AWAITING_FINANCIAL_EXCEPTION', 'FAILED_NEEDS_HUMAN')) OR
    (OLD.state = 'AWAITING_FINANCIAL_EXCEPTION' AND NEW.state IN ('COMMITTED', 'FAILED_NEEDS_HUMAN'))
  ) THEN
    RAISE EXCEPTION 'invalid revision state transition: % -> %', OLD.state, NEW.state USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'AWAITING_FINANCIAL_EXCEPTION'
     AND COALESCE(NEW.financial_exception_kind, '') NOT IN ('CREDIT', 'REFUND') THEN
    RAISE EXCEPTION 'financial exception is reserved for CREDIT or REFUND' USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'COMMITTED' THEN
    IF NEW.client_acceptance IS NULL OR jsonb_typeof(NEW.client_acceptance) <> 'object' THEN
      RAISE EXCEPTION 'client acceptance evidence required before COMMITTED' USING ERRCODE = '23514';
    END IF;
    NEW.committed_at := clock_timestamp();
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cortex_erp.fn_revisao_children_mutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, cortex_erp
AS $$
DECLARE
  v_revisao_id uuid;
  v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_revisao_id := OLD.revisao_id;
  ELSE
    v_revisao_id := NEW.revisao_id;
  END IF;

  SELECT state INTO v_state
  FROM cortex_erp.orcamento_revisoes
  WHERE id = v_revisao_id;

  IF v_state IN ('COMMITTED', 'FAILED_NEEDS_HUMAN') THEN
    RAISE EXCEPTION 'terminal revision children are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cortex_erp.fn_revisao_audit_append_only_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'revision audit is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION cortex_erp.fn_revisao_audit_state_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, cortex_erp
AS $$
BEGIN
  INSERT INTO cortex_erp.orcamento_revisao_auditoria (
    revisao_id, event_type, before_state, after_state,
    detail
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'REVISION_CREATED' ELSE 'STATE_CHANGED' END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    jsonb_build_object('orcamento_id', NEW.orcamento_id, 'erp_order_id', NEW.erp_operational_order_id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_revisao_require_operational_link
  BEFORE INSERT OR UPDATE OF orcamento_id ON cortex_erp.orcamento_revisoes
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_require_operational_link_v1();

CREATE TRIGGER trg_revisao_state_guard
  BEFORE INSERT OR UPDATE ON cortex_erp.orcamento_revisoes
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_state_guard_v1();

CREATE TRIGGER trg_revisao_audit_state
  AFTER INSERT OR UPDATE OF state ON cortex_erp.orcamento_revisoes
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_audit_state_v1();

CREATE TRIGGER trg_revisao_itens_mutable
  BEFORE INSERT OR UPDATE OR DELETE ON cortex_erp.orcamento_revisao_itens
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_children_mutable_v1();

CREATE TRIGGER trg_revisao_operacoes_mutable
  BEFORE INSERT OR UPDATE OR DELETE ON cortex_erp.orcamento_revisao_operacoes
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_children_mutable_v1();

CREATE TRIGGER trg_revisao_auditoria_append_only
  BEFORE UPDATE OR DELETE ON cortex_erp.orcamento_revisao_auditoria
  FOR EACH ROW EXECUTE FUNCTION cortex_erp.fn_revisao_audit_append_only_v1();

REVOKE ALL ON SCHEMA cortex_erp FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA cortex_erp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cortex_erp FROM PUBLIC;
GRANT USAGE ON SCHEMA cortex_erp TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cortex_erp TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cortex_erp TO service_role;
