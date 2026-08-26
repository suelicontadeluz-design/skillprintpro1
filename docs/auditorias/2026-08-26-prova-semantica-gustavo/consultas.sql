-- Prova semantica Gustavo (agente-midia) — 26/08/2026
-- Projeto: ldrdtaibazplvrbwyrvx. TODAS as consultas sao SELECT. Zero escrita.
-- Reproduzir na ordem. Nenhuma depende de now(): o conjunto e estavel.

-- [C0] Frame economico. ATENCAO: 'motivo' tem DOIS formatos.
--      Cobrir apenas um deles foi o defeito da auditoria de 25/08.
--        formato A: 'ROAS 0x | gasto R$605'
--        formato B: 'ROAS 0x com R$2798.8 gastos — abaixo do minimo aceitavel'
CREATE OR REPLACE VIEW __nao_criar AS SELECT 1; -- NAO EXECUTAR: exemplo apenas
-- Use inline, sem criar objeto:
WITH src AS (
  SELECT l.*, l.decisao->>'acao' AS acao, l.decisao->>'motivo' AS motivo,
         l.contexto->>'campaign_id' AS camp,
         NULLIF(substring(l.decisao->>'motivo' from 'ROAS ([0-9.]+)x'),'')::numeric AS roas,
         COALESCE(
           NULLIF(substring(l.decisao->>'motivo' from 'gasto R\$([0-9.]+)'),'')::numeric,
           NULLIF(substring(l.decisao->>'motivo' from 'com R\$([0-9.]+) gastos'),'')::numeric
         ) AS gasto
  FROM agente_decisoes_log l WHERE l.agente_slug='agente-midia')
SELECT count(*) FROM src;  -- 655

-- [C1] Populacao BOM_ANCHOR, definida SO por economia (nunca por feedback/status).
--      Regra: pausar_campanha AND roas < 0.5 AND gasto > 300  =>  55 linhas, 6 campanhas.
--      Nao filtrar por feedback: isso contamina a classe com a variavel procedimental.

-- [C2] Amostra BOM_ANCHOR = 18. Determinista, 3 por campanha:
--      row_number() OVER (PARTITION BY camp ORDER BY md5(id::text)) <= 3
--      md5(id) da ordenacao pseudo-aleatoria estavel e auditavel (sem random()).

-- [C3] Amostra dos 22. Estratos disjuntos, mesmo criterio md5:
--      S2 pausar_campanha roas>=0.5           -> 4
--      S3 escalar_orcamento feedback aprovada -> 2
--      S4 escalar_orcamento roas>=2.0         -> 4
--      S5 escalar_orcamento roas<2.0          -> 3
--      S6 criar_publico                       -> 4
--      S7 escalar_orcamento dry_run           -> 1
--      S8 sem acao (nenhum/nao_proposto/etc)  -> 4
--      NOTA: o estrato S1 previsto (pausa roas<0.5 com gasto<=300) esvaziou apos
--      corrigir o regex — as 55 tem gasto>300. As 5 vagas foram para S6 e S8.

-- [C4] LABEL DO CRITERIO — reproducao fiel das 3 camadas vivas.
--      Camada 1 trg_auto_acerto  : resultado -> acerto_mecanico
--      Camada 2 fn_ricardo_fechar_acertos : status da aprovacao -> acerto
--      Camada 3 fn_sinal_qualidade_decisoes : filtro de "julgavel"
--      Camada 4 fn_avaliar_autonomia_proposta : agregacao (nao aplicavel por decisao)
WITH src AS (SELECT l.* FROM agente_decisoes_log l WHERE l.agente_slug='agente-midia')
SELECT id,
  CASE
    WHEN COALESCE(feedback,'') ILIKE '%nao e decisao real%' THEN 'INCONCLUSIVO'
    WHEN acerto IS NOT NULL
     AND acerto IS DISTINCT FROM (CASE
           WHEN resultado IN ('sucesso','executada','convertida','aprovado','enviada','qualificado','ok') THEN true
           WHEN resultado IN ('falha','falhou','erro','rejeitado','falha_critica') THEN false END)
     AND atribuicao_tipo IS NULL AND regra_atribuicao IS NULL
     AND COALESCE(feedback,'') NOT ILIKE 'Outra decisao mais proxima%'
     AND COALESCE(feedback,'') NOT ILIKE 'Atribuicao automatica via fn_atribuir%'
     AND COALESCE(feedback,'') <> ''
      THEN CASE WHEN acerto THEN 'BOM' ELSE 'RUIM' END
    ELSE 'INCONCLUSIVO' END AS label_criterio
FROM src;

-- [C5] TESTE DE PROXY. Cruza a variavel procedimental com o label do criterio
--      sobre as 655 decisoes. Resultado: mapeamento 1:1 sem excecao.
--        expirou      -> RUIM          114/114
--        aprovada     -> BOM             5/5
--        dry_run      -> INCONCLUSIVO   16/16
--        sem_veredito -> INCONCLUSIVO 520/520

-- [C6] REFUTACAO. A atribuicao funciona em cada campanha?
--      Se a campanha ja registrou ROAS >= 1.0 alguma vez, ROAS 0 nela e real.
--        230052 pico 4.33 -> atribuicao OK
--        910257 pico 8.61 -> atribuicao OK
--        970257 pico 2.11 -> atribuicao OK
--        090257 pico 0.00 -> NAO verificavel
--        470257 pico 0.72 -> NAO verificavel
--        560257 pico 0.01 -> NAO verificavel
