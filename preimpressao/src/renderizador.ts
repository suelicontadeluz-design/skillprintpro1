// ─── Renderizador determinístico do gang sheet ─────────────────────────────
//
// Transforma o PLANO do motor no PNG físico de produção.
//
// O QUE ELE NÃO FAZ — e não tem código para fazer:
//   • não redimensiona: não existe interpolação, reamostragem ou filtro neste
//     arquivo. Se os pixels do mestre não correspondem à medida física no DPI
//     contratado, ele FALHA. Nunca "ajusta".
//   • não regenera: os pixels colocados são cópia byte-a-byte do mestre.
//   • não decide: rotação, posição e página vêm do plano. O renderizador
//     obedece; se o plano pedir algo inválido, ele recusa.
//   • não chama IA nem rede: só `node:zlib` (via codificador/decodificador) e
//     `node:crypto` (via canonico).
//
// FAIL-CLOSED: qualquer inconsistência lança ErroPreImpressao. Não existe
// caminho que produza um PNG "quase certo".
//
// A única transformação aplicada é a rotação de 90°, que é uma permutação
// exata de pixels — sem perda, sem reamostragem.

import { falhar } from './erros.ts'
import { hashCanonico, sha256Hex } from './canonico.ts'
import { TOL_PX, cmParaPx, umParaPx } from './unidades.ts'
import { decodificarPngRgba } from './decodificar-png.ts'
import { codificarPngRgba } from './codificar-png.ts'
import type { EspecLayout, EspecMidia, ItemGangSheet, ResultadoMontagem } from './tipos.ts'

export interface MestreRender {
  arte_mestre_id: string
  versao: number
  /** SHA-256 registrado na aprovação. */
  sha256_registrado: string
  /** Bytes do PNG do mestre, lidos agora. */
  bytes: Uint8Array
  largura_cm: number
  altura_cm: number
}

export interface EntradaRender {
  plano: ResultadoMontagem
  midia: EspecMidia
  layout: EspecLayout
  mestres: MestreRender[]
  /** Página a materializar. Padrão 1. */
  pagina?: number
}

export interface ItemRenderizado {
  sequencia: number
  arte_mestre_id: string
  versao: number
  sha256_mestre: string
  x_px: number
  y_px: number
  largura_px: number
  altura_px: number
  rotacao_graus: 0 | 90
}

export interface ArtefatoRenderizado {
  pagina: number
  largura_px: number
  altura_px: number
  dpi: number
  png: Uint8Array
  /** SHA-256 do arquivo PNG final. */
  sha256_arquivo: string
  /** SHA-256 do raster RGBA cru — prova de determinismo independente do zlib. */
  sha256_raster: string
  itens: ItemRenderizado[]
  /** Hash canônico do manifesto (geometria + sha do raster + shas dos mestres). */
  manifesto_hash: string
}

