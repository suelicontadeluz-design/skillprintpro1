// ─── Motor determinístico de gang sheet ────────────────────────────────────
//
// PROPRIEDADES GARANTIDAS POR CONSTRUÇÃO (não por convenção):
//
//  1. DETERMINISMO BIT-A-BIT
//     Toda a aritmética de empacotamento é inteira, em micrômetros. Não há
//     ponto flutuante no caminho de decisão, não há Math.random, não há Date,
//     não há iteração sobre chaves de Map/objeto dependente de inserção.
//
//  2. INDEPENDÊNCIA DA ORDEM DE ENTRADA
//     As peças são normalizadas (peças idênticas são fundidas somando
//     quantidades) e reordenadas por uma chave total antes de qualquer
//     colocação. Portanto o mesmo CONJUNTO de entradas, em qualquer ordem,
//     produz o mesmo resultado_hash.
//
//  3. ESCALA FIXA EM 1.0
//     Não existe caminho de código que redimensione uma arte. Se não couber,
//     lança ErroPreImpressao. Deformação é impossível, não improvável.
//
//  4. ROTAÇÃO 0° / 90°, SOMENTE QUANDO PERMITIDA
//     A orientação 0° é sempre preferida. 90° só é sequer considerada quando
//     `rotacao_permitida === true` E a orientação 0° não cabe na largura útil.
//
//  5. ZERO IA
//     Este módulo importa exclusivamente módulos locais e `node:crypto`
//     (transitivamente, via canonico.ts). Não há rede, não há cliente HTTP,
//     não há SDK de modelo. Verificado por teste de grafo de imports.
//
//  6. LARGURA DA MÍDIA É PARÂMETRO
//     Nenhuma largura física está codificada neste arquivo. No ERP o valor vem
//     de `maquinas.largura_impressao_cm`.

import { falhar } from './erros.ts'
import { ehSha256Valido, hashCanonico } from './canonico.ts'
import { cmParaUm } from './unidades.ts'
import type {
  EntradaMontagem,
  ItemGangSheet,
  PaginaGangSheet,
  PecaEntrada,
  PecaNormalizada,
  ResultadoMontagem,
} from './tipos.ts'

// ── Validação e normalização ──────────────────────────────────────────────

function exigirMedida(valor: number | null | undefined, rotulo: string, ctx: Record<string, unknown>): number {
  if (valor === null || valor === undefined) {
    falhar('MEDIDA_AUSENTE', `${rotulo} não informado. A medida nunca é presumida.`, ctx)
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    falhar('MEDIDA_NAO_FINITA', `${rotulo} não é um número finito.`, { ...ctx, valor })
  }
  if (valor <= 0) {
    falhar('MEDIDA_NAO_POSITIVA', `${rotulo} precisa ser maior que zero.`, { ...ctx, valor })
  }
  return valor
}

function normalizarPecas(pecas: PecaEntrada[]): PecaNormalizada[] {
  if (!Array.isArray(pecas) || pecas.length === 0) {
    falhar('QUANTIDADE_INVALIDA', 'É preciso ao menos uma peça para montar.', {})
  }

  const fundidas = new Map<string, PecaNormalizada>()

  for (let i = 0; i < pecas.length; i++) {
    const p = pecas[i]
    const ctx = { indice: i, arte_mestre_id: p?.arte_mestre_id }

    if (!p || typeof p.arte_mestre_id !== 'string' || p.arte_mestre_id.length === 0) {
      falhar('IDENTIDADE_AUSENTE', 'arte_mestre_id ausente ou vazio.', ctx)
    }
    if (!Number.isInteger(p.versao) || p.versao < 0) {
      falhar('IDENTIDADE_AUSENTE', 'versao precisa ser inteiro >= 0.', { ...ctx, versao: p.versao })
    }
    if (!ehSha256Valido(p.sha256)) {
      falhar('SHA256_INVALIDO', 'sha256 precisa ser hex de 64 caracteres minúsculos.', {
        ...ctx, sha256: p.sha256,
      })
    }
    if (!Number.isInteger(p.quantidade) || p.quantidade <= 0) {
      falhar('QUANTIDADE_INVALIDA', 'quantidade precisa ser inteiro positivo.', {
        ...ctx, quantidade: p.quantidade,
      })
    }
    if (typeof p.rotacao_permitida !== 'boolean') {
      falhar('IDENTIDADE_AUSENTE', 'rotacao_permitida precisa ser booleano explícito.', ctx)
    }

    const larguraCm = exigirMedida(p.largura_cm, 'largura_cm', ctx)
    const alturaCm = exigirMedida(p.altura_cm, 'altura_cm', ctx)

    const larguraUm = cmParaUm(larguraCm)
    const alturaUm = cmParaUm(alturaCm)
    if (larguraUm <= 0 || alturaUm <= 0) {
      falhar('MEDIDA_NAO_POSITIVA', 'medida arredondou para zero micrômetro.', {
        ...ctx, largura_cm: larguraCm, altura_cm: alturaCm,
      })
    }

    const chave = [p.arte_mestre_id, p.versao, p.sha256, larguraUm, alturaUm, p.rotacao_permitida].join('|')
    const existente = fundidas.get(chave)
    if (existente) {
      existente.quantidade += p.quantidade
    } else {
      fundidas.set(chave, {
        arte_mestre_id: p.arte_mestre_id,
        versao: p.versao,
        sha256: p.sha256,
        largura_um: larguraUm,
        altura_um: alturaUm,
        quantidade: p.quantidade,
        rotacao_permitida: p.rotacao_permitida,
      })
    }
  }

  // Ordem total determinística. Não depende da ordem de inserção no Map.
  return [...fundidas.values()].sort(compararPecas)
}

