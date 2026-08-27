-- Regenera o dataset do replay em SHADOW da guarda de saida.
-- NAO versionar a saida: ela contem conversa real de cliente e este repo e publico.
-- Uso: rodar no projeto ldrdtaibazplvrbwyrvx, salvar o JSON e passar para provas/replay.ts.
-- Rode uma vez por fatia de data (a tabela de observacao comeca em ~16/08/2026).
with turnos as (
  select o.lead_id::text as lid, o.phone, o.created_at, o.slots_antes, o.slots_depois
  from joao_slots_observacao o
  where o.created_at >= now() - interval '8 days'          -- ajuste a fatia aqui
), msg as (
  select t.*, (select d.decisao->>'mensagem' from agente_decisoes_log d
      where d.lead_id = t.lid and d.agente_slug = 'agente-noturno'
        and d.decisao->>'mensagem' is not null
        and d.created_at between t.created_at - interval '90 seconds'
                             and t.created_at + interval '90 seconds'
      order by abs(extract(epoch from (d.created_at - t.created_at))) limit 1) as resposta
  from turnos t
)
select json_agg(json_build_object(
  'r', left(m.resposta, 300), 'sa', m.slots_antes, 'sd', m.slots_depois,
  'c', (select coalesce(json_agg(left(f.message_text, 150)), '[]'::json)
        from fact_conversations f
        where f.phone like '%' || right(m.phone, 8) and f.direction = 'inbound'
          and f.timestamp between m.created_at - interval '14 hours' and m.created_at)
))::text as dados
from msg m
-- so os turnos em que a resposta AFIRMA pedido (numero colado em mercadoria):
-- sao os unicos em que a guarda pode disparar.
where m.resposta ~* '[0-9]{1,6}[[:space:]]*(x[[:space:]]*)?(un\M|und\M|unid|pe[çc]a|camiset|baby|regata|moleton|polo|jaleco|uniforme|adesivo|copo|caneca|garrafa|iten|p[çc]s|pcs|folha|metro)';
