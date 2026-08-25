-- ROLLBACK R33 — restaura fn_linkar_propostas_leads ao estado de 2026-08-25
-- baseline md5(prosrc) = 2db750130c889c729fe5743ed0f44c7a  (338 bytes)
CREATE OR REPLACE FUNCTION public.fn_linkar_propostas_leads()
 RETURNS integer LANGUAGE plpgsql
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE propostas_rd pr
  SET lead_id       = li.lead_id,
      atualizado_em = now()
  FROM lead_identificadores li
  WHERE li.contact_rdstation_id = pr.contact_rdstation_id
    AND pr.lead_id IS NULL
    AND pr.contact_rdstation_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
