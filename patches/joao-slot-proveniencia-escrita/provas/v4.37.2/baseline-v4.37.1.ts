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
function normalizarProdutoMacro(v: any): string | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s || s === 'null') return null;
  if (/t[êe]xtil/.test(s) || s === 'dtf_textil') return 'dtf_textil';
  if (/\buv\b/.test(s) || s === 'dtf_uv') return 'dtf_uv';
  if (/copo/.test(s)) return 'copo';
  if (/camiseta|moletom|regata|baby\s?look/.test(s)) return 'camiseta';
  // v4.37.1: 'uv' colado por separador ('adesivo_dtf_uv', 'adesivo_uv', 'dtf_uv_folha_a4')
  // NAO casa \buv\b porque '_' e caractere de palavra. O macro saia null e o produto
  // desaparecia das guardas. Regra ADITIVA e POR ULTIMO de proposito: so alcanca string
  // que a funcao ja resolvia como null, entao nenhum valor hoje classificado troca de
  // familia. O segundo teste preserva o comportamento atual de string multi-produto
  // ('camiseta + adesivo_uv', 'copo_ou_adesivo_uv'): quem decide continua sendo a
  // regra da familia citada, nunca o token 'uv' solto.
  if (/(?:^|[^a-z0-9])uv(?![a-z0-9])/.test(s)
      && !/t[êe]xtil|copo|caneca|garrafa|camiseta|moletom|regata|baby\s?look|polo|jaleco|uniforme|bon[ée]|pack|pano/.test(s)) return 'dtf_uv';
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
// v4.37.1: a pergunta de quantidade que o PROPRIO Joao acabou de fazer carrega a
// unidade ('Quantos adesivos de 50x75cm voce precisa?'). O numero puro que responde
// a ela tem proveniencia: unidade na pergunta, valor na resposta do cliente.
const RX_PERGUNTA_QUANTIDADE = /\bquant[oa]s\b[^?]{0,160}\?/i;
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

// A PORTA. Devolve os slots que podem virar fato + a lista do que foi recusado.
function filtrarSlotsPorProveniencia(a: {
  anteriores: any; recebidos: any; textosCliente: string[];
  macroCanonico: string | null; toolsUsadas: string[];
  midiaNoTurno?: boolean; numerosDeFerramenta?: number[];
  perguntaQuantidadePendente?: boolean;
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
      // v4.37.1: numero puro que RESPONDE a pergunta de quantidade do proprio Joao tem
      // proveniencia — a unidade esta na pergunta e o cliente devolveu so o numero.
      // Exige as duas pontas: pergunta 'quantos/quantas ...?' no turno anterior do Joao
      // E uma mensagem do cliente que e SO esse numero. Nao reabre o caso Vitor, em que
      // o 300 nasceu dentro de frase de dinheiro, nunca como mensagem isolada.
      const respondeuPerguntaDeQuantidade = a.perguntaQuantidadePendente === true
        && (a.textosCliente || []).some((t) => {
          const so = String(t ?? '').trim();
          return /^\d{1,6}$/.test(so) && Number(so) === nQ;
        });
      ok = !ehNumeroPuro
        || evidenciaDeQuantidade(v, a.textosCliente).ok
        || (sg !== null && nQ === sg)
        || deTool
        || respondeuPerguntaDeQuantidade;
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
const MATRIZ_TOOL: Record<string, { produtos: string[] | null; modalidades: string[] | null }> = {
  calcular_rendimento_uv: { produtos: ['dtf_uv'], modalidades: null },
  calcular_dtf_uv_metro:  { produtos: ['dtf_uv'], modalidades: ['metro'] },
  calcular_dtf_por_arte:  { produtos: ['dtf_textil'], modalidades: null },
  calcular_dtf_metro:     { produtos: ['dtf_textil'], modalidades: ['metro'] },
  calcular_copo:          { produtos: ['copo'], modalidades: null },
  orcar_camisetas:        { produtos: ['camiseta'], modalidades: null },
  consultar_modelos:      { produtos: ['camiseta'], modalidades: null },
  consultar_tabela_dtf:   { produtos: null, modalidades: null },
  consultar_catalogo:     { produtos: null, modalidades: null },
  calcular_frete:         { produtos: null, modalidades: null },
  compor_total:           { produtos: null, modalidades: null },
  gerar_pix:              { produtos: null, modalidades: null },
};
// FAIL-OPEN DELIBERADO NESTA FASE: sem produto conhecido a guarda NAO acusa incompatibilidade.
// Em shadow um falso positivo poluiria a medicao; e o objetivo agora e justamente medir.
function avaliarCompatibilidadeTool(tool: string, produto: string | null, modalidade: string | null): { permitida: boolean; motivo: string } {
  const regra = MATRIZ_TOOL[tool];
  if (!regra) return { permitida: true, motivo: 'ferramenta_nao_mapeada' };
  if (regra.produtos === null) return { permitida: true, motivo: 'ferramenta_transversal' };
  if (!produto) return { permitida: true, motivo: 'produto_indeterminado_fail_open' };
  if (!regra.produtos.includes(produto)) {
    return { permitida: false, motivo: `produto_${produto}_incompativel_com_${tool}` };
  }
  if (regra.modalidades && modalidade && !regra.modalidades.includes(modalidade)) {
    return { permitida: false, motivo: `modalidade_${modalidade}_incompativel_com_${tool}` };
  }
  return { permitida: true, motivo: 'compativel' };
}
export { avaliarCompatibilidadeTool };
export { resolverModalidadeLogistica, perguntaDoQueFaltaFechamento, blocoModalidadeLogistica };
export { normalizarProdutoMacro, filtrarSlotsPorProveniencia, produtoNaMensagem, evidenciaDeQuantidade, evidenciaDeProduto };
