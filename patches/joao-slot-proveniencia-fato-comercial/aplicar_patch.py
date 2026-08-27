# -*- coding: utf-8 -*-
"""v4.37.0 P0 — slot critico so vira FATO com proveniencia verificavel.

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
//
// SEGUNDA METADE DO CONTRATO — o fato tambem nao pode ser DITO.
// A porta acima impede o fato de virar ESTADO, mas `decisao.mensagem` nasce ANTES dela:
// o modelo ainda podia FALAR "os 300 adesivos". Entra entao uma guarda de SAIDA, no
// mesmo ponto onde ja moram as guardas de preco, rendimento e identificador financeiro:
// uma afirmacao de pedido (numero colado em substantivo de mercadoria) so sai se tiver
// lastro em `slotsNovos` — o snapshot que a porta ja aprovou. NUNCA em decisao.slots cru.
// Sem lastro: retry explicito -> revalida -> poda cirurgica (a mesma da v4.34.0) ->
// texto neutro. Prefere-se resposta neutra a mentira comercial; nunca silencio.
// Frase de tabela ("a partir de 10 unidades") nao e afirmacao de pedido e nao e tocada.
//
// Nada financeiro e tocado: Pix, CalcMe, autorizacoes, TTS, debounce, LOST e handoff
// seguem byte-identicos. A correcao logistica da v4.36.0 fica intacta e e REUSADA aqui:
// a guarda de CEP/frete da v4.34.0 continua sendo quem decide pedido de CEP.
const V = 'agente-noturno-v4.37.0';""", "cabecalho + const V")

