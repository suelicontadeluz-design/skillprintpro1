# -*- coding: utf-8 -*-
"""v4.37.0 P0 FASE 1 — slot critico so vira FATO com proveniencia verificavel.

O modelo PROPOE interpretacao. Ele nao decreta fato comercial. Este patch fecha
a porta aberta em `slotsNovos = { ...slotsAnteriores, ...slotsRecebidos }`.
"""
import io, sys, hashlib

BASE, OUT = sys.argv[1], sys.argv[2]
src = io.open(BASE, encoding='utf-8').read()
assert hashlib.sha256(src.encode('utf-8')).hexdigest() == \
    '132df0ca90d39dfd83bf8116f432babaef09b2dbe9134e8a336fa0d8c132be68', 'base nao e o candidato v4.36.0 (LIVE 179)'

trocas = []
def rep(a, n, r): trocas.append((a, n, r))

# ── 1. cabecalho + const V ──────────────────────────────────────────────────
rep("const V = 'agente-noturno-v4.36.0';",
"""//
// v4.37.0 (27/08/2026) P0 — SLOT CRITICO SO VIRA FATO COM PROVENIENCIA.
// Rollback: redeploy do v4.36.0 (Edge 179, index.ts sha256 132df0ca90d39dfd83bf8116f432
// babaef09b2dbe9134e8a336fa0d8c132be68). Sem migracao, sem estado novo, sem coluna nova.
//
// DEFEITO — o MESMO lead 5511994088967 (Vitor), o MESMO turno de 26/08 23:54, mas uma
// SEGUNDA porta, que a v4.36.0 nao fechou. A v4.36.0 corrigiu a modalidade logistica
// (o verbo "enviar" com o cliente como remetente). Nao tocou no que persistiu o resto:
//
//   agente_noturno_estado.slots  ANTES {}  ->  DEPOIS {
//     "produto": "adesivo_uv", "quantidade": 300, "arte": "pack_evangelicos", ... }
//
// O cliente negociava CAMISETAS desde julho (orcamentos 8630 e 9931, "DTF Textil",
// grade M4/G7/GG3/G3-1/Infantil-1). NUNCA escreveu a palavra "adesivo". O unico "300"
// que ele digitou foi "posso enviar 300 agora ? e o restante daqui a 5 dias?" — DINHEIRO.
// Nenhuma tool rodou nesse turno (tools=[]). O modelo devolveu esses slots e eles viraram
// estado porque o merge era um spread cego:
//
//     const slotsNovos = { ...slotsAnteriores, ...slotsRecebidos };
//
// Ou seja: a saida probabilistica do modelo virava FATO COMERCIAL sem provar de onde veio.
// O token "adesivo_uv" nem sequer e vocabulario de produto: ele so existe no prompt como
// valor do enum "tema". Vazou de tema para slots.produto e ninguem conferiu.
//
// CORRECAO — contrato estrutural, nao regra para "300" nem para "adesivo".
//   Todo slot CRITICO que NASCE ou MUDA num turno precisa de fonte verificavel:
//   a fala do cliente, uma ferramenta, a fonte canonica, ou o estado anterior.
//   Sem fonte, a proposta e DESCARTADA e o que ja era fato permanece.
//   modalidade_logistica/envio_retirada saem das maos do modelo de vez: quem escreve e
//   o resolvedor deterministico (estadoLog), porque resolverModalidadeLogistica le esse
//   slot do estado SALVO — um palpite do modelo viraria "fonte" no turno seguinte.
// Nada financeiro e tocado: Pix, CalcMe, autorizacoes, TTS, debounce, LOST e handoff
// seguem byte-identicos. A correcao logistica da v4.36.0 fica intacta e e REUSADA aqui.
//
// ESCOPO DESTA PUBLICACAO (FASE 1): SO a porta de ESCRITA. O modelo continua podendo
// FALAR fato errado no texto — isso e ESPERADO aqui e e tratado na frente seguinte
// (guarda de saida, v4.38.0). O que esta publicacao garante e que o texto errado NAO
// contamina agente_noturno_estado.
const V = 'agente-noturno-v4.37.0';""", "cabecalho + const V")

