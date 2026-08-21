# Rodada 3 — decisões do dono aplicadas (21/08/2026)

Chat `claude-20260821-criar-etiqueta-frenet-r3`. Nenhuma etiqueta emitida,
nenhuma carteira debitada, nenhum WhatsApp, João sem autoridade.

## Decisões recebidas e o que cada uma virou

### 1. CEP canônico de origem = 06813-230

`ERP.public.perfil_empresa.cep`: `06803-150` → `06813-230` (linha `6f478d93`,
só a coluna `cep`). `frete_config` e `CEP_ORIGEM` **não foram tocados** — já
usavam `06813230`, portanto já estavam certos.

**Rollback exato:**
```sql
update public.perfil_empresa set cep = '06803-150'
 where id = '6f478d93-3058-4a40-aca5-97eb21dafd46';
```

Verifiquei o acoplamento fiscal **antes** de aplicar: `perfil_empresa` alimenta
o emitente da NF-e via `fn_montar_payload_nfe` (`v_emp.cep`, `v_emp.logradouro`,
`v_emp.estado`), com 7 notas já em `public.notas_fiscais`. Levantei a ressalva —
e então ela se dissolveu: `perfil_empresa` já tinha *Rua Água Branca, 185,
Jardim Laila, Embu das Artes/SP*, e esse mesmo logradouro + número + bairro
aparece em **três registros independentes do ERP com CEP 06813-230**
(`pessoas` de Alessandro Luciano Alves; `pessoa_cliente_dados` `c18ca601` e
`380254e6`). Não era divergência fiscal × postagem: era `06803` digitado no
lugar de `06813`. A correção deixa a NF-e **mais** correta.

### 2. Emissão = ERP + Agente

O campo `ponte_cerebro_erp` deixou de existir: não há ponte a construir.
`calcular-frete` fica no Cérebro só para **COTAR**; o estado e os dados de
emissão são do ERP. Consequência registrada: os segredos Frenet passam a ser
necessários **no projeto ERP** (`credenciais_frenet_no_erp` = AUSENTE).

Novo módulo `erp/montar-envio.ts` — a única porta por onde um `PedidoEnvio`
pode nascer. O agente não monta payload: passa linhas do ERP e recebe ou um
envio válido, ou a lista estruturada do que falta. **13 testes** com fixtures
copiadas de linhas reais.

### 3. Precedência = `agente-pre-impressao-dtf` antes de `agente-logistica-criar-etiqueta`

`gps_frente_precedencia`: nova linha `agente-logistica-criar-etiqueta` = **5**,
depois de `agente-pre-impressao-dtf` = 4, sem mexer na ordem já decidida em
2026-08-20. A cobertura da trilha `erp` fica completa — a trilha não volta a
AMBIGUA quando as esperas fecharem.

## O que mais foi executado tecnicamente

**Migration `logistica_envio_estado_canonico` APLICADA no ERP** (aditiva; não
altera nem remove nada existente). Cinco tabelas: `logistica_envio`,
`logistica_envio_tentativa`, `logistica_evento_tracking`,
`logistica_produto_medida`, `logistica_embalagem_regra`. RLS ligada em todas,
**zero policies** de propósito — `anon` e `authenticated` sem acesso, só
`service_role` passa. Advisors: apenas `INFO: rls_enabled_no_policy` nas cinco,
que é o desenho pretendido; nenhum ERROR ou WARN novo.

**Guarda de idempotência provada no banco, não só em teste:** inserir uma
segunda tentativa `EM_VOO` com a mesma chave é recusada por
`ux_tentativa_viva_por_chave` (índice único parcial sobre
`estado in ('EM_VOO','CONCLUIDA')`). A prova rodou em bloco abortado; as cinco
tabelas seguem com **0 linhas**.

**`servico` deixou de ser INCOMPLETO.** O buraco era
`CEREBRO.operacoes_financeiras.components`, que guardava só `{cep, servico}` e
descartava o `ServiceCode` — por isso 125 operações `kind=frete` não
reconciliavam com etiqueta nenhuma. Agora o produtor é o próprio adapter
(`cotar()` já devolve `codigo`) e `logistica_envio` guarda `servico_snapshot`,
`cotacao_ref`, `custo_cotado` e `custo_real` na mesma linha.

## Uma correção minha, no meio do caminho

Rodei um SQL ad-hoc que classificou as vendas 30 e 29 como
`falta_para_emitir: []`. **Estava errado**: ele checava "o produto tem medida
cadastrada", não "sei o peso do volume". Essas vendas têm **40 unidades** de um
produto cujas medidas (0,150 kg, 10 × 30 × 40 cm) são de **uma peça**. Corrigi
antes de concluir e o erro virou teste: `montarPacotes()` recusa em três pontos
distintos — produto sem medida, medida sem procedência, e medida de peça sem
regra de embalagem — porque são três faltas diferentes e o operador precisa
saber qual é.

## Placar de fontes

| Antes (R2) | Agora (R3) |
|---|---|
| 9 de 20 campos bloqueiam | **6 de 22 campos bloqueiam** |
| 9 PROVADA · 5 AUSENTE · 2 INCOMPLETO · 2 NAO_AUTORIZADA · 1 AMBIGUA · 1 CANDIDATA | **14 PROVADA · 5 AUSENTE · 1 INCOMPLETO · 2 NAO_AUTORIZADA · 0 AMBIGUA · 0 CANDIDATA** |

Os 6 que sobram caem exatamente nos três portões acordados:

| Campo | Portão |
|---|---|
| `credenciais_frenet_no_erp` | (a) cadastro de secrets |
| `receptor_webhook_tracking` | (a) secrets + dono da frente `logistica-frenet-fonte-canonica` |
| `pacote.peso_kg` · `pacote.dimensoes_cm` · `pacote.procedencia_da_medida` · `pacote.regra_de_embalagem` | (b) entrevista física |

**Testes: 81/81** (48 contrato + 20 receptor + 13 montador). Typecheck limpo.
