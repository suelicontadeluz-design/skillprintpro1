-- ROLLBACK R13. A funcao e NOVA e nao tinha versao anterior: o rollback e o DROP.
-- Blast radius nulo: nenhum objeto do banco referencia esta funcao, nenhum cron a
-- chama, nenhuma edge a chama. Ela so existe para ser chamada explicitamente.
--
-- Se ja tiver sido usada em producao, o DROP NAO apaga as intervencoes registradas
-- (ficam em crm_campaign_audiences) nem a campanha. Para reverter tambem os dados,
-- rodar as linhas comentadas abaixo, nesta ordem, e SOMENTE se for essa a intencao.

DROP FUNCTION IF EXISTS public.fn_exp001_registrar_intervencao(uuid, boolean, text);

-- Reversao de dados (opcional, destrutiva, revisar antes):
-- delete from public.waba_disparos_lista w
--  where w.campaign_audience_id in (
--    select a.id from public.crm_campaign_audiences a
--    join public.crm_campaigns c on c.id = a.campaign_id
--    where c.slug = 'EXP-001-REAQUECIMENTO-31-45D')
--    and w.status not in ('enviado');   -- NUNCA apagar registro de algo ja enviado
-- delete from public.crm_campaign_audiences a
--  using public.crm_campaigns c
--  where c.id = a.campaign_id and c.slug = 'EXP-001-REAQUECIMENTO-31-45D';
-- delete from public.crm_campaigns where slug = 'EXP-001-REAQUECIMENTO-31-45D';
