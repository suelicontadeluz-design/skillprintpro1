// ============================================================================
// HARNESS DE PROVA — v4.33.0. O codigo sob teste e EXTRAIDO VERBATIM do
// candidato.ts. Nada aqui reimplementa a guarda: mocamos apenas o mundo
// (banco, log) para poder executa-la fora do Deno.
// ============================================================================

// ---- MOCK DO MUNDO -------------------------------------------------------
// Espelha operacoes_financeiras. Os quatro primeiros sao os ids REAIS que
// vazaram em producao; o ultimo e um id interno de OUTRO lead.
const TABELA_OPERACOES = new Set<string>([
  '02d22212-8e17-4dfb-9fa4-1c184b7ac1b9', // 25/08 produto  101.18
  '5d357026-77e7-4066-ba76-9d9a57813383', // 04/08 pedido_total 64.52
  'eef34589-e6b7-4f02-8cf8-fea17eba3809', // 08/08 pedido_total 41.83
  '28a00b98-52ef-4213-92b7-98efbbfbd895', // 23/08 produto  233.61
  '9c1f77aa-1111-4222-8333-444455556666', // id interno de outro lead
]);
let LEITURA_FALHA = false;
export let ERROS: any[] = [];
const sb: any = { from: (_t: string) => ({ select: (_c: string) => ({
  in: async (_col: string, vals: string[]) => {
    if (LEITURA_FALHA) return { data: null, error: { message: 'timeout' } };
    return { data: vals.filter(v => TABELA_OPERACOES.has(v)).map(id => ({ id })), error: null };
  } }) }) };
const L = (_s: string, _d?: any) => {};
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }

// ---- CODIGO SOB TESTE (VERBATIM) ----------------------------------------
const RX_UUID_G = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const RX_UUID_EXATO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Ids internos que este turno JA conhece sem ir ao banco. Serve de atalho e de rede de
// seguranca: se a leitura do banco falhar, o que esta aqui ja basta para fechar a porta.
function colherIdsInternosDoCtx(ctx: any): Set<string> {
  const s = new Set<string>();
  const add = (v: unknown) => { const x = String(v ?? '').trim().toLowerCase(); if (RX_UUID_EXATO.test(x)) s.add(x); };
  for (const a of (Array.isArray(ctx?.autorizacoes) ? ctx.autorizacoes : [])) { add(a?.operation_id); add(a?.id); }
  add(ctx?.pixGerado?.operation_id);
  return s;
}

// Remove do texto A SER AUDITADO apenas os QR EMV de proveniencia PROVADA, para que uma chave
// Pix aleatoria legitima DENTRO do payload oficial 000201... nao seja confundida com id
// interno. Nao basta "comecar com 000201": so o codigo EXATO devolvido pelo provider (ou lido
// de mp_pix_cobrancas.qr_code) e exempto — senao bastaria prefixar 000201 para escapar.
// O QR oficial em si nao e tocado por esta funcao: ele atravessa intacto para o cliente.
function textoSemQrProvado(t: string, qrsProvados: Array<string | null | undefined>): string {
  let out = String(t || '');
  for (const qr of qrsProvados) {
    const s = String(qr || '').trim();
    if (s.length >= 40) out = out.split(s).join(' ');
  }
  return out;
}

// Devolve os UUIDs do texto que sao identificadores financeiros INTERNOS.
// Nao filtra por lead: um operation_id de OUTRO lead tambem e interno e tambem nao pode sair.
// Erro de leitura FECHA a porta — na duvida, nao entrega.
async function idsInternosNoTexto(texto: string, ctx: any, qrsProvados: Array<string | null | undefined>): Promise<string[]> {
  const limpo = textoSemQrProvado(texto, qrsProvados);
  const achados = Array.from(new Set((limpo.match(RX_UUID_G) || []).map((u: string) => u.toLowerCase())));
  if (achados.length === 0) return [];
  const conhecidos = colherIdsInternosDoCtx(ctx);
  const jaInternos = achados.filter((u: string) => conhecidos.has(u));
  const restantes = achados.filter((u: string) => !conhecidos.has(u));
  if (restantes.length === 0) return jaInternos;
  try {
    const { data, error } = await sb.from('operacoes_financeiras').select('id').in('id', restantes);
    if (error) throw new Error(String(error.message || 'erro_leitura'));
    const doBanco = (data || []).map((r: any) => String(r.id).toLowerCase());
    return Array.from(new Set([...jaInternos, ...doBanco]));
  } catch (e: any) {
    await logErro('guardrail_egresso_leitura_falhou', { erro: String(e?.message ?? e).slice(0, 150), candidatos: restantes.slice(0, 3) });
    return Array.from(new Set([...jaInternos, ...restantes]));
  }
}

