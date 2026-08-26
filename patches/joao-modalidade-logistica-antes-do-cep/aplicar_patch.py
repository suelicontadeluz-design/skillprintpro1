# -*- coding: utf-8 -*-
"""
v4.34.0 P0 — modalidade logistica antes do CEP.
Aplica substituicoes ANCORADAS sobre a fonte LIVE (base.ts).
Toda ancora e exigida exatamente uma vez: se o texto vivo mudar, o patch FALHA
em vez de aplicar torto.
"""
import io, sys, hashlib

BASE = sys.argv[1]
OUT  = sys.argv[2]

src = io.open(BASE, encoding='utf-8').read()
assert hashlib.sha256(src.encode('utf-8')).hexdigest() == \
    'a9a4aaf143a1188b0308ec459cda69d6d4479ead95704ddf61664db3401b91b4', 'base nao e a LIVE'

trocas = []
def rep(ancora, novo, rotulo):
    trocas.append((ancora, novo, rotulo))

# ─────────────────────────────────────────────────────────────────────────────
# 1. CABECALHO DE VERSAO
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""const V = 'agente-noturno-v4.33.0';""",
"""//
// v4.34.0 (26/08/2026) P0 — MODALIDADE LOGISTICA E RESOLVIDA ANTES DO CEP.
// Rollback: redeploy do v4.33.0 (Edge 176, index.ts sha256 a9a4aaf143a1188b0308ec459cda
// 69d6d4479ead95704ddf61664db3401b91b4). Nao ha migracao nem tabela nova: o unico estado
// novo e a chave slots.modalidade_logistica dentro do jsonb ja existente de
// agente_noturno_estado, e ela e ignorada por qualquer versao anterior.
//
// CASO ORGANICO 5511952315439 (Carolina, 26/08/2026, cliente recorrente, 10 compras):
//   21:05:33 ela escreveu "A quantidade e 14 / Forma de retirada : retirada presencial"
//   21:08:08 o Joao respondeu "Preciso do seu CEP para gerar a cobranca correta, mesmo
//            sendo retirada."
//   21:08:24 ela passou 05893-000
//   21:08:38 o Joao chamou calcular_frete e ofereceu "Sedex R$11,93 ou PAC R$18,54"
//   21:09:11 ela repetiu "Vamos retirar"
//   21:09:27 o Joao voltou a perguntar "quantidade, medida, CEP ou forma de retirada?"
//   21:09:53 ela encerrou o assunto com "Ja passei essas informacoes".
//
// CAUSA ESTRUTURAL, nao desatencao do modelo. Tres pecas empurravam na mesma direcao:
//   (a) SLOTS tratava "envio/retirada + CEP" como UM slot unico;
//   (b) FECHAMENTO dizia "CEP -> calcular_frete -> TOTAL", fazendo do CEP requisito
//       quase obrigatorio da cobranca;
//   (c) blocoLocalizacao mandava "ASSUMA ENVIO: peca o CEP completo" para todo DDD != 11.
// CEP e CONSEQUENCIA DE ENVIO. Nunca slot universal do fechamento.
//
// O QUE ESTA IMPLEMENTADO AQUI, verificavel linha a linha:
//  1. ESTADO CANONICO POR TURNO: modalidade_logistica em {retirada, motoboy, envio,
//     desconhecida}, resolvido por PRECEDENCIA DE FONTES — (1) declaracao explicita mais
//     recente do cliente no turno, (2) declaracao recente na conversa do pedido / estado ja
//     confirmado, (3) historico confiavel do proprio cliente, (4) localizacao por DDD como
//     PISTA, (5) desconhecida. Fonte 4 NUNCA vira fato.
//  2. GUARDA DETERMINISTICA DE FERRAMENTA: com retirada/motoboy (ou produto digital, ou
//     modalidade indefinida onde retirada e plausivel), calcular_frete e INTERCEPTADA ANTES
//     DA EXECUCAO — mesmo padrao ja usado pelo redirecionamento de calcular_dtf_metro. Nao
//     e shadow: executada=false, enforcement_ativo=true.
//  3. VALIDACAO DE SAIDA: pedido de CEP e oferta de PAC/Sedex sao rejeitados na RESPOSTA
//     quando a modalidade nao admite frete. O retry so e aceito se nao apagar valor ja
//     calculado; sem retry valido, a frase ofensora e removida cirurgicamente (mesma
//     invariante de subconjunto da v4.21.6).
//  4. FALLBACK TERMINAL DEIXA DE SER LISTA FIXA: "quantidade, medida, CEP ou forma de
//     retirada?" era literal e reaparecia mesmo com tudo respondido. Agora so pergunta o
//     que de fato falta, e nunca cita CEP fora de envio.
//  5. ROTEIRO CORRIGIDO: produto -> arte -> quantidade -> MODALIDADE -> [envio: CEP ->
//     frete] -> orcamento -> pagamento. Gerar cobranca NAO exige CEP.
// NADA de preco, Pix, cartao, compor_total, operation_id, CalcMe, arquivos, TTS, debounce,
// LOST, correlacao inbound/outbound ou egresso financeiro foi alterado.
const V = 'agente-noturno-v4.34.0';""",
"cabecalho + const V")

# ─────────────────────────────────────────────────────────────────────────────
# 2. blocoLocalizacao: DDD vira PISTA, nao decisao. + modulo novo logo abaixo.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""function blocoLocalizacao(phone: string): string {
  const ddd = phone.length >= 4 ? phone.slice(2, 4) : '';
  const uf = DDD_UF[ddd] || '';
  if (!uf) return '';
  if (ddd === '11') return '\\n\\n[LOCALIZA\\u00c7\\u00c3O: DDD 11 (Grande SP). Pode oferecer RETIRADA ou ENVIO.]';
  return `\\n\\n[LOCALIZA\\u00c7\\u00c3O: DDD ${ddd} = ${UF_NOME[uf] || uf}. ASSUMA ENVIO: pe\\u00e7a o CEP completo, 8 d\\u00edgitos.]`;
}
""",
"""function blocoLocalizacao(phone: string): string {
  const ddd = phone.length >= 4 ? phone.slice(2, 4) : '';
  const uf = DDD_UF[ddd] || '';
  if (!uf) return '';
  if (ddd === '11') return '\\n\\n[LOCALIZA\\u00c7\\u00c3O: DDD 11 (Grande SP). Retirada presencial e possivel para este cliente.]';
  // v4.34.0 P0: o texto anterior era "ASSUMA ENVIO: peca o CEP completo, 8 digitos". Ele
  // transformava um DDD — que nao e endereco e nao e escolha do cliente — em ordem de pedir
  // CEP, e por ai o CEP virava requisito de fechamento. DDD e PISTA, nunca decisao.
  return `\\n\\n[LOCALIZA\\u00c7\\u00c3O: DDD ${ddd} = ${UF_NOME[uf] || uf}. Isso e PISTA REGIONAL, N\\u00c3O \\u00e9 decis\\u00e3o de log\\u00edstica: envio \\u00e9 prov\\u00e1vel, mas n\\u00e3o afirme como fato e n\\u00e3o pe\\u00e7a CEP antes de a modalidade estar resolvida. Retirada presencial s\\u00f3 na Grande SP.]`;
}

// ══ v4.34.0 P0: MODALIDADE LOGISTICA — ESTADO CANONICO RESOLVIDO ANTES DO CEP ══
// Conceito NOVO e separado de slots.produto e da modalidade metro/peca da v4.28.0 (P14).
// Reaproveitar qualquer um dos dois destruiria distincao que ja tem consumidor.
type ModalidadeLogistica = 'retirada' | 'motoboy' | 'envio' | 'desconhecida';

// Motoboy e retirada POR PROCURACAO: o cliente manda alguem buscar. Nao gera frete Correios.
const RX_LOG_MOTOBOY = /\\b(motoboy|moto\\s?boy|motoqueiro|lalamove|uber\\s?flash|99\\s?(?:entregas?|flash)|mensageiro|portador)\\b/i;
const RX_LOG_RETIRADA = /\\b(retirad[ao]s?|retirar|retiro|retiramos|retirei|presencial(?:mente)?)\\b|\\bem\\s+m[a\\u00e3]os\\b|\\b(?:busc(?:ar|o|amos)|peg(?:ar|o|amos)|pass(?:ar|o|amos))\\s+(?:a[i\\u00ed]|l[a\\u00e1]|no\\s+local|na\\s+loja|pessoalmente|o\\s+pedido|o\\s+material)\\b|\\bvou\\s+a[i\\u00ed]\\b|\\bno\\s+local\\b|\\bna\\s+loja\\b/i;
const RX_LOG_ENVIO = /\\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?)|correios?|sedex|pac|transportadora|frete|postagem|postar)\\b|\\bentreg(?:ar|a|ue)\\s+(?:em\\s+casa|no\\s+meu|no\\s+endere[c\\u00e7]o)\\b|\\breceber\\s+em\\s+casa\\b|\\bmandar?\\s+(?:pelo|por|via)\\b/i;
// Negacao curta ANTES do termo, dentro da mesma sentenca: "nao vou retirar", "sem frete".
const RX_LOG_NEGACAO = /\\b(n[a\\u00e3]o|sem|nem|nada\\s+de)\\b/i;
// "Forma de retirada: envio pelos Correios" — o ROTULO nao pode contar como declaracao.
const RX_ROTULO_LOGISTICA = /\\bforma\\s+de\\s+(?:retirada|entrega|envio|recebimento)\\s*:?/gi;
const RX_CEP_TEXTO = /\\b(\\d{5})-?(\\d{3})\\b/;

function cepDoTexto(t: string): string | null {
  const m = String(t || '').match(RX_CEP_TEXTO);
  return m ? (m[1] + m[2]) : null;
}
function sentencasLogisticas(txt: string): string[] {
  return String(txt || '').replace(RX_ROTULO_LOGISTICA, ' ')
    .split(/[.!?;\\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function termoPositivo(sent: string, rx: RegExp): boolean {
  const r = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(sent)) !== null) {
    // A negacao vale dentro da MESMA ORACAO. "Nao vou retirar, prefiro envio" nega
    // retirar e NAO nega envio; sem este corte a virgula seria ignorada e o cliente
    // que corrige a propria fala seria lido ao contrario.
    const antes = sent.slice(0, m.index);
    const b = antes.toLowerCase();
    const corte = Math.max(antes.lastIndexOf(','), antes.lastIndexOf(';'),
      b.lastIndexOf(' mas '), b.lastIndexOf(' porem '), b.lastIndexOf(' por\u00e9m '));
    const oracao = corte >= 0 ? antes.slice(corte + 1) : antes;
    if (!RX_LOG_NEGACAO.test(oracao.slice(-28))) return true;
  }
  return false;
}
// Classifica UMA fala do CLIENTE. Nunca recebe texto do Joao: o que ele escreve nao
// declara nada pelo cliente. Sinais conflitantes na mesma fala devolvem null de proposito.
function classificarDeclaracaoLogistica(texto: string): { modalidade: ModalidadeLogistica | null; trecho: string | null } {
  let motoboy: string | null = null, retirada: string | null = null, envio: string | null = null;
  for (const s of sentencasLogisticas(texto)) {
    if (motoboy === null && termoPositivo(s, RX_LOG_MOTOBOY)) motoboy = s;
    if (retirada === null && termoPositivo(s, RX_LOG_RETIRADA)) retirada = s;
    if (envio === null && termoPositivo(s, RX_LOG_ENVIO)) envio = s;
  }
  if (motoboy !== null) return { modalidade: 'motoboy', trecho: motoboy.slice(0, 120) };
  if (retirada !== null && envio === null) return { modalidade: 'retirada', trecho: retirada.slice(0, 120) };
  if (envio !== null && retirada === null) return { modalidade: 'envio', trecho: envio.slice(0, 120) };
  return { modalidade: null, trecho: null };
}
function normalizarModalidadeSlot(v: any): ModalidadeLogistica | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s || s === 'null') return null;
  if (/motoboy|moto boy|lalamove|entregador/.test(s)) return 'motoboy';
  if (/retirad|retirar|presencial|no local|na loja/.test(s)) return 'retirada';
  if (/envio|enviar|correio|sedex|pac|frete|entrega/.test(s)) return 'envio';
  return null;
}

type EstadoLogistico = {
  modalidade: ModalidadeLogistica;
  proveniencia: string;
  fonte_nivel: number;
  evidencia: string | null;
  confirmar_com_cliente: boolean;
  bloqueia_frete: boolean;
  motivo_bloqueio: string;
  pedir_cep: boolean;
  cep_conhecido: string | null;
  cep_fonte: string | null;
  retirada_plausivel: boolean;
  produto_digital: boolean;
  ddd: string;
};

// PRECEDENCIA DAS FONTES (a ordem e a regra, nao um detalhe):
//  1 declaracao explicita do cliente NESTE turno
//  2 declaracao explicita mais recente do cliente na conversa do pedido; depois o estado
//    ja confirmado no pedido (slots)
//  3 historico confiavel do proprio cliente
//  4 localizacao/DDD: PISTA, jamais fato
//  5 desconhecida
function resolverModalidadeLogistica(a: {
  mensagemAtual: string; inboundsPedido: any[]; historicoInbound: any[];
  slots: any; phone: string; freteJa: any | null; produtoContexto: string;
}): EstadoLogistico {
  const ddd = String(a.phone || '').length >= 4 ? String(a.phone).slice(2, 4) : '';
  const grandeSP = ddd === '11';
  const produtoDigital = /\\bpacks?\\b|estampas?\\s+pronta|arquivo\\s+digital/i.test(String(a.produtoContexto || ''));

  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.
  let cep: string | null = null; let cepFonte: string | null = null;
  const cepSlot = a.slots?.cep ? String(a.slots.cep).replace(/\\D/g, '') : '';
  if (cepSlot.length === 8) { cep = cepSlot; cepFonte = 'slot'; }
  if (!cep) for (const i of (a.inboundsPedido || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'inbound_do_pedido'; break; } }
  if (!cep && a.freteJa?.cep_destino) { const c = String(a.freteJa.cep_destino).replace(/\\D/g, ''); if (c.length === 8) { cep = c; cepFonte = 'frete_ja_calculado'; } }
  if (!cep) for (const i of (a.historicoInbound || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'historico'; break; } }

  const montar = (m: ModalidadeLogistica, prov: string, nivel: number, ev: string | null, confirmar: boolean): EstadoLogistico => {
    const semFretePorModalidade = m === 'retirada' || m === 'motoboy';
    const indefinidaComRetiradaPlausivel = m === 'desconhecida' && grandeSP;
    const bloqueia = semFretePorModalidade || produtoDigital || indefinidaComRetiradaPlausivel;
    const motivo = produtoDigital ? 'produto_digital_sem_frete'
      : semFretePorModalidade ? ('modalidade_' + m + '_nao_tem_frete')
      : indefinidaComRetiradaPlausivel ? 'modalidade_indefinida_com_retirada_plausivel'
      : 'sem_bloqueio';
    return {
      modalidade: m, proveniencia: prov, fonte_nivel: nivel, evidencia: ev,
      confirmar_com_cliente: confirmar,
      bloqueia_frete: bloqueia, motivo_bloqueio: motivo,
      // So se PEDE CEP quando ele e necessario E ainda nao existe.
      pedir_cep: !bloqueia && !cep,
      cep_conhecido: cep, cep_fonte: cepFonte,
      retirada_plausivel: semFretePorModalidade || grandeSP,
      produto_digital: produtoDigital, ddd,
    };
  };

  const n1 = classificarDeclaracaoLogistica(a.mensagemAtual);
  if (n1.modalidade) return montar(n1.modalidade, 'declaracao_explicita_no_turno', 1, n1.trecho, false);

  for (const i of (a.inboundsPedido || [])) {
    const c = classificarDeclaracaoLogistica(String(i?.message_text || ''));
    if (c.modalidade) return montar(c.modalidade, 'declaracao_recente_do_cliente', 2, c.trecho, false);
  }
  const slotMod = normalizarModalidadeSlot(a.slots?.modalidade_logistica) ?? normalizarModalidadeSlot(a.slots?.envio_retirada);
  if (slotMod) return montar(slotMod, 'estado_confirmado_no_pedido', 2, null, false);

  for (const i of (a.historicoInbound || [])) {
    const c = classificarDeclaracaoLogistica(String(i?.message_text || ''));
    // Historico REDUZ ATRITO, nao decide: entra com confirmar_com_cliente=true, e qualquer
    // fala nova do cliente (nivel 1 ou 2) o atropela.
    if (c.modalidade) return montar(c.modalidade, 'historico_do_cliente', 3, c.trecho, true);
  }

  return montar('desconhecida',
    grandeSP ? 'pista_regional_grande_sp' : (ddd ? 'pista_regional_fora_da_grande_sp' : 'sem_sinal'),
    ddd ? 4 : 5, null, false);
}

function blocoModalidadeLogistica(e: EstadoLogistico): string {
  const evid = e.evidencia ? ` O cliente escreveu: "${e.evidencia}".` : '';
  if (e.produto_digital && e.modalidade !== 'envio') {
    return '\\n\\n[LOG\\u00cdSTICA: PRODUTO DIGITAL. A entrega \\u00e9 por LINK no WhatsApp. N\\u00c3O existe CEP, N\\u00c3O existe frete e N\\u00c3O existe endere\\u00e7o neste pedido.]';
  }
  if (e.modalidade === 'retirada' || e.modalidade === 'motoboy') {
    const nome = e.modalidade === 'motoboy' ? 'MOTOBOY (o cliente manda buscar)' : 'RETIRADA PRESENCIAL';
    const conf = e.confirmar_com_cliente
      ? ` Isso vem do HIST\\u00d3RICO deste cliente, n\\u00e3o do pedido de hoje: confirme em UMA pergunta curta ("${e.modalidade === 'motoboy' ? 'Vai mandar o motoboy como das outras vezes?' : 'Vai retirar aqui como das outras vezes?'}") e siga. Se ele disser que agora quer envio, a fala NOVA dele vale mais que o hist\\u00f3rico.`
      : '';
    const cepNota = e.cep_conhecido ? ' Existe CEP conhecido deste cliente e ele N\\u00c3O muda nada aqui: nesta modalidade o CEP n\\u00e3o \\u00e9 usado para nada.' : '';
    return `\\n\\n[MODALIDADE LOG\\u00cdSTICA J\\u00c1 RESOLVIDA: ${nome}.${evid}${conf}`
      + '\\nPROIBIDO pedir CEP. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.'
      + '\\nGERAR COBRAN\\u00c7A N\\u00c3O EXIGE CEP: sem frete, o TOTAL \\u00e9 o valor do produto. \\u00c9 PROIBIDO escrever que precisa do CEP para gerar a cobran\\u00e7a, inclusive com a ressalva "mesmo sendo retirada".'
      + `${cepNota}]`;
  }
  if (e.modalidade === 'envio') {
    return e.cep_conhecido
      ? `\\n\\n[MODALIDADE LOG\\u00cdSTICA J\\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ${e.cep_conhecido} J\\u00c1 \\u00c9 CONHECIDO (fonte: ${e.cep_fonte}). N\\u00c3O pe\\u00e7a de novo: use esse CEP em calcular_frete e feche com produto + frete.]`
      : `\\n\\n[MODALIDADE LOG\\u00cdSTICA J\\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ainda falta: pe\\u00e7a UMA vez, 8 d\\u00edgitos, e chame calcular_frete em seguida.]`;
  }
  if (e.retirada_plausivel) {
    return '\\n\\n[MODALIDADE LOG\\u00cdSTICA N\\u00c3O RESOLVIDA e RETIRADA \\u00c9 PLAUS\\u00cdVEL (Grande SP). Fa\\u00e7a UMA pergunta: retirada aqui em Embu ou envio pelos Correios?'
      + '\\nPROIBIDO pedir CEP antes da resposta. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.]';
  }
  return '\\n\\n[MODALIDADE LOG\\u00cdSTICA N\\u00c3O RESOLVIDA. O cliente est\\u00e1 fora da Grande SP, ent\\u00e3o ENVIO \\u00e9 o caminho prov\\u00e1vel — mas isso \\u00e9 pista, n\\u00e3o fato: havendo qualquer sinal de retirada, pergunte antes.'
    + (e.cep_conhecido ? ` O CEP ${e.cep_conhecido} j\\u00e1 \\u00e9 conhecido (fonte: ${e.cep_fonte}): N\\u00c3O pe\\u00e7a de novo.]` : ' S\\u00f3 pe\\u00e7a o CEP quando ele realmente faltar para o frete.]');
}

// Fallback terminal do fechamento. A v4.33.0 usava uma lista FIXA ("quantidade, medida, CEP
// ou forma de retirada?") que reaparecia mesmo com tudo respondido — foi ela que fechou o
// loop no caso Carolina. Agora pergunta SO o que falta, e nunca cita CEP fora de envio.
function perguntaDoQueFaltaFechamento(e: EstadoLogistico, slots: any): string {
  const tem = (k: string) => {
    const v = slots?.[k];
    return v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null';
  };
  const faltas: string[] = [];
  if (!tem('quantidade')) faltas.push('a quantidade');
  if (!tem('arte') && !tem('quantidade')) faltas.push('a medida');
  if (e.modalidade === 'desconhecida' && !e.produto_digital) faltas.push('se \\u00e9 retirada ou envio');
  if (e.modalidade === 'envio' && !e.cep_conhecido) faltas.push('o CEP');
  if (faltas.length === 0) {
    return 'Para gerar a cobran\\u00e7a correta, me confirma s\\u00f3 a forma de pagamento: Pix ou cart\\u00e3o?';
  }
  const lista = faltas.length === 1 ? faltas[0] : faltas.slice(0, -1).join(', ') + ' e ' + faltas[faltas.length - 1];
  return `Para gerar a cobran\\u00e7a correta, preciso concluir o valor do pedido. Me confirma ${lista}?`;
}

// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy
// confirmados, nenhuma destas palavras pode atravessar.
const RX_SAIDA_TERMO_FRETE = /\\b(cep|pac|sedex|correios?)\\b/i;
// Remove do texto APENAS as sentencas que carregam o termo proibido. Nao reescreve, nao
// resume, nao recalcula — mesma disciplina de removerPerguntaRepetida (v4.21.6).
function removerSentencasComTermo(texto: string, rx: RegExp): string {
  const partes = String(texto || '').split(/(?<=[.!?])\\s+|\\n+/);
  const testar = new RegExp(rx.source, rx.flags.replace('g', ''));
  return partes.filter((p) => !testar.test(p)).join(' ')
    .replace(/[ \\t]{2,}/g, ' ').replace(/\\s+([.,;:!?])/g, '$1')
    .replace(/\\n{3,}/g, '\\n\\n').trim();
}
""",
"blocoLocalizacao + modulo modalidade logistica")

