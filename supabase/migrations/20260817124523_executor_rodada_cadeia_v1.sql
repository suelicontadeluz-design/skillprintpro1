-- ============================================================================
-- executor_rodada_cadeia_v1                          aplicada em 2026-08-17 UTC
--
-- Fecha a LACUNA DE WAKE-UP declarada no proprio corpo de fn_executor_tick:
--   "Tick deterministico: zero token de LLM. Se ha frente escolhida, ela so
--    sera trabalhada quando uma sessao Claude acordar — ver lacuna de wake-up."
--
-- O tick (cron 143, executor-tick-deterministico, */15) ja encerra esperas
-- observaveis e ja escolhe a proxima frente. O que faltava era PROVA, no banco,
-- de que uma rodada AUTOMATICAMENTE DISPARADA percorreu a cadeia inteira:
--   wake-up -> Supabase -> protocolo -> GPS -> selecao -> claim -> heartbeat
--   -> reconciliacao -> trabalho -> teste -> prova -> evidencia/ledger
--   -> fechamento ou espera -> release -> GPS de novo.
--
-- Esta migration NAO executa trabalho e NAO amplia autonomia. Nao toca em
-- executor_config (kill switch), allow_*, orcamento, GPS, claims, esperas,
-- evidencias, checkpoints nem crons. E puramente aditiva.
-- ============================================================================

create table if not exists public.executor_rodada_etapa (
  id              bigserial primary key,
  rodada_id       uuid        not null,
  chat_id         text        not null,
  origem          text        not null,
  etapa           text        not null,
  detalhe         jsonb       not null default '{}'::jsonb,
  registrado_em   timestamptz not null default now(),
  registrado_por  text        not null,
  constraint executor_rodada_etapa_origem_ck
    check (origem in ('sessao_agendada','sessao_interativa')),
  constraint executor_rodada_etapa_etapa_ck
    check (etapa in (
      'wake_up','protocolo','gps','selecao','claim','heartbeat','reconciliacao',
      'trabalho','teste','prova_independente','evidencia_ledger',
      'fechamento','espera','release','gps_novamente','parada_sem_trabalho'))
);

create index if not exists ix_executor_rodada_etapa_rodada
  on public.executor_rodada_etapa (rodada_id, registrado_em);
create index if not exists ix_executor_rodada_etapa_chat
  on public.executor_rodada_etapa (chat_id, registrado_em desc);

comment on table public.executor_rodada_etapa is
  'Append-only. Uma linha por elo da cadeia de uma rodada do executor autonomo. '
  'Auto-declaracao: por si so NAO prova nada. A prova vem de fn_executor_rodada_cadeia, '
  'que cruza cada elo com a tabela que a funcao canonica correspondente escreveu.';

-- ── APPEND-ONLY ─────────────────────────────────────────────────────────────
create or replace function public.fn_trg_executor_rodada_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'executor_rodada_etapa e append-only: % recusado', tg_op;
end $$;

drop trigger if exists trg_executor_rodada_append_only on public.executor_rodada_etapa;
create trigger trg_executor_rodada_append_only
  before update or delete on public.executor_rodada_etapa
  for each row execute function public.fn_trg_executor_rodada_append_only();

alter table public.executor_rodada_etapa enable row level security;
revoke all on public.executor_rodada_etapa from anon, authenticated;
revoke all on sequence public.executor_rodada_etapa_id_seq from anon, authenticated;

-- ── REGISTRO DE ELO ─────────────────────────────────────────────────────────
create or replace function public.fn_executor_rodada_etapa(
  p_rodada_id uuid,
  p_chat_id   text,
  p_origem    text,
  p_etapa     text,
  p_detalhe   jsonb default '{}'::jsonb
) returns jsonb
language plpgsql set search_path to 'public' as $$
declare v_id bigint;
begin
  if nullif(btrim(coalesce(p_chat_id,'')),'') is null then
    return jsonb_build_object('ok',false,'erro','chat_id_obrigatorio');
  end if;
  insert into public.executor_rodada_etapa
    (rodada_id, chat_id, origem, etapa, detalhe, registrado_por)
  values (p_rodada_id, p_chat_id, p_origem, p_etapa,
          coalesce(p_detalhe,'{}'::jsonb), p_chat_id)
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'rodada_id',p_rodada_id,'etapa',p_etapa);
end $$;

