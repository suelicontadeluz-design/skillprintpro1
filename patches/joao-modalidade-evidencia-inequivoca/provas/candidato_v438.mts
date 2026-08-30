// GERADO de patches/joao-modalidade-evidencia-inequivoca/candidato/index.ts (v4.38.0)
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
    // v4.38.0: 'desconhecida' bloqueia frete/CEP em QUALQUER regiao. A versao anterior so
    // bloqueava na Grande SP; fora dela, pedir_cep=true fazia blocoCepCanonico emitir
    // "[CEP AUSENTE: peca o CEP]" com ZERO evidencia do cliente — caso sentinela 29/08,
    // 5521993457646: "Obrigada" respondendo a pergunta de modalidade virou "entao e envio".
    const indefinida = m === 'desconhecida';
    const bloqueia = semFretePorModalidade || produtoDigital || indefinida;
    const motivo = produtoDigital ? 'produto_digital_sem_frete'
      : semFretePorModalidade ? ('modalidade_' + m + '_nao_tem_frete')
      : indefinida ? (grandeSP ? 'modalidade_indefinida_com_retirada_plausivel' : 'modalidade_indefinida_sem_declaracao_do_cliente')
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
  return '\n\n[MODALIDADE LOG\u00cdSTICA N\u00c3O RESOLVIDA. O cliente est\u00e1 fora da Grande SP, ent\u00e3o ENVIO \u00e9 o caminho prov\u00e1vel — mas isso \u00e9 pista, n\u00e3o fato. N\u00c3O afirme que \u00e9 envio. Cortesia ("obrigada", "ok", "beleza"), emoji e sil\u00eancio N\u00c3O s\u00e3o escolha de modalidade. Fa\u00e7a UMA pergunta: envio pelos Correios ou retirada aqui em Embu?'
    + '\nPROIBIDO pedir CEP antes da resposta do cliente. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.'
    + (e.cep_conhecido ? ` O CEP ${e.cep_conhecido} j\u00e1 \u00e9 conhecido (fonte: ${e.cep_fonte}): quando o envio for confirmado, N\u00c3O pe\u00e7a de novo.]` : ']');
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

// ══ v4.38.0 P0: GUARDA DE SAIDA DE MODALIDADE — ver manifesto no topo do arquivo ══
// So atua quando o resolvedor NAO tem evidencia (modalidade 'desconhecida') e o produto nao
// e digital. NAO e regra por frase: "obrigada" nao aparece aqui. O que ela verifica e a
// RESPOSTA: sem evidencia do cliente, afirmar modalidade ou citar CEP e proibido em qualquer
// regiao. Pergunta que OFERECE a escolha (cita retirada E envio) nao e afirmacao e passa.
// Nota de regex: \b nao funciona ao lado de acento ([\u00e9]); os limites usam (?:^|\s).
const RX_TXT_CITA_CEP = /\bcep\b/i;
const RX_TXT_AFIRMA_MODALIDADE = /(?:^|\s)(?:ent[a\u00e3]o\s+)?(?:[e\u00e9]|vai\s+ser|ser[a\u00e1]|fica(?:ria)?\s+(?:por|como))\s+(?:por\s+)?(?:envio|retirada|entrega\s+em\s+casa)(?:$|[\s.,!?])/i;
function guardaTextoModalidadeSemEvidencia(texto: string, e: EstadoLogistico): { bloqueia: boolean; gatilho: string | null; substituta: string } {
  const substituta = 'S\u00f3 me confirma a forma de entrega: retirada aqui em Embu das Artes ou envio pelos Correios?';
  if (e.modalidade !== 'desconhecida' || e.produto_digital) return { bloqueia: false, gatilho: null, substituta };
  const t = String(texto || '');
  if (RX_TXT_CITA_CEP.test(t)) return { bloqueia: true, gatilho: 'citou_cep_sem_modalidade_resolvida', substituta };
  const ofereceEscolha = /retirad/i.test(t) && /envio|correios|sedex|entrega/i.test(t);
  if (!ofereceEscolha && RX_TXT_AFIRMA_MODALIDADE.test(t)) return { bloqueia: true, gatilho: 'afirmou_modalidade_sem_evidencia', substituta };
  return { bloqueia: false, gatilho: null, substituta };
}

function soDigitos(v: any): string { return String(v ?? '').replace(/\D/g, ''); }
function mascararCep(cep: string | null): string {
  const d = soDigitos(cep);
  return d.length === 8 ? d.slice(-4) : '';
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
export { resolverModalidadeLogistica, blocoModalidadeLogistica, blocoCepCanonico, blocoLocalizacao, classificarDeclaracaoLogistica, perguntaDoQueFaltaFechamento, cepDoTexto, guardaTextoModalidadeSemEvidencia };
export type { EstadoLogistico, ModalidadeLogistica };