# ─────────────────────────────────────────────────────────────────────────────
# 3. SYSTEM: SLOTS deixa de ter "envio/retirada + CEP" como slot unico.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""SLOTS: produto -> arte -> quantidade -> envio/retirada + CEP -> or\\u00e7amento -> "Vamos fechar?" -> "Pix ou cart\\u00e3o?".""",
"""SLOTS: produto -> arte -> quantidade -> MODALIDADE LOG\\u00cdSTICA (retirada, motoboy ou envio) -> [s\\u00f3 se for ENVIO: CEP -> frete] -> or\\u00e7amento -> "Vamos fechar?" -> "Pix ou cart\\u00e3o?".
CEP N\\u00c3O \\u00c9 SLOT UNIVERSAL: ele s\\u00f3 existe quando a modalidade \\u00e9 ENVIO. Retirada e motoboy fecham SEM CEP e SEM frete. GERAR COBRAN\\u00c7A N\\u00c3O EXIGE CEP: \\u00e9 PROIBIDO escrever que precisa do CEP para gerar a cobran\\u00e7a quando o cliente vai retirar.
RESOLVA A MODALIDADE ANTES DO CEP. Uma pergunta: "retirada aqui em Embu ou envio?". Nunca junte as duas coisas numa pergunta s\\u00f3 ("quer retirada ou envio para um CEP?") — isso confunde e faz o cliente repetir o que j\\u00e1 disse.""",
"SYSTEM SLOTS")

