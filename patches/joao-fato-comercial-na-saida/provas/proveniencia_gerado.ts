// GERADO AUTOMATICAMENTE por provas/extrair.py — NAO EDITAR.
// Recorte VERBATIM de candidato/index.ts.

// ═══════ PREAMBULO DE MOCK — NAO FAZ PARTE DO CANDIDATO ═══════
// Substitui apenas o MUNDO (funcao de log). Nenhuma regra e reimplementada.
export const ERROS: any[] = [];
export function resetErros() { ERROS.length = 0; }
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }
function termoPositivo(s: string, rx: RegExp): boolean {
  // Recorte funcional de negacao usado pelo candidato. Nos testes de proveniencia
  // nenhuma frase usa negacao, entao o comportamento observavel e identico.
  return rx.test(s) && !/\b(nao|n\u00e3o)\b[^.!?]{0,20}$/i.test(s);
}
// ═══════ FIM DO MOCK — daqui para baixo e recorte VERBATIM ═══════

const RX_PROD_UV = /\b(dtf ?uv|adesivo|etiqueta|r[o\u00f3]tulo|copo|caneca|garrafa|vidro|metal|madeira|mdf|acr[i\u00ed]lico)\b/i;
const RX_PROD_TEXTIL = /\b(dtf ?t[e\u00ea]xtil|dtf|pel[i\u00ed]cula|filme|tecido|malha|prensa)\b/i;
const RX_PROD_CAMISETA = /\b(camiseta|moletom|baby ?look|regata|polo|uniforme|oversized)\b/i;
// v105: os NOMES DOS TEMAS eram invisiveis. O cliente recebia a lista de packs, respondia
// "Streetwear", e o detector nao reconhecia: virava palavra solta e o agente voltava ao produto
// anterior. Caso Os Incansaveis 01/08 19:03 — escolheu o pack e recebeu pergunta sobre
// impressao de camiseta. MEDIDO em 30 dias: 12 clientes escolheram tema, 10 nao fecharam.
const RX_PROD_PACK = /\b(pack|packs|cat[a\u00e1]logo de estampas|comprar estampas?|quero estampas? prontas?|procuro artes? prontas?|anime|animes|streetwear|street ?wear|nba|rock|futebol|hip ?hop|cat[o\u00f3]lic[oa]s?|caveiras?)\b/i;
// FIX 2 (v87): "ja tenho a arte pronta" e POSSE da arte, nao interesse em comprar pack.
const RX_ARTE_PROPRIA_PRONTA = /\b(j[a\u00e1]\s+tenho|eu\s+tenho|tenho|minha|meu|minhas|meus|j[a\u00e1]\s+possuo)\b.{0,30}\b(arte|artes|estampa|estampas)\s+pront[ao]s?\b/i;
const RX_PROD_COPO = /\b(copo|caneca|garrafa|cuia|t[e\u00e9]rmic|vaso)\b/i;
// v4.20: cliente que JA TEM a peca quer o ADESIVO, nao o produto
const RX_PECA_PROPRIA = /\b(meu|minha|meus|minhas|que eu tenho|que tenho|pr[o\u00f3]prio|pr[o\u00f3]pria|j[a\u00e1] tenho|de vidro|colar? (no|na|em))\b/i;
// v106: PRECOS DE TABELA FIXA QUE O PROMPT JA ENTREGA AO AGENTE.
// O guardrail 'preco_sem_tool' exigia chamada de ferramenta para QUALQUER valor em R$. Mas a
// FICHA TECNICA do system prompt entrega precos fixos ao agente ("A4 R$29,90, A3 R$39,90",
// "copo R$35,90 abaixo de 10 e R$29,90 a partir de 10", "packs a partir de R$6,90", a tabela
// de DTF textil). O agente obedecia o prompt, falava o valor CERTO, e era derrubado por isso.
// MEDIDO em 14 dias: 59 bloqueios, e 31 deles eram o preco EXATO da tabela oficial.
// Caso 02/08 09:23 (14 99122-2117): cliente pediu folha A4, o modelo respondeu
// "Folha A4 sai por R$29,90" — correto — e o cliente recebeu frase de espera.
// Estes valores sao FATO FIXO, nao calculo. Qualquer outro valor continua exigindo ferramenta.
// v4.21.1: precos confirmados pelo Alessandro em 03/08/2026.
const PRECOS_DE_FICHA = new Set<number>([
  2990, 3990,              // folha A4 e folha A3 de DTF UV
  3590,                    // copo termico avulso
  690, 990, 1990,          // packs de estampas
  5990, 5490, 4990, 4490, 3990, // tabela de DTF textil por faixa
]);
// v4.21.2: subconjunto da ficha que e preco FECHADO DE UNIDADE — o unico que pode virar
// autorizacao de produto sozinho. A tabela por METRO fica de fora de proposito: la o numero
// e preco unitario e o total depende da metragem, entao emitir autorizacao com ele cobraria
// 1 metro num pedido de 10.
const PRECOS_FICHA_FECHADOS = new Set<number>([
  2990, 3990,        // folha A4 e folha A3 de DTF UV
  3590,              // copo termico avulso
  690, 990, 1990,    // packs de estampas
]);
const ABERTURAS = ['Combinado!', 'Perfeito!', 'Maravilha!', 'Show!'];