function compararPecas(a: PecaNormalizada, b: PecaNormalizada): number {
  if (a.altura_um !== b.altura_um) return b.altura_um - a.altura_um
  if (a.largura_um !== b.largura_um) return b.largura_um - a.largura_um
  if (a.arte_mestre_id !== b.arte_mestre_id) return a.arte_mestre_id < b.arte_mestre_id ? -1 : 1
  if (a.versao !== b.versao) return a.versao - b.versao
  if (a.sha256 !== b.sha256) return a.sha256 < b.sha256 ? -1 : 1
  if (a.rotacao_permitida !== b.rotacao_permitida) return a.rotacao_permitida ? 1 : -1
  return 0
}

// ── Estruturas internas ───────────────────────────────────────────────────

interface Copia {
  peca: PecaNormalizada
  indice_copia: number
  largura_final_um: number
  altura_final_um: number
  rotacao_graus: 0 | 90
}

interface Faixa {
  copias: Copia[]
  largura_usada_um: number
  altura_um: number
}

// ── Motor ─────────────────────────────────────────────────────────────────

export function montarGangSheet(entrada: EntradaMontagem): ResultadoMontagem {
  const { midia, layout } = entrada

  // ── Mídia e layout ──────────────────────────────────────────────────────
  const larguraUtilCm = exigirMedida(midia?.largura_util_cm, 'midia.largura_util_cm', {})
  if (!Number.isFinite(midia.dpi) || midia.dpi <= 0) {
    falhar('MIDIA_DPI_INVALIDO', 'midia.dpi precisa ser número positivo.', { dpi: midia.dpi })
  }
  if (!Number.isFinite(layout?.margem_cm) || layout.margem_cm < 0) {
    falhar('LAYOUT_MARGEM_INVALIDA', 'layout.margem_cm precisa ser >= 0.', { margem_cm: layout?.margem_cm })
  }
  if (!Number.isFinite(layout?.espacamento_cm) || layout.espacamento_cm < 0) {
    falhar('LAYOUT_ESPACAMENTO_INVALIDO', 'layout.espacamento_cm precisa ser >= 0.', {
      espacamento_cm: layout?.espacamento_cm,
    })
  }

  const larguraUtilUm = cmParaUm(larguraUtilCm)
  const margemUm = cmParaUm(layout.margem_cm)
  const espacamentoUm = cmParaUm(layout.espacamento_cm)

  let comprimentoMaxUm: number | null = null
  if (midia.comprimento_max_cm !== null && midia.comprimento_max_cm !== undefined) {
    const c = exigirMedida(midia.comprimento_max_cm, 'midia.comprimento_max_cm', {})
    comprimentoMaxUm = cmParaUm(c)
    if (comprimentoMaxUm <= 2 * margemUm) {
      falhar('MARGEM_MAIOR_QUE_MIDIA', 'margens consomem todo o comprimento da mídia.', {
        comprimento_max_um: comprimentoMaxUm, margem_um: margemUm,
      })
    }
  }

  const larguraDisponivelUm = larguraUtilUm - 2 * margemUm
  if (larguraDisponivelUm <= 0) {
    falhar('MARGEM_MAIOR_QUE_MIDIA', 'margens consomem toda a largura útil da mídia.', {
      largura_util_um: larguraUtilUm, margem_um: margemUm,
    })
  }

  // ── Peças ───────────────────────────────────────────────────────────────
  const pecas = normalizarPecas(entrada.pecas)

  // ── Expansão em cópias, com orientação decidida por peça ────────────────
  const copias: Copia[] = []
  for (const peca of pecas) {
    const orient = decidirOrientacao(peca, larguraDisponivelUm, comprimentoMaxUm, margemUm)
    for (let k = 1; k <= peca.quantidade; k++) {
      copias.push({
        peca,
        indice_copia: k,
        largura_final_um: orient.largura_final_um,
        altura_final_um: orient.altura_final_um,
        rotacao_graus: orient.rotacao_graus,
      })
    }
  }

  // ── Faixas (shelves), first-fit por largura ─────────────────────────────
  const faixas: Faixa[] = []
  for (const copia of copias) {
    let alocada = false
    for (const faixa of faixas) {
      const gap = faixa.copias.length > 0 ? espacamentoUm : 0
      if (faixa.largura_usada_um + gap + copia.largura_final_um <= larguraDisponivelUm) {
        faixa.copias.push(copia)
        faixa.largura_usada_um += gap + copia.largura_final_um
        if (copia.altura_final_um > faixa.altura_um) faixa.altura_um = copia.altura_final_um
        alocada = true
        break
      }
    }
    if (!alocada) {
      faixas.push({
        copias: [copia],
        largura_usada_um: copia.largura_final_um,
        altura_um: copia.altura_final_um,
      })
    }
  }

  // ── Faixas → páginas, respeitando comprimento máximo ────────────────────
  const paginasFaixas: Faixa[][] = []
  let atual: Faixa[] = []
  let usadoAtual = 0 // soma de alturas + espaçamentos, sem margens

  for (const faixa of faixas) {
    const gap = atual.length > 0 ? espacamentoUm : 0
    const candidato = usadoAtual + gap + faixa.altura_um
    const cabe = comprimentoMaxUm === null || candidato + 2 * margemUm <= comprimentoMaxUm

    if (cabe) {
      atual.push(faixa)
      usadoAtual = candidato
      continue
    }

    if (atual.length === 0) {
      // Faixa sozinha não cabe em uma página inteira. Falha explícita.
      falhar('ARTE_NAO_CABE_NO_COMPRIMENTO', 'faixa isolada excede o comprimento máximo da mídia.', {
        altura_faixa_um: faixa.altura_um,
        margem_um: margemUm,
        comprimento_max_um: comprimentoMaxUm,
      })
    }

    paginasFaixas.push(atual)
    atual = [faixa]
    usadoAtual = faixa.altura_um
    if (comprimentoMaxUm !== null && usadoAtual + 2 * margemUm > comprimentoMaxUm) {
      falhar('ARTE_NAO_CABE_NO_COMPRIMENTO', 'faixa isolada excede o comprimento máximo da mídia.', {
        altura_faixa_um: faixa.altura_um,
        margem_um: margemUm,
        comprimento_max_um: comprimentoMaxUm,
      })
    }
  }
  if (atual.length > 0) paginasFaixas.push(atual)

  // ── Coordenadas ─────────────────────────────────────────────────────────
  const itens: ItemGangSheet[] = []
  const paginas: PaginaGangSheet[] = []
  let sequencia = 0
  let faixaGlobal = 0
  let comprimentoTotalUm = 0
  let areaPecasTotalUm2 = 0
  let areaMidiaTotalUm2 = 0

  for (let p = 0; p < paginasFaixas.length; p++) {
    const doPagina = paginasFaixas[p]
    const numeroPagina = p + 1
    let y = margemUm
    let areaPagina = 0
    let itensPagina = 0

    for (let f = 0; f < doPagina.length; f++) {
      const faixa = doPagina[f]
      faixaGlobal += 1
      if (f > 0) y += espacamentoUm

      let x = margemUm
      for (let c = 0; c < faixa.copias.length; c++) {
        const copia = faixa.copias[c]
        if (c > 0) x += espacamentoUm

        sequencia += 1
        itens.push({
          sequencia,
          arte_mestre_id: copia.peca.arte_mestre_id,
          versao: copia.peca.versao,
          sha256: copia.peca.sha256,
          indice_copia: copia.indice_copia,
          x_um: x,
          y_um: y,
          largura_final_um: copia.largura_final_um,
          altura_final_um: copia.altura_final_um,
          rotacao_graus: copia.rotacao_graus,
          escala: 1,
          faixa: faixaGlobal,
          pagina: numeroPagina,
        })

        areaPagina += copia.largura_final_um * copia.altura_final_um
        itensPagina += 1
        x += copia.largura_final_um
      }

      y += faixa.altura_um
    }

    const comprimentoPaginaUm = y + margemUm
    const areaMidiaPagina = larguraUtilUm * comprimentoPaginaUm

    paginas.push({
      pagina: numeroPagina,
      comprimento_utilizado_um: comprimentoPaginaUm,
      area_util_pct: pct(areaPagina, areaMidiaPagina),
      itens_count: itensPagina,
    })

    comprimentoTotalUm += comprimentoPaginaUm
    areaPecasTotalUm2 += areaPagina
    areaMidiaTotalUm2 += areaMidiaPagina
  }

  const entradaNormalizada = {
    midia: { largura_util_um: larguraUtilUm, dpi: midia.dpi, comprimento_max_um: comprimentoMaxUm },
    layout: { margem_um: margemUm, espacamento_um: espacamentoUm },
    pecas,
  }

  const parametrosHash = hashCanonico(entradaNormalizada)
  const areaUtilPct = pct(areaPecasTotalUm2, areaMidiaTotalUm2)

  const resultadoHash = hashCanonico({
    parametros_hash: parametrosHash,
    itens,
    paginas,
    comprimento_total_utilizado_um: comprimentoTotalUm,
    area_util_pct: areaUtilPct,
  })

  return {
    entrada_normalizada: entradaNormalizada,
    itens,
    paginas,
    comprimento_total_utilizado_um: comprimentoTotalUm,
    area_util_pct: areaUtilPct,
    parametros_hash: parametrosHash,
    resultado_hash: resultadoHash,
  }
}