# ─────────────────────────────────────────────────────────────────────────────
# 4. SYSTEM: FECHAMENTO passo 2.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""2. CEP -> calcular_frete -> TOTAL = produto + frete.""",
"""2. Resolva a MODALIDADE LOG\\u00cdSTICA. RETIRADA ou MOTOBOY: n\\u00e3o existe frete — siga direto para o TOTAL do produto, sem CEP. ENVIO: reutilize o CEP que voc\\u00ea j\\u00e1 tem, ou pe\\u00e7a UMA vez, e s\\u00f3 ent\\u00e3o calcular_frete -> TOTAL = produto + frete.""",
"SYSTEM FECHAMENTO passo 2")

# ─────────────────────────────────────────────────────────────────────────────
# 5. SYSTEM: slot novo no contrato JSON (envio_retirada preservado por compat).
# ─────────────────────────────────────────────────────────────────────────────
rep(
""""envio_retirada": "...ou null", "cep": "...ou null",""",
""""envio_retirada": "...ou null", "modalidade_logistica": "retirada|motoboy|envio ou null", "cep": "...ou null",""",
"SYSTEM contrato de slots")

# ─────────────────────────────────────────────────────────────────────────────
# 6. REGRAS_EXTRA: roteiro do copo + regra explicita de cobranca sem CEP.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""- ROTEIRO DO COPO: 1. calcular_copo. 2. "Me fala o tema que a gente monta a arte." 3. CEP -> calcular_frete -> TOTAL. 4. "Pix ou cartao?" -> gerar_pix.""",
"""- ROTEIRO DO COPO: 1. calcular_copo. 2. "Me fala o tema que a gente monta a arte." 3. Resolva a modalidade: retirada ou motoboy fecham SEM frete e SEM CEP; envio -> CEP -> calcular_frete -> TOTAL. 4. "Pix ou cartao?" -> gerar_pix.
- MODALIDADE LOGISTICA ANTES DO CEP: o CEP e CONSEQUENCIA de ENVIO, nunca requisito do fechamento. Enquanto voce nao souber se o cliente retira, manda motoboy ou quer envio, NAO peca CEP e NAO chame calcular_frete. Se ele ja disse que retira, PROIBIDO pedir CEP, PROIBIDO oferecer PAC ou Sedex e PROIBIDO dizer "preciso do seu CEP para gerar a cobranca, mesmo sendo retirada" — essa frase e falsa: cobranca nao usa CEP.
- HISTORICO DE RETIRADA OU MOTOBOY: serve para REDUZIR ATRITO, nao para decidir. Confirme em uma pergunta ("Vai retirar como das outras vezes?") e siga. Se o cliente disser outra coisa NESTE pedido, a fala nova dele vence o historico.
- NAO REPERGUNTE O QUE JA FOI RESPONDIDO: se o cliente ja informou quantidade, medida, forma de entrega ou CEP, esses dados estao resolvidos. Voltar a lista-los numa pergunta e o mesmo erro que faz o cliente responder "ja passei essas informacoes".""",
"REGRAS_EXTRA roteiro + modalidade")

