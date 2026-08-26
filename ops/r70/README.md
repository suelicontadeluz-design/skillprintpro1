# R70 — Reparar a máquina de reativação sem ativar campanhas

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY do início ao fim.
Nenhuma correção foi aplicada — e a §19 explica por quê: **não há defeito vivo para corrigir.**

**Regra central:**
> Worker Sistema deve fazer a máquina FICAR CAPAZ de executar. Não deve decidir SE a empresa
> deve executá-la.

---

## §1 — Reconciliação dos denominadores (gate de entrada)

Unidade única: **linha de `crm_campaign_audiences`**. Snapshot de 26/08/2026 ~21h UTC.

| | filtro | n |
|---|---|---|
| T0 | todas as linhas | **2.226** |
| T1 | `status_disparo='pendente'` | **2.124** |
| T2 | ⤷ em campanha `~reativacao` — **o 1.879 da R68** | **1.879** |
| T3 | ⤷ em campanha não-reativação | 245 |
| T4 | T1 e `incluido and not excluido` → **elegíveis** | **1.275** |
| T5 | T1 e (`excluido` ou `not incluido`) → não elegíveis | **849** |
| T6 | T4 e `disparo_id is null` → fila real da função | **1.275** (T12 = 0 já enfileirados) |
| T7 | ⤷ campanha canal `whatsapp` | **1.099** |
| T8 | ⤷ campanha canal `email` | 176 |
| T9 | T6 por status: rascunho 1.065 · pausada 125 · em_execucao 85 | 1.275 |
| T10 | ⤷ **fila em campanhas rascunho** | **1.065** |

Fecha: T1 = T2+T3 = T4+T5 · T6 = T7+T8 · T9 soma 1.275 · T0 − T1 = 102 = 4 enviado + 1 erro + 97 cancelado.

### Correção de um erro meu na R69

A R69 reportou 617 leads no gate de opt-out. **O valor certo é 686** — eu somei errado a coluna.
Com isso os quatro gates somam **686 + 43 + 91 + 245 = 1.065 = T10**, exatamente. O README da
R69 foi corrigido neste commit. Nenhuma conclusão muda; o número muda.

---

## §3 — A regra de opt-out é literal, e as 13 mensagens não têm opt-out nenhum

O código faz `v_msg.mensagem not ilike '%responda SAIR%'` — substring literal, case-insensitive.
Minha hipótese era que as 13 usassem uma variante ("digite SAIR", "descadastrar") e a regra é que
seria estreita demais.

**Refutado.** As 13 são **byte a byte a mesma mensagem de 86 caracteres**:

> *"Oi! Tudo bem? Queria saber se ainda tem interesse na estamparia. Como posso te ajudar?"*

`cita_sair = false`, `cita_optout_outro = false`. Não há opt-out em nenhuma forma. O gate está
certo e as mensagens estão erradas.

---

## §4/§8 — O produtor **já foi corrigido**. Não há o que consertar.

Histórico por versão do gerador (canal whatsapp):

| `criado_por` | data | campanhas | msg seq1 | compliant |
|---|---|---|---|---|
| `agente-campanhas-crm-v1.1.0-debug` | 20/05 | 3 | 3 | **0** |
| `agente-campanhas-crm-v1.2.0` | 23/05–10/08 | 12 | 9 | **0** |
| `agente-campanhas-crm-v1.4.0` | 10/08 | 2 | 1 | **0** |
| **`agente-campanhas-crm-v1.5.0`** | **10/08** | 1 | 1 | **1 ✓** |
| `cerebro-exp001` | 25/08 | 1 | 1 | **1 ✓** |

A correção entrou em **v1.5.0, em 10/08**, entre duas versões do mesmo dia. **Desde então nenhuma
mensagem de whatsapp foi gerada sem opt-out.** As 13 quebradas são de v1.1.0 / v1.2.0 / v1.4.0.

§4 pedia "corrigir o produtor, não as 13 campanhas". **Não se aplica: o produtor está correto.**
As 13 são resíduo histórico, e §4 proíbe expressamente alterá-las individualmente.

---

## §6 — As 4 sem `sequencia=1`

