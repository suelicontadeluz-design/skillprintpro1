# Governança obrigatória de desenvolvimento

Objetivo macro: fazer o sistema vender com previsibilidade e, depois, otimizar lucro.

## A fonte da verdade não é este arquivo

O protocolo canônico vive no banco, não aqui. Este arquivo existe para te levar até ele.

**Primeira ação de qualquer sessão, antes de escolher trabalho:**

```sql
select public.fn_contexto_codex_frentes();
```

O retorno traz `contrato_navegacao` e `protocolo`. **Siga o que vier de lá**, não o que estiver escrito neste arquivo. Se os dois divergirem, o banco vence — este arquivo pode estar desatualizado, a função não.

Projeto Supabase do Cérebro: `ldrdtaibazplvrbwyrvx`.

## Como escolher trabalho

A ordem é:

```
PRE-FLIGHT → CONTEXTO → GPS → ELEGIBILIDADE → ACIONABILIDADE → ROTA → CLAIM → EXECUÇÃO → PROVA → POST-FLIGHT
```

Duas autoridades distintas, que não se substituem:

- **O GPS decide ONDE trabalhar.** Use a chave `selecionavel` do contexto.
- **`fn_frente_claim` decide SE você pode trabalhar.** É o gate final e não pode ser contornado.

**Regra de ouro:** nunca escolha uma frente lendo a chave `fila`. A `fila` é diagnóstico — ela mostra de propósito frentes que não podem ser trabalhadas, com o motivo. Escolher de lá é o erro clássico: parte dela seria recusada pelo próprio portão.

Escolha somente dentro de `selecionavel`.

### Você pode trabalhar sozinho quando

A frente está em `selecionavel`, com `elegivel=true`, `acionavel=true`, e o claim é obtido legitimamente.

- `elegivel` = o portão permitiria capturar.
- `acionavel` = elegível **e** sem espera aberta, ou seja, existe trabalho executável agora.

### Você não pode escolher sozinho quando

- trilha `AMBIGUA` sem rota registrada — **nunca** desempate por preferência sua; leve ao humano ou use rota já persistida;
- a frente tem espera aberta;
- a frente é inelegível ou tem dependência insatisfeita;
- a trilha está `NENHUMA` ou `TODAS_AGUARDANDO`.

## Espera

Se o trabalho chegou legitimamente a uma condição externa — evento orgânico, data futura, decisão humana ou terceiro — **registre a espera em `frentes_espera` e libere o claim**.

Não segure claim esperando tempo, amostra, shadow ou tráfego orgânico: isso trava a trilha inteira para as outras sessões sem produzir nada.

Tipos válidos: `evento_organico`, `data_agendada`, `decisao_humana`, `terceiro_externo`. Não invente um quinto.

## Durante o trabalho

1. Uma frente por chat, um chat por frente.
2. Renove o heartbeat em trabalhos longos.
3. Reconcilie contra o estado real — anotação antiga não é prova.
4. Preserve alterações locais não relacionadas.
5. Registre bloqueios, dependências e desvios encontrados.

## Ao terminar

1. Atualize evidência, `onde_paramos` e próximo passo; chame `fn_frente_finalizar_chat`.
2. Feche a frente **somente** com `criterio_aceite` comprovado.
3. Se faltar validação independente, mantenha em andamento e libere o claim.
4. Nunca dê baixa só porque o código foi escrito, commitado ou deployado — prove o efeito.

Esta governança orienta chats e ferramentas de desenvolvimento. Não deve ser injetada nos 23 agentes comerciais em runtime.