# ── 2. modulo de proveniencia ───────────────────────────────────────────────
rep("""// MATRIZ produto x modalidade x ferramenta. produtos/modalidades = null significa transversal.""",
"""// ══ v4.37.0 P0: PROVENIENCIA OBRIGATORIA PARA FATO COMERCIAL ═══════════════
// O modelo PROPOE. So vira FATO com fonte verificavel. Slot critico = o que
// vira pedido, cobranca ou logistica.
// 'arte' NAO entra. MEDIDO em 1.273 turnos: 66 recusas, praticamente todas legitimas.
// Arte nasce de IMAGEM ou AUDIO do cliente ("[imagem]", "[audio]") ou de descricao em
// conversa — coisa que uma checagem de TEXTO nunca consegue lastrear. Gatear arte so
// gera falso positivo, e arte sozinha nao cria pedido errado: quem cria e produto,
// quantidade e modalidade, e esses estao gateados.
const SLOTS_CRITICOS = ['produto', 'quantidade', 'cep', 'pagamento', 'grade'];
// Escritos SO pelo resolvedor deterministico. O modelo nunca escreve modalidade.
const SLOTS_SO_DETERMINISTICOS = ['modalidade_logistica', 'envio_retirada'];

function semAcento(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
}

// O cliente falou ESTE valor? Compara os tokens do valor com o texto do cliente.
// Generico: nao conhece "adesivo" nem "300", so compara palavras.
function valorEcoaNoTexto(valor: any, texto: string): boolean {
  const alvo = semAcento(texto);
  const toks = semAcento(String(valor ?? '')).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!toks.length) return false;
  if (toks.some((t) => t.length >= 4 && alvo.includes(t))) return true;
  return toks.every((t) => alvo.includes(t));
}

// VOCABULARIO UNICO de unidade de mercadoria. Serve as DUAS pontas do contrato:
// a porta de escrita (o que pode virar quantidade) e a guarda de saida (o que pode
// ser afirmado ao cliente). Uma lista so, para as duas nao divergirem.
const NOMES_MERCADORIA = 'un\\\\b|und\\\\b|unid\\\\w*|pe[c\\u00e7]as?|camisetas?|baby\\\\s?looks?|regatas?|moletons?|polos?|jalecos?|uniformes?|adesivos?|copos?|canecas?|garrafas?|itens?|p[c\\u00e7]s?|pcs?|folhas?|metros?';
// Numero COM marcador de unidade ao lado. O numero entra por parametro: nao ha
// literal numerico nesta regra.
const RX_EVID_UNIDADE_SUF = '\\\\s*(?:x\\\\s*)?(?:' + NOMES_MERCADORIA + ')';
// Verbo de PEDIDO explicito. "mandar"/"enviar" NAO entram: sao verbos de remessa.
// "sao"/"total de" tambem nao entram: "sao 300" costuma ser preco, nao peca.
const RX_EVID_PEDIDO = /\\b(?:quero|queria|preciso|vou\\s+querer|fech\\w+|or[c\\u00e7]a\\w*|pedido\\s+(?:[e\\u00e9]|de))\\b/i;
// A frase fala de DINHEIRO. Se o numero so aparece aqui, nao e quantidade.
const RX_EVID_DINHEIRO = /(?:r\\$|reais|conto|entrada|sinal|adiantamento|dep[o\\u00f3]sito|pagar|paguei|pago|pagamento|transfer\\w+|\\bpix\\b|restante|resto|parcel\\w+|metade)/i;
// Cliente falou de TAMANHO na janela do pedido.
const RX_EVID_GRADE = /\\b(?:pp|p|m|g|gg|g1|g2|g3|xg|xgg|infantil|tamanh\\w+)\\b/i;

// O numero proposto como quantidade tem evidencia de UNIDADE na fala do cliente?
// Rejeita quando a unica ocorrencia esta em frase de dinheiro ou de remessa do
// proprio cliente — REUSANDO RX_ENVIO_REMETENTE_CLIENTE da v4.36.0.
function evidenciaDeQuantidade(valor: any, textos: string[]): { ok: boolean; evidencia: string | null } {
  const n = String(valor ?? '').replace(/\\D/g, '');
  if (!n) return { ok: false, evidencia: null };
  const rxNum = new RegExp('(?:^|[^\\\\d])' + n + '(?![\\\\d])');
  const rxUnidade = new RegExp(n + RX_EVID_UNIDADE_SUF, 'i');
  for (const t of (textos || [])) {
    for (const frase of String(t || '').split(/[.!?\\n]+/)) {
      const s = frase.trim();
      if (!s || !rxNum.test(s)) continue;
      // Unidade explicita ao lado do numero DECIDE: "quero 300 camisetas, pago no pix"
      // continua sendo quantidade mesmo falando de pagamento na mesma frase.
      if (rxUnidade.test(s)) return { ok: true, evidencia: s.slice(0, 120) };
      if (RX_ENVIO_REMETENTE_CLIENTE.test(s)) continue;   // "posso enviar 300 agora"
      if (RX_EVID_DINHEIRO.test(s)) continue;             // "entrada de 300", "paguei 300"
      if (RX_EVID_PEDIDO.test(s)) return { ok: true, evidencia: s.slice(0, 120) };
    }
  }
  return { ok: false, evidencia: null };
}

// Familias que a FALA DO CLIENTE admite. Existe para ACEITAR, nunca para recusar:
// so acrescenta caminho de aceitacao, entao nao enfraquece nenhuma guarda.
// MEDIDO: produtoNaMensagem perde sinal legitimo do cliente por vocabulario —
// "camisas" (so conhece "camiseta") e "Eu tenho uma de caneca" (a regra de peca
// propria exige "que tenho"/"ja tenho"). Copo/caneca emitem copo E dtf_uv porque a
// fala e compativel com os dois e quem escolhe entre eles e o modelo.
// normalizarProdutoMacro e produtoNaMensagem seguem INTOCADOS: gating de tool igual.
const FAMILIAS_FALA: Array<[RegExp, string[]]> = [
  [/t[e\u00ea]xtil|tecido|malha|pel[i\u00ed]cula|filme|prensa/i, ['dtf_textil']],
  [/\buv\b|adesivo|r[o\u00f3]tulo|etiqueta|vidro|metal|madeira|mdf|acr[i\u00ed]lico/i, ['dtf_uv']],
  [/copo|caneca|garrafa|cuia|t[e\u00e9]rmic/i, ['copo', 'dtf_uv']],
  [/camiseta|camisa|blusa|moletom|regata|baby\s?look|polo|jaleco|uniforme|colete|bon[e\u00e9]/i, ['camiseta']],
  [/\bpack\b|estampas?\s+pronta|anime|streetwear/i, ['pack']],
];
function familiasFaladasPeloCliente(texto: string): string[] {
  const t = semAcento(texto);
  const out: string[] = [];
  for (const [rx, fams] of FAMILIAS_FALA) if (rx.test(t)) out.push(...fams);
  return out;
}

// De onde veio este produto? null = de lugar nenhum verificavel.
function evidenciaDeProduto(valor: any, textos: string[], macroCanonico: string | null, macroAnterior: string | null): { fonte: string | null; macro: string | null } {
  const macro = normalizarProdutoMacro(valor);
  const texto = (textos || []).join(' \\n ');
  if (valorEcoaNoTexto(valor, texto)) return { fonte: 'mensagem_cliente', macro };
  // Por FRAGMENTO, nao so pelo texto inteiro: em "nao quero mais camiseta, quero
  // adesivo UV" o texto inteiro resolve para camiseta (a primeira regra que casa) e
  // esconderia a troca que o cliente acabou de declarar.
  if (macro) {
    for (const f of [texto, ...texto.split(/[,;.!?\\n]+/)]) {
      const t = f.trim();
      if (t && produtoNaMensagem(t) === macro) return { fonte: 'mensagem_cliente', macro };
    }
  }
  if (macro && familiasFaladasPeloCliente(texto).includes(macro)) return { fonte: 'mensagem_cliente', macro };
  if (macro && macroCanonico && macro === macroCanonico) return { fonte: 'canonico', macro };
  if (macro && macroAnterior && macro === macroAnterior) return { fonte: 'estado_anterior', macro };
  return { fonte: null, macro };
}

// Soma da grade = quantidade derivada de FATO ja aceito. "M 4 / G 7 / GG 3" = 14.
// Sem isto a porta recusaria a quantidade legitima do fluxo de camiseta, em que o
// cliente manda a grade e nunca digita o total.
function somaGrade(grade: any): number | null {
  if (!Array.isArray(grade) || !grade.length) return null;
  let t = 0;
  for (const item of grade) {
    const tam = item?.tamanhos || {};
    for (const k of Object.keys(tam)) { const n = Number(tam[k]); if (Number.isFinite(n) && n > 0) t += n; }
  }
  return t > 0 ? t : null;
}

// A PORTA. Devolve os slots que podem virar fato + a lista do que foi recusado.
function filtrarSlotsPorProveniencia(a: {
  anteriores: any; recebidos: any; textosCliente: string[];
  macroCanonico: string | null; toolsUsadas: string[];
  midiaNoTurno?: boolean; numerosDeFerramenta?: number[];
}): { slots: any; rejeitados: Array<{ slot: string; valor: any; motivo: string }> } {
  const rejeitados: Array<{ slot: string; valor: any; motivo: string }> = [];
  const out: any = { ...(a.recebidos || {}) };
  const ant: any = a.anteriores || {};
  const texto = (a.textosCliente || []).join(' \\n ');
  const macroAnterior = normalizarProdutoMacro(ant.produto);

  // Modalidade nunca vem do modelo: quem escreve e estadoLog, logo abaixo.
  for (const s of SLOTS_SO_DETERMINISTICOS) {
    if (out[s] !== undefined && String(out[s] ?? '') !== String(ant[s] ?? '')) {
      rejeitados.push({ slot: s, valor: out[s], motivo: 'so_resolvedor_deterministico' });
    }
    delete out[s];
  }

  for (const s of SLOTS_CRITICOS) {
    const v = out[s];
    if (v === undefined || v === null || v === '' || v === 'null') continue;
    // Identico ao que ja era fato: nao e criacao nem mudanca.
    if (ant[s] !== undefined && JSON.stringify(ant[s]) === JSON.stringify(v)) continue;

    let ok = false; let motivo = '';
    if (s === 'produto') {
      // CONTRADICAO, nao ausencia. MEDIDO em 1.273 turnos organicos: exigir evidencia
      // textual para TODO produto recusava 216 deles — quase todos DESCOBERTA legitima
      // no primeiro turno, em que o cliente so escreve "Ola! Posso ter mais informacoes
      // sobre isso?" (clique de anuncio) e o produto vem do ANUNCIO, nao da mensagem.
      // Sem referencia anterior nem canonica nao ha o que contradizer: aceita.
      // Com referencia, ela manda — foi exatamente o caso do Vitor (canonico=camiseta).
      const temReferencia = !!macroAnterior || !!a.macroCanonico;
      ok = !temReferencia || !!evidenciaDeProduto(v, a.textosCliente, a.macroCanonico, macroAnterior).fonte;
      motivo = 'produto_contradiz_referencia';
    } else if (s === 'quantidade') {
      // So numero puro entra na regra. MEDIDO: quantidade tambem chega como TEXTO
      // ("40 coletes (20 amarelo + 20 azul)", "37.86m + 4.56m", "100-200") e ai
      // replace(/\\D/g,'') fabricava um numero que nunca existiu. Descricao livre nao
      // e o defeito do Vitor — o dele era um numero puro (300) nascido de dinheiro.
      // A soma da grade ja aceita e fonte legitima: no fluxo de camiseta o cliente
      // manda "M 4 / G 7 / GG 3" e nunca digita o total.
      const ehNumeroPuro = typeof v === 'number' || /^\\s*\\d{1,6}(?:[.,]\\d+)?\\s*$/.test(String(v));
      const sg = somaGrade(out.grade ?? ant.grade);
      const nQ = Number(String(v).replace(',', '.'));
      // Numero devolvido por FERRAMENTA neste turno e fonte legitima: no fluxo por
      // metro a metragem sai de calcular_dtf_metro, nunca da fala do cliente.
      const deTool = (a.numerosDeFerramenta || []).some((x) => Number(x) === nQ);
      ok = !ehNumeroPuro
        || evidenciaDeQuantidade(v, a.textosCliente).ok
        || (sg !== null && nQ === sg)
        || deTool;
      motivo = 'quantidade_sem_evidencia_de_unidade';
    } else if (s === 'cep') {
      const d = String(v).replace(/\\D/g, '');
      ok = d.length === 8 && texto.replace(/\\D/g, '').includes(d);
      motivo = 'cep_nao_dito_pelo_cliente';
    } else if (s === 'arte') {
      // Arte quase sempre nasce de IMAGEM ou AUDIO que o cliente mandou — coisa que
      // uma checagem textual nunca ve. MEDIDO: exigir eco recusava refinamento
      // legitimo ("dois designs - frente e costas" -> o mesmo + nome da igreja).
      // Aceita eco, refinamento do valor anterior, ou midia no turno.
      const antAr = String(ant.arte ?? '');
      const novoAr = String(v ?? '');
      const refino = !!antAr && (semAcento(novoAr).includes(semAcento(antAr)) || semAcento(antAr).includes(semAcento(novoAr)));
      ok = valorEcoaNoTexto(v, texto) || refino || a.midiaNoTurno === true;
      motivo = 'arte_sem_evidencia';
    } else if (s === 'pagamento') {
      ok = valorEcoaNoTexto(v, texto) || a.midiaNoTurno === true
        || (a.toolsUsadas || []).some((t) => /pix|cobranca|pagamento|cartao/i.test(String(t)));
      motivo = 'pagamento_sem_evidencia';
    } else if (s === 'grade') {
      // So bloqueia o caso destrutivo: trocar grade JA CONHECIDA sem o cliente
      // ter falado de tamanho nenhum na janela do pedido.
      const jaTinha = Array.isArray(ant.grade) && ant.grade.length > 0;
      ok = !jaTinha || RX_EVID_GRADE.test(texto);
      motivo = 'grade_trocada_sem_o_cliente_falar_de_tamanho';
    }
    if (!ok) { rejeitados.push({ slot: s, valor: v, motivo }); delete out[s]; }
  }
  return { slots: out, rejeitados };
}

// MATRIZ produto x modalidade x ferramenta. produtos/modalidades = null significa transversal.""",
    "modulo de proveniencia")