-- ── VERIFICADOR DA CADEIA ───────────────────────────────────────────────────
-- Cada elo tem duas colunas: auto_declarado (o que a sessao disse) e
-- prova_independente (o que OUTRA funcao canonica escreveu em OUTRA tabela).
-- Os elos 6, 7, 12, 13 e 14 SO passam pela prova independente: declarar sem
-- fazer da FAIL. Isso e o que impede uma rodada de fabricar o proprio sucesso.
create or replace function public.fn_executor_rodada_cadeia(p_rodada_id uuid)
returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  v_chat text; v_origem text; v_ini timestamptz; v_fim timestamptz;
  v_frente text; v_elos jsonb := '[]'::jsonb; v_falta text[] := '{}';
  v_release_em timestamptz;

  d_wake boolean; d_prot boolean; d_gps boolean; d_sel boolean; d_claim boolean;
  d_hb boolean; d_rec boolean; d_trab boolean; d_teste boolean; d_prova boolean;
  d_evid boolean; d_fech boolean; d_esp boolean; d_rel boolean; d_gps2 boolean;
  d_parada boolean;

  i_claim boolean; i_hb boolean; i_evid boolean; i_desfecho boolean;
  i_rel boolean; i_sem_claim_ativo boolean; i_frente_existe boolean;

  v_claim_ref jsonb; v_desfecho_ref jsonb; v_evid_ref jsonb;
