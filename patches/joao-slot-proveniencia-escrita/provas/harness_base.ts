// HARNESS BASELINE v174 — codigo VERBATIM da edge publicada, sem nenhuma guarda nova.
const PIX_CHAVE = '30248650000111';
const validarPix = (m: string) => { const semQr = m.replace(/000201[\w\W]{50,}/, ''); const chaves = semQr.match(/\b\d{14}\b/g) || []; return chaves.every(c => c === PIX_CHAVE); };

function checkoutMercadoPago(raw: unknown): string | null {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !(host === 'mercadopago.com.br' || host.endsWith('.mercadopago.com.br'))) return null;
    return u.toString();
  } catch { return null; }
}


export function calcPrometeuPixBase(resposta: string): boolean {
  const prometeuPix: boolean = /(vou|vamos|j[a\u00e1] vou|deixa eu|posso) (gerar|mandar|enviar|passar|criar|fazer)\s+(o |seu |a |sua )?(pix|c[o\u00f3]digo|cobran[c\u00e7]a|chave)|(gero|mando|envio|passo|crio)\s+(o |seu )?pix|pix (vai |ja |j[a\u00e1] )?(sai|segue|vem)|te mando o pix/i.test(resposta);
  return prometeuPix;
}

// Replica FIEL do sitio de transporte da v174: a UNICA coisa que remove conteudo e a
// linha que comeca com 000201 e tem mais de 60 chars. Nao existe guarda de UUID.
export function simularTransporteBase(opts: { resposta: string; pixGerado?: any; cobrancaPendente?: any }) {
  let resposta = opts.resposta;
  const ctx: any = { pixGerado: opts.pixGerado ?? null };
  const execucoes: any = { cobrancaPendente: opts.cobrancaPendente ?? null };
  let codigoPixEnviado = '';
  const linhasResp = resposta.split('\n');
  const idxPix = linhasResp.findIndex((l: string) => l.trim().startsWith('000201') && l.trim().length > 60);
  if (idxPix >= 0) {
    resposta = linhasResp.filter((_: string, i: number) => i !== idxPix).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (resposta.length < 5) resposta = 'Segue seu Pix copia e cola logo abaixo. O pagamento confirma automaticamente.';
  }
  const prometeuPix = calcPrometeuPixBase(resposta);
  if (ctx.pixGerado?.ok === true && ctx.pixGerado?.qr_code) codigoPixEnviado = String(ctx.pixGerado.qr_code).trim();
  else if (execucoes.cobrancaPendente?.qr_code && (idxPix >= 0 || prometeuPix)) codigoPixEnviado = String(execucoes.cobrancaPendente.qr_code).trim();
  return { textoEnviado: resposta, codigoPixEnviado };
}

export function simularGuardaUrlBase(resposta: string, checkoutOficialRaw: string | null, pediuCartao: boolean) {
  const checkoutOficial = checkoutMercadoPago(checkoutOficialRaw);
  const urlsResposta = resposta.match(/https?:\/\/[^\s<>]+/gi) || [];
  const temUrlPagamento = urlsResposta.some((u: string) => /pay|checkout|pagamento|mercadopago/i.test(u));
  let out = resposta;
  if (pediuCartao) {
    if (checkoutOficial) out = 'Segue o link oficial: ' + checkoutOficial;
    else {
      out = out.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      if (/segue (?:o )?link|link (?:para|de) pagamento|checkout/i.test(out) || out.length < 12) out = 'Ainda nao consegui criar o link oficial do Mercado Pago.';
    }
  } else if (temUrlPagamento && !urlsResposta.some((u: string) => checkoutMercadoPago(u) === checkoutOficial)) {
    out = out.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return out;
}
export { validarPix };