Todas de `v1.2.0` (3) e `v1.4.0` (1) — **mesma era do defeito de opt-out**, e nenhuma de v1.5.0
em diante. Classificação: **GERADOR_FALHOU (histórico)**. Nenhum texto fictício foi preenchido.

---

## §7 — As 2 de e-mail pertencem a outra máquina

`fn_tiago_autorizar_e_enfileirar` só aceita `canal='whatsapp'`. As duas campanhas de e-mail são
`v1.7.x` / `v1.8.0-brevo`, do caminho Brevo, que tem guardrail próprio
(`fn_tiago_guardrail_email_v1`) e reconciliação própria (`fn_tiago_reconciliar_email_atribuicao`).

**Resposta: C — permanecem fora desta máquina.** Não é defeito; é outra esteira.

---

## §8 — Os 2 `criado_por` inválidos

- `cerebro-exp001` (25/08, **vivo**) — mas tem **caminho próprio**: `fn_exp001_coorte`,
  `fn_exp001_registrar_intervencao` (que escreve direto em `waba_disparos_lista`) e
  `fn_exp001_resultado`. Não deveria passar por esta função. O "autor inválido" é **por desenho**.
- `agente-campanhas-crm / auditoria-manual` (04/05) — histórico.

**Nenhum produtor vivo cria `criado_por` inválido para esta máquina.**

---

## §11/§12 — TTL: **GAP_DE_REGRA**, não implementação

Na R69 eu propus fazer `crm_campaign_audiences` expirar. Fui procurar de onde tirar a validade:

- `crm_campaigns.data_fim_sugerida` — a coluna existe e está **NULL em 23 de 23**
- `crm_campaign_audiences` não tem coluna de validade; `janela_envio_sugerida` é **hora do dia**,
  não prazo
- audiência pendente em campanha com `data_fim` vencida: **0** (porque nenhuma tem data_fim)

**Não existe TTL no domínio.** Implementar um agora seria inventar a regra. Registrado como
`GAP_DE_REGRA` em `gap_do_mapa`. E `fn_expirar_disparos_vencidos(72)` está **correta no seu
escopo** — ela trata `waba_disparos_lista`, e é isso que deve tratar.

---

## §9/§10 — Intenção de automação provada. E ainda assim: não criar o consumidor.

A intenção está escrita nas frentes, não inferida:

- **`tiago-campanha-nao-pede-aprovacao`** (em_andamento) — o nome é o contrato. Critério: campanha
  real e pequena percorre `decision_id → Brevo → destinatário → evento externo → conversão →
  aprendizado → próxima decisão`.
- **`tiago-publico-seguro`** (fechada) — *"Público seguro e **gate autônomo implementados**;
  canário técnico de 5 agendado para a próxima janela útil."*

Os 4 enviados + 1 erro **são** esse canário de 5.

**Mesmo assim, não criei consumidor. Duas razões, ambas documentadas no próprio sistema:**

1. **`tiago-brevo-luciana-resultado` está EM ANDAMENTO**, com janela de observação do canário
   fechando em **04/09/2026 10:02:47 BRT** — *"se não entrar, a janela fecha como zero conversão
   observada"*. A política foi congelada em 21/08 exatamente para isso
   (*"canario 5 concluido; congelado para validar eventos/resultado"*). Criar scheduler agora
   atropela uma espera declarada.
2. A frente `tiago-campanha-nao-pede-aprovacao` registra em `onde_paramos`:
   *"10/08/2026 ~20:00 BRT — **VIOLAÇÃO DE GOVERNANÇA RECONCILIADA PELO GPT**. Após liberar o
   claim …, o GPT executou mutações sem claim ativo: mudou 5 linhas de `waba_disparos_lista` de
   `pendente_envio` para `removido` …"*.
   Já houve um incidente exatamente nesta máquina, por um agente agindo fora de claim. Criar um
   consumidor aqui repetiria o padrão.

§10 exigia provar a intenção antes de criar o scheduler. A intenção está provada — **e mesmo
assim a resposta é não, por outro motivo, que a §10 não previa.**

---

## §13 — Ensaio da cadeia inteira, gate 4 forçado como `POLICY_FALSE_STOP`

Nenhum provider chamado, nenhuma escrita:

