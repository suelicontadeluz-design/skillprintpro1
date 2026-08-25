# Validacao de seguranca do canal — pre-requisito do EXP-001

Projeto: Supabase `ldrdtaibazplvrbwyrvx` · 2026-08-25 · Somente `SELECT`.
Nenhuma mensagem enviada. Nada criado.

## VEREDITO: CANAL_SEM_ORIGEM_SEGURA

Dois bloqueios independentes. Qualquer um sozinho ja impede o piloto.

### Bloqueio 1 — nao existe origem isolada

| | |
|---|---|
| Instancias Z-API em 90 dias | **1** (`3E3FDA4A904550C350F33E61E96978DB`) |
| Numeros conectados em 90 dias | **1** (`5511992769857`, 155.640 mensagens) |
| Envios do BotConversa que ecoam nessa mesma instancia | **725 de 742 (97,7%)** |

"Dois canais" e ilusao de API. Z-API e BotConversa sao duas portas para a MESMA
linha de WhatsApp. Nao ha para onde isolar o piloto.

### Bloqueio 2 — o opt-out esta funcionalmente morto

`fn_crm_capturar_optout_inbound` (trigger INSERT em fact_conversations) so
reconhece seis frases exatas, apos lowercase/trim/remocao de pontuacao final:
`sair`, `pare`, `parar`, `cancelar`, `nao quero receber`, `não quero receber`.

Medido sobre 76.438 inbounds de 90 dias:

| | |
|---|---|
| Mensagens que parecem recusa explicita | **97** |
| Capturadas pelo gate atual | **0** |
| **Cobertura do gate** | **0,0%** |

Isso explica por que `crm_contact_optouts` tem 1 registro na historia inteira.
Ninguem escreve "pare". Escrevem "nao quero mais receber", "me tira dessa lista",
"para de mandar mensagem" — e nada disso e capturado.

## Idempotencia — parcial

`waba_disparos_lista` tem `uq_waba_lead_pendente_ou_ativo`: UNIQUE(lead_id)
WHERE status IN ('ativo','pendente_envio'). Isso impede DOIS disparos simultaneos
para o mesmo lead. Nao impede reenvio depois que o primeiro vira 'enviado'.

Evidencia historica: **148 leads receberam multiplos disparos**, ate **11 disparos**
no mesmo lead, com intervalo minimo observado de **31 horas**.

Para o piloto, "1 mensagem por lead" dependeria de disciplina do chamador, nao de
uma garantia do banco.

## Observabilidade — nao existe "entregue"

Estados reais em `mensagem_envio` (30 dias):

| status | n | tem provider_id | significado real |
|---|---|---|---|
| observada | 13.484 | 13.484 | eco da Z-API: sabemos que a mensagem existiu na linha |
| submetida | 82 | 0 | submetida e sem eco: desfecho desconhecido |
| falha | 2 | 0 | erro na submissao |

Nao ha nenhum estado de entrega. O maximo que o sistema prova e ECO_CONFIRMADO.
Confirmar que a mensagem chegou ao aparelho do cliente e impossivel hoje.

## Contaminacoes relevantes ao piloto

- `vigia-leads-mornos-diario`: ja excluido da coorte do EXP-001 (17 leads).
- `fn_resgatar_leads_vacuo`: so atua sobre inbound de 48h. Nao alcanca a coorte.
- `whatsapp-executor-15min`: consome a fila `waba_disparos_lista`. Qualquer insercao
  na fila seria processada por ele, nao por um caminho isolado do piloto.

## Onde registrar `piloto_canal=true` (proposto, NAO criado)

`waba_disparos_lista` ja tem `origem_agente text` e `evento text`. Um piloto
poderia ser marcado por valor convencionado nesses campos existentes, sem coluna
nova. Nao foi criado nada: o piloto nao esta autorizado.

## O que precisaria ser verdade para liberar o piloto

1. Uma segunda origem de WhatsApp, separada do numero que atende clientes.
2. Um gate de opt-out que reconheca linguagem real, com cobertura medida acima de
   zero contra as 97 recusas historicas.
3. Uma trava de "no maximo 1 mensagem por lead neste experimento" que nao dependa
   de disciplina do chamador.

Nenhuma das tres existe hoje.
