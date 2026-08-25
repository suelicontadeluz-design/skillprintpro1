-- R33 — guarda de unicidade. Unica mudanca: o AND (SELECT count(DISTINCT ...)) = 1
-- Impede que um contact_rdstation_id compartilhado por varios leads resolva
-- arbitrariamente via UPDATE...FROM com join nao-unico.
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
    AND pr.contact_rdstation_id IS NOT NULL
    AND (SELECT count(DISTINCT li2.lead_id)
           FROM lead_identificadores li2
          WHERE li2.contact_rdstation_id = pr.contact_rdstation_id) = 1;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