// ── Auxiliares ────────────────────────────────────────────────────────────

function decidirOrientacao(
  peca: PecaNormalizada,
  larguraDisponivelUm: number,
  comprimentoMaxUm: number | null,
  margemUm: number,
): { largura_final_um: number; altura_final_um: number; rotacao_graus: 0 | 90 } {
  const alturaDisponivelUm = comprimentoMaxUm === null ? null : comprimentoMaxUm - 2 * margemUm

  const cabe = (w: number, h: number): boolean =>
    w <= larguraDisponivelUm && (alturaDisponivelUm === null || h <= alturaDisponivelUm)

  // 0° é sempre preferida.
  if (cabe(peca.largura_um, peca.altura_um)) {
    return { largura_final_um: peca.largura_um, altura_final_um: peca.altura_um, rotacao_graus: 0 }
  }

  // 90° só é sequer considerada com permissão explícita.
  if (peca.rotacao_permitida && cabe(peca.altura_um, peca.largura_um)) {
    return { largura_final_um: peca.altura_um, altura_final_um: peca.largura_um, rotacao_graus: 90 }
  }

  const detalhe = {
    arte_mestre_id: peca.arte_mestre_id,
    versao: peca.versao,
    largura_um: peca.largura_um,
    altura_um: peca.altura_um,
    largura_disponivel_um: larguraDisponivelUm,
    altura_disponivel_um: alturaDisponivelUm,
    rotacao_permitida: peca.rotacao_permitida,
  }

  if (peca.largura_um > larguraDisponivelUm &&
      (!peca.rotacao_permitida || peca.altura_um > larguraDisponivelUm)) {
    falhar(
      'ARTE_NAO_CABE_NA_LARGURA',
      'arte excede a largura útil da mídia. O motor NÃO reduz a arte para caber.',
      detalhe,
    )
  }

  falhar(
    'ARTE_NAO_CABE_NO_COMPRIMENTO',
    'arte excede o comprimento útil da mídia. O motor NÃO reduz a arte para caber.',
    detalhe,
  )
}

function pct(parte: number, todo: number): number {
  if (todo <= 0) return 0
  return (parte / todo) * 100
}