# ─────────────────────────────────────────────────────────────────────────────
# 7. Leitura do historico logistico + resolucao do estado canonico.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""  const obsModalidade = detectarModalidade(mensagem);
  const obsCorrecoes = detectarCorrecoes(mensagem);""",
"""  const obsModalidade = detectarModalidade(mensagem);
  const obsCorrecoes = detectarCorrecoes(mensagem);

  // ── v4.34.0 P0: HISTORICO LOGISTICO DO CLIENTE (fonte de NIVEL 3) ─────────
  // Janela longa e SOMENTE INBOUND: o que o Joao escreveu nao declara nada pelo cliente.
  // Recorta fora a janela do pedido atual (14h), que ja e coberta por `inbounds` no nivel 2.
  let historicoInbound: any[] = [];
  try {
    const { data: hl } = await sb.from('fact_conversations')
      .select('message_text, timestamp').like('phone', `%${phone.slice(-8)}`)
      .eq('direction', 'inbound')
      .gte('timestamp', new Date(Date.now() - 180 * 24 * 3600000).toISOString())
      .lt('timestamp', new Date(Date.now() - 14 * 3600000).toISOString())
      .order('timestamp', { ascending: false }).limit(40);
    historicoInbound = hl || [];
  } catch (e: any) { await logErro('historico_logistico_falhou', { phone, erro: String(e?.message ?? e).slice(0, 120) }); }

  const estadoLog = resolverModalidadeLogistica({
    mensagemAtual: mensagem,
    inboundsPedido: inbounds,
    historicoInbound,
    slots: { ...(estado?.slots || {}) },
    phone,
    freteJa: execucoes.freteJa,
    produtoContexto: [prodMsg, estado?.slots?.produto, categoriaAnuncio].filter(Boolean).join(' '),
  });
  L('modalidade_logistica', {
    phone: phone.slice(-4), modalidade: estadoLog.modalidade, prov: estadoLog.proveniencia,
    nivel: estadoLog.fonte_nivel, bloqueia_frete: estadoLog.bloqueia_frete, pedir_cep: estadoLog.pedir_cep,
  });
  if (!dryRun && estadoLog.fonte_nivel <= 3) {
    await logErro('modalidade_logistica_resolvida', {
      phone, turn_id: obsTurnId, agent_version: V,
      modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
      fonte_nivel: estadoLog.fonte_nivel, evidencia: estadoLog.evidencia,
      confirmar_com_cliente: estadoLog.confirmar_com_cliente,
      bloqueia_frete: estadoLog.bloqueia_frete, motivo_bloqueio: estadoLog.motivo_bloqueio,
      pedir_cep: estadoLog.pedir_cep, cep_conhecido: estadoLog.cep_conhecido, cep_fonte: estadoLog.cep_fonte,
    });
  }""",
"historico logistico + resolucao")

# ─────────────────────────────────────────────────────────────────────────────
# 8. systemFinal recebe o bloco de modalidade.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""    + blocoLocalizacao(phone) + blocoOrigem + blocoAnuncio + blocoMudouProduto + blocoPreco + blocoObjecao + blocoRespostaCurta + blocoArquivos""",
"""    + blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) + blocoOrigem + blocoAnuncio + blocoMudouProduto + blocoPreco + blocoObjecao + blocoRespostaCurta + blocoArquivos""",
"systemFinal + bloco modalidade")

