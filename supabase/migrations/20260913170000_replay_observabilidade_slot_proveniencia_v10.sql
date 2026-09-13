-- ============================================================================
-- Harness de replay v10 — E1 (observabilidade de slot e proveniência)
--                       + E3 (separar "chegou ao modelo" de "guard interrompeu")
--
-- Projeto: ldrdtaibazplvrbwyrvx (cérebro-vendas).  NÃO é o ERP.
-- Contexto: no ciclo 920aedd5-fd26-4529-b651-2861403aac1d, `candidato_slots` veio
-- null em 31 de 31 execuções e 11 casos custaram US$ 0 sem que houvesse campo que
-- separasse "o modelo decidiu" de "um guard interrompeu". Esta migration cria o
-- lugar onde essas duas coisas passam a ser gravadas, e a regra que impede que a
-- ausência de proveniência seja lida como aprovação.
--
-- NÃO toca no núcleo do João, nem em `agente-noturno`, nem em nenhuma edge viva.
-- Não altera `go_ai_dev_config`: `allow_replay_execution` continua false.
-- ============================================================================

-- (a migration roda dentro da transação do runner; sem BEGIN/COMMIT explícitos)

-- ─────────────────────────── E1: colunas de proveniência ───────────────────────────

alter table public.replay_execucao
  add column if not exists candidato_produto_proveniencia jsonb;

comment on column public.replay_execucao.candidato_produto_proveniencia is
  'E1/v10. Proveniência do produto resolvido ao fim do turno: '
  '{produto, produto_macro, fonte, fonte_detalhe, promovido, conhecimento, evidencias[], macro_sem_fonte}. '
  '`fonte` é vocabulário FECHADO (ver replay_fonte_produto_valida). '
  '`conhecimento` distingue promovido_ao_estado de apenas_conhecido.';

comment on column public.replay_execucao.candidato_slots is
  'E1/v10. Slots resolvidos ao fim do turno: {produto, produto_macro, macro_origem, origem_leitura, slots}. '
  '`origem_leitura` diz de onde o harness leu: escrita_estado_tentada (payload que a jaula bloqueou, '
  'isto é, o estado que produção teria gravado), resposta_handler, palco_estado_anterior ou ausente.';

-- ─────────────────────────── E3: guard × modelo ───────────────────────────

alter table public.replay_execucao
  add column if not exists chegou_ao_modelo  boolean,
  add column if not exists guard_interruptor text,
  add column if not exists model_call_count  integer;

comment on column public.replay_execucao.chegou_ao_modelo is
  'E3/v10. true quando houve ao menos uma chamada a /v1/messages nesta execução.';
comment on column public.replay_execucao.guard_interruptor is
  'E3/v10. Guard do núcleo v288 que encerrou o turno antes do modelo: '
  'cliente_comprador | agente_pausado | sem_conteudo. null = nenhum guard interrompeu.';
comment on column public.replay_execucao.model_call_count is
  'E3/v10. Quantidade de chamadas ao modelo. Custo US$ 0 com model_call_count=0 deixa de ser ambíguo.';

-- ─────────────────────────── vocabulários fechados ───────────────────────────

create or replace function public.replay_fonte_produto_valida(p_fonte text)
returns boolean language sql immutable as $$
  select p_fonte is not null and p_fonte in
    ('mensagem_cliente','estado_anterior','canonico','anuncio','modelo','nenhuma');
$$;

comment on function public.replay_fonte_produto_valida(text) is
  'E1/v10. Vocabulário FECHADO de fonte de produto. `nenhuma` é valor válido de registro '
  'mas NÃO é fonte identificável — ver fn_replay_veredito_produto_v10.';

create or replace function public.replay_fonte_produto_identificavel(p_fonte text)
returns boolean language sql immutable as $$
  select p_fonte is not null and p_fonte in
    ('mensagem_cliente','estado_anterior','canonico','anuncio','modelo');
$$;

comment on function public.replay_fonte_produto_identificavel(text) is
  'E1/v10. Subconjunto que conta como fonte identificável. `nenhuma`, null e qualquer '
  'string fora do vocabulário são NÃO identificáveis.';

alter table public.replay_execucao
  drop constraint if exists replay_execucao_guard_interruptor_check;
alter table public.replay_execucao
  add constraint replay_execucao_guard_interruptor_check
  check (guard_interruptor is null
         or guard_interruptor in ('cliente_comprador','agente_pausado','sem_conteudo'));

alter table public.replay_execucao
  drop constraint if exists replay_execucao_model_call_count_check;
alter table public.replay_execucao
  add constraint replay_execucao_model_call_count_check
  check (model_call_count is null or model_call_count >= 0);

-- chegou_ao_modelo e model_call_count não podem contar histórias diferentes.
alter table public.replay_execucao
  drop constraint if exists replay_execucao_modelo_coerente_check;
alter table public.replay_execucao
  add constraint replay_execucao_modelo_coerente_check
  check (chegou_ao_modelo is null or model_call_count is null
         or chegou_ao_modelo = (model_call_count > 0));