# ── 3. a porta no ponto de persistencia ─────────────────────────────────────
rep("""  // FIX 1 (v87): resposta vazia do modelo NAO sobrescreve memoria estruturada ja preenchida.
  const slotsAnteriores: any = estado?.slots || {};
  const slotsRecebidos: any = decisao.slots || {};
  const slotsNovos: any = {""",
"""  // FIX 1 (v87): resposta vazia do modelo NAO sobrescreve memoria estruturada ja preenchida.
  const slotsAnteriores: any = estado?.slots || {};
  // ── v4.37.0 P0: o modelo PROPOE; so vira fato com proveniencia verificavel ──
  const textosCliente: string[] = [String(mensagem || ''), ...(inbounds || []).map((i: any) => String(i?.message_text || ''))];
  // Numeros que as FERRAMENTAS deste turno devolveram: fonte legitima de quantidade.
  const numerosFerramenta: number[] = [];
  for (const r of (Array.isArray(ctx.rendimentosAutorizados) ? ctx.rendimentosAutorizados : [])) {
    const v = Number(r?.cabem_por_metro); if (Number.isFinite(v) && v > 0) numerosFerramenta.push(v);
  }
  for (const v of (Array.isArray(ctx.rendimentosAuxiliares) ? ctx.rendimentosAuxiliares : [])) {
    if (Number.isFinite(Number(v)) && Number(v) > 0) numerosFerramenta.push(Number(v));
  }
  for (const it of (Array.isArray(calcmeVigente?.itens) ? calcmeVigente.itens : [])) {
    const q = Number(it?.qtd); if (Number.isFinite(q) && q > 0) numerosFerramenta.push(q);
  }
  const provSlots = filtrarSlotsPorProveniencia({
    anteriores: slotsAnteriores,
    recebidos: decisao.slots || {},
    textosCliente,
    macroCanonico: normalizarProdutoMacro(prodOrigem),
    toolsUsadas,
    midiaNoTurno: (imagens || []).length > 0 || (transcricoes || []).length > 0,
    numerosDeFerramenta: numerosFerramenta,
  });
  const slotsRecebidos: any = provSlots.slots;
  if (provSlots.rejeitados.length && !dryRun) {
    await logErro('slot_critico_sem_proveniencia', {
      phone: phone.slice(-4), turn_id: obsTurnId,
      rejeitados: provSlots.rejeitados.slice(0, 8),
    });
  }
  const slotsNovos: any = {""", "porta na persistencia")

