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
| `src/decodificar-png.ts` | Decodificador PNG → raster RGBA |
| `src/codificar-png.ts` | Codificador PNG RGBA + pHYs |
| `src/motor-gang-sheet.ts` | Motor determinístico de montagem |
| `src/renderizador.ts` | Materializa o PNG físico a partir do plano |
| `src/preflight.ts` | Validador independente — 17 checagens |
| `testkit/png-sintetico.ts` | Gerador de PNG real para os testes |
| `tests/harness.ts` | Micro-harness |
| `tests/run.ts` + `casos-render.ts` + `casos-c17.ts` | 102 testes |

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
                        │ plano
                        ▼
        ┌───────────────────────────────┐
        │   renderizador                │   cópia de pixels byte-a-byte
        │   • confere SHA do mestre     │   sem reamostragem, sem blending
        │   • decodifica uma vez cada   │   rotação 90° = permutação exata
        │   • compõe e codifica o PNG   │   fail-closed em tudo
        └───────────────┬───────────────┘
                        │ PNG físico (ALEGAÇÃO)
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
| 17 | `C17_FIDELIDADE_PIXEL` | pixels do artefato × pixels do mestre, **byte a byte** |

Cada uma tem um teste que a faz reprovar isoladamente.

### C17 — fidelidade pixel a pixel

C16 prova que os **bytes do mestre** são os aprovados. C17 prova que o
**artefato realmente contém esses pixels**, nas coordenadas do plano. São
coisas diferentes, e a diferença importa: um artefato materializado a partir de
uma arte **regenerada** — mesma dimensão, mesmo DPI, mesmo colorType — passa em
C16 se o registro tiver sido atualizado de forma coerente. Só C17 pega. Há
teste exatamente para esse caso.

Para cada instância da página de referência, o pré-flight:

1. decodifica o raster do artefato;
2. reconfere o SHA-256 do mestre **por conta própria** (não delega a C16);
3. decodifica o raster do mestre;
4. calcula a região a partir de `x_um`/`y_um` do plano;
5. aplica **somente** a rotação registrada, por índice, sem alocar buffer e sem
   reamostrar;
6. compara **byte a byte**, com **zero tolerância**, e reporta o primeiro ponto
   de divergência com canal e coordenada.

Nenhum hash produzido pelo renderizador é aceito como substituto da comparação
— há teste que falha se `preflight.ts` sequer mencionar `sha256_raster`,
`sha256_arquivo` ou `manifesto_hash`.

**Motivos estáveis** (`MotivoC17`, contrato — não renomear sem versionar):
`ARTEFATO_ILEGIVEL` · `MESTRE_NAO_REGISTRADO` · `MESTRE_ILEGIVEL` ·
`MESTRE_SHA_DIVERGENTE` · `ROTACAO_INVALIDA` · `DIMENSAO_INCOMPATIVEL` ·
`REGIAO_FORA_DO_ARTEFATO` · `PIXEL_DIVERGENTE`

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

---

## Renderizador

Materializa o PNG de produção a partir do plano. **Não decide nada:** posição,
rotação e página vêm do plano; ele obedece ou recusa.

```ts
renderizarGangSheet({ plano, midia, layout, mestres, pagina })
  → { pagina, largura_px, altura_px, dpi, png,
      sha256_arquivo, sha256_raster, itens, manifesto_hash }
```

**O que ele não tem código para fazer:**

- **Não redimensiona.** Não existe interpolação, reamostragem ou filtro neste
  arquivo. Se os pixels do mestre não correspondem à medida física no DPI
  contratado (tolerância `TOL_PX`), ele **falha** com
  `RENDER_MESTRE_PX_INCOMPATIVEL`.
- **Não regenera.** Os pixels colocados são cópia byte-a-byte do mestre. Como o
  motor garante ausência de sobreposição — e o renderizador reconfere em pixels
  antes de escrever — a cópia é direta, sem blending. Nenhum canal é misturado.
- **Rotação 90° é permutação exata** (sentido horário): nenhum pixel é criado,
  perdido ou interpolado. Provado por teste comparando o recorte renderizado
  com a rotação calculada independentemente.
- **Verifica fidelidade antes de tocar nos pixels:** o SHA-256 de cada mestre é
  recalculado dos bytes e comparado com o registrado; cada instância precisa
  apontar para esse mesmo SHA.

**Fail-closed** — toda inconsistência lança:
`RENDER_PAGINA_INEXISTENTE` · `RENDER_MESTRE_AUSENTE` · `RENDER_MESTRE_ILEGIVEL`
· `RENDER_MESTRE_SHA_DIVERGENTE` · `RENDER_MESTRE_SEM_ALPHA` ·
`RENDER_MESTRE_PX_INCOMPATIVEL` · `RENDER_ROTACAO_INVALIDA` ·
`RENDER_ESCALA_INVALIDA` · `RENDER_FORA_DA_MIDIA` · `RENDER_SOBREPOSICAO` ·
`RENDER_CANVAS_INCOERENTE`

### Dois hashes, dois propósitos

| Hash | O que prova |
|---|---|
| `sha256_raster` | determinismo do **conteúdo**, independente da versão do zlib |
| `sha256_arquivo` | identidade do **artefato entregue** à produção |

O `manifesto_hash` amarra geometria + raster + `parametros_hash` +
`resultado_hash` do plano, permitindo verificar o artefato sem transportá-lo.

---

## Limitações conhecidas

1. **Só PNG.** PDF/SVG vetorial não têm DPI intrínseco; exigirão um passo de
   rasterização declarado. O decodificador aceita 8 bits, não entrelaçado,
   colorType 0/2/4/6 — **paleta e 16 bits falham explicitamente**.
2. **Alfa é estrutural.** C05 e o renderizador confirmam que existe canal alfa;
   não confirmam que o fundo está transparente pixel a pixel. O teste do
   artefato renderizado mostra que os pixels opacos correspondem exatamente à
   área das artes, mas isso vale para os mestres usados nos testes.
3. **Uma página por arquivo.** `pagina` no renderizador e `pagina_referencia` no
   pré-flight. Multi-página = um arquivo por página.
4. **`C06_QUANTIDADE` é global.** Ao validar uma página isolada de um plano
   multi-página, essa checagem compara o total do plano, não o da página.
5. **Bounding box retangular.** Nesting por contorno real fora do escopo.
6. **FFDH não é ótimo.** É determinístico e auditável, que era o requisito.
7. **C17 cobre a página de referência.** Instâncias de outras páginas não são
   comparadas nessa execução — cada página exige o seu próprio artefato.
8. **C17 não inspeciona o espaço vazio.** Ela prova que cada região *contém* o
   mestre; não prova que o restante do canvas está limpo. Conteúdo espúrio fora
   das regiões passaria despercebido.
9. **A convenção de rotação é compartilhada.** Renderizador e pré-flight
   implementam a permutação de 90° de forma independente, mas seguem a mesma
   convenção documentada (horário). Um teste em `casos-render.ts` a verifica
   contra uma terceira implementação.
10. **Nada disto está ligado ao ERP.** Não há schema, RPC ou tela envolvidos.
