// ─── Pré-flight independente ───────────────────────────────────────────────
//
// INDEPENDÊNCIA
// Este módulo NÃO importa o motor. Ele não chama, não instancia e não conhece
// `montarGangSheet`. Recebe o plano como ALEGAÇÃO e o reconfere contra:
//   • os bytes reais do arquivo de produção (metadados lidos do PNG);
//   • os bytes reais de cada arte mestre (SHA-256 recalculado agora);
//   • os parâmetros físicos fornecidos separadamente.
//
// Comprimento de página, área útil e quantidades são RE-DERIVADOS a partir das
// colocações — os valores declarados no plano são apenas comparados contra os
// re-derivados. Se o gerador mentir, a divergência aparece.
//
// O gerador não é sua própria validação.

import { sha256Hex } from './canonico.ts'
import { lerMetadadosPng } from './metadados-png.ts'
import { decodificarPngRgba } from './decodificar-png.ts'
import {
  TOL_PROPORCAO,
  TOL_PX,
  TOL_UM,
  cmParaPx,
  cmParaUm,
  pxParaCm,
  umParaCm,
  umParaPx,
} from './unidades.ts'
import type {
  Checagem,
  CodigoChecagem,
  EntradaPreflight,
  ItemGangSheet,
  MestreRegistrado,
  MotivoC17,
  ResultadoPreflight,
} from './tipos.ts'

/**
 * Tolerância de DPI. O chunk pHYs guarda pixels por metro como inteiro:
 * 300 DPI → 300/0,0254 = 11811,02 px/m → grava 11811 → volta 299,9994 DPI.
 * O erro máximo de ida-e-volta é ~0,0013 DPI; 0,05 cobre com folga sem
 * permitir confundir 300 com 299 ou 301.
 */
const TOL_DPI = 0.05

/** Tolerância de comparação de área útil, em pontos percentuais. */
const TOL_AREA_PCT = 1e-6

