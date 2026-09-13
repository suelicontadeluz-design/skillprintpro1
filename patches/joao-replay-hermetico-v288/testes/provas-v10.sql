-- ============================================================================
-- Provas do aceite v10 — rodar em ldrdtaibazplvrbwyrvx (cérebro-vendas).
-- Nenhuma delas executa replay. Nenhuma escreve fora de rollback.
-- ============================================================================

-- ─────────────────────────── E1 · regra dura, tabela-verdade ───────────────────────────
-- Esperado: INCONCLUSIVE/pass=false nas 5 primeiras; veredito-base preservado nas demais.
select caso, r->>'veredito' as veredito, (r->>'pass')::boolean as pass, r->>'regra_aplicada' as regra
from (values
  ('base MELHOROU + fonte nenhuma',   public.fn_replay_veredito_produto_v10('dtf_textil','nenhuma','MELHOROU',true)),
  ('base EQUIVALENTE + fonte nenhuma',public.fn_replay_veredito_produto_v10('dtf_textil','nenhuma','EQUIVALENTE',true)),
  ('base MELHOROU + fonte null',      public.fn_replay_veredito_produto_v10('dtf_uv',null,'MELHOROU',true)),
  ('base MELHOROU + fonte vazia',     public.fn_replay_veredito_produto_v10('dtf_uv','','MELHOROU',true)),
  ('base MELHOROU + fonte inventada', public.fn_replay_veredito_produto_v10('camiseta','chute','MELHOROU',true)),
  ('fonte mensagem_cliente',          public.fn_replay_veredito_produto_v10('dtf_textil','mensagem_cliente','MELHOROU',true)),
  ('fonte estado_anterior',           public.fn_replay_veredito_produto_v10('dtf_textil','estado_anterior','EQUIVALENTE',true)),
  ('fonte canonico',                  public.fn_replay_veredito_produto_v10('dtf_textil','canonico','MELHOROU',true)),
  ('fonte anuncio',                   public.fn_replay_veredito_produto_v10('dtf_textil','anuncio','MELHOROU',true)),
  ('fonte modelo',                    public.fn_replay_veredito_produto_v10('dtf_textil','modelo','MELHOROU',true)),
  ('sem produto_macro',               public.fn_replay_veredito_produto_v10(null,'nenhuma','EQUIVALENTE',true))
) t(caso, r);

-- ─────────────────── E1 + E3 · fim-a-fim, com ROLLBACK proposital ───────────────────
-- Grava pelo ingestor, lê de volta, tenta burlar por INSERT direto e aborta tudo.
-- A saída vem na mensagem da exceção ROLLBACK_PROPOSITAL. Nada fica no banco.
do $$
declare
  v_ciclo uuid := '920aedd5-fd26-4529-b651-2861403aac1d';
  v_caso  uuid;
  v_payload jsonb; v_r1 jsonb; v_r2 jsonb; v_lin record;
  v_bypass text := 'NAO_TESTADO'; v_out jsonb;
