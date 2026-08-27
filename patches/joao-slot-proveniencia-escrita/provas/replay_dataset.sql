-- Regenera o dataset do replay em SHADOW da PORTA DE ESCRITA (fase 1).
-- NAO versionar a saida: contem conversa real de cliente e este repo e publico.
-- Rode por fatia de data (joao_slots_observacao comeca em ~16/08/2026) e concatene.
with turnos as (
  select o.lead_id::text as lid, o.phone, o.created_at, o.slots_antes, o.slots_depois
  from joao_slots_observacao o
  where o.created_at >= now() - interval '8 days'      -- ajuste a fatia aqui
    and o.slots_depois <> '{}'::jsonb
)
select json_agg(json_build_object(
  'sa', t.slots_antes, 'sd', t.slots_depois,
  'cc', (select l.content_category from leads_marketing l where l.lead_id::text = t.lid),
  'c',  (select coalesce(json_agg(left(f.message_text, 150)), '[]'::json)
         from fact_conversations f
         where f.phone like '%' || right(t.phone, 8) and f.direction = 'inbound'
           and f.timestamp between t.created_at - interval '14 hours' and t.created_at)
))::text as dados
from turnos t;