# ─────────────────────────────────────────────────────────────────────────────
# 9. GUARDA DETERMINISTICA: intercepta calcular_frete ANTES da execucao.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""        const out = await executarTool(toolEfetiva, inputEfetivo, ctx);
        toolsUsadas.push(toolEfetiva);""",
"""        // ── v4.34.0 P0: GUARDA DETERMINISTICA DE FRETE POR MODALIDADE ────────
        // ENFORCEMENT REAL, nao shadow. Texto de prompt nao resolve: no caso Carolina o
        // modelo pediu o CEP e chamou calcular_frete com "retirada presencial" escrito no
        // proprio turno. A chamada e INTERCEPTADA ANTES DA EXECUCAO, no mesmo ponto em que
        // a v4.21.9 ja intercepta calcular_dtf_metro. Nenhuma autorizacao de frete nasce,
        // entao compor_total e gerar_pix nao tem como somar frete que nao existe.
        if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {
          await logErro('guardrail_frete_bloqueado_modalidade', {
            phone, lead: leadId, turn_id: obsTurnId,
            modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
            fonte_nivel: estadoLog.fonte_nivel, motivo: estadoLog.motivo_bloqueio,
            evidencia: estadoLog.evidencia,
            cep_tentado: String((inputEfetivo as any)?.cep_destino || '').slice(0, 12),
          });
          if (!dryRun) {
            await registrarGuardaToolShadow({
              phone, lead_id: leadId, turn_id: obsTurnId, agent_version: V,
              tool_name: 'calcular_frete',
              produto_macro: normalizarProdutoMacro((decisao?.slots || {}).produto ?? estado?.slots?.produto ?? prodMsg),
              modalidade_detectada: obsModalidade.modalidade,
              permitida: false, motivo: estadoLog.motivo_bloqueio,
              executada: false, enforcement_ativo: true,
            });
          }
          toolsUsadas.push('calcular_frete_bloqueado');
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({
            ok: false, erro: 'frete_incompativel_com_modalidade',
            modalidade_logistica: estadoLog.modalidade,
            acao: estadoLog.produto_digital
              ? 'Este produto e DIGITAL: a entrega e por link no WhatsApp. NAO existe frete, NAO peca CEP e NAO fale de PAC nem Sedex.'
              : estadoLog.modalidade === 'desconhecida'
                ? 'A forma de entrega ainda NAO foi resolvida e retirada e plausivel. Pergunte em UMA frase se ele quer retirada aqui em Embu ou envio, e NAO peca CEP antes da resposta.'
                : 'O cliente JA disse que vai ' + (estadoLog.modalidade === 'motoboy' ? 'mandar motoboy buscar' : 'retirar presencialmente')
                  + '. NAO existe frete neste pedido. NAO peca CEP, NAO ofereca PAC nem Sedex e NAO diga que precisa do CEP para gerar a cobranca. Feche com o valor do produto.',
          }) });
          continue;
        }
        const out = await executarTool(toolEfetiva, inputEfetivo, ctx);
        toolsUsadas.push(toolEfetiva);""",
"guarda deterministica calcular_frete")

# ─────────────────────────────────────────────────────────────────────────────
# 10. Retry que forca PAC/Sedex na resposta nao pode rodar sob retirada.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""  if (decisao.responde === true && toolsUsadas.includes('calcular_frete') && !execucoes.freteJa && !/PAC|Sedex|SEDEX|frete/i.test(resposta)) {""",
"""  // v4.34.0 P0: `&& !estadoLog.bloqueia_frete` — este retry EXIGE PAC/Sedex no texto. Sob
  // retirada/motoboy ele seria a propria fonte da oferta de Correios que a frente proibe.
  if (decisao.responde === true && !estadoLog.bloqueia_frete && toolsUsadas.includes('calcular_frete') && !execucoes.freteJa && !/PAC|Sedex|SEDEX|frete/i.test(resposta)) {""",
