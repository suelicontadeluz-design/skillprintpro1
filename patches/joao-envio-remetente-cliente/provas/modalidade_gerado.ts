// GERADO AUTOMATICAMENTE por provas/extrair.py — NAO EDITAR.
// Recorte VERBATIM de candidato/index.ts (bytes 45908..75680).

// ═══════ PREAMBULO DE MOCK — NAO FAZ PARTE DO CANDIDATO ═══════
// Substitui apenas o MUNDO (ERP por HTTP e log). Nenhuma regra e reimplementada.
export const ERROS: any[] = [];
export const PATCHES: any[] = [];
let ERP_ROWS: any[] = [];
export function setErpRows(r: any[]) { ERP_ROWS = r; }
export function reset() { ERROS.length = 0; PATCHES.length = 0; ERP_ROWS = []; }
export let ERP_FALHA = false;
export function setErpFalha(v: boolean) { ERP_FALHA = v; }
const ERP_URL = 'https://erp.test';
const ERP_SERVICE_KEY = 'chave-de-teste';
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }
const fetch = async (url: any, init?: any): Promise<any> => {
  const u = String(url);
  if (ERP_FALHA) return { ok: false, status: 503, json: async () => ({}) };
  if ((init?.method || 'GET') === 'PATCH') {
    PATCHES.push({ url: u, body: JSON.parse(String(init.body)) });
    return { ok: true, status: 204, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ERP_ROWS };
};
// ═══════ FIM DO MOCK — daqui para baixo e recorte VERBATIM ═══════

const DDD_UF: Record<string, string> = { '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP','21':'RJ','22':'RJ','24':'RJ','27':'ES','28':'ES','31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG','41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR','47':'SC','48':'SC','49':'SC','51':'RS','53':'RS','54':'RS','55':'RS','61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO','71':'BA','73':'BA','74':'BA','75':'BA','77':'BA','79':'SE','81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI','91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA' };
const UF_NOME: Record<string, string> = { SP:'S\u00e3o Paulo', RJ:'Rio de Janeiro', ES:'Esp\u00edrito Santo', MG:'Minas Gerais', PR:'Paran\u00e1', SC:'Santa Catarina', RS:'Rio Grande do Sul', DF:'Distrito Federal', GO:'Goi\u00e1s', TO:'Tocantins', MT:'Mato Grosso', MS:'Mato Grosso do Sul', AC:'Acre', RO:'Rond\u00f4nia', BA:'Bahia', SE:'Sergipe', PE:'Pernambuco', AL:'Alagoas', PB:'Para\u00edba', RN:'Rio Grande do Norte', CE:'Cear\u00e1', PI:'Piau\u00ed', PA:'Par\u00e1', AM:'Amazonas', RR:'Roraima', AP:'Amap\u00e1', MA:'Maranh\u00e3o' };
function blocoLocalizacao(phone: string): string {
  const ddd = phone.length >= 4 ? phone.slice(2, 4) : '';
  const uf = DDD_UF[ddd] || '';
  if (!uf) return '';
  if (ddd === '11') return '\n\n[LOCALIZA\u00c7\u00c3O: DDD 11 (Grande SP). Retirada presencial e possivel para este cliente.]';
  // v4.34.0 P0: o texto anterior era "ASSUMA ENVIO: peca o CEP completo, 8 digitos". Ele
  // transformava um DDD — que nao e endereco e nao e escolha do cliente — em ordem de pedir
  // CEP, e por ai o CEP virava requisito de fechamento. DDD e PISTA, nunca decisao.
  return `\n\n[LOCALIZA\u00c7\u00c3O: DDD ${ddd} = ${UF_NOME[uf] || uf}. Isso e PISTA REGIONAL, N\u00c3O \u00e9 decis\u00e3o de log\u00edstica: envio \u00e9 prov\u00e1vel, mas n\u00e3o afirme como fato e n\u00e3o pe\u00e7a CEP antes de a modalidade estar resolvida. Retirada presencial s\u00f3 na Grande SP.]`;
}

// ══ v4.34.0 P0: MODALIDADE LOGISTICA — ESTADO CANONICO RESOLVIDO ANTES DO CEP ══
// Conceito NOVO e separado de slots.produto e da modalidade metro/peca da v4.28.0 (P14).
// Reaproveitar qualquer um dos dois destruiria distincao que ja tem consumidor.
type ModalidadeLogistica = 'retirada' | 'motoboy' | 'envio' | 'desconhecida';

// Motoboy e retirada POR PROCURACAO: o cliente manda alguem buscar. Nao gera frete Correios.
const RX_LOG_MOTOBOY = /\b(motoboy|moto\s?boy|motoqueiro|lalamove|uber\s?flash|99\s?(?:entregas?|flash)|mensageiro|portador)\b/i;
const RX_LOG_RETIRADA = /\b(retirad[ao]s?|retirar|retiro|retiramos|retirei|presencial(?:mente)?)\b|\bem\s+m[a\u00e3]os\b|\b(?:busc(?:ar|o|amos)|peg(?:ar|o|amos)|pass(?:ar|o|amos))\s+(?:a[i\u00ed]|l[a\u00e1]|no\s+local|na\s+loja|pessoalmente|o\s+pedido|o\s+material)\b|\bvou\s+a[i\u00ed]\b|\bno\s+local\b|\bna\s+loja\b/i;
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
function sentencasLogisticas(txt: string): string[] {
  return String(txt || '').replace(RX_ROTULO_LOGISTICA, ' ')
    .split(/[.!?;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
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
      b.lastIndexOf(' mas '), b.lastIndexOf(' porem '), b.lastIndexOf(' porém '));
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
    if (envio === null && envioPositivoNaSentenca(s)) envio = s;
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
  // ── v4.35.0: contrato de CEP. Preenchido por refinarCepComCadastro, que so roda
  // quando a modalidade admite frete. Sob retirada/motoboy ficam nos valores neutros.
  cep_cadastro: string | null;
  pessoa_id: string | null;
  cadastro_ambiguo: boolean;
  cadastro_tem_endereco: boolean;
  cep_confirmado: boolean;
  pedir_confirmacao_cep: boolean;
  cep_divergente_do_cadastro: boolean;
  intencao_cep_padrao: 'novo_padrao' | 'so_este_pedido' | 'indefinida' | null;
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
  // v4.35.0: a.mensagemAtual ja era usada para a MODALIDADE (nivel 1) e agora tambem entra
  // como nivel 1 do CEP. Nada da resolucao de modalidade mudou.
  const ddd = String(a.phone || '').length >= 4 ? String(a.phone).slice(2, 4) : '';
  const grandeSP = ddd === '11';
  const produtoDigital = /\bpacks?\b|estampas?\s+pronta|arquivo\s+digital/i.test(String(a.produtoContexto || ''));

  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.
  // v4.35.0: ordem das fontes conforme o contrato. O que o cliente ACABOU de escrever vence
  // o estado salvo — antes o slot vinha primeiro e um CEP novo digitado perdia para um slot
  // velho. pessoas.cep (nivel 3) entra depois, em refinarCepComCadastro.
  let cep: string | null = null; let cepFonte: string | null = null;
  const cepDoTurno = cepDoTexto(String(a.mensagemAtual || ''));
  if (cepDoTurno) { cep = cepDoTurno; cepFonte = 'pedido'; }
  if (!cep) for (const i of (a.inboundsPedido || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'pedido'; break; } }
  if (!cep) { const cepSlot = a.slots?.cep ? String(a.slots.cep).replace(/\D/g, '') : ''; if (cepSlot.length === 8) { cep = cepSlot; cepFonte = 'estado_confirmado'; } }
  if (!cep && a.freteJa?.cep_destino) { const c = String(a.freteJa.cep_destino).replace(/\D/g, ''); if (c.length === 8) { cep = c; cepFonte = 'frete_anterior'; } }
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
      // v4.35.0: neutros aqui. Sob retirada/motoboy/digital continuam neutros para SEMPRE,
      // porque refinarCepComCadastro nem chega a ser chamado — o cadastro nao e nem lido.
      cep_cadastro: null, pessoa_id: null, cadastro_ambiguo: false,
      cadastro_tem_endereco: false, cep_confirmado: false,
      pedir_confirmacao_cep: false, cep_divergente_do_cadastro: false,
      intencao_cep_padrao: null,
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
    return '\n\n[LOG\u00cdSTICA: PRODUTO DIGITAL. A entrega \u00e9 por LINK no WhatsApp. N\u00c3O existe CEP, N\u00c3O existe frete e N\u00c3O existe endere\u00e7o neste pedido.]';
  }
  if (e.modalidade === 'retirada' || e.modalidade === 'motoboy') {
    const nome = e.modalidade === 'motoboy' ? 'MOTOBOY (o cliente manda buscar)' : 'RETIRADA PRESENCIAL';
    const conf = e.confirmar_com_cliente
      ? ` Isso vem do HIST\u00d3RICO deste cliente, n\u00e3o do pedido de hoje: confirme em UMA pergunta curta ("${e.modalidade === 'motoboy' ? 'Vai mandar o motoboy como das outras vezes?' : 'Vai retirar aqui como das outras vezes?'}") e siga. Se ele disser que agora quer envio, a fala NOVA dele vale mais que o hist\u00f3rico.`
      : '';
    const cepNota = e.cep_conhecido ? ' Existe CEP conhecido deste cliente e ele N\u00c3O muda nada aqui: nesta modalidade o CEP n\u00e3o \u00e9 usado para nada.' : '';
    return `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ${nome}.${evid}${conf}`
      + '\nPROIBIDO pedir CEP. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.'
      + '\nGERAR COBRAN\u00c7A N\u00c3O EXIGE CEP: sem frete, o TOTAL \u00e9 o valor do produto. \u00c9 PROIBIDO escrever que precisa do CEP para gerar a cobran\u00e7a, inclusive com a ressalva "mesmo sendo retirada".'
      + `${cepNota}]`;
  }
  if (e.modalidade === 'envio') {
    return e.cep_conhecido
      ? `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ${e.cep_conhecido} J\u00c1 \u00c9 CONHECIDO (fonte: ${e.cep_fonte}). N\u00c3O pe\u00e7a de novo: use esse CEP em calcular_frete e feche com produto + frete.]`
      : `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ainda falta: pe\u00e7a UMA vez, 8 d\u00edgitos, e chame calcular_frete em seguida.]`;
  }
  if (e.retirada_plausivel) {
    return '\n\n[MODALIDADE LOG\u00cdSTICA N\u00c3O RESOLVIDA e RETIRADA \u00c9 PLAUS\u00cdVEL (Grande SP). Fa\u00e7a UMA pergunta: retirada aqui em Embu ou envio pelos Correios?'
      + '\nPROIBIDO pedir CEP antes da resposta. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.]';
  }
  return '\n\n[MODALIDADE LOG\u00cdSTICA N\u00c3O RESOLVIDA. O cliente est\u00e1 fora da Grande SP, ent\u00e3o ENVIO \u00e9 o caminho prov\u00e1vel — mas isso \u00e9 pista, n\u00e3o fato: havendo qualquer sinal de retirada, pergunte antes.'
    + (e.cep_conhecido ? ` O CEP ${e.cep_conhecido} j\u00e1 \u00e9 conhecido (fonte: ${e.cep_fonte}): N\u00c3O pe\u00e7a de novo.]` : ' S\u00f3 pe\u00e7a o CEP quando ele realmente faltar para o frete.]');
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
  if (e.modalidade === 'desconhecida' && !e.produto_digital) faltas.push('se \u00e9 retirada ou envio');
  if (e.modalidade === 'envio' && !e.cep_conhecido) faltas.push('o CEP');
  if (faltas.length === 0) {
    return 'Para gerar a cobran\u00e7a correta, me confirma s\u00f3 a forma de pagamento: Pix ou cart\u00e3o?';
  }
  const lista = faltas.length === 1 ? faltas[0] : faltas.slice(0, -1).join(', ') + ' e ' + faltas[faltas.length - 1];
  return `Para gerar a cobran\u00e7a correta, preciso concluir o valor do pedido. Me confirma ${lista}?`;
}

// ══ v4.35.0 P0: CEP CANONICO — LER O CADASTRO, CONFIRMAR, REUTILIZAR, PERSISTIR ══
// KILL SWITCH. FALSE = nunca troca um cep que ja convive com endereco preenchido.
// Ligar significa aceitar que a NF-e saia com cep novo e logradouro/cidade antigos.
const PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO = false;

type PessoaCadastro = {
  pessoa_id: string | null; nome: string | null; cep: string | null;
  tem_endereco: boolean; ambiguo: boolean;
};

const CADASTRO_VAZIO: PessoaCadastro = { pessoa_id: null, nome: null, cep: null, tem_endereco: false, ambiguo: false };

function soDigitos(v: any): string { return String(v ?? '').replace(/\D/g, ''); }

// Le o cadastro canonico do ERP por TELEFONE. Fail-closed: 0 ou 2+ casamentos exatos de
// sufixo devolvem cadastro vazio com ambiguo=true. Nunca cria pessoa, nunca adivinha.
// O filtro vai pelos 4 ultimos digitos (sempre contiguos no formato "(11) 91857-0605") so
// para limitar a linha trafegada; o casamento real e por sufixo de 8 digitos, aqui.
async function lerPessoaCanonicaPorTelefone(phone: string): Promise<PessoaCadastro> {
  const digits = soDigitos(phone);
  if (digits.length < 10) return CADASTRO_VAZIO;
  if (!ERP_URL || !ERP_SERVICE_KEY) { await logErro('cep_cadastro_sem_credencial', { phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
  const ult4 = digits.slice(-4);
  const suf8 = digits.slice(-8);
  try {
    const COLUNAS = 'id,nome,cep,logradouro,numero,bairro,cidade,estado,telefone,whatsapp,ativo';
    const cab = { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}` };
    // Filtro pelos 4 ultimos digitos so para nao trafegar a tabela inteira. Medido no ERP:
    // pior grupo de ult4 tem 7 linhas, contra o limite de 20.
    let r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}`
      + `&or=(telefone.ilike.*${ult4}*,whatsapp.ilike.*${ult4}*)&limit=20`,
      { headers: cab, signal: AbortSignal.timeout(10000) });
    // FALLBACK DELIBERADO: se o filtro for recusado (grafia de PostgREST, coluna renomeada),
    // a feature NAO some em silencio — relemos sem filtro. O cadastro tem 144 linhas hoje;
    // o casamento exato continua sendo feito aqui, por sufixo de 8 digitos.
    if (!r.ok) {
      await logErro('cep_cadastro_filtro_recusado', { status: r.status, phone: phone.slice(-4) });
      r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}&limit=500`,
        { headers: cab, signal: AbortSignal.timeout(10000) });
    }
    if (!r.ok) { await logErro('cep_cadastro_http_erro', { status: r.status, phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
    const linhas = await r.json();
    const casam = (Array.isArray(linhas) ? linhas : []).filter((p: any) => {
      if (p?.ativo === false) return false;
      const t1 = soDigitos(p?.telefone), t2 = soDigitos(p?.whatsapp);
      return (t1.length >= 10 && t1.slice(-8) === suf8) || (t2.length >= 10 && t2.slice(-8) === suf8);
    });
    if (casam.length !== 1) {
      if (casam.length > 1) await logErro('cep_cadastro_ambiguo', { phone: phone.slice(-4), encontrados: casam.length });
      return { ...CADASTRO_VAZIO, ambiguo: casam.length > 1 };
    }
    const p = casam[0];
    const cepCad = soDigitos(p?.cep);
    return {
      pessoa_id: String(p.id), nome: p?.nome ? String(p.nome) : null,
      cep: cepCad.length === 8 ? cepCad : null,
      tem_endereco: !!(String(p?.logradouro || '').trim() || String(p?.cidade || '').trim() || String(p?.bairro || '').trim()),
      ambiguo: false,
    };
  } catch (e: any) {
    await logErro('cep_cadastro_excecao', { phone: phone.slice(-4), e: String(e?.message ?? e).slice(0, 120) });
    return CADASTRO_VAZIO;
  }
}

// Respostas do cliente a pergunta de confirmacao de CEP. Deterministicas: o modelo nao opina.
const RX_CEP_CONFIRMA = /\b(isso|isso mesmo|esse mesmo|o mesmo|mesmo cep|mesmo endere[c\u00e7]o|sim|pode ser|pode mandar|confirmo|confirmado|exato|correto|isso a[i\u00ed]|[e\u00e9] esse|[e\u00e9] esse mesmo|continua|igual)\b/i;
const RX_CEP_OUTRO = /\b(outro|outra|novo|nova|mudei|mudou|mudamos|mudan[c\u00e7]a|troquei|trocamos|diferente|n[a\u00e3]o [e\u00e9] esse|nao e esse|agora [e\u00e9]|me mudei)\b/i;
const RX_CEP_PADRAO_NOVO = /\b(novo (cep )?padr[a\u00e3]o|mudei de endere[c\u00e7]o|me mudei|nos mudamos|mudamos de endere[c\u00e7]o|endere[c\u00e7]o novo|atualiza(r)? (o )?cadastro|pode atualizar|passa a ser|de agora em diante|daqui (pra|para) frente|sempre (vai ser|ser[a\u00e1]))\b/i;
const RX_CEP_SO_ESTE_PEDIDO = /\b(s[o\u00f3] (para|pra) (este|esse) pedido|s[o\u00f3] (deste|desse) pedido|s[o\u00f3] (desta|dessa) vez|apenas (este|esse) pedido|s[o\u00f3] agora|exce[c\u00e7][a\u00e3]o|dessa vez|s[o\u00f3] dessa)\b/i;
// A pergunta que o PROPRIO Joao faz. Serve para saber se "isso mesmo" responde ao CEP.
const RX_JOAO_PERGUNTOU_CEP = /(mesmo cep|cep final|mesmo endere[c\u00e7]o|novo (cep )?padr[a\u00e3]o|s[o\u00f3] (para|pra) este pedido)/i;

function mascararCep(cep: string | null): string {
  const d = soDigitos(cep);
  return d.length === 8 ? d.slice(-4) : '';
}

// NIVEL 3 do contrato + estado de confirmacao. So roda quando a modalidade admite frete:
// sob retirada/motoboy/produto digital o cadastro nem e lido, e por construcao o CEP salvo
// NAO interfere.
function refinarCepComCadastro(
  e: EstadoLogistico, cadastro: PessoaCadastro, slots: any, mensagem: string, ultimaMsgJoao: string,
): EstadoLogistico {
  const r: EstadoLogistico = { ...e };
  r.cep_cadastro = cadastro.cep;
  r.pessoa_id = cadastro.pessoa_id;
  r.cadastro_ambiguo = cadastro.ambiguo === true;
  r.cadastro_tem_endereco = cadastro.tem_endereco === true;

  const joaoPerguntouCep = RX_JOAO_PERGUNTOU_CEP.test(String(ultimaMsgJoao || ''));
  const confirmouAntes = slots?.cep_confirmado_para_envio === true;
  const cepDoTurnoAgora = cepDoTexto(String(mensagem || ''));

  // Intencao sobre cadastro: so vale se o cliente falou, nunca inferida do silencio.
  r.intencao_cep_padrao = RX_CEP_PADRAO_NOVO.test(mensagem) ? 'novo_padrao'
    : RX_CEP_SO_ESTE_PEDIDO.test(mensagem) ? 'so_este_pedido'
    : null;

  // NIVEL 3: sem CEP de nivel 1/2/4, o cadastro entra como fonte.
  if (!r.cep_conhecido && cadastro.cep) { r.cep_conhecido = cadastro.cep; r.cep_fonte = 'pessoas'; }

  r.cep_divergente_do_cadastro = !!(cadastro.cep && r.cep_conhecido && r.cep_conhecido !== cadastro.cep);

  // CONFIRMACAO. O cliente respondendo "isso mesmo" a uma pergunta de CEP confirma; dizendo
  // "outro"/"mudei" desconfirma e o CEP do cadastro deixa de servir.
  if (joaoPerguntouCep && RX_CEP_OUTRO.test(mensagem) && !cepDoTurnoAgora) {
    r.cep_confirmado = false;
    if (r.cep_fonte === 'pessoas') { r.cep_conhecido = null; r.cep_fonte = null; }
  } else if (cepDoTurnoAgora) {
    // CEP escrito agora e confirmacao por si: e o proprio cliente declarando o destino.
    r.cep_confirmado = true;
  } else if (confirmouAntes && !r.cep_divergente_do_cadastro) {
    r.cep_confirmado = true;
  } else if (joaoPerguntouCep && RX_CEP_CONFIRMA.test(mensagem)) {
    r.cep_confirmado = true;
  } else {
    r.cep_confirmado = false;
  }

  // Reutilizar CEP do cadastro sem avisar e o defeito que esta rodada corrige: confirma
  // primeiro, em UMA pergunta, sem expor o endereco inteiro.
  r.pedir_confirmacao_cep = r.cep_fonte === 'pessoas' && !r.cep_confirmado;
  // Pedir CEP so quando nao existe NENHUM. Ter de confirmar nao e ter de pedir.
  r.pedir_cep = !r.bloqueia_frete && !r.cep_conhecido;
  return r;
}

// O CEP so vale para calcular frete quando esta confirmado como destino deste pedido.
function cepLiberadoParaFrete(e: EstadoLogistico): boolean {
  if (e.bloqueia_frete) return false;
  if (!e.cep_conhecido) return false;
  return e.cep_confirmado === true || e.cep_fonte !== 'pessoas';
}

function blocoCepCanonico(e: EstadoLogistico): string {
  if (e.bloqueia_frete) return '';
  if (e.pedir_confirmacao_cep && e.cep_cadastro) {
    return `\n\n[CEP DO CADASTRO: este cliente j\u00e1 tem CEP no cadastro, final ${mascararCep(e.cep_cadastro)}.`
      + ' N\u00c3O pe\u00e7a o CEP inteiro de novo e N\u00c3O use o do cadastro calado.'
      + ` CONFIRME em UMA frase curta e natural: "Vai ser enviado para o mesmo CEP final ${mascararCep(e.cep_cadastro)}?".`
      + ' N\u00e3o exponha o endere\u00e7o completo. Se ele confirmar, calcule o frete com esse CEP. Se disser que \u00e9 outro, a\u00ed sim pe\u00e7a o CEP novo.]';
  }
  if (e.cep_conhecido && e.cep_confirmado) {
    return `\n\n[CEP CONFIRMADO para este pedido: ${e.cep_conhecido} (fonte: ${e.cep_fonte}). N\u00c3O pergunte de novo, nem o CEP nem a confirma\u00e7\u00e3o: chame calcular_frete com ele.`
      + (e.cep_divergente_do_cadastro && e.intencao_cep_padrao === null
        ? ' Este CEP \u00e9 DIFERENTE do que est\u00e1 no cadastro dele. Antes de encerrar o assunto de entrega, pergunte UMA vez, curto: "Esse \u00e9 seu novo CEP padr\u00e3o ou \u00e9 s\u00f3 para este pedido?" — e N\u00c3O trate como novo padr\u00e3o enquanto ele n\u00e3o responder.'
        : '')
      + ']';
  }
  if (e.pedir_cep) {
    return '\n\n[CEP AUSENTE: pe\u00e7a o CEP UMA vez, 8 d\u00edgitos, e chame calcular_frete em seguida. N\u00c3O pe\u00e7a duas vezes.]';
  }
  return '';
}

// PERSISTENCIA GUARDADA. Devolve o que aconteceu e POR QUE. Nunca cria pessoa, nunca escreve
// campo que nao seja cep, nunca roda sob retirada/motoboy.
async function persistirCepCanonico(
  e: EstadoLogistico, phone: string,
): Promise<{ persistido: boolean; motivo: string }> {
  if (e.bloqueia_frete) return { persistido: false, motivo: 'modalidade_sem_frete' };
  const cep = soDigitos(e.cep_conhecido);
  if (cep.length !== 8) return { persistido: false, motivo: 'cep_invalido' };
  if (!e.pessoa_id) return { persistido: false, motivo: e.cadastro_ambiguo ? 'cadastro_ambiguo' : 'sem_pessoa_vinculada' };
  if (!e.cep_confirmado) return { persistido: false, motivo: 'cep_nao_confirmado' };
  if (e.cep_cadastro === cep) return { persistido: false, motivo: 'cep_ja_igual_ao_cadastro' };
  // Lacuna: pessoa sem cep. Preencher e aditivo e nao contradiz endereco nenhum.
  const preencheLacuna = !e.cep_cadastro;
  if (!preencheLacuna) {
    if (e.intencao_cep_padrao !== 'novo_padrao') {
      return { persistido: false, motivo: e.intencao_cep_padrao === 'so_este_pedido' ? 'apenas_este_pedido' : 'intencao_de_padrao_indefinida' };
    }
    if (e.cadastro_tem_endereco && !PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO) {
      return { persistido: false, motivo: 'endereco_fiscal_coerente_exige_atualizacao_completa' };
    }
  } else if (e.intencao_cep_padrao === 'so_este_pedido') {
    return { persistido: false, motivo: 'apenas_este_pedido' };
  }
  if (!ERP_URL || !ERP_SERVICE_KEY) return { persistido: false, motivo: 'erp_sem_credencial' };
  try {
    const r = await fetch(`${ERP_URL}/rest/v1/pessoas?id=eq.${e.pessoa_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ cep: cep.slice(0, 5) + '-' + cep.slice(5) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { await logErro('cep_persistencia_http_erro', { status: r.status, pessoa_id: e.pessoa_id }); return { persistido: false, motivo: 'http_' + r.status }; }
    return { persistido: true, motivo: preencheLacuna ? 'lacuna_preenchida' : 'novo_padrao_declarado' };
  } catch (err: any) {
    await logErro('cep_persistencia_excecao', { pessoa_id: e.pessoa_id, e: String(err?.message ?? err).slice(0, 120) });
    return { persistido: false, motivo: 'excecao' };
  }
}

// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy
// confirmados, nenhuma destas palavras pode atravessar.
const RX_SAIDA_TERMO_FRETE = /\b(cep|pac|sedex|correios?)\b/i;
// Remove do texto APENAS as sentencas que carregam o termo proibido. Nao reescreve, nao
// resume, nao recalcula — mesma disciplina de removerPerguntaRepetida (v4.21.6).
function removerSentencasComTermo(texto: string, rx: RegExp): string {
  const partes = String(texto || '').split(/(?<=[.!?])\s+|\n+/);
  const testar = new RegExp(rx.source, rx.flags.replace('g', ''));
  return partes.filter((p) => !testar.test(p)).join(' ')
    .replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}


export {
  cepDoTexto, sentencasLogisticas, termoPositivo, classificarDeclaracaoLogistica,
  normalizarModalidadeSlot, resolverModalidadeLogistica, blocoModalidadeLogistica,
  perguntaDoQueFaltaFechamento, removerSentencasComTermo, RX_SAIDA_TERMO_FRETE,
  blocoLocalizacao, lerPessoaCanonicaPorTelefone, refinarCepComCadastro,
  persistirCepCanonico, blocoCepCanonico, cepLiberadoParaFrete, mascararCep,
  CADASTRO_VAZIO, PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO,
};
export type { ModalidadeLogistica, EstadoLogistico, PessoaCadastro };
