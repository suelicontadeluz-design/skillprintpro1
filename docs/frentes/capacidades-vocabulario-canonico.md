# Frente: `capacidades-vocabulario-canonico`

> Vocabulário canônico de capacidades — padronizar antes de instrumentar.

| campo | valor |
|---|---|
| slug | `capacidades-vocabulario-canonico` |
| título | Capacidades: quatro representações e nenhuma língua comum entre "pode fazer" e "fez" |
| estado | `aberta` |
| trilha | `aprendizado` |
| macrofrente (pai) | `microloops-23-agentes` |
| macro_fase | `F5` |
| tipo | `diagnostico` |
| prioridade | `3` (default — ver nota de governança) |
| ordem_execucao | `7` (mesma onda da macrofrente) |
| resultado | `medicao` |
| depende_de | `{}` (nenhuma dependência insatisfeita) |
| criada em | 18/08/2026 |
| projeto | Supabase `ldrdtaibazplvrbwyrvx` |

---

## Problema

Existem quatro representações independentes do que um agente "pode fazer" ou "fez",
e elas não se encontram:

| # | representação | fonte | volume |
|---|---|---|---|
| 1 | texto livre | `agentes.ferramentas` / `agentes.responsabilidades` | 69 ferramentas, 108 responsabilidades distintas |
| 2 | autoridade por verbo/nível | `autonomia_capacidades_agente` | 68 verbos em `pode_executar`, 57 em `precisa_aprovar` |
| 3 | habilidade declarada | `org_agente_habilidades` | **0 linhas** (esquema completo, nunca populado) |
| 4 | uso real | `julia_tool_audit_log`, `joao_tool_guard_shadow` | 25.381 e 78 linhas |

### Medição (18/08/2026, somente leitura)

- **68 verbos declarados × 108 ações observadas (90 dias) → 2 termos em comum**
  por igualdade exata: `escalar_orcamento` e `criar_publico`.
- **`agentes.ferramentas` é totalmente disjunta das outras duas**:
  interseção com as 108 ações observadas = **0**;
  interseção com os 68 verbos de `pode_executar` = **0**.
- **Nenhum dos 23 agentes tem uma única habilidade declarada.**
- **João (`agente-noturno`) não tem autoridade declarada alguma**: 0 linhas em
  `autonomia_capacidades_agente`, 0 ferramentas em texto — mas 10 tools observadas
  e 12 ações distintas em 90 dias. Instrumentar sem padronizar escreveria a
  autoridade a partir do log, invertendo a direção do contrato.

O problema não é estético, é de junção: nenhuma chave liga autoridade declarada
a ação observada. Instrumentar João agora, com nomes novos, cria uma **quinta
língua** e torna a atribuição futura indecidível.

---

## Contrato alvo

```
capacidade_id / verbo canônico
  → autoridade declarada
  → ação / tool observada
  → executor / agente
  → evidência de uso
```

Separando, sem colapsar: **capacidade · ferramenta · ação · resultado**.

### Fora de escopo, por decisão

Telemetria nova, mudança funcional em qualquer agente, e os elos
"funcionou" e "gerou dinheiro". Resultado causal e atribuição econômica
pertencem a `atrib-instrumentar-execucao`, `atrib-vinculo-origem-decisao`
e `atribuicao-vendas-v2`, que **consomem** este contrato mas não são
resolvidos aqui.

---

## Fases

1. **Inventário read-only** das quatro representações.
2. **Desenho** do identificador estável por capacidade.
3. **Mapa de equivalência** `termo_origem → origem → capacidade_canônica → confiança → evidência`.
   Proibida equivalência por semelhança textual apenas.
4. **Prova** em amostra real: Julia (`agente-exploracao`), João (`agente-noturno`)
   e um terceiro com autoridade declarada — candidato Bruno (`agente-conversacao`,
   5 verbos declarados × 16 ações observadas).
5. **Aceite** (abaixo).

### Hospedagem do mapa

`acao_classificacao` já existe, é versionada (`classificacao_versao`), cobre as
109 ações observadas e carrega colunas de evidência (`evidencia_agente_slug`,
`evidencia_objeto`, `evidencia_versao`, `evidencia_hash`). É o candidato natural
a hospedar a equivalência **sem tabela nova**. Tabela nova só com necessidade
provada e registrada na frente.

---

## Critério de aceite

A frente só fecha quando:

1. vocabulário canônico definido, com as quatro dimensões separadas;
2. mapa de equivalência documentado, nenhuma linha justificada só por semelhança textual;
3. nenhuma terceira língua criada — todo termo novo aponta para termo já existente
   em ao menos uma das quatro representações, ou é declarado como novo com motivo;