# ── 2. modulo de proveniencia ───────────────────────────────────────────────
rep("""// MATRIZ produto x modalidade x ferramenta. produtos/modalidades = null significa transversal.""",
"""// ══ v4.37.0 P0: PROVENIENCIA OBRIGATORIA PARA FATO COMERCIAL ═══════════════
// O modelo PROPOE. So vira FATO com fonte verificavel. Slot critico = o que
// vira pedido, cobranca ou logistica.
const SLOTS_CRITICOS = ['produto', 'quantidade', 'arte', 'cep', 'pagamento', 'grade'];
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

// ── GUARDA DE SAIDA: fato comercial AFIRMADO ao cliente ────────────────────
// Uma afirmacao de pedido e um numero colado num substantivo de mercadoria:
// "300 adesivos", "16 camisetas", "12 un". Mencao solta de produto NAO conta —
// o Joao precisa poder oferecer catalogo sem ser bloqueado.
function fatosDePedidoNoTexto(texto: string): Array<{ num: string; unidade: string; trecho: string }> {
  const out: Array<{ num: string; unidade: string; trecho: string }> = [];
  // (?<![\\d.,]) e (?:[.,]\\d+)? porque "116,6 metros" e UM numero. Sem isso o extrator
  // lia "6 metros" e acusava divergencia onde nao havia. MEDIDO no replay organico.
  const rx = new RegExp('(?<![\\\\d.,])(\\\\d{1,6}(?:[.,]\\\\d+)?)\\\\s*(?:x\\\\s*)?(' + NOMES_MERCADORIA + ')', 'gi');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(String(texto || ''))) !== null) out.push({ num: m[1], unidade: m[2], trecho: m[0] });
  return out;
}
// Todos os numeros que a grade ja confirma: o total E cada tamanho. "Fica 17 unidades
// no tamanho M" e lastreado por grade.M=17, nao pela soma.
function numerosDaGrade(grade: any): number[] {
  const out: number[] = [];
  const s = somaGrade(grade);
  if (s !== null) out.push(s);
  for (const item of (Array.isArray(grade) ? grade : [])) {
    const tam = item?.tamanhos || {};
    for (const k of Object.keys(tam)) { const n = Number(tam[k]); if (Number.isFinite(n) && n > 0) out.push(n); }
  }
  return out;
}
// O numero AFIRMADO nasceu da fala de DINHEIRO do cliente? E o inverso exato de
// evidenciaDeQuantidade: aparece na fala dele, mas so em frase de dinheiro ou de
// remessa dele proprio. Foi assim que "300" (entrada em R$) virou "300 adesivos".
// ADJACENCIA, nao a frase inteira. MEDIDO: a versao por frase acusava "18" em
// "o valor pedido para dar a entrada, sobre a questao do 19 blusas e 18 kits" —
// a frase tem "entrada", mas o 18 esta colado em "kits", que e mercadoria que o
// vocabulario nao conhece. Exigir o marcador de dinheiro GRUDADO no numero mata
// essa classe inteira de falso positivo sem precisar crescer o vocabulario.
const RX_DINHEIRO_ANTES = /(?:r\\$|entrada|sinal|adiantamento|dep[o\\u00f3]sito|pagar|paguei|pago|pagamento|transferir|transferi|metade|dou|deposito)\\s*(?:de\\s+|uns\\s+|em\\s+|uma\\s+)?$/i;
const RX_DINHEIRO_DEPOIS = /^\\s*(?:reais|conto|pila|paus)\\b/i;
function numeroVeioDeDinheiroDoCliente(valor: string, textos: string[]): boolean {
  const n = String(valor ?? '').replace(/\\D/g, '');
  if (!n) return false;
  if (evidenciaDeQuantidade(n, textos).ok) return false;   // tem lastro de unidade: nao e dinheiro
  for (const t of (textos || [])) {
    const s = String(t || '');
    const rx = new RegExp('(?:^|[^\\\\d])' + n + '(?![\\\\d])', 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(s)) !== null) {
      const idx = m.index + m[0].length - n.length;
      const antes = s.slice(Math.max(0, idx - 28), idx);
      const depois = s.slice(idx + n.length, idx + n.length + 12);
      if (RX_DINHEIRO_ANTES.test(antes)) return true;
      if (RX_DINHEIRO_DEPOIS.test(depois)) return true;
      // O cliente como REMETENTE grudado no numero: "posso enviar 300".
      if (RX_ENVIO_REMETENTE_CLIENTE.test(antes + ' ' + n)) return true;
    }
  }
  return false;
}

// O que a resposta afirma que NAO tem lastro no estado verificado.
// `verificado` e o snapshot ja filtrado pela porta de escrita — nunca decisao.slots cru.
//
// DUAS regras, ambas estreitadas contra trafego organico real (284 turnos):
//  1. QUANTIDADE — so acusa quando o numero afirmado nasceu de fala de DINHEIRO do
//     cliente. Numero de tabela de preco, de orcamento, de ferramenta ou de grade tem
//     origem legitima e NAO e acusado. A versao ampla desta regra bloqueava 47,7% do
//     trafego normal: tabela por metro, KIT do catalogo, grade por tamanho.
//  2. PRODUTO — so acusa CONTRADICAO: o texto nomeia um produto diferente do que o
//     pedido verificado (ou a fonte canonica) diz, e o cliente nunca o nomeou.
// TODAS as familias presentes num texto, nao a primeira que casar. Existe SO para a
// guarda de saida: normalizarProdutoMacro NAO e tocado, entao o gating de ferramenta
// (MATRIZ_TOOL) segue exatamente igual. Ausencia de reconhecimento = nao comprovado.
function macrosDoTexto(s: string): string[] {
  const t = semAcento(s);
  const out: string[] = [];
  if (/textil/.test(t)) out.push('dtf_textil');
  if (/\\buv\\b|adesivo/.test(t)) out.push('dtf_uv');
  if (/copo|caneca|garrafa/.test(t)) out.push('copo');
  if (/camiseta|moletom|regata|baby ?look|polo|jaleco|uniforme|camisa/.test(t)) out.push('camiseta');
  return out;
}
// Frase de TABELA/limiar: nao afirma pedido nenhum.
const RX_FRAME_TABELA = /\\b(a\\s+partir\\s+de|acima\\s+de|abaixo\\s+de|m[i\\u00ed]nimo|cada|at[e\\u00e9]\\s+\\d|entre\\s+\\d|por\\s+unidade|faixa|tabela)\\b|\\d\\s*a\\s*\\d/i;

function afirmacoesSemLastro(a: {
  texto: string; verificado: any; textosCliente: string[];
  macroCanonico: string | null; numerosAutorizados: number[];
  descricoesCanonicas?: string[];
}): Array<{ trecho: string; motivo: string }> {
  const fora: Array<{ trecho: string; motivo: string }> = [];
  const ver = a.verificado || {};
  const textoCli = (a.textosCliente || []).join(' \\n ');
  // Conjunto de familias que o pedido ADMITE. Um pedido pode ser multi-produto
  // ("19 polos + 18 copos"): comparar com UMA macro so acusava contradicao falsa.
  const permitidos = new Set<string>([
    ...macrosDoTexto(String(ver.produto ?? '')),
    ...macrosDoTexto((Array.isArray(ver.grade) ? ver.grade : []).map((g: any) => String(g?.modelo ?? '')).join(' ')),
    ...macrosDoTexto(String(ver.arte ?? '')),
    ...macrosDoTexto(textoCli),
    ...(a.macroCanonico ? [a.macroCanonico] : []),
    ...macrosDoTexto((a.descricoesCanonicas || []).join(' ')),
  ]);
  const qtdVer = (ver.quantidade === undefined || ver.quantidade === null)
    ? null : Number(String(ver.quantidade).replace(',', '.'));
  const lastreados = new Set<number>([
    ...numerosDaGrade(ver.grade),
    ...(a.numerosAutorizados || []).map((x) => Number(x)),
  ]);
  if (qtdVer !== null && Number.isFinite(qtdVer)) lastreados.add(qtdVer);
  for (const f of fatosDePedidoNoTexto(a.texto)) {
    // Frase de TABELA/limiar nao afirma pedido: "1 a 4 metros R$59,90", "a partir de
    // 10 unidades". Preco ja tem guarda propria; aqui so evita falso positivo.
    const sent = String(a.texto).split(/(?<=[.!?])\\s+|\\n+/).find((s) => s.includes(f.trecho)) || a.texto;
    if (RX_FRAME_TABELA.test(sent)) continue;
    const n = Number(String(f.num).replace(',', '.'));
    const numOk = lastreados.has(n) || evidenciaDeQuantidade(f.num, a.textosCliente).ok;
    if (!numOk && numeroVeioDeDinheiroDoCliente(f.num, a.textosCliente)) {
      fora.push({ trecho: f.trecho, motivo: 'quantidade_veio_de_dinheiro' });
      continue;
    }
    // "unidades"/"itens"/"metros" nao nomeiam produto: so o numero e afirmado ali.
    // Conjunto vazio = nao se sabe nada do pedido: nao da para acusar contradicao.
    // Usa macrosDoTexto, nao produtoNaMensagem: este ultimo ancora em \\b e devolve
    // null para PLURAL ("camisetas", "adesivos") — MEDIDO. Familia ambigua = nao
    // comprovado, entao nao se acusa nada.
    const familias = macrosDoTexto(f.unidade);
    const macroUni = familias.length === 1 ? familias[0] : null;
    if (macroUni !== null && permitidos.size > 0 && !permitidos.has(macroUni)
        && !valorEcoaNoTexto(f.unidade, textoCli)) {
      fora.push({ trecho: f.trecho, motivo: 'produto_contradiz_pedido' });
    }
    // NAO existe regra de "quantidade divergente do pedido conhecido". Ela foi
    // implementada, MEDIDA no replay organico e RETIRADA: disparou 10 vezes em 281
    // turnos e quase todas eram legitimas — quantidade muda no meio da conversa
    // (cliente revisa, o Joao oferece completar o filme, a ferramenta calcula
    // rendimento). Estado verificado fica velho em relacao ao turno vivo. Sobraram
    // as duas regras que a medicao sustentou com zero falso positivo.
  }
  return fora;
}

// A PORTA. Devolve os slots que podem virar fato + a lista do que foi recusado.
function filtrarSlotsPorProveniencia(a: {
  anteriores: any; recebidos: any; textosCliente: string[];
  macroCanonico: string | null; toolsUsadas: string[];
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
      ok = !!evidenciaDeProduto(v, a.textosCliente, a.macroCanonico, macroAnterior).fonte;
      motivo = 'produto_sem_evidencia';
    } else if (s === 'quantidade') {
      // A soma da grade ja aceita e fonte legitima: no fluxo de camiseta o cliente
      // manda "M 4 / G 7 / GG 3" e nunca digita o total.
      const sg = somaGrade(out.grade ?? ant.grade);
      ok = evidenciaDeQuantidade(v, a.textosCliente).ok
        || (sg !== null && Number(String(v).replace(/\\D/g, '')) === sg);
      motivo = 'quantidade_sem_evidencia_de_unidade';
    } else if (s === 'cep') {
      const d = String(v).replace(/\\D/g, '');
      ok = d.length === 8 && texto.replace(/\\D/g, '').includes(d);
      motivo = 'cep_nao_dito_pelo_cliente';
    } else if (s === 'arte') {
      ok = valorEcoaNoTexto(v, texto);
      motivo = 'arte_sem_evidencia';
    } else if (s === 'pagamento') {
      ok = valorEcoaNoTexto(v, texto) || (a.toolsUsadas || []).some((t) => /pix|cobranca|pagamento|cartao/i.test(String(t)));
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
  const provSlots = filtrarSlotsPorProveniencia({
    anteriores: slotsAnteriores,
    recebidos: decisao.slots || {},
    textosCliente,
    macroCanonico: normalizarProdutoMacro(prodOrigem),
    toolsUsadas,
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

# ── 5. guarda de saida: fato comercial afirmado sem lastro ──────────────────
rep("""  // Ultima barreira antes do transporte. Entre este ponto e entregarComoJoao nenhuma linha""",
"""  // ── v4.37.0 P0: FATO COMERCIAL AFIRMADO SEM LASTRO ────────────────────
  // A porta de escrita impede o fato de virar ESTADO. Esta impede que ele seja DITO.
  // Roda depois de TODAS as reescritas (frete/CEP, preco, rendimento, hold de arte) e
  // antes da guarda financeira, para ver o texto exatamente como ele iria ao cliente.
  // A fonte de verdade e `slotsNovos` — o snapshot que a porta da v4.37.0 ja aprovou.
  // decisao.slots CRU nao entra aqui em momento nenhum.
  if (decisao.responde === true) {
    const numerosAut: number[] = [];
    for (const r of (Array.isArray(ctx.rendimentosAutorizados) ? ctx.rendimentosAutorizados : [])) {
      const v = Number(r?.cabem_por_metro); if (Number.isInteger(v) && v > 0) numerosAut.push(v);
    }
    for (const v of (Array.isArray(ctx.rendimentosAuxiliares) ? ctx.rendimentosAuxiliares : [])) {
      if (Number.isInteger(v) && v > 0) numerosAut.push(Number(v));
    }
    // O orcamento CalcMe e FONTE CANONICA: as quantidades e descricoes dos itens dele
    // lastreiam a fala. Sem isto a guarda acusaria a propria leitura do orcamento.
    const descCanon: string[] = [];
    const itensCanon: any[] = Array.isArray(calcmeVigente?.itens) ? calcmeVigente.itens : [];
    for (const it of itensCanon) {
      const q = Number(it?.qtd); if (Number.isFinite(q) && q > 0) numerosAut.push(q);
      if (it?.descricao) descCanon.push(String(it.descricao));
    }
    const argsLastro = {
      verificado: slotsNovos, textosCliente,
      macroCanonico: normalizarProdutoMacro(prodOrigem), numerosAutorizados: numerosAut,
      descricoesCanonicas: descCanon,
    };
    const semLastro = afirmacoesSemLastro({ texto: resposta, ...argsLastro });
    if (semLastro.length > 0) {
      const respostaOriginalFato = resposta;
      const valoresAntesFato = valoresDaMensagem(respostaOriginalFato);
      await logErro('guardrail_fato_comercial_sem_lastro', {
        phone, afirmacoes: semLastro, verificado: slotsNovos,
        resposta: respostaOriginalFato.slice(0, 300), tools: toolsUsadas,
      });
      let desfechoFato = 'rejeitado';
      try {
        const conhecido = [
          slotsNovos.produto ? 'produto: ' + String(slotsNovos.produto) : null,
          (slotsNovos.quantidade !== undefined && slotsNovos.quantidade !== null) ? 'quantidade: ' + String(slotsNovos.quantidade) : null,
          somaGrade(slotsNovos.grade) !== null ? 'total pela grade: ' + String(somaGrade(slotsNovos.grade)) : null,
        ].filter(Boolean).join('; ');
        const df = await chamarCerebro('[SISTEMA: sua resposta afirma fato comercial SEM fonte verificavel: '
          + semLastro.map((x: any) => '"' + x.trecho + '" (' + x.motivo + ')').join(', ') + '. '
          + 'PROIBIDO inventar produto, quantidade ou medida. So pode afirmar o que esta no pedido confirmado.\\n'
          + 'Pedido confirmado deste cliente: ' + (conhecido || '(nada confirmado ainda)') + '.\\n'
          + (conhecido
              ? 'Reescreva usando SOMENTE esses dados.'
              : 'Nao afirme produto nem quantidade nenhuma: responda de forma curta e neutra, sem numero de peca.')
          + ' MANTENHA todos os valores em R$ que voce ja calculou. Retorne APENAS o JSON.]');
        const rf = aberturaCorreta(sanearMsg(df.mensagem), !conversaAtivaHoje, false);
        const valoresDepoisFato = valoresDaMensagem(rf);
        // Invariante de preservacao de valor (v4.21.6): o retry nao pode apagar R$ ja calculado.
        const perdeuValorFato = valoresAntesFato.some((v: number) => !valoresDepoisFato.includes(v));
        const aindaSemLastro = afirmacoesSemLastro({ texto: rf, ...argsLastro });
        if (df.responde === true && aindaSemLastro.length === 0 && !perdeuValorFato
            && validarMsg(rf, ehPerguntaDireta) && validarPix(rf)
            && !(estadoLog.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(rf))) {
          resposta = rf; desfechoFato = 'aceito';
        }
      } catch (e: any) {
        await logErro('guardrail_fato_sem_lastro_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) });
      }
      if (desfechoFato !== 'aceito') {
        // Cirurgia deterministica: remove SO as sentencas que carregam a afirmacao sem
        // lastro. Reusa a mesma poda da v4.34.0 — nada de mecanismo novo.
        const rxFora = new RegExp(semLastro
          .map((x: any) => x.trecho.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\s+/g, '\\\\s+'))
          .join('|'), 'i');
        const podadoFato = removerSentencasComTermo(respostaOriginalFato, rxFora);
        const sobrouLastro = afirmacoesSemLastro({ texto: podadoFato, ...argsLastro });
        if (podadoFato.length >= 8 && sobrouLastro.length === 0
            && !valoresAntesFato.some((v: number) => !valoresDaMensagem(podadoFato).includes(v))) {
          resposta = podadoFato; desfechoFato = 'preservado_cirurgia';
        } else {
          // Sem texto aproveitavel. Neutro e verdadeiro: nao inventa produto, nao inventa
          // quantidade, nao pede CEP. Prefere-se resposta neutra a mentira comercial.
          resposta = 'Perfeito! Recebi por aqui. Vou seguir com o seu pedido conforme o que a gente j\\u00e1 combinou e te confirmo os detalhes na sequ\\u00eancia.';
          desfechoFato = 'substituido_deterministico';
        }
      }
      await logErro('guardrail_fato_comercial_desfecho', {
        phone, resultado: desfechoFato, afirmacoes: semLastro,
        valores_antes: valoresAntesFato, valores_depois: valoresDaMensagem(resposta),
        resposta_original: respostaOriginalFato.slice(0, 600), resposta_final: resposta.slice(0, 600),
      });
    }
  }

  // Ultima barreira antes do transporte. Entre este ponto e entregarComoJoao nenhuma linha""", "guarda de saida de fato comercial")

for antigo, novo, nome in trocas:
    n = src.count(antigo)
    assert n == 1, 'ancora "%s" apareceu %d vezes (esperado 1)' % (nome, n)
    src = src.replace(antigo, novo)

io.open(OUT, 'w', encoding='utf-8').write(src)
sys.stderr.write('candidato v4.37.0 escrito: %d bytes, sha256 %s\n'
                 % (len(src), hashlib.sha256(src.encode('utf-8')).hexdigest()))