# ── 4. observabilidade enxerga a divergencia ────────────────────────────────
rep("""    const prodMacroObs = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
    const propostas: Array<{ slot: string; motivo: string }> = [];""",
"""    const prodMacroObs = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
    // v4.37.0: produto preenchido que o vocabulario canonico nao reconhece deixa de
    // ser silencio. Foi assim que "adesivo_uv" atravessou com produto_macro=null.
    if ((slotsNovos.produto ?? null) !== null && prodMacroObs === null) {
      await logErro('slot_produto_fora_do_vocabulario', {
        phone: phone.slice(-4), turn_id: obsTurnId,
        produto: String(slotsNovos.produto).slice(0, 60),
      });
    }
    const propostas: Array<{ slot: string; motivo: string; aplicada?: boolean }> = [];
    // v4.37.0: o que a porta RECUSOU fica na observacao, ja aplicado.
    for (const r of provSlots.rejeitados) propostas.push({ slot: r.slot, motivo: r.motivo, aplicada: true });""",
    "observabilidade da divergencia")

for antigo, novo, nome in trocas:
    n = src.count(antigo)
    assert n == 1, 'ancora "%s" apareceu %d vezes (esperado 1)' % (nome, n)
    src = src.replace(antigo, novo)

io.open(OUT, 'w', encoding='utf-8').write(src)
sys.stderr.write('candidato v4.37.0 escrito: %d bytes, sha256 %s\n'
                 % (len(src), hashlib.sha256(src.encode('utf-8')).hexdigest()))