function produtoNaMensagem(msg: string): string | null {
  const m = String(msg || '');
  const falaDeArtePropria = RX_ARTE_PROPRIA_PRONTA.test(m);
  if (!falaDeArtePropria && RX_PROD_PACK.test(m)) return 'pack';
  if (RX_PROD_CAMISETA.test(m)) return 'camiseta';
  // v4.20: copo + peca propria = quer ADESIVO, nao o copo
  if (RX_PROD_COPO.test(m) && (RX_PECA_PROPRIA.test(m) || /adesivo|dtf|uv|estampa/i.test(m))) return 'dtf_uv';
  if (RX_PROD_COPO.test(m)) return 'copo';
  if (RX_PROD_UV.test(m)) return 'dtf_uv';
  if (RX_PROD_TEXTIL.test(m)) return 'dtf_textil';
  return null;
}
function categoriaParaProduto(cat: string): string | null {
  const c = String(cat || '').toLowerCase();
  if (!c) return null;
  if (c.includes('pack') || c.includes('anime') || c.includes('estampa')) return 'pack';
  if (c.includes('uv')) return 'dtf_uv';
  if (c.includes('textil') || c.includes('t\u00eaxtil')) return 'dtf_textil';
  if (c.includes('camiseta') || c.includes('uniforme') || c.includes('terceirao') || c.includes('evangel')) return 'camiseta';
  if (c.includes('copo')) return 'copo';
  return null;
}