begin
  select min(registrado_em), max(registrado_em), min(chat_id), min(origem)
    into v_ini, v_fim, v_chat, v_origem
    from public.executor_rodada_etapa where rodada_id = p_rodada_id;

  if v_chat is null then
    return jsonb_build_object('rodada_id',p_rodada_id,'veredito','FAIL',
      'motivo','rodada_inexistente');
  end if;

  select detalhe->>'frente' into v_frente
    from public.executor_rodada_etapa
   where rodada_id = p_rodada_id and etapa = 'selecao' and detalhe ? 'frente'
   order by registrado_em limit 1;

  select
    bool_or(etapa='wake_up'),            bool_or(etapa='protocolo'),
    bool_or(etapa='gps'),                bool_or(etapa='selecao'),
    bool_or(etapa='claim'),              bool_or(etapa='heartbeat'),
    bool_or(etapa='reconciliacao'),      bool_or(etapa='trabalho'),
    bool_or(etapa='teste'),              bool_or(etapa='prova_independente'),
    bool_or(etapa='evidencia_ledger'),   bool_or(etapa='fechamento'),
    bool_or(etapa='espera'),             bool_or(etapa='release'),
    bool_or(etapa='gps_novamente'),      bool_or(etapa='parada_sem_trabalho')
  into d_wake,d_prot,d_gps,d_sel,d_claim,d_hb,d_rec,d_trab,d_teste,d_prova,
       d_evid,d_fech,d_esp,d_rel,d_gps2,d_parada
  from public.executor_rodada_etapa where rodada_id = p_rodada_id;

  select max(registrado_em) into v_release_em
    from public.executor_rodada_etapa
   where rodada_id = p_rodada_id and etapa = 'release';

  select exists(select 1 from public.frentes f where f.slug = v_frente)
    into i_frente_existe;

  -- PROVA INDEPENDENTE 1: claim real gravado por fn_frente_claim
  select exists(
    select 1 from public.frentes_claims fc
      join public.frentes f on f.id = fc.frente_id
     where fc.chat_id = v_chat and f.slug = v_frente
       and fc.capturada_em >= v_ini - interval '10 minutes')
  into i_claim;

  select jsonb_build_object(
           'claim_id', fc.id, 'frente', f.slug, 'trilha', fc.trilha_execucao,
           'capturada_em', fc.capturada_em, 'heartbeat_em', fc.heartbeat_em,
           'liberada_em', fc.liberada_em, 'status', fc.status, 'desfecho', fc.desfecho)
    into v_claim_ref
    from public.frentes_claims fc join public.frentes f on f.id = fc.frente_id
   where fc.chat_id = v_chat and f.slug = v_frente
   order by fc.capturada_em desc limit 1;

  -- PROVA INDEPENDENTE 2: heartbeat gravado por fn_frente_heartbeat no historico
  select exists(
    select 1 from public.frentes_historico h
     where h.alterado_por = v_chat and h.evento in ('heartbeat','claim_renovado'))
  into i_hb;

  -- PROVA INDEPENDENTE 3: evidencia escrita por funcao canonica
  select exists(
    select 1 from public.microloops_23_ponto_evento e
     where e.registrado_por = v_chat and e.registrado_em >= v_ini - interval '10 minutes')
    or exists(
    select 1 from public.frentes f
     where f.slug = v_frente and f.validada_por = v_chat
       and f.validada_em >= v_ini - interval '10 minutes')
  into i_evid;

  select jsonb_build_object(
           'ponto_eventos', (select count(*) from public.microloops_23_ponto_evento e
                              where e.registrado_por = v_chat
                                and e.registrado_em >= v_ini - interval '10 minutes'),
           'frente_validada_por', (select f.validada_por from public.frentes f where f.slug = v_frente),
           'frente_validada_em',  (select f.validada_em  from public.frentes f where f.slug = v_frente))
    into v_evid_ref;

  -- PROVA INDEPENDENTE 4: desfecho = fechamento OU espera estruturada
  select exists(
    select 1 from public.frentes_espera fe
     where fe.aberta_por = v_chat and fe.aberta_em >= v_ini - interval '10 minutes')
    or exists(
    select 1 from public.frentes_historico h
     where h.alterado_por = v_chat
       and h.evento in ('claim_concluido','claim_liberado'))
  into i_desfecho;

  select jsonb_build_object(
           'esperas_abertas_nesta_rodada',
             (select coalesce(jsonb_agg(jsonb_build_object('id',fe.id,'frente',fe.frente_slug,'tipo',fe.tipo)),'[]'::jsonb)
                from public.frentes_espera fe
               where fe.aberta_por = v_chat and fe.aberta_em >= v_ini - interval '10 minutes'),
           'eventos_postflight',
             (select coalesce(jsonb_agg(distinct h.evento),'[]'::jsonb)
                from public.frentes_historico h
               where h.alterado_por = v_chat
                 and h.evento in ('claim_concluido','claim_liberado')))
    into v_desfecho_ref;

  -- PROVA INDEPENDENTE 5: release real e zero claim ativo residual
  select exists(
    select 1 from public.frentes_claims fc
     where fc.chat_id = v_chat and fc.liberada_em is not null
       and fc.status in ('liberado','concluido','expirado'))
  into i_rel;

  select not exists(
    select 1 from public.frentes_claims fc
     where fc.chat_id = v_chat and fc.status = 'ativo' and fc.expira_em > now())
  into i_sem_claim_ativo;

  v_elos :=
    jsonb_build_array(
      jsonb_build_object('elo','1_wake_up_agendado','auto_declarado',coalesce(d_wake,false),
        'prova_independente', v_origem = 'sessao_agendada',
        'fonte','executor_rodada_etapa.origem',
        'ok', coalesce(d_wake,false) and v_origem = 'sessao_agendada'),
      jsonb_build_object('elo','2_supabase','auto_declarado',true,
        'prova_independente', true,
        'fonte','a propria existencia das linhas desta rodada e escrita via Supabase',
        'ok', true),
      jsonb_build_object('elo','3_protocolo','auto_declarado',coalesce(d_prot,false),
        'prova_independente', null, 'fonte','fn_contexto_codex_frentes (leitura)',
        'ok', coalesce(d_prot,false)),
      jsonb_build_object('elo','4_gps','auto_declarado',coalesce(d_gps,false),
        'prova_independente', null, 'fonte','fn_gps_panorama / fn_executor_proxima_tarefa (leitura)',
        'ok', coalesce(d_gps,false)),
      jsonb_build_object('elo','5_selecao_legitima','auto_declarado',coalesce(d_sel,false),
        'prova_independente', coalesce(i_frente_existe,false),
        'fonte','public.frentes', 'frente', v_frente,
        'ok', coalesce(d_sel,false) and coalesce(i_frente_existe,false)),
      jsonb_build_object('elo','6_claim_real','auto_declarado',coalesce(d_claim,false),
        'prova_independente', coalesce(i_claim,false),
        'fonte','public.frentes_claims (escrita por fn_frente_claim)',
        'referencia', v_claim_ref,
        'ok', coalesce(i_claim,false)),
      jsonb_build_object('elo','7_heartbeat','auto_declarado',coalesce(d_hb,false),
        'prova_independente', coalesce(i_hb,false),
        'fonte','public.frentes_historico (escrita por fn_frente_heartbeat)',
        'ok', coalesce(i_hb,false)),
      jsonb_build_object('elo','8_reconciliacao_runtime','auto_declarado',coalesce(d_rec,false),
        'prova_independente', null, 'fonte','leitura do estado real',
        'ok', coalesce(d_rec,false)),
      jsonb_build_object('elo','9_trabalho_real','auto_declarado',coalesce(d_trab,false),
        'prova_independente', null, 'fonte','detalhe da etapa trabalho',
        'ok', coalesce(d_trab,false)),
      jsonb_build_object('elo','10_teste','auto_declarado',coalesce(d_teste,false),
        'prova_independente', null, 'fonte','detalhe da etapa teste',
        'ok', coalesce(d_teste,false)),
      jsonb_build_object('elo','11_prova_independente','auto_declarado',coalesce(d_prova,false),
        'prova_independente', null, 'fonte','detalhe da etapa prova_independente',
        'ok', coalesce(d_prova,false)),
      jsonb_build_object('elo','12_evidencia_ledger','auto_declarado',coalesce(d_evid,false),
        'prova_independente', coalesce(i_evid,false),
        'fonte','microloops_23_ponto_evento (append-only) ou frentes.validada_por',
        'referencia', v_evid_ref,
        'ok', coalesce(i_evid,false)),
      jsonb_build_object('elo','13_fechamento_ou_espera','auto_declarado',
        coalesce(d_fech,false) or coalesce(d_esp,false),
        'prova_independente', coalesce(i_desfecho,false),
        'fonte','frentes_espera e/ou frentes_historico (fn_frente_finalizar_chat)',
        'referencia', v_desfecho_ref,
        'ok', coalesce(i_desfecho,false)),
      jsonb_build_object('elo','14_release','auto_declarado',coalesce(d_rel,false),
        'prova_independente', coalesce(i_rel,false) and coalesce(i_sem_claim_ativo,false),
        'fonte','frentes_claims.liberada_em e ausencia de claim ativo',
        'claim_ativo_residual', not coalesce(i_sem_claim_ativo,true),
        'ok', coalesce(i_rel,false) and coalesce(i_sem_claim_ativo,false)),
      jsonb_build_object('elo','15_gps_novamente','auto_declarado',coalesce(d_gps2,false),
        'prova_independente',
          coalesce(d_gps2,false) and v_release_em is not null and exists(
            select 1 from public.executor_rodada_etapa r
             where r.rodada_id = p_rodada_id and r.etapa='gps_novamente'
               and r.registrado_em >= v_release_em),
        'fonte','ordem temporal das etapas: gps_novamente depois de release',
        'ok', coalesce(d_gps2,false) and v_release_em is not null and exists(
            select 1 from public.executor_rodada_etapa r
             where r.rodada_id = p_rodada_id and r.etapa='gps_novamente'
               and r.registrado_em >= v_release_em))
    );

  select coalesce(array_agg(e->>'elo' order by e->>'elo'),'{}')
    into v_falta
    from jsonb_array_elements(v_elos) e
   where not coalesce((e->>'ok')::boolean,false);

  return jsonb_build_object(
    'rodada_id', p_rodada_id,
    'chat_id', v_chat,
    'origem', v_origem,
    'frente', v_frente,
    'iniciada_em', v_ini,
    'ultima_etapa_em', v_fim,
    'duracao_segundos', round(extract(epoch from (v_fim - v_ini))),
    'elos', v_elos,
    'elos_ok', (select count(*) from jsonb_array_elements(v_elos) e
                 where coalesce((e->>'ok')::boolean,false)),
    'elos_total', jsonb_array_length(v_elos),
    'faltando', to_jsonb(v_falta),
    'veredito', case when cardinality(v_falta) = 0 then 'PASS' else 'FAIL' end,
    'criterio', 'PASS exige: wake-up agendado, protocolo, GPS, selecao legitima, claim REAL '
             || 'em frentes_claims, heartbeat REAL em frentes_historico, reconciliacao, trabalho, '
             || 'teste, prova independente, evidencia em ledger append-only, fechamento OU espera '
             || 'estruturada, release com zero claim ativo, e GPS consultado de novo apos o release.',
    'avaliado_em', now());
end $$;

comment on function public.fn_executor_rodada_cadeia(uuid) is
  'Veredito objetivo da cadeia de uma rodada autonoma. Elos 6,7,12,13,14 exigem prova '
  'INDEPENDENTE escrita por outra funcao canonica em outra tabela: auto-declaracao nao basta.';

-- ── PANORAMA DAS RODADAS ────────────────────────────────────────────────────
create or replace view public.vw_executor_rodada as
select r.rodada_id,
       min(r.chat_id)       as chat_id,
       min(r.origem)        as origem,
       min(r.registrado_em) as iniciada_em,
       max(r.registrado_em) as ultima_etapa_em,
       count(*)             as etapas,
       (public.fn_executor_rodada_cadeia(r.rodada_id)->>'veredito') as veredito
  from public.executor_rodada_etapa r
 group by r.rodada_id;

revoke all on public.vw_executor_rodada from anon, authenticated;