| onde para | campanhas | fila |
|---|---|---|
| `G8_optout_ausente` | 13 | **686** |
| `G1_autor_invalido` | 2 | 245 |
| `G6_canal_nao_whatsapp` | 2 | 91 |
| `G5_mensagem_ausente` | 4 | 43 |
| **`G4_POLICY_FALSE_STOP`** | **0** | **0** |

Confirma a R69 com o número corrigido: **zero campanhas chegam ao gate de política**.

---

## §14 — Gate de segurança: **PASSOU**

| exigido | obtido |
|---|---|
| mensagens enviadas = 0 | **0** |
| WABA outbound novo = 0 | **0** |
| e-mail novo = 0 | **0** |
| `policy.ativo` = false | **false** |
| campanhas ativadas = 0 | **0** |

Status inalterado: 21 rascunho · 1 pausada · 1 em_execucao. `crm_campaign_messages` não tocada,
audiências não tocadas, 93 crons intactos, executor/GPS/tick com hashes idênticos,
`fn_tiago_autorizar_e_enfileirar` intacta.

---

## §18 — Auto-refutação

| tentativa | resultado |
|---|---|
| o texto não é realmente o bloqueio? | **é**, para 13 campanhas e 686 leads — e por ausência total, não por variante |
| o opt-out obrigatório está errado? | **não** — WhatsApp business exige, e as mensagens não têm nada |
| `seq1` faltante é deliberado? | **não** — é do mesmo período dos outros defeitos |
| e-mail pertence a outra máquina? | **sim**, com guardrail e reconciliação próprios |
| `criado_por` inválido é só histórico? | **um sim, outro não** — `cerebro-exp001` é vivo, mas tem esteira própria |
| a função não deveria ser automática? | **deveria** — está escrito na frente. Mas há espera aberta |
| a audiência antiga deveria permanecer? | **indeterminado** — não há regra de validade a consultar |
| a correção poderia disparar por acidente? | **não se aplica**: nenhuma correção foi aplicada |
| algum consumidor fora do banco chama a função? | **não encontrado** — nenhuma edge, nenhum cron, e a única ocorrência em 10 dias de `pg_stat_statements` é um script de migração |

---

## §19 — Veredito

**`MAQUINA_TECNICAMENTE_PRONTA_POLICY_OFF`**, com duas ressalvas que não podem ser omitidas:

- **pronta para mensagens NOVAS**, não para as 13 históricas. O gerador vigente (v1.5.0+) produz
  texto conforme; qualquer campanha gerada de 10/08 em diante passa os gates 1 e 5–8 e para
  corretamente no gate 4.
- **`REGRA_DE_EXPIRACAO_INDETERMINADA`** segue aberta como gap de domínio.

**§17 — `EXPOSICAO_TECNICAMENTE_PRONTA = SIM`**, para uma campanha nova gerada pelo produtor
atual. Não para as 21 antigas, e isso não é um defeito a consertar: é resíduo que a §4 proíbe
maquiar campanha a campanha.

---

## §20 — Próximo passo

Devolvo ao Worker Econômico: **infra pronta para um teste controlado** — com a condição de que o
experimento use uma **campanha nova**, gerada pelo produtor vigente, e não reaproveite as 13.

Antes disso, dois marcos que **não são meus**:
1. **04/09/2026** — fecha a janela de observação de `tiago-brevo-luciana-resultado`. Religar a
   política antes disso invalida o canário que ela foi congelada para medir.
2. **Decisão de domínio sobre validade de audiência**, sem a qual não há TTL a implementar.

Os 26 `pendente_aprovacao` (§15) e os 142 `escalar_task_retencao` (§16) ficaram fora, como pedido:
trilha humana e comportamento intencional, respectivamente.

---

## Objetos desta rodada

**Criados:** nenhum. **Alterados:** nenhum. **Enviados:** nenhum.
**Registrados:** 2 linhas em `gap_do_mapa` (TTL indeterminado; consumidor a não criar até 04/09).
**Corrigido no repo:** o número 617 → 686 no README da R69.

Esta rodada tinha autorização para escrever e **escolheu não escrever**, porque a investigação
mostrou que o defeito que ela vinha corrigir já tinha sido corrigido em 10/08.