export function renderizarGangSheet(entrada: EntradaRender): ArtefatoRenderizado {
  const { plano, midia, layout, mestres } = entrada
  const pagina = entrada.pagina ?? 1

  const paginaPlano = plano.paginas.find(p => p.pagina === pagina)
  if (!paginaPlano) {
    falhar('RENDER_PAGINA_INEXISTENTE', `plano não contém a página ${pagina}.`, {
      paginas_disponiveis: plano.paginas.map(p => p.pagina),
    })
  }

  const itensPagina = plano.itens
    .filter(i => i.pagina === pagina)
    .slice()
    .sort((a, b) => a.sequencia - b.sequencia) // ordem determinística de composição

  const larguraPx = cmParaPx(midia.largura_util_cm, midia.dpi)
  const alturaPx = umParaPx(paginaPlano.comprimento_utilizado_um, midia.dpi)
  if (larguraPx <= 0 || alturaPx <= 0) {
    falhar('RENDER_CANVAS_INCOERENTE', 'dimensão de canvas não positiva.', { larguraPx, alturaPx })
  }

  // ── Prepara os mestres: decodifica uma única vez cada um ────────────────
  interface MestrePronto {
    sha256: string
    largura_px: number
    altura_px: number
    rgba: Uint8Array
  }
  const prontos = new Map<string, MestrePronto>()

  for (const m of mestres ?? []) {
    const chave = `${m.arte_mestre_id}|${m.versao}`

    // Fidelidade ANTES de qualquer uso dos pixels.
    const shaAtual = sha256Hex(m.bytes)
    if (shaAtual !== m.sha256_registrado) {
      falhar('RENDER_MESTRE_SHA_DIVERGENTE',
        'bytes do mestre divergem do SHA-256 registrado na aprovação.', {
          chave, sha256_registrado: m.sha256_registrado, sha256_atual: shaAtual,
        })
    }

    const leitura = decodificarPngRgba(m.bytes)
    if (!leitura.ok || !leitura.raster) {
      falhar('RENDER_MESTRE_ILEGIVEL', `mestre não pôde ser decodificado: ${leitura.erro}`, { chave })
    }
    const r = leitura.raster

    if (!r.tem_alpha) {
      falhar('RENDER_MESTRE_SEM_ALPHA',
        'mestre sem canal alfa; DTF exige fundo transparente.', { chave, tipo_cor: r.tipo_cor })
    }

    // ANTI-REDIMENSIONAMENTO: os pixels do mestre têm de corresponder à medida
    // física declarada no DPI contratado. Divergência além da tolerância de
    // arredondamento é falha — jamais reamostragem.
    const espW = cmParaPx(m.largura_cm, midia.dpi)
    const espH = cmParaPx(m.altura_cm, midia.dpi)
    if (Math.abs(r.largura_px - espW) > TOL_PX || Math.abs(r.altura_px - espH) > TOL_PX) {
      falhar('RENDER_MESTRE_PX_INCOMPATIVEL',
        'pixels do mestre não correspondem à medida física no DPI contratado. ' +
        'O renderizador NÃO redimensiona.', {
          chave, dpi: midia.dpi,
          px_arquivo: [r.largura_px, r.altura_px],
          px_esperado: [espW, espH],
          tolerancia_px: TOL_PX,
        })
    }

    prontos.set(chave, {
      sha256: shaAtual,
      largura_px: r.largura_px,
      altura_px: r.altura_px,
      rgba: r.dados,
    })
  }

  // ── Canvas transparente ─────────────────────────────────────────────────
  // Zeros = RGBA(0,0,0,0). O fundo nasce transparente e só é escrito onde há arte.
  const canvas = new Uint8Array(larguraPx * alturaPx * 4)

  const colocados: ItemRenderizado[] = []
  const retangulos: Array<{ x: number; y: number; w: number; h: number; seq: number }> = []

  for (const item of itensPagina) {
    const chave = `${item.arte_mestre_id}|${item.versao}`
    const mestre = prontos.get(chave)
    if (!mestre) {
      falhar('RENDER_MESTRE_AUSENTE', 'plano referencia mestre não fornecido ao renderizador.', {
        chave, sequencia: item.sequencia,
      })
    }

    if (item.escala !== 1) {
      falhar('RENDER_ESCALA_INVALIDA', 'escala diferente de 1 não é renderizável.', {
        sequencia: item.sequencia, escala: item.escala,
      })
    }

    // Fidelidade por instância: a cópia tem de apontar para o mestre aprovado.
    if (item.sha256 !== mestre.sha256) {
      falhar('RENDER_MESTRE_SHA_DIVERGENTE',
        'instância do plano não deriva do mestre fornecido.', {
          sequencia: item.sequencia, esperado: mestre.sha256, recebido: item.sha256,
        })
    }

    if (item.rotacao_graus !== 0 && item.rotacao_graus !== 90) {
      falhar('RENDER_ROTACAO_INVALIDA', 'rotação fora de {0,90}.', {
        sequencia: item.sequencia, rotacao: item.rotacao_graus,
      })
    }

    const larguraItemPx = item.rotacao_graus === 90 ? mestre.altura_px : mestre.largura_px
    const alturaItemPx = item.rotacao_graus === 90 ? mestre.largura_px : mestre.altura_px

    const xPx = umParaPx(item.x_um, midia.dpi)
    const yPx = umParaPx(item.y_um, midia.dpi)

    if (xPx < 0 || yPx < 0 || xPx + larguraItemPx > larguraPx || yPx + alturaItemPx > alturaPx) {
      falhar('RENDER_FORA_DA_MIDIA', 'instância não cabe integralmente no canvas.', {
        sequencia: item.sequencia,
        caixa: [xPx, yPx, larguraItemPx, alturaItemPx],
        canvas: [larguraPx, alturaPx],
      })
    }

    for (const r of retangulos) {
      const ix = Math.min(r.x + r.w, xPx + larguraItemPx) - Math.max(r.x, xPx)
      const iy = Math.min(r.y + r.h, yPx + alturaItemPx) - Math.max(r.y, yPx)
      if (ix > 0 && iy > 0) {
        falhar('RENDER_SOBREPOSICAO', 'instâncias se sobrepõem em pixels.', {
          a: r.seq, b: item.sequencia, area_px: ix * iy,
        })
      }
    }
    retangulos.push({ x: xPx, y: yPx, w: larguraItemPx, h: alturaItemPx, seq: item.sequencia })

    copiar(canvas, larguraPx, mestre.rgba, mestre.largura_px, mestre.altura_px,
      xPx, yPx, item.rotacao_graus)

    colocados.push({
      sequencia: item.sequencia,
      arte_mestre_id: item.arte_mestre_id,
      versao: item.versao,
      sha256_mestre: mestre.sha256,
      x_px: xPx,
      y_px: yPx,
      largura_px: larguraItemPx,
      altura_px: alturaItemPx,
      rotacao_graus: item.rotacao_graus,
    })
  }

  const sha256Raster = sha256Hex(canvas)
  const png = codificarPngRgba(canvas, larguraPx, alturaPx, midia.dpi)
  const sha256Arquivo = sha256Hex(png)

  const manifestoHash = hashCanonico({
    pagina,
    largura_px: larguraPx,
    altura_px: alturaPx,
    dpi: midia.dpi,
    margem_cm: layout.margem_cm,
    espacamento_cm: layout.espacamento_cm,
    parametros_hash: plano.parametros_hash,
    resultado_hash: plano.resultado_hash,
    sha256_raster: sha256Raster,
    itens: colocados,
  })

  return {
    pagina,
    largura_px: larguraPx,
    altura_px: alturaPx,
    dpi: midia.dpi,
    png,
    sha256_arquivo: sha256Arquivo,
    sha256_raster: sha256Raster,
    itens: colocados,
    manifesto_hash: manifestoHash,
  }
}

