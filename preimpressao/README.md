# Pré-impressão DTF — núcleo puro

Frente de governança: **`agente-pre-impressao-dtf`** (trilha `erp`).
Escopo deste patch: **somente código puro e testes**. Nenhuma migration, tabela,
RPC, trigger, Edge Function, alteração de frontend, deploy ou merge.

```
node --experimental-strip-types preimpressao/tests/run.ts
```

Sem dependências. Node ≥ 22.6 (type-stripping nativo). Usa apenas `node:crypto`
e — no testkit — `node:zlib`.

---

## O que existe aqui

| Arquivo | Papel |
|---|---|
| `src/unidades.ts` | Conversão cm ↔ px ↔ µm e **tolerâncias documentadas** |
| `src/canonico.ts` | Serialização canônica sem perda + SHA-256 |
| `src/erros.ts` | Códigos de falha explícitos |
| `src/tipos.ts` | Contratos (somente tipos) |
| `src/metadados-png.ts` | Extrator de metadados PNG com validação de CRC-32 |
| `src/motor-gang-sheet.ts` | Motor determinístico de montagem |
| `src/preflight.ts` | Validador independente — 16 checagens |
| `testkit/png-sintetico.ts` | Gerador de PNG real para os testes |
| `tests/run.ts` | 56 testes |

---

## Arquitetura

```
        medidas + quantidades + SHA dos mestres
                        │
                        ▼
        ┌───────────────────────────────┐
        │   motor-gang-sheet            │   aritmética inteira (µm)
        │   • normaliza e funde peças   │   sem float no caminho de decisão
        │   • ordena por chave total    │   sem IA, sem rede, sem relógio
        │   • empacota em faixas        │
        │   • paginação por comprimento │
        └───────────────┬───────────────┘
                        │ plano (ALEGAÇÃO)
                        ▼
        ┌───────────────────────────────┐
        │   preflight                   │   NÃO importa o motor
        │   re-deriva tudo do zero      │   relê os bytes reais
        │   16 checagens independentes  │   recalcula SHA-256 agora
        └───────────────────────────────┘
```

O pré-flight **não conhece** o motor: não o importa, não o chama. Ele recebe o
plano como alegação e recalcula comprimento de página, área útil, quantidades e
hashes a partir das colocações e dos bytes. Se o gerador mentir, a divergência
aparece. Há um teste que falha se alguém adicionar esse import.

### Por que micrômetros

Toda medida de entrada cruza **uma única vez** a fronteira do ponto flutuante e
vira inteiro em µm (1 cm = 10 000 µm). Todo o empacotamento — posições, somas,
comparações, sobreposição, espaçamento — é aritmética inteira. Determinismo
bit-a-bit passa a ser propriedade estrutural, não esperança. A 300 DPI, 1 px =
84,67 µm, então a grade é ~85× mais fina que o pixel: nenhuma decisão geométrica
se perde no arredondamento.

---

## Algoritmo

**Shelf / First-Fit Decreasing Height**, escolhido por ser auditável e
reproduzível — não há heurística estocástica, não há busca aleatória.

1. **Normalização** — valida cada peça; converte cm → µm; **funde** peças
   idênticas somando quantidades (`[A×2, A×3] ≡ [A×5]`).
2. **Ordenação total** — `altura ↓`, `largura ↓`, `arte_mestre_id ↑`,
   `versao ↑`, `sha256 ↑`, `rotacao_permitida`. Chave total ⇒ a ordem de
   chegada é irrelevante.
3. **Orientação** — 0° é sempre preferida. 90° só é *considerada* quando
   `rotacao_permitida === true` **e** 0° não cabe. Não couber em nenhuma
   orientação admissível ⇒ exceção.
4. **Faixas** — first-fit por largura na largura disponível
   (`largura_util − 2×margem`). A altura da faixa é o máximo das cópias nela.
5. **Páginas** — faixas empilhadas enquanto
   `margem + Σalturas + espaçamentos + margem ≤ comprimento_max`.
6. **Coordenadas** — X acumula dentro da faixa, Y acumula entre faixas.
7. **Hashes** — `parametros_hash` sobre a entrada normalizada;
   `resultado_hash` sobre `(parametros_hash, itens, páginas, comprimento, área)`.

**Complexidade:** O(n·f) para colocação (f = faixas) e O(n²) na verificação
pareada do pré-flight.

---

## Contrato de entrada

```ts
montarGangSheet({
  midia: {
    largura_util_cm: number,        // PARÂMETRO — vem de maquinas.largura_impressao_cm
    dpi: number,
    comprimento_max_cm: number | null,
  },
  layout: { margem_cm: number, espacamento_cm: number },
  pecas: [{
    arte_mestre_id: string,
    versao: number,                 // inteiro ≥ 0
    sha256: string,                 // hex 64, minúsculo
    largura_cm: number | null,      // null/undefined ⇒ REJEIÇÃO
    altura_cm:  number | null,
    quantidade: number,             // inteiro > 0
    rotacao_permitida: boolean,     // booleano explícito
  }],
})
```

**Nenhuma largura física está codificada neste pacote.** Há um teste que varre
o código de produção e falha se `57` ou `60` aparecerem como literal.

## Contrato de saída

```ts
{
  entrada_normalizada: { midia, layout, pecas },      // em µm
  itens: [{
    sequencia, arte_mestre_id, versao, sha256, indice_copia,
    x_um, y_um, largura_final_um, altura_final_um,
    rotacao_graus: 0 | 90,
    escala: 1,                                        // sempre exatamente 1
    faixa, pagina,
  }],
  paginas: [{ pagina, comprimento_utilizado_um, area_util_pct, itens_count }],
  comprimento_total_utilizado_um: number,
  area_util_pct: number,
  parametros_hash: string,
  resultado_hash: string,
}
```

