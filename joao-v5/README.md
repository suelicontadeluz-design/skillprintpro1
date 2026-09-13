# João v5 — reconstrução controlada

Esta árvore nasce isolada do runtime v288. Nada aqui é importado por produção até passar por evals e promoção explícita.

## Objetivo

Reconstruir João preservando o aprendizado real e removendo a arquitetura de remendos.

## Fronteiras obrigatórias

1. **Estado não pertence ao modelo.** Produto, quantidade, CEP, preço comprometido, frete e etapa são projeções de eventos comerciais.
2. **Prompt de sistema é pequeno e estável.** Conhecimento procedural entra por skills carregadas sob demanda.
3. **Regra determinística vira código.** Preço, frete, Pix, autorização, idempotência e validações não dependem de memória do LLM.
4. **Decisão é separada de efeito.** O cérebro pode propor; executor autorizado envia mensagem, cria cobrança ou pedido.
5. **Aprendizado novo vira skill, código ou caso de eval.** Não vira mais um bloco em `SYSTEM`.
6. **Sem novos preloads.** João v5 não cria `globalThis.fetch` overrides nem novas cadeias de `Deno.serve`.
7. **Sem import remoto de runtime em produção.** Artefatos promovidos devem ser versionados e implantados como unidade.

## Estrutura inicial

- `core/system.ts` — prompt mínimo e estável.
- `state/commercial-events.ts` — eventos e projeção de estado comercial.
- `runtime/contracts.ts` — contrato do cérebro, sem efeitos diretos.
- `effects/contracts.ts` — fronteira explícita dos efeitos externos.
- `evals/recife-state.test.ts` — primeira regressão do caso Recife.
- `.claude/skills/joao-*` — skills no formato oficial de Agent Skills.

## Primeira linha de base

O caso Recife deve preservar, mesmo após falha de frete:

- produto `DTF_TEXTIL`;
- quantidade `1 metro`;
- CEP `50875020`;
- preço comprometido `R$ 29,90` e sua proveniência.

Falha de provider não pode apagar fatos comerciais.

## Congelamento do legado

O runtime v288 continua como produção enquanto v5 nasce. A partir desta reconstrução, regra nova de comportamento deve preferencialmente entrar em v5 como código, skill ou eval. Alteração no prompt legado fica restrita a incidente crítico de produção.