"retry PAC/Sedex sob bloqueio")

# ─────────────────────────────────────────────────────────────────────────────
# 11. VALIDACAO DE SAIDA — CEP/PAC/Sedex com modalidade sem frete.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""  // v4.22.6: terminal anti-promessa. Os retries acima podem falhar ou devolver outra promessa;""",
"""  // ── v4.34.0 P0: VALIDACAO DE SAIDA — PEDIDO DE CEP / OFERTA DE CORREIOS ───────────
  // A guarda de ferramenta impede o frete de ser CALCULADO; esta impede que a RESPOSTA peca
  // CEP ou ofereca PAC/Sedex quando a modalidade nao admite frete. Foi exatamente por aqui
  // que "Preciso do seu CEP para gerar a cobranca correta, mesmo sendo retirada" saiu sem
  // nenhuma ferramenta envolvida. Preservacao de valor e SUBCONJUNTO (invariante da
  // v4.21.6): o retry so e aceito se nao apagar valor que nao seja de frete.
  if (decisao.responde === true && estadoLog.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(resposta)) {
    const respostaOriginalLog = resposta;
    const valoresAntesLog = valoresDaMensagem(respostaOriginalLog);
    await logErro('guardrail_cep_ou_correios_sem_frete', {
      phone, modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
      motivo: estadoLog.motivo_bloqueio, resposta: respostaOriginalLog.slice(0, 300),
      tools: toolsUsadas,
    });
    let desfechoLog = 'rejeitado';
    try {
      const nomeMod = estadoLog.produto_digital ? 'PRODUTO DIGITAL (entrega por link)'
        : estadoLog.modalidade === 'motoboy' ? 'MOTOBOY'
        : estadoLog.modalidade === 'retirada' ? 'RETIRADA PRESENCIAL'
        : 'AINDA NAO RESOLVIDA';
      const dcep = await chamarCerebro('[SISTEMA: a forma de entrega deste pedido e ' + nomeMod + '. '
        + 'Nesta situacao NAO existe frete: e PROIBIDO pedir CEP, PROIBIDO falar em PAC, Sedex ou Correios '
        + 'e PROIBIDO dizer que precisa do CEP para gerar a cobranca. Cobranca nao usa CEP. '
        + (estadoLog.modalidade === 'desconhecida'
            ? 'Pergunte em UMA frase apenas se ele quer retirar aqui em Embu ou receber por envio. '
            : 'Nao pergunte de novo a forma de entrega: ela ja esta definida. ')
        + 'Reescreva a resposta MANTENDO todos os valores em R$ que voce ja calculou para o produto. Retorne APENAS o JSON.]');
      const rcep = aberturaCorreta(sanearMsg(dcep.mensagem), !conversaAtivaHoje, false);
      const valoresDepoisLog = valoresDaMensagem(rcep);
      // Valor de FRETE pode e deve sumir; valor de PRODUTO nao. Como o frete nunca foi
      // calculado neste turno (a guarda o bloqueou), qualquer valor perdido e perda real.
      const perdeuValorLog = valoresAntesLog.some((v: number) => !valoresDepoisLog.includes(v));
      if (dcep.responde === true && !RX_SAIDA_TERMO_FRETE.test(rcep) && !perdeuValorLog
          && validarMsg(rcep, ehPerguntaDireta) && validarPix(rcep)) {
        decisao = dcep; resposta = rcep; desfechoLog = 'aceito';
      }
    } catch (e: any) {
      await logErro('guardrail_cep_sem_frete_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) });
    }
    if (desfechoLog !== 'aceito') {
      // Cirurgia deterministica: remove SO as sentencas que carregam CEP/PAC/Sedex/Correios.
      const podado = removerSentencasComTermo(respostaOriginalLog, RX_SAIDA_TERMO_FRETE);
      if (podado.length >= 8 && !RX_SAIDA_TERMO_FRETE.test(podado)) {
        resposta = podado; desfechoLog = 'preservado_cirurgia';
      } else {
        // Sem texto aproveitavel. Mensagem deterministica, SEM numero novo: nao inventa
        // total e nao repete pergunta ja respondida.
        resposta = estadoLog.produto_digital
          ? 'O arquivo \\u00e9 digital e vai por link aqui no WhatsApp, sem frete. Pix ou cart\\u00e3o?'
          : estadoLog.modalidade === 'motoboy'
            ? 'Combinado, o motoboy retira aqui em Embu e n\\u00e3o tem frete. Pix ou cart\\u00e3o?'
            : estadoLog.modalidade === 'retirada'
              ? 'Combinado, fica retirada aqui em Embu e n\\u00e3o tem frete. Pix ou cart\\u00e3o?'
              : 'Voc\\u00ea prefere retirar aqui em Embu ou receber por envio?';
        desfechoLog = 'substituido_deterministico';
      }
    }
    await logErro('guardrail_cep_ou_correios_desfecho', {
      phone, modalidade: estadoLog.modalidade, resultado: desfechoLog,
      valores_antes: valoresAntesLog, valores_depois: valoresDaMensagem(resposta),
      resposta_original: respostaOriginalLog.slice(0, 600), resposta_final: resposta.slice(0, 600),
    });
  }

  // v4.22.6: terminal anti-promessa. Os retries acima podem falhar ou devolver outra promessa;""",
