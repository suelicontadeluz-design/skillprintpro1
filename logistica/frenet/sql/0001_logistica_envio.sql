-- Frente: agente-logistica-criar-etiqueta (trilha erp)
-- Projeto alvo: Supabase ldrdtaibazplvrbwyrvx (Cerebro)
--
-- NAO APLICADA. Esta migration nao foi executada em nenhum ambiente nesta
-- sessao. Aplicar exige gate explicito, porque cria estado canonico novo.
--
-- Motivo de existir: hoje ha ZERO tabelas ou views em public com nome
-- etiqueta/label/shipment/tracking/rastreio. Sem estas tabelas nao existe
-- onde provar vinculo pedido -> etiqueta -> tracking, nem como comparar o
-- custo cotado (125 operacoes kind=frete) com o custo real da etiqueta.

begin;

-- 1. Envio: a unidade fisica despachada. Um pedido pode ter mais de um.
create table if not exists public.logistica_envio (
  envio_id            uuid primary key default gen_random_uuid(),
  pedido_id           text not null,
  pedido_fonte        text not null,
  lead_id             uuid,
  chave_idempotencia  text not null,
  estado              text not null default 'RASCUNHO'
                        check (estado in ('RASCUNHO','VALIDADO','EM_EMISSAO','EMITIDO','FALHOU','CANCELADO')),
  -- Snapshots imutaveis do que foi usado na emissao. Nao sao FKs de proposito:
  -- se o cadastro mudar depois, a etiqueta emitida continua explicavel.
  remetente_snapshot  jsonb not null,
  destinatario_snapshot jsonb not null,
  itens_snapshot      jsonb not null,
  pacotes_snapshot    jsonb not null,
  valor_declarado     numeric(12,2) not null check (valor_declarado > 0),
  servico_snapshot    jsonb not null,
  -- Reconciliacao cotacao x etiqueta, que hoje e impossivel.
  custo_cotado        numeric(12,2),
  custo_real          numeric(12,2),
  cotacao_ref         text,
  -- Resultado externo.
  frenet_order_id     text,
  frenet_shipment_id  text,
  tracking_number     text,
  etiqueta_url        text,
  -- Autoria auditavel: quem pediu e quem autorizou sao pessoas diferentes.
  solicitado_por_tipo text not null check (solicitado_por_tipo in ('humano','agente')),
  solicitado_por_id   text not null,
  autorizado_por      text,
  autorizado_em       timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint logistica_envio_chave_unica unique (chave_idempotencia)
);

create index if not exists ix_logistica_envio_pedido on public.logistica_envio (pedido_fonte, pedido_id);
create index if not exists ix_logistica_envio_tracking on public.logistica_envio (tracking_number)
  where tracking_number is not null;
create index if not exists ix_logistica_envio_order on public.logistica_envio (frenet_order_id)
  where frenet_order_id is not null;

-- 2. Tentativa: persistida ANTES e DEPOIS do efeito externo.
--    E o que permite recuperar de timeout sem comprar duas vezes.
create table if not exists public.logistica_envio_tentativa (
  id                  uuid primary key default gen_random_uuid(),
  chave_idempotencia  text not null,
  envio_id            uuid not null references public.logistica_envio(envio_id) on delete restrict,
  estado              text not null
                        check (estado in ('EM_VOO','CONCLUIDA','FALHA_DEFINITIVA','INDETERMINADA')),
  endpoint_id         text not null,
  -- Hash do payload com o segredo do webhook redigido. Detecta troca silenciosa
  -- de servico, peso ou custo entre tentativas da mesma chave.
  payload_hash        text not null,
  http_status         integer,
  frenet_order_id     text,
  frenet_shipment_id  text,
  tracking_number     text,
  custo_real          numeric(12,2),
  servico_real        text,
  erro                text,
  resposta_bruta      jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- Garantia dura de idempotencia no banco, nao so na aplicacao:
-- para uma mesma chave nao pode existir mais de uma tentativa viva
-- (EM_VOO) ou vencedora (CONCLUIDA). Um retry concorrente colide aqui.
create unique index if not exists ux_tentativa_viva_por_chave
  on public.logistica_envio_tentativa (chave_idempotencia)
  where estado in ('EM_VOO','CONCLUIDA');

create index if not exists ix_tentativa_chave on public.logistica_envio_tentativa (chave_idempotencia);
create index if not exists ix_tentativa_indeterminada on public.logistica_envio_tentativa (criado_em)
  where estado = 'INDETERMINADA';

-- 3. Evento de tracking: append-only, deduplicado, sem interpretacao.
--    A Frenet envia so o ultimo evento; o historico local e nosso.
create table if not exists public.logistica_evento_tracking (
  id                  bigint generated always as identity primary key,
  chave_evento        text not null,
  envio_id            uuid references public.logistica_envio(envio_id) on delete set null,
  frenet_order_id     text,
  frenet_shipment_id  text,
  tracking_number     text,
  event_type          text,
  event_descricao     text,
  event_em            timestamptz,
  -- Evento cujo OrderId nao reconcilia com nenhum envio fica aqui mesmo assim,
  -- observavel, sem inventar vinculo.
  reconciliado        boolean not null default false,
  payload_bruto       jsonb not null,
  recebido_em         timestamptz not null default now(),
  constraint logistica_evento_tracking_chave_unica unique (chave_evento)
);

create index if not exists ix_evento_tracking_envio on public.logistica_evento_tracking (envio_id);
create index if not exists ix_evento_tracking_nao_reconciliado on public.logistica_evento_tracking (recebido_em)
  where reconciliado = false;

-- 4. RLS: nenhuma destas tabelas e legivel por anon. Emissao e dado
--    financeiro e pessoal (CPF, endereco). Somente service_role.
alter table public.logistica_envio enable row level security;
alter table public.logistica_envio_tentativa enable row level security;
alter table public.logistica_evento_tracking enable row level security;

-- Nenhuma policy criada de proposito: com RLS ligada e sem policy,
-- anon e authenticated ficam sem acesso e service_role continua passando.

commit;

-- ROLLBACK (executar em ordem inversa):
--   begin;
--   drop table if exists public.logistica_evento_tracking;
--   drop table if exists public.logistica_envio_tentativa;
--   drop table if exists public.logistica_envio;
--   commit;