export function executarPreflight(entrada: EntradaPreflight): ResultadoPreflight {
  const checagens: Checagem[] = []
  const add = (codigo: CodigoChecagem, descricao: string, ok: boolean, detalhe: Record<string, unknown> = {}) => {
    checagens.push({ codigo, descricao, ok, detalhe })
  }

  const { midia, layout, plano, mestres } = entrada
  const paginaRef = entrada.pagina_referencia ?? 1

  const larguraUtilUm = cmParaUm(midia.largura_util_cm)
  const margemUm = cmParaUm(layout.margem_cm)
  const espacamentoUm = cmParaUm(layout.espacamento_cm)
  const comprimentoMaxUm =
    midia.comprimento_max_cm === null || midia.comprimento_max_cm === undefined
      ? null
      : cmParaUm(midia.comprimento_max_cm)

  const itens = Array.isArray(plano?.itens) ? plano.itens : []
  const porPagina = agruparPorPagina(itens)
  const itensRef = porPagina.get(paginaRef) ?? []

  // Comprimento RE-DERIVADO da página de referência (não o declarado).
  const comprimentoRefUm = itensRef.length > 0
    ? Math.max(...itensRef.map(i => i.y_um + i.altura_final_um)) + margemUm
    : 0

  const mestrePorChave = new Map<string, MestreRegistrado>()
  for (const m of mestres ?? []) {
    mestrePorChave.set(`${m.arte_mestre_id}|${m.versao}`, m)
  }

  // ── C01 — integridade do arquivo ────────────────────────────────────────
  const leitura = lerMetadadosPng(entrada.arquivo_producao)
  add('C01_INTEGRIDADE_ARQUIVO', 'Arquivo decodifica, estrutura e CRC-32 de todos os chunks válidos',
    leitura.ok, { erro: leitura.erro })
  const meta = leitura.metadados

  // ── C02 — dimensão em pixels ────────────────────────────────────────────
  if (meta) {
    const larguraEsperadaPx = cmParaPx(midia.largura_util_cm, midia.dpi)
    const alturaEsperadaPx = umParaPx(comprimentoRefUm, midia.dpi)
    const dLarg = Math.abs(meta.largura_px - larguraEsperadaPx)
    const dAlt = Math.abs(meta.altura_px - alturaEsperadaPx)
    add('C02_DIMENSAO_PX', `Pixels do arquivo conferem com o cálculo (tolerância ${TOL_PX} px)`,
      dLarg <= TOL_PX && dAlt <= TOL_PX,
      {
        largura_px_arquivo: meta.largura_px, largura_px_esperada: larguraEsperadaPx, desvio_px: dLarg,
        altura_px_arquivo: meta.altura_px, altura_px_esperada: alturaEsperadaPx, desvio_altura_px: dAlt,
        tolerancia_px: TOL_PX,
      })
  } else {
    add('C02_DIMENSAO_PX', 'Pixels do arquivo conferem com o cálculo', false, { motivo: 'arquivo ilegível' })
  }

  // ── C03 — DPI ───────────────────────────────────────────────────────────
  if (meta) {
    const ok = meta.dpi_x !== null && meta.dpi_y !== null &&
      Math.abs(meta.dpi_x - midia.dpi) <= TOL_DPI &&
      Math.abs(meta.dpi_y - midia.dpi) <= TOL_DPI
    add('C03_DPI', `DPI gravado no arquivo confere com o exigido (tolerância ${TOL_DPI})`, ok,
      { dpi_x: meta.dpi_x, dpi_y: meta.dpi_y, dpi_exigido: midia.dpi, tem_phys: meta.tem_phys })
  } else {
    add('C03_DPI', 'DPI gravado no arquivo confere com o exigido', false, { motivo: 'arquivo ilegível' })
  }

  // ── C04 — dimensão física ───────────────────────────────────────────────
  if (meta) {
    // Usa o DPI GRAVADO NO ARQUIVO quando existir. C02 já cobre a comparação
    // contra o DPI exigido; C04 mede o que o arquivo de fato afirma ser, em
    // centímetros, de forma independente da declaração externa.
    const dpiArquivoX = meta.dpi_x ?? midia.dpi
    const dpiArquivoY = meta.dpi_y ?? midia.dpi
    const largCmArquivo = pxParaCm(meta.largura_px, dpiArquivoX)
    const altCmArquivo = pxParaCm(meta.altura_px, dpiArquivoY)
    const dLargUm = Math.abs(cmParaUm(largCmArquivo) - larguraUtilUm)
    const dAltUm = Math.abs(cmParaUm(altCmArquivo) - comprimentoRefUm)
    add('C04_DIMENSAO_FISICA', `Dimensão física recalculada de px+DPI confere (tolerância ${TOL_UM} µm)`,
      dLargUm <= TOL_UM && dAltUm <= TOL_UM,
      {
        largura_cm_arquivo: largCmArquivo, largura_cm_exigida: midia.largura_util_cm, desvio_um: dLargUm,
        altura_cm_arquivo: altCmArquivo, altura_cm_derivada: umParaCm(comprimentoRefUm), desvio_altura_um: dAltUm,
        dpi_usado_x: dpiArquivoX, dpi_usado_y: dpiArquivoY, tolerancia_um: TOL_UM,
      })
  } else {
    add('C04_DIMENSAO_FISICA', 'Dimensão física recalculada de px+DPI confere', false, { motivo: 'arquivo ilegível' })
  }

  // ── C05 — transparência ─────────────────────────────────────────────────
  add('C05_TRANSPARENCIA', 'Arquivo possui canal alfa', meta ? meta.tem_alpha : false,
    { tipo_cor: meta?.tipo_cor ?? null, tem_alpha: meta?.tem_alpha ?? null })

  // ── C06 — quantidade ────────────────────────────────────────────────────
  {
    const contagem = new Map<string, number>()
    for (const i of itens) {
      const k = `${i.arte_mestre_id}|${i.versao}`
      contagem.set(k, (contagem.get(k) ?? 0) + 1)
    }
    const divergencias: Record<string, unknown>[] = []
    let solicitadoTotal = 0
    for (const m of mestres ?? []) {
      const k = `${m.arte_mestre_id}|${m.versao}`
      const colocado = contagem.get(k) ?? 0
      solicitadoTotal += m.quantidade_solicitada
      if (colocado !== m.quantidade_solicitada) {
        divergencias.push({ chave: k, solicitado: m.quantidade_solicitada, colocado })
      }
    }
    for (const [k, v] of contagem) {
      if (!mestrePorChave.has(k)) divergencias.push({ chave: k, solicitado: 0, colocado: v })
    }
    add('C06_QUANTIDADE', 'Instâncias colocadas conferem com as quantidades solicitadas',
      divergencias.length === 0 && itens.length === solicitadoTotal,
      { total_colocado: itens.length, total_solicitado: solicitadoTotal, divergencias })
  }

  // ── C07 — escala ────────────────────────────────────────────────────────
  {
    const ruins = itens.filter(i => i.escala !== 1)
    add('C07_ESCALA', 'Toda instância está em escala exatamente 1.0', ruins.length === 0,
      { instancias_fora_de_escala: ruins.map(i => ({ sequencia: i.sequencia, escala: i.escala })) })
  }

  // ── C08 — proporção ─────────────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    for (const i of itens) {
      const m = mestrePorChave.get(`${i.arte_mestre_id}|${i.versao}`)
      if (!m) { ruins.push({ sequencia: i.sequencia, motivo: 'mestre não registrado' }); continue }
      const mw = cmParaUm(m.largura_cm)
      const mh = cmParaUm(m.altura_cm)
      const espW = i.rotacao_graus === 90 ? mh : mw
      const espH = i.rotacao_graus === 90 ? mw : mh
      // Sem deformação: as medidas têm de bater exatamente, não só a razão.
      if (i.largura_final_um !== espW || i.altura_final_um !== espH) {
        ruins.push({
          sequencia: i.sequencia, esperado: [espW, espH],
          recebido: [i.largura_final_um, i.altura_final_um],
        })
        continue
      }
      const razaoItem = i.largura_final_um / i.altura_final_um
      const razaoEsp = espW / espH
      if (Math.abs(razaoItem - razaoEsp) > TOL_PROPORCAO * razaoEsp) {
        ruins.push({ sequencia: i.sequencia, razao_item: razaoItem, razao_esperada: razaoEsp })
      }
    }
    add('C08_PROPORCAO', 'Proporção e medidas idênticas ao mestre (nenhuma deformação)',
      ruins.length === 0, { divergencias: ruins })
  }

  // ── C09 / C12 — espaçamento e sobreposição ──────────────────────────────
  {
    const violacoesEsp: Record<string, unknown>[] = []
    const sobreposicoes: Record<string, unknown>[] = []

    for (const [pagina, lista] of porPagina) {
      for (let a = 0; a < lista.length; a++) {
        for (let b = a + 1; b < lista.length; b++) {
          const A = lista[a]
          const B = lista[b]
          const interX = Math.min(A.x_um + A.largura_final_um, B.x_um + B.largura_final_um) - Math.max(A.x_um, B.x_um)
          const interY = Math.min(A.y_um + A.altura_final_um, B.y_um + B.altura_final_um) - Math.max(A.y_um, B.y_um)

          if (interX > 0 && interY > 0) {
            sobreposicoes.push({
              pagina, a: A.sequencia, b: B.sequencia,
              area_intersecao_um2: interX * interY,
            })
            continue
          }
          const folga = Math.max(-interX, -interY)
          if (folga < espacamentoUm - TOL_UM) {
            violacoesEsp.push({ pagina, a: A.sequencia, b: B.sequencia, folga_um: folga, exigido_um: espacamentoUm })
          }
        }
      }
    }

    add('C09_ESPACAMENTO', `Espaçamento mínimo entre artes respeitado (tolerância ${TOL_UM} µm)`,
      violacoesEsp.length === 0, { exigido_um: espacamentoUm, violacoes: violacoesEsp })
    add('C12_SOBREPOSICAO', 'Nenhuma interseção entre artes', sobreposicoes.length === 0,
      { sobreposicoes })
  }

  // ── C10 — margem ────────────────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    for (const [pagina, lista] of porPagina) {
      const compPag = Math.max(...lista.map(i => i.y_um + i.altura_final_um)) + margemUm
      for (const i of lista) {
        const dentro =
          i.x_um >= margemUm - TOL_UM &&
          i.y_um >= margemUm - TOL_UM &&
          i.x_um + i.largura_final_um <= larguraUtilUm - margemUm + TOL_UM &&
          i.y_um + i.altura_final_um <= compPag - margemUm + TOL_UM
        if (!dentro) ruins.push({ pagina, sequencia: i.sequencia, x_um: i.x_um, y_um: i.y_um })
      }
    }
    add('C10_MARGEM', 'Nenhuma arte invade a margem externa', ruins.length === 0,
      { margem_um: margemUm, violacoes: ruins })
  }

  // ── C11 — clipping ──────────────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    for (const [pagina, lista] of porPagina) {
      const compPag = Math.max(...lista.map(i => i.y_um + i.altura_final_um)) + margemUm
      for (const i of lista) {
        const dentro =
          i.x_um >= 0 && i.y_um >= 0 &&
          i.x_um + i.largura_final_um <= larguraUtilUm + TOL_UM &&
          i.y_um + i.altura_final_um <= compPag + TOL_UM
        if (!dentro) {
          ruins.push({
            pagina, sequencia: i.sequencia,
            direita_um: i.x_um + i.largura_final_um, limite_um: larguraUtilUm,
          })
        }
      }
    }
    add('C11_CLIPPING', 'Nenhuma arte cruza a borda da mídia', ruins.length === 0, { violacoes: ruins })
  }

  // ── C13 — rotação ───────────────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    for (const i of itens) {
      if (i.rotacao_graus !== 0 && i.rotacao_graus !== 90) {
        ruins.push({ sequencia: i.sequencia, rotacao: i.rotacao_graus, motivo: 'ângulo fora de {0,90}' })
        continue
      }
      if (i.rotacao_graus === 90) {
        const m = mestrePorChave.get(`${i.arte_mestre_id}|${i.versao}`)
        if (!m || !m.rotacao_permitida) {
          ruins.push({ sequencia: i.sequencia, rotacao: 90, motivo: 'rotação não permitida para este mestre' })
        }
      }
    }
    add('C13_ROTACAO', 'Rotação apenas 0°/90° e somente quando permitida', ruins.length === 0,
      { violacoes: ruins })
  }

  // ── C14 — comprimento ───────────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    for (const [pagina, lista] of porPagina) {
      const compPag = Math.max(...lista.map(i => i.y_um + i.altura_final_um)) + margemUm
      if (comprimentoMaxUm !== null && compPag > comprimentoMaxUm + TOL_UM) {
        ruins.push({ pagina, comprimento_um: compPag, maximo_um: comprimentoMaxUm })
      }
      const declarada = plano.paginas?.find(p => p.pagina === pagina)
      if (declarada && Math.abs(declarada.comprimento_utilizado_um - compPag) > TOL_UM) {
        ruins.push({
          pagina, motivo: 'comprimento declarado diverge do re-derivado',
          declarado_um: declarada.comprimento_utilizado_um, rederivado_um: compPag,
        })
      }
    }
    add('C14_COMPRIMENTO', 'Comprimento por página dentro do máximo e coerente com o declarado',
      ruins.length === 0, { maximo_um: comprimentoMaxUm, violacoes: ruins })
  }

  // ── C15 — área útil ─────────────────────────────────────────────────────
  {
    let areaPecas = 0
    let areaMidia = 0
    const ruins: Record<string, unknown>[] = []
    for (const [pagina, lista] of porPagina) {
      const compPag = Math.max(...lista.map(i => i.y_um + i.altura_final_um)) + margemUm
      const aP = lista.reduce((s, i) => s + i.largura_final_um * i.altura_final_um, 0)
      const aM = larguraUtilUm * compPag
      areaPecas += aP
      areaMidia += aM
      const declarada = plano.paginas?.find(p => p.pagina === pagina)
      const rederivada = aM > 0 ? (aP / aM) * 100 : 0
      if (declarada && Math.abs(declarada.area_util_pct - rederivada) > TOL_AREA_PCT) {
        ruins.push({ pagina, declarada: declarada.area_util_pct, rederivada })
      }
    }
    const globalRederivada = areaMidia > 0 ? (areaPecas / areaMidia) * 100 : 0
    if (typeof plano.area_util_pct === 'number' &&
        Math.abs(plano.area_util_pct - globalRederivada) > TOL_AREA_PCT) {
      ruins.push({ escopo: 'global', declarada: plano.area_util_pct, rederivada: globalRederivada })
    }
    add('C15_AREA_UTIL', 'Aproveitamento de área recalculado bate com o declarado',
      ruins.length === 0, { area_util_pct_rederivada: globalRederivada, divergencias: ruins })
  }

  // ── C16 — fidelidade SHA-256 ────────────────────────────────────────────
  {
    const ruins: Record<string, unknown>[] = []
    const shaRecalculado = new Map<string, string>()

    for (const m of mestres ?? []) {
      const chave = `${m.arte_mestre_id}|${m.versao}`
      const atual = sha256Hex(m.bytes)
      shaRecalculado.set(chave, atual)
      if (atual !== m.sha256_registrado) {
        ruins.push({
          chave, motivo: 'bytes do mestre divergem do SHA-256 registrado na aprovação',
          sha256_registrado: m.sha256_registrado, sha256_atual: atual,
        })
      }
    }

    // Toda instância precisa apontar para o SHA do seu mestre: prova de que a
    // cópia N derivou do mesmo arquivo, sem regeneração intermediária.
    const shasDistintosPorMestre = new Map<string, Set<string>>()
    for (const i of itens) {
      const chave = `${i.arte_mestre_id}|${i.versao}`
      if (!shasDistintosPorMestre.has(chave)) shasDistintosPorMestre.set(chave, new Set())
      shasDistintosPorMestre.get(chave)!.add(i.sha256)

      const m = mestrePorChave.get(chave)
      if (!m) {
        ruins.push({ sequencia: i.sequencia, motivo: 'instância referencia mestre não registrado', chave })
      } else if (i.sha256 !== m.sha256_registrado) {
        ruins.push({
          sequencia: i.sequencia, motivo: 'instância não deriva do mestre registrado',
          esperado: m.sha256_registrado, recebido: i.sha256,
        })
      }
    }
    for (const [chave, conjunto] of shasDistintosPorMestre) {
      if (conjunto.size > 1) {
        ruins.push({ chave, motivo: 'cópias com SHA-256 diferentes: houve regeneração', shas: [...conjunto].sort() })
      }
    }

    add('C16_FIDELIDADE_SHA256', 'Todas as cópias derivam do mesmo mestre aprovado (SHA-256 recalculado agora)',
      ruins.length === 0, { divergencias: ruins })
  }

  // ── C17 — fidelidade PIXEL A PIXEL ──────────────────────────────────────
  //
  // C16 prova que os BYTES do mestre são os aprovados. C17 prova que o
  // ARTEFATO realmente contém esses pixels, nas coordenadas do plano.
  //
  // São coisas diferentes: um artefato renderizado a partir de uma arte
  // regenerada — mesma dimensão, mesmo DPI, mesmo tamanho de arquivo — passa
  // em C16 se o registro tiver sido atualizado, e só C17 pega.
  //
  // Comparação EXATA, byte a byte, zero tolerância. Nenhum hash produzido pelo
  // renderizador é aceito como substituto: os pixels são lidos e comparados
  // aqui. A única transformação admitida é a rotação registrada no plano, e ela
  // é aplicada por índice, sem alocar buffer intermediário e sem reamostrar.
  {
    const divergencias: Record<string, unknown>[] = []
    const LIMITE_RELATO = 8
    let verificados = 0
    let itensDivergentes = 0

    const divergir = (m: MotivoC17, extra: Record<string, unknown>): void => {
      itensDivergentes++
      if (divergencias.length < LIMITE_RELATO) divergencias.push({ motivo: m, ...extra })
    }

    const leitura = decodificarPngRgba(entrada.arquivo_producao)
    if (!leitura.ok || !leitura.raster) {
      divergir('ARTEFATO_ILEGIVEL', { erro: leitura.erro })
    } else {
      const art = leitura.raster

      // Mestres decodificados uma única vez, com o SHA-256 reconferido aqui —
      // C17 não delega essa verificação a C16.
      interface MestrePixels { largura_px: number; altura_px: number; dados: Uint8Array }
      const prontos = new Map<string, MestrePixels | null>()

      for (const m of mestres ?? []) {
        const chave = `${m.arte_mestre_id}|${m.versao}`
        if (prontos.has(chave)) continue
        const shaAtual = sha256Hex(m.bytes)
        if (shaAtual !== m.sha256_registrado) {
          prontos.set(chave, null)
          divergir('MESTRE_SHA_DIVERGENTE', {
            chave, sha256_registrado: m.sha256_registrado, sha256_atual: shaAtual,
          })
          continue
        }
        const lm = decodificarPngRgba(m.bytes)
        if (!lm.ok || !lm.raster) {
          prontos.set(chave, null)
          divergir('MESTRE_ILEGIVEL', { chave, erro: lm.erro })
          continue
        }
        prontos.set(chave, {
          largura_px: lm.raster.largura_px,
          altura_px: lm.raster.altura_px,
          dados: lm.raster.dados,
        })
      }

      for (const item of itensRef) {
        const chave = `${item.arte_mestre_id}|${item.versao}`
        if (!prontos.has(chave)) {
          divergir('MESTRE_NAO_REGISTRADO', { chave, sequencia: item.sequencia })
          continue
        }
        const mestre = prontos.get(chave)
        if (!mestre) continue // erro do mestre já relatado

        if (item.rotacao_graus !== 0 && item.rotacao_graus !== 90) {
          divergir('ROTACAO_INVALIDA', { sequencia: item.sequencia, rotacao: item.rotacao_graus })
          continue
        }

        const girado = item.rotacao_graus === 90
        const larguraRegiao = girado ? mestre.altura_px : mestre.largura_px
        const alturaRegiao = girado ? mestre.largura_px : mestre.altura_px

        // A região tem de bater com a medida que o próprio plano declara.
        const larguraPlano = umParaPx(item.largura_final_um, midia.dpi)
        const alturaPlano = umParaPx(item.altura_final_um, midia.dpi)
        if (Math.abs(larguraRegiao - larguraPlano) > TOL_PX ||
            Math.abs(alturaRegiao - alturaPlano) > TOL_PX) {
          divergir('DIMENSAO_INCOMPATIVEL', {
            sequencia: item.sequencia,
            px_mestre: [larguraRegiao, alturaRegiao],
            px_plano: [larguraPlano, alturaPlano],
          })
          continue
        }

        const x0 = umParaPx(item.x_um, midia.dpi)
        const y0 = umParaPx(item.y_um, midia.dpi)
        if (x0 < 0 || y0 < 0 ||
            x0 + larguraRegiao > art.largura_px ||
            y0 + alturaRegiao > art.altura_px) {
          divergir('REGIAO_FORA_DO_ARTEFATO', {
            sequencia: item.sequencia,
            regiao: [x0, y0, larguraRegiao, alturaRegiao],
            artefato: [art.largura_px, art.altura_px],
          })
          continue
        }

        const falha = compararRegiaoExata(
          art.dados, art.largura_px, x0, y0,
          mestre.dados, mestre.largura_px, mestre.altura_px,
          larguraRegiao, alturaRegiao, girado,
        )
        verificados++
        if (falha) {
          divergir('PIXEL_DIVERGENTE', { sequencia: item.sequencia, ...falha })
        }
      }
    }

    add('C17_FIDELIDADE_PIXEL',
      'Pixels do artefato conferem exatamente com os do mestre aprovado (comparação byte a byte)',
      itensDivergentes === 0,
      {
        pagina: paginaRef,
        itens_verificados: verificados,
        itens_divergentes: itensDivergentes,
        divergencias,
        relato_truncado: itensDivergentes > divergencias.length,
      })
  }

  const motivos = checagens.filter(c => !c.ok).map(c => `${c.codigo}: ${c.descricao}`)
  return { aprovado: motivos.length === 0, checagens, motivos }
}