"validacao de saida cep/correios")

# ─────────────────────────────────────────────────────────────────────────────
# 12. Fallback terminal deixa de ser lista fixa com CEP.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""      resposta = 'Para gerar a cobran\\u00e7a correta, preciso primeiro concluir o valor do pedido. Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?';""",
"""      // v4.34.0 P0: a lista FIXA saiu. Ela citava CEP e "forma de retirada" mesmo com os
      // dois ja respondidos, e foi ela que fechou o loop com a Carolina (21:00, 21:03,
      // 21:09 e 21:16 — quatro vezes o mesmo texto, tres delas depois de ela responder).
      resposta = perguntaDoQueFaltaFechamento(estadoLog, { ...(estado?.slots || {}), ...(decisao.slots || {}) });""",
"fallback terminal do fechamento")

# ─────────────────────────────────────────────────────────────────────────────
# 13. Fallback "Anotei seu CEP" nao pode disparar sob retirada/motoboy/digital.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""      else if (ehCep) { resposta = 'Anotei seu CEP! J\\u00e1 calculo o frete e te passo o total certinho.'; decisao.tema = 'frete'; }""",
"""      // v4.34.0 P0: `&& !estadoLog.bloqueia_frete`. Sob retirada/motoboy um CEP recebido
      // NAO vira frete: no caso Carolina o CEP so existiu porque o Joao o exigiu contra o
      // que ela tinha acabado de escrever.
      else if (ehCep && !estadoLog.bloqueia_frete) { resposta = 'Anotei seu CEP! J\\u00e1 calculo o frete e te passo o total certinho.'; decisao.tema = 'frete'; }""",
