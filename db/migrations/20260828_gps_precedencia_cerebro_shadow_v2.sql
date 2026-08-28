-- GPS / selecao autonoma do Worker
-- Objetivo: fechar a UNICA lacuna de precedencia que bloqueava a trilha "governanca".
--
-- NATUREZA DA MUDANCA: extensao mecanica conservadora. NAO e decisao de negocio,
-- NAO e atribuida ao dono e NAO altera nenhuma ordem relativa ja decidida.
--
-- Regra reutilizada (ja existente e ja aplicada antes neste banco):
--   fonte = 'gps_extensao_conservadora_politica_v1_2026-08-20'
--   precedente = identidade/contrato-autoria-corpus (precedencia 4)
--
-- Fundamento factual:
--   A decisao do dono 'decisao_dono_precedencia_governanca_2026-08-20' enumerou
--   explicitamente "posicao N de 5" para as 5 frentes P3 de governanca entao existentes:
--     crons-sucesso-sem-efeito=7, claim-recusa-sem-observabilidade=8,
--     frentes-delete-quebrado-trigger-auditoria=9, regra-fato-versus-interpretacao=10,
--     qualidade-contexto-frentes-continua=11.
--   A frente 'cerebro-shadow-v2-observador-passivo' foi criada em 2026-08-24,
--   DEPOIS dessa decisao. Logo nao foi omitida pelo dono: ela nao existia.
--   Encaixada APOS todo o bloco decidido pelo dono.
--
-- PROVA DE NAO-ARBITRARIEDADE:
--   A vencedora resultante e 'crons-sucesso-sem-efeito', que e a propria
--   "posicao 1 de 5" declarada pelo dono. O resultado e INVARIANTE a qualquer
--   valor > 11 atribuido aqui: testado em transacao revertida com 12 e com 999,
--   mesma vencedora. O valor 12 nao expressa juizo sobre esta frente.
--
-- ROLLBACK:
--   DELETE FROM public.gps_frente_precedencia
--    WHERE frente_slug = 'cerebro-shadow-v2-observador-passivo';

INSERT INTO public.gps_frente_precedencia
  (frente_slug, trilha, precedencia, ativo, fonte, motivo, atualizada_por)
VALUES (
  'cerebro-shadow-v2-observador-passivo',
  'governanca',
  12,
  true,
  'gps_extensao_conservadora_politica_v1_2026-08-20',
  'EXTENSAO MECANICA CONSERVADORA - ver cabecalho da migration. Frente criada em 2026-08-24, depois da decisao do dono de 2026-08-20. Encaixada apos o bloco decidido, sem alterar ordem relativa. Vencedora invariante a qualquer valor > 11.',
  'claude-20260828-selecao-autonoma-ambiguidade'
);