alter table public.replay_execucao
  drop constraint if exists replay_execucao_proveniencia_fonte_check;
alter table public.replay_execucao
  add constraint replay_execucao_proveniencia_fonte_check
  check (candidato_produto_proveniencia is null
         or candidato_produto_proveniencia->>'fonte' is null
         or public.replay_fonte_produto_valida(candidato_produto_proveniencia->>'fonte'));

-- ─────────────────────────── veredito INCONCLUSIVE ───────────────────────────

alter table public.replay_execucao
  drop constraint if exists replay_execucao_veredito_check;
alter table public.replay_execucao
  add constraint replay_execucao_veredito_check
  check (veredito = any (array['MELHOROU','EQUIVALENTE','REGREDIU','INDETERMINADO','INCONCLUSIVE']));

-- ─────────────────────────── A REGRA DURA ───────────────────────────
-- "produto_macro preenchido SEM fonte identificável ⇒ veredito INCONCLUSIVE.
--  Nunca PASS."  — Alessandro, 13/09/2026.
--
-- Fica em três camadas, de propósito:
--   1. no harness  (observabilidade-v10.ts :: aplicarRegraProduto)
--   2. nesta função, usada pelo ingestor
--   3. nesta CHECK, que o banco recusa violar mesmo por INSERT direto.
-- Não depende de julgamento humano em nenhuma delas.

create or replace function public.fn_replay_veredito_produto_v10(
  p_produto_macro text,
  p_fonte         text,
  p_veredito_base text default null,
  p_pass_base     boolean default false
) returns jsonb
language sql immutable as $$
  select case
    when coalesce(nullif(btrim(p_produto_macro),''), null) is not null
     and not public.replay_fonte_produto_identificavel(p_fonte)
    then jsonb_build_object(
      'veredito','INCONCLUSIVE',
      'pass', false,
      'motivo', format(
        'produto_macro=%s sem fonte identificável (fonte=%s). Aceite de produto é inmensurável nesta execução: INCONCLUSIVE, nunca PASS.',
        btrim(p_produto_macro), coalesce(nullif(btrim(p_fonte),''),'ausente')),
      'regra_aplicada','produto_macro_sem_fonte')
    else jsonb_build_object(
      'veredito', coalesce(nullif(btrim(p_veredito_base),''),'INDETERMINADO'),
      'pass', coalesce(p_pass_base,false),
      'motivo','Regra de proveniência de produto não se aplica.',
      'regra_aplicada','nenhuma')
  end;
$$;

comment on function public.fn_replay_veredito_produto_v10(text,text,text,boolean) is
  'E1/v10. Regra dura: produto_macro preenchido sem fonte identificável ⇒ INCONCLUSIVE e pass=false. '
  'Nunca devolve PASS nesse caso, qualquer que seja o veredito-base.';

alter table public.replay_execucao
  drop constraint if exists replay_execucao_produto_macro_exige_fonte;
alter table public.replay_execucao
  add constraint replay_execucao_produto_macro_exige_fonte
  check (
    coalesce(btrim(candidato_slots->>'produto_macro'),'') = ''
    or public.replay_fonte_produto_identificavel(candidato_produto_proveniencia->>'fonte')
    or veredito = 'INCONCLUSIVE'
  );

comment on constraint replay_execucao_produto_macro_exige_fonte on public.replay_execucao is
  'E1/v10. Última trava da regra dura: nenhuma linha com produto_macro e sem fonte identificável '
  'entra no banco com veredito diferente de INCONCLUSIVE.';

-- ─────────────────────────── ingestor canônico ───────────────────────────
-- O harness não escreve no banco (a jaula bloqueia escrita). Quem grava é o runner,
-- e até 13/09 ele fazia INSERT direto — foi assim que `candidato_slots` ficou null
-- em 31 de 31. Daqui em diante o caminho é este, e ele preenche tudo a partir do
-- payload que o harness devolve.

