# Iniciativa `microloops-23-agentes` — mapa verificável e contrato de fechamento

Rodada de 17/08/2026. Frente de governança: `gps-microloops-23-membresia-fechamento`
(trilha `governanca`, claim `claude-20260817-gps-microloops23-4k8m2p`).

Projeto Supabase: `ldrdtaibazplvrbwyrvx` (Cérebro).

---

## 1. Causa-raiz da ambiguidade

A iniciativa mede **agentes**; o GPS só modela **frentes**; não existia relação entre os dois.

| Fato | Verificação |
|---|---|
| "23" é a contagem de agentes, não de frentes | `select count(*) from public.agentes` → 23, todas `status='ativo'` |
| A macro tinha 11 filhas, mas 3 não são microloop de agente algum | `contrato-orcamento-contexto-aprendizado` declara na descrição: *"Frente do CONTRATO DE ENTREGA, nao do Joao nem da Julia"*; `agente-chat-sem-autenticacao` e `ricardo-edge-sem-autenticacao` são endurecimento de autenticação |
| As 8 filhas restantes cobrem apenas 4 agentes | João (agente-noturno), Júlia (agente-exploracao), Vera (agente-retencao), Ricardo (agente-supervisor) |
| O único inventário dos 23 vivia em prosa | `frentes.onde_paramos` = 10.857 chars; `fn_frente_checkpoint` lista `onde_paramos` e `evidencia` em `nao_contam` |

Consequência: o fechamento da macro era **improvável por construção** — o critério é conjuntivo
sobre 23 agentes e a única medição era texto autoral do executor.

---

## 2. Atribuição agente ↔ frente: provada por dado, não por nome

Registrada em `public.microloops_23_frente.atribuicao_fonte` + `evidencia`.

| Fonte | Agente | Prova |
|---|---|---|
| `ligacao_estruturada` | `agente-noturno` | `joao_envios.decision_id → agente_decisoes_log.agente_slug` = `agente-noturno` em **1006/1006** linhas, valor único |
| `ligacao_estruturada` | `agente-retencao` | `vera_retencao_ciclos.decision_id → agente_decisoes_log.agente_slug` = `agente-retencao` em **19/19** |
| `artefato_declarado` | `agente-supervisor` | o campo `bloqueio` nomeia a edge `agente-supervisor` v5.8.2 / version 61, que é o `agentes.edge_function` do Ricardo Neves |
| `nome_unico_dominio` | `agente-exploracao` | único "Julia" em `public.agentes`; descrição cobre DTF Têxtil/UV, domínio do incidente. **Limitação registrada:** `julia_tool_audit_log` não tem coluna de decisão, então não há ligação estruturada |

> A atribuição de "João" **não** veio do primeiro nome. `agente-noturno` é descrito como
> plantonista noturno, mas responde 6.764 decisões com pico às 17–21 BRT — a descrição está
> desatualizada. Só o join resolveu.

Os **19 agentes sem frente portadora** ficam explícitos como `nao_inventariado`. A lacuna é
visível em vez de ser confundida com loop pronto.

---

## 3. Objetos criados (aditivos)

| Objeto | Papel |
|---|---|
| `public.microloops_23_membro` | 23 linhas, uma por agente. Torna a membresia contável. Carrega `classificacao_loop` (completo/parcial/quebrado/inexistente), exigida literalmente pelo `criterio_aceite` da macro |
| `public.microloops_23_frente` | Liga agente → frente portadora, com `papel` (microloop/suporte), `atribuicao_fonte` e `evidencia` |
| `public.vw_microloops_23_frente_prova` | Prova de fechamento por frente, incluindo `validacao_independente` |
| `public.vw_microloops_23` | Estado por agente |
| `public.fn_microloops_23_fechamento()` | Condição objetiva de fechamento, nas duas leituras (ver §5) |
| `public.fn_microloops_23_proxima()` | Navegador **escopado à iniciativa** |

RLS habilitada; zero grants a `anon`/`authenticated`.

### Por que `validacao_independente` existe

`fn_frente_finalizar_chat` faz `validada_por = coalesce(p_validada_por, p_chat_id)` — o executor
pode assinar a própria validação. Logo `estado='fechada'` **não** prova aprovação de terceiro.
A view compara `validada_por` com o `chat_id` do claim concluinte e marca
`fechado_sem_validacao_independente` quando coincidem.

---

## 4. Correções de dado