// v4.36.0: o sinal de envio passa a ter DOIS niveis, porque o verbo sozinho mentia.
// FORTE nomeia o meio de transporte — nao importa quem e o sujeito da frase.
const RX_LOG_ENVIO_FORTE = /\b(correios?|sedex|pac|transportadora|postagem|postar|frete)\b/i;
// VERBO e apenas candidato. Precisa passar pelos dois filtros abaixo.
const RX_LOG_ENVIO_VERBO = /\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?))\b|\bmandar?\s+(?:pelo|por|via|pra|para)\b|\bentreg(?:ar|a|ue)\s+(?:em\s+casa|no\s+meu|no\s+endere[c\u00e7]o)\b|\breceber\s+em\s+casa\b/i;
// O CLIENTE como REMETENTE. "posso enviar 300 agora", "vou mandar o comprovante", "ja enviei
// a arte" — nada disso e forma de entrega. Foi por aqui que o caso 5511994088967 entrou.
const RX_ENVIO_REMETENTE_CLIENTE = /\b(posso|poderia|vou|irei|consigo|acabei\s+de|estou|t[o\u00f4]|j[a\u00e1]|eu)\s+(?:te\s+|lhe\s+|j[a\u00e1]\s+)?(?:envi|mand)/i;
// Objeto que nao e mercadoria: dinheiro, arquivo, arte, comprovante, numero solto.
const RX_ENVIO_OBJETO_NAO_LOGISTICO = /(?:envi|mand)\w*\s+(?:o\s+|a\s+|os\s+|as\s+|um\s+|uma\s+|meu\s+|minha\s+|mais\s+)?(?:arquivo|arte|foto|imagem|print|comprovante|pix|pagamento|dinheiro|valor|dep[o\u00f3]sito|r?\$?\s*\d)/i;
// Mantido para compatibilidade de leitura: a uniao dos dois niveis, sem os filtros.
const RX_LOG_ENVIO = new RegExp(RX_LOG_ENVIO_FORTE.source + '|' + RX_LOG_ENVIO_VERBO.source, 'i');
// Decide envio numa sentenca. Negacao continua sendo tratada por termoPositivo.
function envioPositivoNaSentenca(s: string): boolean {
  if (termoPositivo(s, RX_LOG_ENVIO_FORTE)) return true;
  if (!termoPositivo(s, RX_LOG_ENVIO_VERBO)) return false;
  if (RX_ENVIO_REMETENTE_CLIENTE.test(s)) return false;
  if (RX_ENVIO_OBJETO_NAO_LOGISTICO.test(s)) return false;
  return true;
}
// Negacao curta ANTES do termo, dentro da mesma sentenca: "nao vou retirar", "sem frete".
const RX_LOG_NEGACAO = /\b(n[a\u00e3]o|sem|nem|nada\s+de)\b/i;
// "Forma de retirada: envio pelos Correios" — o ROTULO nao pode contar como declaracao.
const RX_ROTULO_LOGISTICA = /\bforma\s+de\s+(?:retirada|entrega|envio|recebimento)\s*:?/gi;
const RX_CEP_TEXTO = /\b(\d{5})-?(\d{3})\b/;

function cepDoTexto(t: string): string | null {
  const m = String(t || '').match(RX_CEP_TEXTO);
  return m ? (m[1] + m[2]) : null;
}

function normalizarProdutoMacro(v: any): string | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s || s === 'null') return null;
  if (/t[êe]xtil/.test(s) || s === 'dtf_textil') return 'dtf_textil';
  if (/\buv\b/.test(s) || s === 'dtf_uv') return 'dtf_uv';
  if (/copo/.test(s)) return 'copo';
  if (/camiseta|moletom|regata|baby\s?look/.test(s)) return 'camiseta';
  return null;
}

// ══ v4.37.0 P0: PROVENIENCIA OBRIGATORIA PARA FATO COMERCIAL ═══════════════
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
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
const NOMES_MERCADORIA = 'un\\b|und\\b|unid\\w*|pe[c\u00e7]as?|camisetas?|baby\\s?looks?|regatas?|moletons?|polos?|jalecos?|uniformes?|adesivos?|copos?|canecas?|garrafas?|itens?|p[c\u00e7]s?|pcs?|folhas?|metros?';
// Numero COM marcador de unidade ao lado. O numero entra por parametro: nao ha
// literal numerico nesta regra.
const RX_EVID_UNIDADE_SUF = '\\s*(?:x\\s*)?(?:' + NOMES_MERCADORIA + ')';
// Verbo de PEDIDO explicito. "mandar"/"enviar" NAO entram: sao verbos de remessa.
// "sao"/"total de" tambem nao entram: "sao 300" costuma ser preco, nao peca.
const RX_EVID_PEDIDO = /\b(?:quero|queria|preciso|vou\s+querer|fech\w+|or[c\u00e7]a\w*|pedido\s+(?:[e\u00e9]|de))\b/i;
// A frase fala de DINHEIRO. Se o numero so aparece aqui, nao e quantidade.
const RX_EVID_DINHEIRO = /(?:r\$|reais|conto|entrada|sinal|adiantamento|dep[o\u00f3]sito|pagar|paguei|pago|pagamento|transfer\w+|\bpix\b|restante|resto|parcel\w+|metade)/i;
// Cliente falou de TAMANHO na janela do pedido.
const RX_EVID_GRADE = /\b(?:pp|p|m|g|gg|g1|g2|g3|xg|xgg|infantil|tamanh\w+)\b/i;

