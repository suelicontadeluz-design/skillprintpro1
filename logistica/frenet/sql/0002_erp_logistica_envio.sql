-- Frente: agente-logistica-criar-etiqueta (trilha erp)
-- Projeto alvo: ERP ynjsflvdfftcopibzxyo
--
-- Substitui o alvo de 0001_logistica_envio.sql (que apontava para o Cerebro).
-- Decisao do dono, 21/08/2026: a emissao roda como ERP + Agente, com o ERP
-- dono dos dados e do estado. Por isso o estado logistico nasce aqui, ao lado
-- de vendas, e nao no Cerebro.
--
-- SOMENTE ADITIVA: cria tabelas novas, nao altera nem remove nada existente.

begin;

-- 1. Envio: a unidade fisica despachada.
create table if not exists public.logistica_envio (
  envio_id            uuid primary key default gen_random_uuid(),
  venda_id            uuid not null references public.vendas(id) on delete restrict,
  chave_idempotencia  text not null,
  estado              text not null default 'RASCUNHO'
                        check (estado in ('RASCUNHO','VALIDADO','EM_EMISSAO','EMITIDO','FALHOU','CANCELADO')),
  -- Snapshots imutaveis. Nao sao FKs de proposito: se o cadastro mudar depois,
  -- a etiqueta emitida continua explicavel.
  remetente_snapshot    jsonb not null,
  destinatario_snapshot jsonb not null,
  itens_snapshot        jsonb not null,
  pacotes_snapshot      jsonb not null,
  servico_snapshot      jsonb not null,
  valor_declarado     numeric(12,2) not null check (valor_declarado > 0),
  -- Reconciliacao cotacao x etiqueta, hoje impossivel.
  custo_cotado        numeric(12,2),
  custo_real          numeric(12,2),
  cotacao_ref         text,
  frenet_order_id     text,
  frenet_shipment_id  text,
  tracking_number     text,
  etiqueta_url        text,
  -- Autoria auditavel: quem pediu e quem autorizou sao papeis distintos.
  solicitado_por_tipo text not null check (solicitado_por_tipo in ('humano','agente')),
  solicitado_por_id   text not null,
  autorizado_por      text,
  autorizado_em       timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint logistica_envio_chave_unica unique (chave_idempotencia)
);

create index if not exists ix_logistica_envio_venda on public.logistica_envio (venda_id);
create index if not exists ix_logistica_envio_tracking on public.logistica_envio (tracking_number)
  where tracking_number is not null;
create index if not exists ix_logistica_envio_order on public.logistica_envio (frenet_order_id)
  where frenet_order_id is not null;

-- 2. Tentativa: persistida ANTES e DEPOIS do efeito externo.
create table if not exists public.logistica_envio_tentativa (
  id                  uuid primary key default gen_random_uuid(),
  chave_idempotencia  text not null,
  envio_id            uuid not null references public.logistica_envio(envio_id) on delete restrict,
  estado              text not null
                        check (estado in ('EM_VOO','CONCLUIDA','FALHA_DEFINITIVA','INDETERMINADA')),
  endpoint_id         text not null,
  -- Hash do payload com o segredo do webhook redigido. Detecta troca
  -- silenciosa de servico, peso ou custo entre tentativas da mesma chave.
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

-- Idempotencia garantida no banco, nao so na aplicacao: para uma mesma chave
-- nao pode existir mais de uma tentativa viva (EM_VOO) ou vencedora
-- (CONCLUIDA). Dois workers concorrentes colidem aqui.
create unique index if not exists ux_tentativa_viva_por_chave
  on public.logistica_envio_tentativa (chave_idempotencia)
  where estado in ('EM_VOO','CONCLUIDA');

create index if not exists ix_tentativa_chave on public.logistica_envio_tentativa (chave_idempotencia);

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
  -- Evento que nao reconcilia fica aqui mesmo assim, observavel,
  -- sem inventar vinculo.
  reconciliado        boolean not null default false,
  payload_bruto       jsonb not null,
  recebido_em         timestamptz not null default now(),
  constraint logistica_evento_tracking_chave_unica unique (chave_evento)
);

create index if not exists ix_evento_tracking_envio on public.logistica_evento_tracking (envio_id);
create index if not exists ix_evento_tracking_pendente on public.logistica_evento_tracking (recebido_em)
  where reconciliado = false;

-- 4. Medida fisica COM PROCEDENCIA. O ERP guarda peso e dimensoes em
--    public.produtos, mas nao guarda como foram obtidos. Coluna preenchida
--    nao e medida confiavel: o unico produto com medida hoje nao tem registro
--    de quem mediu nem quando. Esta tabela e onde a entrevista fisica aterrissa.
create table if not exists public.logistica_produto_medida (
  produto_id      uuid primary key references public.produtos(id) on delete cascade,
  peso_kg         numeric(10,4) not null check (peso_kg > 0),
  altura_cm       numeric(10,2) not null check (altura_cm > 0),
  largura_cm      numeric(10,2) not null check (largura_cm > 0),
  comprimento_cm  numeric(10,2) not null check (comprimento_cm > 0),
  origem          text not null check (origem in ('FICHA_FISICA','AFERIDO_NA_EXPEDICAO')),
  -- Sem quem e quando, nao e procedencia; e so um numero.
  medido_por      text not null,
  medido_em       timestamptz not null,
  evidencia_url   text,
  observacao      text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- 5. Regra de embalagem: como N pecas viram M volumes.
--    O que separa "o produto tem peso" de "sei o peso do volume postado".
create table if not exists public.logistica_embalagem_regra (
  produto_id            uuid primary key references public.produtos(id) on delete cascade,
  pecas_por_volume      integer not null check (pecas_por_volume > 0),
  volume_altura_cm      numeric(10,2) not null check (volume_altura_cm > 0),
  volume_largura_cm     numeric(10,2) not null check (volume_largura_cm > 0),
  volume_comprimento_cm numeric(10,2) not null check (volume_comprimento_cm > 0),
  tara_kg               numeric(10,4) not null default 0 check (tara_kg >= 0),
  origem                text not null check (origem in ('FICHA_FISICA','AFERIDO_NA_EXPEDICAO')),
  definida_por          text not null,
  definida_em           timestamptz not null,
  observacao            text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

-- 6. RLS: emissao carrega dado financeiro e pessoal (CPF, endereco).
--    Sem policy, anon e authenticated ficam sem acesso e service_role passa.
alter table public.logistica_envio enable row level security;
alter table public.logistica_envio_tentativa enable row level security;
alter table public.logistica_evento_tracking enable row level security;
alter table public.logistica_produto_medida enable row level security;
alter table public.logistica_embalagem_regra enable row level security;

commit;

-- ROLLBACK (ordem inversa, sem tocar em nada preexistente):
--   begin;
--   drop table if exists public.logistica_embalagem_regra;
--   drop table if exists public.logistica_produto_medida;
--   drop table if exists public.logistica_evento_tracking;
--   drop table if exists public.logistica_envio_tentativa;
--   drop table if exists public.logistica_envio;
--   commit;