4. Julia traduzida: as 20 tools de `julia_tool_audit_log` classificadas ou marcadas `NÃO MAPEADAS`;
5. João com caminho definido para instrumentação futura, nomeando a fonte que ele já
   possui (`joao_tool_guard_shadow`, com `decision_id` e `turn_id`) e o que falta —
   **sem instrumentar agora**;
6. casos ambíguos registrados explicitamente como `NÃO MAPEADOS`, com motivo;
7. nenhuma tabela nova sem necessidade provada, com a avaliação de `acao_classificacao` registrada;
8. nenhuma alteração funcional em agente algum — prompt, edge, tool, nível de
   autonomia e limite financeiro intactos, comprovado por diff vazio;
9. dependências para "funcionou" e "gerou dinheiro" declaradas como handoff para
   as frentes de resultado/atribuição existentes.

---

## Ambiguidades já visíveis (a resolver na Fase 3)

- **Família DTF sem dono semântico.** Julia usa `buscar_tabela_dtf` (1.023) e
  `calcular_dtf` (626); João usa `consultar_tabela_dtf` (9) e `calcular_dtf_por_arte` (7).
  Consultar tabela e calcular preço são capacidades diferentes, mas os quatro nomes
  não dizem qual é qual. **Não mapear por semelhança.**
- **Sobreposição limpa Julia × João:** apenas 3 nomes coincidem exatamente —
  `calcular_frete` (256 × 12), `calcular_copo` (98 × 3), `consultar_catalogo` (42 × 7).
  É o subconjunto mais barato para provar o contrato na Fase 4.
- **Julia não tem `decision_id` no log de tool** (liga por `lead_id` + `turn_id`);
  João já tem. O elo até a decisão é assimétrico entre os dois agentes.

---

## Cobertura verificada antes de criar

Buscadas frentes equivalentes por slug e título em: capacidade, autonomia,
instrumentação, tool, microloop, vocabulário, habilidade, verbo, atribuição, skill.
Nenhuma cobre padronização de vocabulário de capacidade.

| frente mais próxima | estado | por que não cobre |
|---|---|---|
| `atrib-elegibilidade-acoes` | fechada | classifica ação → efeito → elegibilidade; trata só o lado **observado**, nunca o declarado |
| `atrib-instrumentar-execucao` | aberta | é **consumidora** — instrumenta João, Julia e Bruno, e precisaria deste contrato antes |
| `gps-microloops-23-membresia-fechamento` | em_andamento | trata da relação agente↔frente no GPS, não do vocabulário de capacidade |
| `destravar-promocao-autonomia` / `teto-autonomia-supervisor` | aberta | tratam de nível e teto de autonomia, não do nome das capacidades |

---

## Nota de governança — por que prioridade 3

Em `aprendizado` a menor prioridade entre as frentes **acionáveis** é 3, com
10 candidatas e situação `AMBIGUA`. Entrar em prioridade 1 ou 2 tornaria esta
frente a **única** candidata da trilha e a promoveria sozinha a `UNICA`/selecionável
— ou seja, alterar a rota para ganhar o GPS, o que foi explicitamente vedado.

Como prioridade 3 ela apenas se soma às candidatas: `aprendizado` passou de
10 → 11 candidatas e **continua `AMBIGUA`, sem rota humana registrada**.

Estado do GPS após a criação (verificado):

- `aprendizado`: `AMBIGUA`, 11 candidatas, melhor prioridade 3 — **inalterada**
- `unica`, `rota_escolhida`, `todas_aguardando`, `nenhuma`: **idênticas** à leitura anterior
- a frente **não** aparece em `selecionavel`
- nenhuma linha de `gps_rota_decisao` criada ou alterada (4 antes, 4 depois)

**Consequência:** a frente não é imediatamente selecionável. Nenhum
`fn_frente_claim` foi chamado e nenhuma execução foi iniciada. O GPS governa
quando ela entra.

---

## Encadeamento

```
padronização (esta frente)
   └─> instrumentação      atrib-instrumentar-execucao
          └─> resultado    atrib-vinculo-origem-decisao · atrib-ledger-shadow
                 └─> atribuição   atribuicao-vendas-v2
                        └─> GPS Econômico
```

Esta frente entrega **apenas** o primeiro elo: um `capacidade_id` estável que
permite dizer, sem ambiguidade falsa, que o "pode fazer" declarado e o "fez"
observado são a mesma coisa. Nada além disso é prometido aqui.
