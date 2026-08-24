# Cérebro — fonte canônica, busca de artefato e autoridade técnica

Vigente desde 24/08/2026. Persistido também no banco vivo `ldrdtaibazplvrbwyrvx`
em `recurso_catalogo` (mecanismo canônico) — este arquivo é a cópia legível.

## 1. Fonte canônica

| recurso | papel |
|---|---|
| `repo:suelicontadeluz-design/skillprintpro1` | **fonte canônica do Cérebro/agentes** |
| `repo:suelicontadeluz-design/skillprint-erp` | ERP — **não** é repositório de artefato do Cérebro |

Evidência que sustenta a declaração:

- o rollback v166 do `agente-noturno` está em `.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts`,
  sha256 `6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764` — exatamente o sha
  registrado na espera `f23406b7`;
- `ops/edge/agente-pipeline/` guarda os fontes cujos `ezbr` declarados batem com a edge viva;
- o Draft PR #4 head `700f7b9efb82ff3035a959e548d10b3133acda8f` vive aqui, não no ERP.

## 2. Ordem de busca antes de declarar ausência

`config:cerebro.busca_de_artefato.v1`. Antes de abrir espera humana por
“arquivo/branch/PR/fonte ausente”, a sessão **deve**:

1. identificar o repo da frente em `frentes_recurso_declarado` (tipo `repo`);
2. buscar em **todas** as branches remotas — `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`;
3. procurar PR e head por API no repo certo, **incluindo draft**;
4. havendo sha256 citado, procurar o **blob pelo hash**, não pelo nome;
5. sendo Edge, consultar o ACTIVE vivo e conferir se `version`/`ezbr_sha256` ainda são os vigentes;
6. só então declarar bloqueio humano, nomeando o que foi procurado e onde.

Esta regra evita **abrir** espera falsa. Encerrar espera continua exigindo prova.

## 3. Regra de hash de fonte

`config:cerebro.hash_fonte.v1` — implementada em [`hash_fonte.py`](./hash_fonte.py).

    H = sha256( Σ  path_utf8 || 0x00 || len_decimal || 0x00 || bytes )

ordenado pelos **bytes** do caminho relativo POSIX. **Sem normalização de newline**:
LF, CRLF e ausência de newline final produzem hashes diferentes, por design —
normalizar esconderia divergência real entre repo e ACTIVE.

> `hash_fonte` **≠** `ezbr_sha256`. O `ezbr` é hash do bundle eszip/brotli, artefato
> de *build*: serve como **detector de mudança** de deploy (barato — uma listagem
> cobre a superfície toda), nunca como prova byte-exata de fonte.

Provas em [`provas-20260824.md`](./provas-20260824.md).

## 4. Autoridade técnica (AUTONOMA_LIMITADA_TECNICA v1)

Concedida **por frente** em `gps_autoridade_frente`, nunca global.

Permite: patch de código · reconstrução de artefato a partir do baseline vivo ·
teste · instrumentação · deploy controlado (onde marcado).

Nega: schema · write em produção · segurança · dinheiro · mensagem externa —
além dos quatro indelegáveis que a constraint `gps_autoridade_v1_indelegaveis`
já impede no banco (objetivo, critério de aceite, criar frente, alterar autoridade).

Guardas obrigatórias antes de qualquer mutação: baseline/snapshot · diff limitado
com âncora única · teste antes · canário quando houver produção · reobtenção do
estado vivo depois · prova por hash · rollback definido antes e testável ·
rollback automático em divergência.

`worker_B` está fora da classe e segue bloqueado desde 18/08/2026.