"fallback ehCep")

# ─────────────────────────────────────────────────────────────────────────────
# 14. Persistencia do estado canonico nos slots.
# ─────────────────────────────────────────────────────────────────────────────
rep(
"""  if (slotsSalvos._idioma) slotsNovos._idioma = slotsSalvos._idioma;""",
"""  // v4.34.0 P0: a modalidade resolvida por fonte EXPLICITA (niveis 1 e 2) vira estado do
  // pedido, para o proximo turno nao precisar redescobrir nem reperguntar. Historico
  // (nivel 3) e pista regional (nivel 4) NAO sao persistidos: nao sao declaracao do cliente.
  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {
    slotsNovos.modalidade_logistica = estadoLog.modalidade;
    slotsNovos.envio_retirada = estadoLog.modalidade === 'envio' ? 'envio'
      : estadoLog.modalidade === 'motoboy' ? 'motoboy' : 'retirada';
  }
  if (slotsSalvos._idioma) slotsNovos._idioma = slotsSalvos._idioma;""",
"persistencia slots.modalidade_logistica")

# ─────────────────────────────────────────────────────────────────────────────
out = src
for ancora, novo, rotulo in trocas:
    n = out.count(ancora)
    if n != 1:
        sys.stderr.write('FALHA ancora [%s]: encontrada %d vez(es)\n' % (rotulo, n))
        sys.exit(1)
    out = out.replace(ancora, novo, 1)
    sys.stderr.write('ok  %s\n' % rotulo)

io.open(OUT, 'w', encoding='utf-8').write(out)
sys.stderr.write('escrito %s (%d bytes, sha256 %s)\n' % (
    OUT, len(out.encode('utf-8')), hashlib.sha256(out.encode('utf-8')).hexdigest()))