// O numero proposto como quantidade tem evidencia de UNIDADE na fala do cliente?
// Rejeita quando a unica ocorrencia esta em frase de dinheiro ou de remessa do
// proprio cliente — REUSANDO RX_ENVIO_REMETENTE_CLIENTE da v4.36.0.
function evidenciaDeQuantidade(valor: any, textos: string[]): { ok: boolean; evidencia: string | null } {
  const n = String(valor ?? '').replace(/\D/g, '');
  if (!n) return { ok: false, evidencia: null };
  const rxNum = new RegExp('(?:^|[^\\d])' + n + '(?![\\d])');
  const rxUnidade = new RegExp(n + RX_EVID_UNIDADE_SUF, 'i');
  for (const t of (textos || [])) {
    for (const frase of String(t || '').split(/[.!?\n]+/)) {
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
  [/t[eê]xtil|tecido|malha|pel[ií]cula|filme|prensa/i, ['dtf_textil']],
  [/uv|adesivo|r[oó]tulo|etiqueta|vidro|metal|madeira|mdf|acr[ií]lico/i, ['dtf_uv']],
  [/copo|caneca|garrafa|cuia|t[eé]rmic/i, ['copo', 'dtf_uv']],
  [/camiseta|camisa|blusa|moletom|regata|baby\s?look|polo|jaleco|uniforme|colete|bon[eé]/i, ['camiseta']],
  [/pack|estampas?\s+pronta|anime|streetwear/i, ['pack']],
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
  const texto = (textos || []).join(' \n ');
  if (valorEcoaNoTexto(valor, texto)) return { fonte: 'mensagem_cliente', macro };
  // Por FRAGMENTO, nao so pelo texto inteiro: em "nao quero mais camiseta, quero
  // adesivo UV" o texto inteiro resolve para camiseta (a primeira regra que casa) e
  // esconderia a troca que o cliente acabou de declarar.
  if (macro) {
    for (const f of [texto, ...texto.split(/[,;.!?\n]+/)]) {
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

// ── GUARDA DE SAIDA: fato comercial AFIRMADO ao cliente ────────────────────
// Uma afirmacao de pedido e um numero colado num substantivo de mercadoria:
// "300 adesivos", "16 camisetas", "12 un". Mencao solta de produto NAO conta —
// o Joao precisa poder oferecer catalogo sem ser bloqueado.
function fatosDePedidoNoTexto(texto: string): Array<{ num: string; unidade: string; trecho: string }> {
  const out: Array<{ num: string; unidade: string; trecho: string }> = [];
  // (?<![\d.,]) e (?:[.,]\d+)? porque "116,6 metros" e UM numero. Sem isso o extrator
  // lia "6 metros" e acusava divergencia onde nao havia. MEDIDO no replay organico.
  const rx = new RegExp('(?<![\\d.,])(\\d{1,6}(?:[.,]\\d+)?)\\s*(?:x\\s*)?(' + NOMES_MERCADORIA + ')', 'gi');
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
const RX_DINHEIRO_ANTES = /(?:r\$|entrada|sinal|adiantamento|dep[o\u00f3]sito|pagar|paguei|pago|pagamento|transferir|transferi|metade|dou|deposito)\s*(?:de\s+|uns\s+|em\s+|uma\s+)?$/i;
const RX_DINHEIRO_DEPOIS = /^\s*(?:reais|conto|pila|paus)\b/i;
function numeroVeioDeDinheiroDoCliente(valor: string, textos: string[]): boolean {
  const n = String(valor ?? '').replace(/\D/g, '');
  if (!n) return false;
  if (evidenciaDeQuantidade(n, textos).ok) return false;   // tem lastro de unidade: nao e dinheiro
  for (const t of (textos || [])) {
    const s = String(t || '');
    const rx = new RegExp('(?:^|[^\\d])' + n + '(?![\\d])', 'g');
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
  if (/\buv\b|adesivo/.test(t)) out.push('dtf_uv');
  if (/copo|caneca|garrafa/.test(t)) out.push('copo');
  if (/camiseta|moletom|regata|baby ?look|polo|jaleco|uniforme|camisa/.test(t)) out.push('camiseta');
  return out;
}
// Frase de TABELA/limiar: nao afirma pedido nenhum.
const RX_FRAME_TABELA = /\b(a\s+partir\s+de|acima\s+de|abaixo\s+de|m[i\u00ed]nimo|cada|at[e\u00e9]\s+\d|entre\s+\d|por\s+unidade|faixa|tabela)\b|\d\s*a\s*\d/i;

function afirmacoesSemLastro(a: {
  texto: string; verificado: any; textosCliente: string[];
  macroCanonico: string | null; numerosAutorizados: number[];
  descricoesCanonicas?: string[];
}): Array<{ trecho: string; motivo: string }> {
  const fora: Array<{ trecho: string; motivo: string }> = [];
  const ver = a.verificado || {};
  const textoCli = (a.textosCliente || []).join(' \n ');
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
    const sent = String(a.texto).split(/(?<=[.!?])\s+|\n+/).find((s) => s.includes(f.trecho)) || a.texto;
    if (RX_FRAME_TABELA.test(sent)) continue;
    const n = Number(String(f.num).replace(',', '.'));
    const numOk = lastreados.has(n) || evidenciaDeQuantidade(f.num, a.textosCliente).ok;
    if (!numOk && numeroVeioDeDinheiroDoCliente(f.num, a.textosCliente)) {
      fora.push({ trecho: f.trecho, motivo: 'quantidade_veio_de_dinheiro' });
      continue;
    }
    // "unidades"/"itens"/"metros" nao nomeiam produto: so o numero e afirmado ali.
    // Conjunto vazio = nao se sabe nada do pedido: nao da para acusar contradicao.
    // Usa macrosDoTexto, nao produtoNaMensagem: este ultimo ancora em \b e devolve
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
  midiaNoTurno?: boolean; numerosDeFerramenta?: number[];
}): { slots: any; rejeitados: Array<{ slot: string; valor: any; motivo: string }> } {
  const rejeitados: Array<{ slot: string; valor: any; motivo: string }> = [];
  const out: any = { ...(a.recebidos || {}) };
  const ant: any = a.anteriores || {};
  const texto = (a.textosCliente || []).join(' \n ');
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
      // replace(/\D/g,'') fabricava um numero que nunca existiu. Descricao livre nao
      // e o defeito do Vitor — o dele era um numero puro (300) nascido de dinheiro.
      // A soma da grade ja aceita e fonte legitima: no fluxo de camiseta o cliente
      // manda "M 4 / G 7 / GG 3" e nunca digita o total.
      const ehNumeroPuro = typeof v === 'number' || /^\s*\d{1,6}(?:[.,]\d+)?\s*$/.test(String(v));
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
      const d = String(v).replace(/\D/g, '');
      ok = d.length === 8 && texto.replace(/\D/g, '').includes(d);
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



export {
  SLOTS_CRITICOS, SLOTS_SO_DETERMINISTICOS, semAcento, valorEcoaNoTexto,
  evidenciaDeQuantidade, evidenciaDeProduto, filtrarSlotsPorProveniencia,
  somaGrade, familiasFaladasPeloCliente, numerosDaGrade, fatosDePedidoNoTexto,
  afirmacoesSemLastro, numeroVeioDeDinheiroDoCliente, macrosDoTexto, RX_FRAME_TABELA,
  normalizarProdutoMacro, produtoNaMensagem,
  RX_EVID_PEDIDO, RX_EVID_DINHEIRO, RX_EVID_GRADE,
  RX_ENVIO_REMETENTE_CLIENTE, RX_ENVIO_OBJETO_NAO_LOGISTICO,
};