- `joao-loop-desfecho-avaliacao-aprendizado.depende_de` → `{joao-contexto-comercial-canonico}`.
  Transcrição da decisão já registrada em prosa no campo `bloqueio`:
  *"CONGELADA por decisao do Alessandro em 16/08/2026: depende de joao-contexto-comercial-canonico fechar primeiro."*
  Vira DAG, não decisão de rota.

- 4 esperas estruturadas abertas para frentes que estavam `acionavel=true` **declarando espera
  no próprio `proximo_passo`**:

  | Frente | Tipo |
  |---|---|
  | `joao-desistencia-lost-canonico` | `evento_organico` |
  | `julia-instrucao-tecnica-e-mensagem-concorrente` | `evento_organico` |
  | `ricardo-livro-recomendacoes-inerte` | `evento_organico` |
  | `contrato-orcamento-contexto-aprendizado` | `decisao_humana` (dono = alessandro) |

### Efeito medido no GPS

| Trilha | Candidatas antes | Depois |
|---|---|---|
| `aprendizado` | 4 | 2 |
| `conversao_joao` | 7 | 5 |
| `conversao_julia` | 4 | 3 |

`conversao_joao` mudou de `NENHUM_SINAL_ESTRUTURADO` / `DAG_VAZIO` para
`SINAL_UNICO_NAO_VALIDADO` / `DAG_DISTINGUE`, com
`venceria_por_dag = joao-contexto-comercial-canonico`, `regras_que_resolvem=1` e
`respostas_distintas=1` — nenhuma discordância entre regras.

---

## 5. Fechamento: duas leituras, e a diferença é do proprietário

`fn_microloops_23_fechamento()` devolve as duas sem escolher:

- **`criterio_registrado`** — o `criterio_aceite` validado por Alessandro em 15/08/2026 é de
  **medição**: os 23 inventariados com classificação + evidência, e todo loop não-completo com
  frente portadora. Não exige que os 23 loops estejam completos.
- **`contrato_estrito`** — o contrato pedido em 17/08/2026: os 23 **comprovados**.

Enquanto `criterio_aceite` não for emendado, vale a leitura registrada — `fn_frente_finalizar_chat`
cobra `criterio_aceite`, não esta função.

Estado atual: 0 comprovados, 4 em aberto, 19 não inventariados, `macro_fechavel = false` nas duas leituras.

---

## 6. Paralelismo não é ambiguidade

Microloops de agentes diferentes vivem em **trilhas diferentes**, e a regra `TRILHA` do protocolo
já permite trilhas distintas em paralelo. Por isso `fn_microloops_23_proxima()` devolve
`MULTIPLAS_ACIONAVEIS` — não `AMBIGUA` — quando há mais de um acionável.
Dentro de um mesmo agente, quem ordena é `ordem_execucao` / `depende_de` já declarados.

Hoje o retorno é `UNICA → joao-contexto-comercial-canonico`.

---

## 7. Limites do contrato GPS atual (reportados, não alterados)

1. **`fn_gps_proxima` não consulta o DAG.** Ele desempata só por `prioridade`. Em
   `conversao_joao` o DAG já resolve, mas o GPS continua dizendo `AMBIGUA`.
   Instalar "DAG primeiro" globalmente **não** se sustenta: em `aprendizado` DAG e onda
   discordam (2 respostas distintas). Regra global não corroborada não foi criada.
2. **Pai competindo com filha** em 4 de 12 trilhas com candidatas (`atribuicao`,
   `conversao_joao`, `operacao_humana`, `erp`). Não afeta esta iniciativa —
   `microloops-23-agentes` está inelegível por `dependencia_insatisfeita` —, mas mudar isso
   alteraria 4 trilhas fora do escopo.
3. **Auto-release de espera orgânica.** `fn_espera_avaliar_um` só conhece as famílias
   `tempo`/`composta` e os verificadores `mensagem_envio_autor_apos` e `vera_ciclo_estado_mudou`.
   Não há verificador capaz de observar linha nova em `joao_lost_eventos` ou
   `ricardo_recomendacoes`, então as 3 esperas de `evento_organico` ficam sem predicado e exigem
   encerramento explícito.

---

## 8. Rollback

- `public.backup_gps_microloops23_20260817` guarda `depende_de` e `proximo_passo` originais.
- As 4 esperas se encerram por `fn_espera_encerrar`.
- As tabelas/views/funções `microloops_23_*` são aditivas e podem ser dropadas sem tocar o GPS.

Nada foi alterado em `fn_gps_proxima`, `vw_frentes_elegiveis`, autonomia de deploy, flags `allow_*`
ou schedulers. `gps_rota_decisao` segue **sem linha nova** — nenhuma decisão humana falsa foi registrada.