## Falhas — sempre explícitas

O motor **lança** `ErroPreImpressao` com `codigo` estável. Nunca devolve um
resultado degradado, nunca reduz a arte para caber.

`MEDIDA_AUSENTE` · `MEDIDA_NAO_FINITA` · `MEDIDA_NAO_POSITIVA` ·
`QUANTIDADE_INVALIDA` · `SHA256_INVALIDO` · `IDENTIDADE_AUSENTE` ·
`MIDIA_LARGURA_INVALIDA` · `MIDIA_DPI_INVALIDO` · `LAYOUT_MARGEM_INVALIDA` ·
`LAYOUT_ESPACAMENTO_INVALIDO` · `MARGEM_MAIOR_QUE_MIDIA` ·
`ARTE_NAO_CABE_NA_LARGURA` · `ARTE_NAO_CABE_NO_COMPRIMENTO`

---

## Tolerâncias (todas explícitas)

| Constante | Valor | Justificativa |
|---|---|---|
| `TOL_PX` | 1 px | cm→px erra até 0,5 px; comparar dois valores arredondados acumula até 1 px |
| `TOL_UM` | 100 µm (0,1 mm) | abaixo do registro mecânico da impressora e da precisão de corte |
| `TOL_PROPORCAO` | 1e-6 relativo | só absorve erro de divisão em ponto flutuante |
| `TOL_DPI` | 0,05 | pHYs grava px/metro inteiro: 300 DPI → 11811 px/m → volta 299,9994 |
| `TOL_AREA_PCT` | 1e-6 p.p. | comparação de área re-derivada |

Referência DTF Têxtil a 300 DPI, **verificada por teste**:

| cm | px exato | px gravado | volta | desvio |
|---|---|---|---|---|
| 57 | 6732,283464566929 | **6732** | 56,9976 cm | 24 µm |
| 100 | 11811,023622047243 | **11811** | 99,9998 cm | 2 µm |

O desvio existe, é medido e é declarado. Não é escondido nem "corrigido"
esticando a arte.

---

## As 16 checagens do pré-flight

| # | Código | Verifica |
|---|---|---|
| 1 | `C01_INTEGRIDADE_ARQUIVO` | assinatura, ordem dos chunks, **CRC-32 de cada chunk** |
| 2 | `C02_DIMENSAO_PX` | pixels do arquivo × pixels calculados (tol. 1 px) |
| 3 | `C03_DPI` | pHYs × DPI exigido |
| 4 | `C04_DIMENSAO_FISICA` | cm recalculado de px + **DPI do próprio arquivo** |
| 5 | `C05_TRANSPARENCIA` | canal alfa presente (colorType 4/6 ou tRNS) |
| 6 | `C06_QUANTIDADE` | instâncias colocadas × quantidades solicitadas |
| 7 | `C07_ESCALA` | toda instância em escala exatamente 1.0 |
| 8 | `C08_PROPORCAO` | medidas idênticas ao mestre — nenhuma deformação |
| 9 | `C09_ESPACAMENTO` | folga mínima entre bounding boxes |
| 10 | `C10_MARGEM` | nada dentro da margem externa |
| 11 | `C11_CLIPPING` | nada cruza a borda da mídia |
| 12 | `C12_SOBREPOSICAO` | interseção pareada = 0 |
| 13 | `C13_ROTACAO` | ângulo ∈ {0,90} e 90° só com permissão |
| 14 | `C14_COMPRIMENTO` | ≤ máximo, e coerente com o declarado |
| 15 | `C15_AREA_UTIL` | aproveitamento re-derivado × declarado |
| 16 | `C16_FIDELIDADE_SHA256` | SHA-256 dos mestres **recalculado agora** |

Cada uma tem um teste que a faz reprovar isoladamente.

### C16 é a prova de fidelidade

Não usamos o estado `aprovado` como prova de imutabilidade. A prova é
criptográfica:

- o SHA-256 de cada mestre é **recalculado a partir dos bytes**, no momento da
  validação, e comparado com o registrado na aprovação;
- toda instância no gang sheet carrega o SHA do mestre e precisa bater;
- se as N cópias de um mestre apresentarem SHAs diferentes, isso é
  **regeneração** e reprova.

Trocar o arquivo no storage depois de aprovado é detectado. Há teste.

---

## Limitações conhecidas (assumidas neste patch)

1. **Só PNG.** PDF/SVG vetorial não têm DPI intrínseco; exigirão um passo de
   rasterização declarado antes de entrar no pré-flight.
2. **Metadados, não pixels.** O pré-flight não decodifica o raster: não
   verifica se a arte foi *desenhada* na posição calculada, apenas que o plano é
   geometricamente válido e que os mestres são os aprovados. O renderizador que
   materializa o PNG ainda não existe — é o elo seguinte.
3. **Uma página por arquivo.** `pagina_referencia` (padrão 1) define qual página
   o arquivo representa. Multi-página exige um arquivo por página.
4. **Bounding box retangular.** Nesting por contorno real não está no escopo;
   o aproveitamento de área é o de um empacotamento retangular.
5. **FFDH não é ótimo.** É determinístico e auditável, que é o requisito. Um
   empacotador melhor pode ser trocado depois, desde que preserve as provas.
6. **Alfa é estrutural.** C05 confirma que existe canal alfa; não confirma que o
   fundo está de fato transparente pixel a pixel — isso depende do item 2.
7. **Nada disto está ligado ao ERP.** Não há schema, RPC ou tela envolvidos.