/**
 * Cópia de pixels do mestre para o canvas.
 *
 * Rotação 0°  : cópia direta, linha a linha.
 * Rotação 90° : permutação exata (sentido horário). destino(x,y) recebe
 *               origem(y, alturaOrigem-1-x) — nenhum pixel é criado, perdido,
 *               interpolado ou misturado.
 *
 * Como o motor e as verificações acima garantem ausência de sobreposição, a
 * cópia é direta e não há blending: os bytes do mestre chegam intactos.
 */
function copiar(
  canvas: Uint8Array, canvasLargura: number,
  origem: Uint8Array, origemLargura: number, origemAltura: number,
  destinoX: number, destinoY: number, rotacao: 0 | 90,
): void {
  if (rotacao === 0) {
    for (let y = 0; y < origemAltura; y++) {
      const de = y * origemLargura * 4
      const para = ((destinoY + y) * canvasLargura + destinoX) * 4
      canvas.set(origem.subarray(de, de + origemLargura * 4), para)
    }
    return
  }

  // 90° horário: destino tem largura = origemAltura, altura = origemLargura.
  for (let ys = 0; ys < origemAltura; ys++) {
    for (let xs = 0; xs < origemLargura; xs++) {
      const xd = origemAltura - 1 - ys
      const yd = xs
      const de = (ys * origemLargura + xs) * 4
      const para = ((destinoY + yd) * canvasLargura + (destinoX + xd)) * 4
      canvas[para] = origem[de]
      canvas[para + 1] = origem[de + 1]
      canvas[para + 2] = origem[de + 2]
      canvas[para + 3] = origem[de + 3]
    }
  }
}