const CANAIS_NOME = ['R', 'G', 'B', 'A'] as const

/**
 * Comparação exata da região do artefato contra o raster do mestre.
 *
 * `girado = true` aplica a rotação de 90° no sentido horário POR ÍNDICE — sem
 * alocar buffer intermediário e, principalmente, sem reamostrar. Convenção
 * (idêntica à do renderizador, porém implementada de forma independente aqui):
 *   destino(dx, dy) ← origem(xs = dy, ys = alturaMestre − 1 − dx)
 *
 * Retorna `null` quando todos os bytes conferem, ou o primeiro ponto de
 * divergência. Zero tolerância: um único byte diferente reprova.
 */
function compararRegiaoExata(
  artefato: Uint8Array, artefatoLargura: number, x0: number, y0: number,
  mestre: Uint8Array, mestreLargura: number, mestreAltura: number,
  larguraRegiao: number, alturaRegiao: number, girado: boolean,
): Record<string, unknown> | null {
  for (let dy = 0; dy < alturaRegiao; dy++) {
    for (let dx = 0; dx < larguraRegiao; dx++) {
      const origem = girado
        ? ((mestreAltura - 1 - dx) * mestreLargura + dy) * 4
        : (dy * mestreLargura + dx) * 4
      const destino = ((y0 + dy) * artefatoLargura + (x0 + dx)) * 4

      for (let c = 0; c < 4; c++) {
        if (artefato[destino + c] !== mestre[origem + c]) {
          return {
            canal: CANAIS_NOME[c],
            x_px: x0 + dx,
            y_px: y0 + dy,
            x_local: dx,
            y_local: dy,
            esperado: mestre[origem + c],
            recebido: artefato[destino + c],
          }
        }
      }
    }
  }
  return null
}

function agruparPorPagina(itens: ItemGangSheet[]): Map<number, ItemGangSheet[]> {
  const m = new Map<number, ItemGangSheet[]>()
  for (const i of itens) {
    if (!m.has(i.pagina)) m.set(i.pagina, [])
    m.get(i.pagina)!.push(i)
  }
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]))
}
