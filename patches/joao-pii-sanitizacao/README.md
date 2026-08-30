# joao-pii-sanitizacao — substituto sanitizado do artefato live (P0 privacidade)

Incidente: o código-fonte do agente-noturno, num repositório **público**, carrega
PII de clientes reais em comentários de anotação de casos (telefones, um CEP e
primeiros nomes). Este diretório entrega o **substituto sanitizado** do artefato
que a Edge live importa hoje — sem alterar comportamento e sem tocar no commit
que a produção aponta.

## Identidade

| | |
|---|---|
| Baseline live (commit) | `58f64326271f3a38e5b92ee322ff5dfcd0866816` |
| Baseline live (arquivo) | `patches/joao-slot-proveniencia-escrita/candidato/index.ts` |
| Baseline live (sha256) | `1d8385891f12daaa609d3cf4a8bb5a9a24aea91b47dd63251a0a27dcbe49967b` |
| **Sanitizado (sha256)** | `3a37115932b1675f5dcb9250dabb2aeeecabe25ff4bddbbcd1ca7c4f9a100485` |
| Bundle minificado (ambos) | `ad6accc36a2946db8270eb0f8a2d004053a2eda28f02eab2f94d5b6f95f58800` |
| Rollback | `58f64326271f3a38e5b92ee322ff5dfcd0866816` |

Versão lógica inalterada: `agente-noturno-v4.37.1`.

## O que mudou

10 literais de PII distintos, em 14 ocorrências, **todas em comentário** e
**nenhuma em código executável**: 8 telefones com DDI, 1 telefone formatado,
1 CEP. Mais os primeiros nomes de cliente colados a três casos anotados.

Substituição determinística, preservando formato e comprimento:

- telefone → DDI e DDD mantidos, corpo sintético `9` + zeros + índice
  (ex.: `55DD900000001`), evidentemente falso e não alocável;
- telefone formatado → mesmo formato, corpo sintético;
- CEP → `00000-000`;
- nome de cliente → rótulo genérico (`cliente A`, `cliente B`, …).

**Nada de nome de funcionário foi tocado.** Eles vivem em `RX_HUMANO`, que é
código funcional (roteamento de humano no atendimento), não comentário —
alterá-los mudaria comportamento.

Nenhum cliente real foi usado como substituto de outro.

## Prova de equivalência semântica

`provas/verificar.sh <baseline>` prova, nesta ordem:

1. os dois arquivos compilam;
2. **os bundles minificados têm o mesmo sha256** — o esbuild remove comentários
   mas preserva todo o código, strings, prompts e definições de tools; se um
   literal de PII estivesse dentro de um prompt, de uma regra ou de uma tool, os
   bundles divergiriam. Bateram byte a byte:
   `ad6accc36a2946db8270eb0f8a2d004053a2eda28f02eab2f94d5b6f95f58800`;
3. as 44 linhas `+/-` do diff são **100% comentário**;
4. não resta nenhum telefone ou CEP real no sanitizado.

Disso decorre: `LOGICA_ALTERADA=NÃO`, `CONTROLE_DE_FLUXO_ALTERADO=NÃO`,
`REGRAS_ALTERADAS=NÃO`, `PROMPT_ALTERADO=NÃO`, `TOOLS_ALTERADAS=NÃO`,
`DIFF_PII_ONLY=SIM`.

## Reproduzir

```bash
git cat-file -p 58f64326271f3a38e5b92ee322ff5dfcd0866816:patches/joao-slot-proveniencia-escrita/candidato/index.ts > /tmp/base.ts
python3 provas/sanitizar.py /tmp/base.ts /tmp/san.ts nomes.json   # nomes.json NÃO versionado: contém PII
bash provas/verificar.sh /tmp/base.ts
```

`nomes.json` fica fora do versionamento de propósito: publicá-lo republicaria
os nomes que este trabalho existe para remover.

## Estado — o que este commit NÃO faz

- **Não move o pointer live.** `agente-noturno` v183 continua importando
  `58f64326…`. Trocar o pointer é publicação e exige governança (ver abaixo).
- **Não purga o histórico.** O commit live e as demais refs contaminadas seguem
  intactos e alcançáveis; purgar antes de existir substituto publicado
  quebraria o runtime e o rollback.
- **Não corrige o candidato A1** `3f1ecf3c…`, que herda a mesma PII e portanto
  está **invalidado para promoção**. O próximo candidato A1 deve nascer desta
  baseline sanitizada.

## Sequência governada pretendida

1. auditor independente verifica a equivalência (roda `provas/verificar.sh`);
2. canário governado apontando para o SHA sanitizado;
3. mover `agente-noturno` live para o SHA sanitizado;
4. pós-flight (versão, ezbr, comportamento);
5. **só então** iniciar o purge do histórico público contaminado.

Purgar antes do passo 4 quebra o import em cold start e destrói o rollback.