create or replace function public.fn_replay_registrar_execucao_v10(
  p_ciclo_id        uuid,
  p_caso_id         uuid,
  p_tentativa       integer,
  p_payload         jsonb,                 -- resposta do harness (modo=executar)
  p_veredito_base   text    default null,  -- de fn_replay_comparar
  p_veredito_motivo text    default null,
  p_pass_base       boolean default false,
  p_executado_por   text    default 'harness-v3',
  p_candidate_sha   text    default null,
  p_candidate_diff  text    default null
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_slots        jsonb := p_payload -> 'candidato_slots';
  v_prov         jsonb := p_payload -> 'candidato_produto_proveniencia';
  v_macro        text  := btrim(coalesce(v_slots ->> 'produto_macro',''));
  v_fonte        text  := v_prov ->> 'fonte';
  v_regra        jsonb;
  v_guard        text  := p_payload ->> 'guard_interruptor';
  v_calls        integer := coalesce((p_payload ->> 'model_call_count')::integer, 0);
  v_custo        numeric := coalesce((p_payload #>> '{anthropic,custo_usd}')::numeric, 0);
  v_efeito_zero  boolean;
  v_id           uuid;
begin
  if p_payload is null then
    raise exception 'PAYLOAD_OBRIGATORIO: sem a resposta do harness não há o que registrar';
  end if;

  v_regra := public.fn_replay_veredito_produto_v10(
               nullif(v_macro,''), v_fonte, p_veredito_base, p_pass_base);

  -- efeito zero: nenhuma leitura nativa em tabela mutável e nenhum bloqueio de escrita
  -- que tenha escapado. `bloqueios` é o registro do que FOI barrado — ele é esperado.
  v_efeito_zero := coalesce((p_payload ->> 'nativo_em_mutavel')::integer, 0) = 0;

  insert into public.replay_execucao (
    ciclo_id, caso_id, tentativa, candidate_sha, candidate_diff, modo, as_of_usado,
    candidato_resposta, candidato_slots, candidato_tools, candidato_guardrails,
    candidato_acoes_hipoteticas,
    candidato_produto_proveniencia, chegou_ao_modelo, guard_interruptor, model_call_count,
    veredito, veredito_motivo, custo_usd, efeito_zero_ok, erro, executado_por
  ) values (
    p_ciclo_id,
    p_caso_id,
    p_tentativa,
    p_candidate_sha,
    p_candidate_diff,
    'shadow',
    coalesce((p_payload #>> '{palco,as_of}')::timestamptz,
             (select as_of from public.replay_caso where id = p_caso_id)),
    p_payload #>> '{resposta,json}',
    v_slots,
    p_payload #> '{resposta,json,tools}',
    jsonb_strip_nulls(jsonb_build_object(
      'inner_status',      p_payload #>> '{resposta,status}',
      'json_invalido',     p_payload -> 'json_invalido',
      'nativo_em_mutavel', p_payload -> 'nativo_em_mutavel',
      'palco_versao',      p_payload #> '{palco,versao_palco}',
      'palco_futuro',      p_payload -> 'palco_futuro',
      'inconsistencias',   p_payload -> 'observabilidade_inconsistencias'
    )),
    p_payload -> 'bloqueios',          -- o que teria saído se não houvesse jaula
    v_prov,
    coalesce((p_payload ->> 'chegou_ao_modelo')::boolean, v_calls > 0),
    nullif(btrim(coalesce(v_guard,'')),''),
    v_calls,
    v_regra ->> 'veredito',
    coalesce(
      case when v_regra ->> 'regra_aplicada' = 'produto_macro_sem_fonte'
           then v_regra ->> 'motivo' else p_veredito_motivo end,
      v_regra ->> 'motivo'),
    v_custo,
    v_efeito_zero,
    p_payload ->> 'erro',
    p_executado_por
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'execucao_id', v_id,
    'veredito', v_regra ->> 'veredito',
    'pass', (v_regra ->> 'pass')::boolean,
    'regra_aplicada', v_regra ->> 'regra_aplicada',
    'candidato_slots', v_slots,
    'proveniencia', v_prov,
    'chegou_ao_modelo', coalesce((p_payload ->> 'chegou_ao_modelo')::boolean, v_calls > 0),
    'guard_interruptor', nullif(btrim(coalesce(v_guard,'')),''),
    'model_call_count', v_calls);
end
$function$;

comment on function public.fn_replay_registrar_execucao_v10(uuid,uuid,integer,jsonb,text,text,boolean,text,text,text) is
  'E1+E3/v10. Único caminho de gravação de replay_execucao. Preenche candidato_slots, '
  'candidato_produto_proveniencia, chegou_ao_modelo, guard_interruptor e model_call_count '
  'a partir da resposta do harness, e reaplica a regra dura de produto antes de gravar.';

-- ─────────────────────────── leitura de aceite ───────────────────────────

create or replace view public.vw_replay_observabilidade_v10 as
select
  e.ciclo_id,
  e.caso_id,
  e.tentativa,
  e.executado_em,
  e.candidato_slots ->> 'produto'         as produto,
  e.candidato_slots ->> 'produto_macro'   as produto_macro,
  e.candidato_slots ->> 'origem_leitura'  as origem_leitura,
  e.candidato_produto_proveniencia ->> 'fonte'         as fonte,
  e.candidato_produto_proveniencia ->> 'fonte_detalhe' as fonte_detalhe,
  (e.candidato_produto_proveniencia ->> 'promovido')::boolean as promovido,
  e.candidato_produto_proveniencia ->> 'conhecimento'  as conhecimento,
  public.replay_fonte_produto_identificavel(e.candidato_produto_proveniencia ->> 'fonte') as fonte_identificavel,
  e.chegou_ao_modelo,
  e.guard_interruptor,
  e.model_call_count,
  e.custo_usd,
  e.veredito
from public.replay_execucao e;

comment on view public.vw_replay_observabilidade_v10 is
  'E1+E3/v10. Uma linha por execução com o que o aceite cobra, já desempacotado.';