begin
  select id into v_caso from public.replay_caso
   where id in (select caso_id from public.replay_palco_congelado) limit 1;

  v_payload := jsonb_build_object(
    'candidato_slots', jsonb_build_object('produto','dtf_textil','produto_macro','dtf_textil',
        'macro_origem','igual_ao_produto','origem_leitura','resposta_handler'),
    'candidato_produto_proveniencia', jsonb_build_object('produto','dtf_textil','produto_macro','dtf_textil',
        'fonte','nenhuma','fonte_detalhe',null,'promovido',false,
        'conhecimento','apenas_conhecido','macro_sem_fonte',true),
    'chegou_ao_modelo', true, 'model_call_count', 2, 'guard_interruptor', null,
    'nativo_em_mutavel', 0,
    'resposta', jsonb_build_object('status',200,'json', jsonb_build_object('responde',true)),
    'palco', jsonb_build_object('versao_palco',3,'as_of', now()),
    'anthropic', jsonb_build_object('custo_usd', 0.0123));

  -- (A) produto_macro sem fonte, com veredito-base MELHOROU/pass=true
  v_r1 := public.fn_replay_registrar_execucao_v10(v_ciclo, v_caso, 99, v_payload, 'MELHOROU', 'base diz que melhorou', true, 'prova-v10');

  -- (B) mesma execução com fonte identificável + guard registrado
  v_payload := jsonb_set(v_payload, '{candidato_produto_proveniencia,fonte}', '"mensagem_cliente"');
  v_payload := jsonb_set(v_payload, '{guard_interruptor}', '"cliente_comprador"');
  v_payload := jsonb_set(v_payload, '{chegou_ao_modelo}', 'false');
  v_payload := jsonb_set(v_payload, '{model_call_count}', '0');
  v_r2 := public.fn_replay_registrar_execucao_v10(v_ciclo, v_caso, 98, v_payload, 'MELHOROU', 'base diz que melhorou', true, 'prova-v10');

  -- (C) tentativa de burlar a regra por INSERT direto
  begin
    insert into public.replay_execucao (ciclo_id, caso_id, tentativa, modo, as_of_usado,
      candidato_slots, candidato_produto_proveniencia, veredito, custo_usd, executado_por)
    values (v_ciclo, v_caso, 97, 'shadow', now(),
      '{"produto_macro":"dtf_textil"}'::jsonb, '{"fonte":"nenhuma"}'::jsonb, 'MELHOROU', 0, 'prova-v10');
    v_bypass := 'FALHA_GRAVE: o banco aceitou MELHOROU sem fonte';
  exception when check_violation then
    v_bypass := 'RECUSADO pela constraint: ' || SQLERRM;
  end;

  select * into v_lin from public.vw_replay_observabilidade_v10 where ciclo_id=v_ciclo and tentativa=98;

  v_out := jsonb_build_object(
    'A_macro_sem_fonte', jsonb_build_object('veredito', v_r1->>'veredito', 'pass', v_r1->'pass', 'regra', v_r1->>'regra_aplicada'),
    'B_macro_com_fonte', jsonb_build_object('veredito', v_r2->>'veredito', 'pass', v_r2->'pass', 'regra', v_r2->>'regra_aplicada'),
    'B_persistido', jsonb_build_object('produto', v_lin.produto, 'produto_macro', v_lin.produto_macro,
        'fonte', v_lin.fonte, 'fonte_identificavel', v_lin.fonte_identificavel, 'promovido', v_lin.promovido,
        'conhecimento', v_lin.conhecimento, 'chegou_ao_modelo', v_lin.chegou_ao_modelo,
        'guard_interruptor', v_lin.guard_interruptor, 'model_call_count', v_lin.model_call_count,
        'origem_leitura', v_lin.origem_leitura),
    'C_insert_direto', v_bypass);

  raise exception 'ROLLBACK_PROPOSITAL %', v_out::text;
end $$;

-- confirma que nada ficou
select count(*) as residuo_da_prova from public.replay_execucao where executado_por='prova-v10';

-- ─────────────────────────── E2 · CRITÉRIO DE ACEITE ───────────────────────────
-- Esperado: versao_palco=3 com eventos_posteriores = 0 e casos_limpos = 31.
-- A linha de versao_palco=1 fica no resultado de propósito: prova que o palco
-- anterior não foi apagado nem alterado.
select versao_palco,
       count(*)                                        casos,
       sum(eventos_posteriores)                        eventos_posteriores,
       count(*) filter (where eventos_posteriores = 0) casos_limpos,
       count(*) filter (where eventos_posteriores > 0) casos_contaminados,
       sum(referencia_posterior)                       referencia_posterior_declarada
from public.fn_replay_palco_futuro_v1()
group by versao_palco order by versao_palco;

-- detalhe por caso, quando algum voltar diferente de 0
select caso_id, versao_palco, as_of, eventos_posteriores, por_campo
from public.fn_replay_palco_futuro_v1(null, 3)
where eventos_posteriores > 0;

-- ─────────────── E2 · consequência nos 4 casos contaminados por compra futura ───────────────
-- Esperado: compras_no_palco = 0 na versao_palco=3 para 3b3560fe, 769fb38a, 9c8a13d3, 3c91e46a.
with ev as (
  select p.caso_id, p.versao_palco, p.as_of, e.value as evento
  from public.replay_palco_congelado p,
       lateral jsonb_array_elements(coalesce(p.estado->'pixel_events','[]'::jsonb)) e
  where left(p.caso_id::text,8) in ('3b3560fe','769fb38a','9c8a13d3','3c91e46a')
)
select left(caso_id::text,8) caso, versao_palco,
       count(*)                                                            eventos_no_palco,
       count(*) filter (where evento->>'event_name' ilike '%purchase%')     compras_no_palco,
       count(*) filter (where (evento->>'event_time')::timestamptz > as_of) eventos_apos_as_of
from ev group by 1,2 order by 1,2;

-- ─────────────────────────── trava de execução ───────────────────────────
-- Esperado: allow_replay_execution = false. Esta entrega NÃO a reabre.
select nome, allow_production_write, allow_edge_function_patch, allow_replay_execution
from public.go_ai_dev_config where nome='default';
