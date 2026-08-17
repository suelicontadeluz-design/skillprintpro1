# GPS — contrato determinístico de esperas observáveis

**Frente `gps-espera-observavel-determinista` · 17/08/2026**
Chat `claude-gps-espera-observavel-20260817` · trilha `governanca` · macro-fase `GOV`.
Continuação direta de `gps-acionabilidade-espera-externa`.

---

## 1. Linhagem

Quinta frente da família, todas em `governanca`/`GOV`:

| Frente | Entregou |
|---|---|
| `gps-navegador-elegibilidade-canonica` | `vw_frentes_elegiveis`, `fn_gps_proxima` |
| `governanca-depende-de-nao-e-gate` | gate de dependência em `fn_frente_claim` |
| `gps-decisao-de-rota` | `gps_rota_decisao`, `ROTA_ESCOLHIDA` |
| `gps-acionabilidade-espera-externa` | `frentes_espera`, `acionavel` |
| **`gps-espera-observavel-determinista`** | **predicado + avaliador determinístico** |

A mãe criou o *registro* da espera mas não a *condição*: `frentes_espera` sabia que havia espera, não o que a encerraria. Verificado antes de criar: nenhuma frente equivalente existia.

## 2. Contrato

Dada uma espera aberta:

| Resultado | Quando |
|---|---|
| `SATISFEITA` | predicado existe, é avaliável e a condição é verdadeira. Vem com evidência objetiva estruturada |
| `NAO_SATISFEITA` | predicado existe, é avaliável, condição falsa |
| `NAO_AVALIAVEL` | `decisao_humana`, **ou** espera sem predicado, **ou** espera já encerrada. Cada caso com `motivo` distinto |

`NAO_AVALIAVEL` **nunca** é convertido em `NAO_SATISFEITA`. São coisas diferentes: uma diz "a condição não ocorreu", a outra diz "isto não é do meu domínio".

**`SATISFEITA` ≠ frente aprovada.** Significa apenas que já existe material para a frente voltar a ser trabalhada. O critério de aceite é avaliado depois, pelo executor.

## 3. Objetos criados

Todos **aditivos**. Nenhum objeto do GPS foi alterado — provado por sha256 contra `backup_gps_espera_observavel_20260817`: `vw_frentes_elegiveis`, `vw_esperas_abertas`, `fn_gps_proxima` e `fn_frente_claim` idênticos.

| Objeto | Papel |
|---|---|
| `frentes_espera_predicado` | Condição legível por máquina, 1:1 com a espera |
| `fn_espera_avaliar_um` | Avalia uma condição. `STABLE` |
| `fn_espera_avaliar` | O contrato. `STABLE`, read-only |
| `fn_espera_encerrar` | Mutação explícita e separada. `VOLATILE` |
| `vw_esperas_avaliacao` | Leitura do estado de todas as esperas abertas |

## 4. Como o determinismo é garantido

- **Sem SQL dinâmico.** `verificador` é uma whitelist declarativa por `CHECK`; o despacho é um `CASE` fixo. Adicionar verificador exige migration — é ato de governança, não configuração.
- **O avaliador nunca lê `descricao`.** A prosa é lida por humano/sessão ao **autorar** o predicado, jamais em runtime.
- **Sem regex, sem LLM.**
- **Sem efeito colateral:** `fn_espera_avaliar` é `STABLE`. Duas chamadas seguidas deixam o banco byte a byte idêntico.

Famílias suportadas: `tempo`, `contagem`, `evento`, `amostra`, `composta` (E/OU sobre sub-condições), `externo_observavel`. Verificadores registrados hoje: `mensagem_envio_autor_apos`, `vera_ciclo_estado_mudou`.

## 5. Trava de encerramento automático

`permite_encerramento_automatico` (default `false`) existe por causa de um achado real: a espera do Bruno declara na própria descrição que *"encerramento explicito; nao existe motor automatico em v1"* e exige contrato composto — autoria, pareamento 1:1, hash, canal, reconciliação.

Sem essa trava, um watcher fecharia a espera do Bruno assim que o primeiro outbound aparecesse, violando o contrato que a espera define para si mesma. Com ela:

- `p_automatico=true` numa espera travada → recusa `encerramento_automatico_nao_autorizado`;
- `p_automatico=false` → encerramento deliberado permitido, ainda exigindo `SATISFEITA`.

Bruno e Vera foram registrados com a trava **ligada** (`false`). São frentes comerciais reais; conceder encerramento automático a elas não é decisão desta sessão.

## 6. Compatibilidade legada

Espera sem predicado continua **válida, aberta, não interpretada** e responde `NAO_AVALIAVEL` com motivo `sem_predicado_estruturado`. Nenhum backfill por prosa, regex ou LLM. `frentes_espera` não foi alterada — nem schema, nem dados, nem trigger.

Migração é incremental: registrar predicado é um `INSERT` numa tabela satélite, espera por espera.

## 7. Riscos

| Risco | Situação |
|---|---|
| Verificador novo exige migration | Deliberado — é a fronteira que elimina SQL dinâmico |
| `composta` implementada mas sem caso real | Coberta por código e testável; ainda sem uso em produção |
| `externo_observavel` sem verificador | Família declarada, sem verificador registrado. `CHECK` impede criar predicado órfão |
| Predicado autorado erradamente | O predicado é escrito por humano/sessão lendo a prosa. Erro de autoria não é detectável pelo avaliador |

O último é o limite honesto do contrato: ele garante avaliação determinística de uma condição declarada, não que a condição declarada capture a intenção da prosa.

## 8. Rollback

```sql
drop function public.fn_espera_encerrar(uuid,text,boolean);
drop function public.fn_espera_avaliar(uuid);
drop function public.fn_espera_avaliar_um(text,text,jsonb);
drop view public.vw_esperas_avaliacao;
drop table public.frentes_espera_predicado;
```

Reverter não altera nenhuma espera: o predicado vive em tabela satélite. As esperas encerradas nesta rodada permanecem encerradas, com evidência preservada.