// Expurga os ids internos do texto: soltos, em markdown ou dentro de URL. A URL INTEIRA cai —
// um link inventado que carrega o id nao pode virar "link sem id", que continuaria quebrado.
function expurgarIdsInternos(texto: string, ids: string[]): string {
  let out = String(texto || '');
  for (const id of ids) out = out.replace(new RegExp('\\S*' + id + '\\S*', 'gi'), '');
  return out
    .replace(/```\s*```/g, '')
    .replace(/^[ \t]*[`>*_-]+[ \t]*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// GUARDA DE TRANSPORTE. Roda imediatamente antes de a mensagem sair, em TODO caminho de saida
// (resposta do fluxo principal e _direct_message). Nao confia no texto do modelo nem no texto
// ditado: pergunta ao banco se aquele UUID e um identificador financeiro interno.
async function guardaEgressoFinanceiro(
  texto: string, ctx: any, qrsProvados: Array<string | null | undefined>, phone: string, origem: string,
): Promise<{ bloqueou: boolean; texto: string; ids: string[] }> {
  const ids = await idsInternosNoTexto(texto, ctx, qrsProvados);
  if (ids.length === 0) return { bloqueou: false, texto, ids: [] };
  await logErro('guardrail_identificador_financeiro_interno', {
    phone, origem, ids: ids.slice(0, 4),
    trecho: String(texto || '').replace(/\n/g, ' ').slice(0, 180),
  });
  L('guardrail_identificador_financeiro_interno', { phone: String(phone || '').slice(-4), origem, qtd: ids.length });
  return { bloqueou: true, texto: expurgarIdsInternos(texto, ids), ids };
}

// ── v4.33.0 P0: CLIENTE CONDICIONOU O PAGAMENTO A APROVACAO DA ARTE ─────────────────
// No caso de 25/08 o cliente escreveu "Ok fico no aguardo da art para finalizacao e pagamento"
// e o Pix saiu 3 segundos depois. A politica comercial NAO muda: pagamento continua ANTES da
// producao. O que muda e so o TURNO: quando o proprio cliente condiciona explicitamente o
// pagamento a ver a arte, a sequencia dele e arte -> aprovacao -> finalizacao -> pagamento ->
// producao, e cobrar naquele turno atropela o que ele acabou de dizer. Vale so para o turno em
// que a frase aparece — nao vira regra geral de "pagar depois".
const RX_HOLD_ARTE_PAGAMENTO = /\b(?:aguard\w*|esper\w*|assim que|depois que|quando|ap[oó]s)\b[^.!?\n]{0,60}\b(?:arte|art|layout|mockup|prova)\b[^.!?\n]{0,60}\b(?:pag\w*|finaliza\w*|fech\w*)\b|\b(?:arte|art|layout|mockup)\b[^.!?\n]{0,40}\b(?:antes d[eo]|primeiro)\b[^.!?\n]{0,30}\b(?:pag\w*|fech\w*)\b/i;

const validarPix = (m: string) => { const semQr = m.replace(/000201[\w\W]{50,}/, ''); const chaves = semQr.match(/\b\d{14}\b/g) || []; return chaves.length === 0; };

function calcPrometeuPix(resposta: string): boolean {
  const RX_ENTREGA_PIX = /(segue|segui|aqui (?:est[a\u00e1]|vai|v\u00e3o)|te (?:envio|mando|passo)|vou te (?:enviar|mandar|passar))\s+(?:o |a |seu |sua )?(?:pix|c[o\u00f3]digo|chave|cobran[c\u00e7]a)\b|\b(?:c[o\u00f3]digo|chave)\s+pix\b|\bpix\s*:/i;
  const prometeuPix:boolean = /(vou|vamos|j[a\u00e1] vou|deixa eu|posso) (gerar|mandar|enviar|passar|criar|fazer)\s+(o |seu |a |sua )?(pix|c[o\u00f3]digo|cobran[c\u00e7]a|chave)|(gero|mando|envio|passo|crio)\s+(o |seu )?pix|pix (vai |ja |j[a\u00e1] )?(sai|segue|vem)|te mando o pix/i.test(resposta)
    || RX_ENTREGA_PIX.test(resposta);
  return prometeuPix;
}

function checkoutMercadoPago(raw: unknown): string | null {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !(host === 'mercadopago.com.br' || host.endsWith('.mercadopago.com.br'))) return null;
    return u.toString();
  } catch { return null; }
}


// ---- REPLICA FIEL DO SITIO DE TRANSPORTE --------------------------------
// Reproduz, na mesma ordem, o trecho do candidato entre o calculo de
// codigoPixEnviado e entregarComoJoao/enviarComoJoao.
export async function simularTransporte(opts: {
  resposta: string; ctx?: any; pixGerado?: any; cobrancaPendente?: any;
  holdArte?: boolean; prometeuPix?: boolean; prometeuCartao?: boolean; responde?: boolean;
}): Promise<{ textoEnviado: string; codigoPixEnviado: string; bloqueou: boolean; ids: string[] }> {
  const phone = '5511999995163';
  const ctx: any = opts.ctx ?? { autorizacoes: [], pixGerado: opts.pixGerado ?? null };
  if (opts.pixGerado && !ctx.pixGerado) ctx.pixGerado = opts.pixGerado;
  const execucoes: any = { cobrancaPendente: opts.cobrancaPendente ?? null };
  let resposta = opts.resposta;
  const decisao: any = { responde: opts.responde !== false, tema: 't' };
  const holdArtePagamento = !!opts.holdArte;
  const prometeuCartao = !!opts.prometeuCartao;

  // --- extracao deterministica do codigo (identica ao candidato) ---
  let codigoPixEnviado = '';
  const linhasResp = resposta.split('\n');
  const idxPix = linhasResp.findIndex((l: string) => l.trim().startsWith('000201') && l.trim().length > 60);
  if (idxPix >= 0) {
    resposta = linhasResp.filter((_: string, i: number) => i !== idxPix).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (resposta.length < 5) resposta = 'Segue seu Pix copia e cola logo abaixo. O pagamento confirma automaticamente.';
  }
  const prometeuPix = opts.prometeuPix ?? calcPrometeuPix(resposta);
  const temCodigoPix = /000201/.test(resposta);
  if (ctx.pixGerado?.ok === true && ctx.pixGerado?.qr_code) codigoPixEnviado = String(ctx.pixGerado.qr_code).trim();
  else if (execucoes.cobrancaPendente?.qr_code && (idxPix >= 0 || prometeuPix)) codigoPixEnviado = String(execucoes.cobrancaPendente.qr_code).trim();

  // --- hold de arte (verbatim do candidato) ---
  if (holdArtePagamento && decisao.responde === true && (prometeuPix || prometeuCartao || temCodigoPix || codigoPixEnviado)) {
    await logErro('cobranca_suspensa_hold_arte', { phone });
    resposta = 'Combinado! Primeiro a arte vem aqui para voc\u00ea aprovar. Assim que voc\u00ea aprovar, eu te envio a cobran\u00e7a para finalizar e a\u00ed entra na produ\u00e7\u00e3o.';
    codigoPixEnviado = '';
  }

  // --- INVARIANTE DE TRANSPORTE (verbatim do candidato) ---
  const egresso = await guardaEgressoFinanceiro(resposta, ctx, [codigoPixEnviado, ctx.pixGerado?.qr_code, execucoes.cobrancaPendente?.qr_code], phone, 'resposta_noturna');
  if (egresso.bloqueou) {
    resposta = egresso.texto;
    if (codigoPixEnviado) {
      if (resposta.length < 5) resposta = 'Segue seu Pix copia e cola logo abaixo. O pagamento confirma automaticamente.';
    } else {
      resposta = 'Para gerar a cobran\u00e7a correta eu preciso fechar o pedido no sistema. Me confirma a quantidade e se \u00e9 retirada ou entrega que eu finalizo agora.';
    }
  }
  if (codigoPixEnviado && RX_UUID_EXATO.test(codigoPixEnviado.trim().toLowerCase())) {
    await logErro('guardrail_identificador_financeiro_interno', { phone, origem: 'codigo_pix_uuid' });
    codigoPixEnviado = '';
  }
  return { textoEnviado: resposta, codigoPixEnviado, bloqueou: egresso.bloqueou, ids: egresso.ids };
}

// Replica do ramo de URL de pagamento (verbatim na condicao corrigida).
export function simularGuardaUrl(resposta: string, checkoutOficialRaw: string | null, pediuCartao: boolean) {
  const checkoutOficial = checkoutMercadoPago(checkoutOficialRaw);
  const urlsResposta = resposta.match(/https?:\/\/[^\s<>]+/gi) || [];
  const temUrlPagamento = urlsResposta.some((u: string) => /pay|checkout|pagamento|mercadopago/i.test(u));
  let out = resposta;
  if (pediuCartao) {
    if (checkoutOficial) out = `Segue o link oficial do Mercado Pago para pagar no cartao em ate 3x:\n\n${checkoutOficial}`;
    else {
      out = out.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      if (/segue (?:o )?link|link (?:para|de) pagamento|checkout/i.test(out) || out.length < 12) out = 'Ainda nao consegui criar o link oficial do Mercado Pago.';
    }
  } else if (temUrlPagamento && !(checkoutOficial && urlsResposta.some((u: string) => checkoutMercadoPago(u) === checkoutOficial))) {
    out = out.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return out;
}

export { validarPix, calcPrometeuPix, RX_HOLD_ARTE_PAGAMENTO, guardaEgressoFinanceiro, idsInternosNoTexto };
export function setLeituraFalha(v: boolean) { LEITURA_FALHA = v; }
export function resetErros() { ERROS = []; }
