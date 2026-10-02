// João freight positive-quote outbound guard v1.1 — 2026-09-14
// Proven case: successful freight quote persisted, but customer answer denied freight and regressed to CEP confirmation/pickup.
// Also retries only explicit transient Z-API HTTP rejections before the existing fallback.

const FP_URL = Deno.env.get('SUPABASE_URL') ?? '';
const FP_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const fpBaseFetch = globalThis.fetch.bind(globalThis);
const fpSubscriberPhone = new Map<string, { phone: string; at: number }>();
const FP_MAX_QUOTE_AGE_MS = 20 * 60 * 1000;
const FP_TRANSIENT_ZAPI = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function fpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
function fpDigits(value: unknown): string { return String(value ?? '').replace(/\D/g, ''); }
function fpNorm(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
async function fpRaw(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function fpRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
function fpExtractCep(text: string): string | null {
  const m = String(text).match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}` : null;
}
function fpFreightDenial(text: string): boolean {
  const t = fpNorm(text);
  return /(?:nao\s+(?:esta\s+)?(?:retornando|retorna|retornou|apareceu|tem|ha)|sem|nenhuma)\s+(?:uma\s+|qualquer\s+)?(?:opcao|opcoes|alternativa|alternativas)\s+(?:de\s+)?frete/.test(t)
    || /cep.{0,35}nao.{0,25}(?:retorn|tem|ha).{0,30}frete/.test(t)
    || /frete.{0,30}(?:nao\s+(?:retornou|apareceu|tem|ha)|sem\s+(?:opcao|opcoes))/.test(t);
}
function fpPositiveQuoteRegression(text: string): boolean {
  const t = fpNorm(text);
  return fpFreightDenial(text)
    || /(?:confirm|confere|confirma).{0,35}(?:cep|certo|correto)/.test(t)
    || /(?:prefere|quer|pode).{0,35}(?:retirar|retirada|buscar|motoboy)/.test(t)
    || /(?:retirar|retirada|buscar|motoboy).{0,35}(?:prefere|quer|pode)/.test(t);
}
function fpMoney(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `R$ ${n.toFixed(2).replace('.', ',')}` : '';
}
function fpDeadline(option: any): string {
  const d = Number(option?.prazo_dias);
  if (Number.isFinite(d)) return d === 1 ? '1 dia útil' : `${d} dias úteis`;
  const raw = String(option?.prazo_formatado ?? '').trim();
  return raw.replace(/\buteis\b/gi, 'úteis').replace(/\butil\b/gi, 'útil');
}
function fpQuoteLines(options: any[]): string[] {
  return options.map((o: any) => {
    const service = String(o?.servico || o?.transportadora || 'Frete').trim();
    const carrier = String(o?.transportadora || '').trim();
    const label = carrier && !fpNorm(service).includes(fpNorm(carrier)) ? `${service} (${carrier})` : service;
    const price = String(o?.preco_formatado || '').trim() || fpMoney(o?.preco);
    const deadline = fpDeadline(o);
    return `• ${label}: ${price}${deadline ? ` — ${deadline}` : ''}`;
  }).filter(Boolean);
}
function fpFormatCep(cep: string): string { return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep; }

async function fpLatestPositiveQuote(phone: string, text: string): Promise<any | null> {
  if (!FP_URL || !FP_SERVICE) return null;
  const p = fpDigits(phone);
  if (p.length < 10) return null;
  const since = new Date(Date.now() - FP_MAX_QUOTE_AGE_MS).toISOString();
  const query = `${FP_URL}/rest/v1/joao_freight_quote_snapshots?select=quote_id,phone,cep_destino,opcoes,quoted_at,source_evidence,shipment_kind&phone=eq.${encodeURIComponent(p)}&quoted_at=gte.${encodeURIComponent(since)}&order=quoted_at.desc&limit=10`;
  try {
    const r = await fpBaseFetch(query, { headers: { apikey: FP_SERVICE, authorization: `Bearer ${FP_SERVICE}` } });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows)) return null;
    const cepInText = fpExtractCep(text);
    for (const row of rows) {
      const options = Array.isArray(row?.opcoes) ? row.opcoes : [];
      if (!options.length) continue;
      const rowCep = fpDigits(row?.cep_destino);
      if (cepInText && rowCep !== cepInText) continue;
      return row;
    }
  } catch {}
  return null;
}

function fpRewriteWithQuote(original: string, quote: any): string {
  const options = Array.isArray(quote?.opcoes) ? quote.opcoes : [];
  const cep = fpDigits(quote?.cep_destino);
  const lines = fpQuoteLines(options);
  if (!lines.length || cep.length !== 8) return original;

  const pieces = String(original).split(/(?<=[.!?])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
  const kept = pieces.filter((piece) => !fpPositiveQuoteRegression(piece));
  const prefix = kept.join(' ').trim();
  const quoteText = `Para o CEP ${fpFormatCep(cep)}, tenho estas opções de frete:\n${lines.join('\n')}\nQual você prefere?`;
  return prefix ? `${prefix}\n\n${quoteText}` : `*João Barros:*\n${quoteText}`;
}

async function fpAudit(event: string, detail: Record<string, unknown>): Promise<void> {
  if (!FP_URL || !FP_SERVICE) return;
  try {
    await fpBaseFetch(`${FP_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', apikey: FP_SERVICE,
        authorization: `Bearer ${FP_SERVICE}`, prefer: 'return=minimal',
      },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'joao-freight-positive-output-guard',
        versao: 'freight-positive-output-preload/v1.1',
        nivel: event.includes('failed') || event.includes('rejected') ? 'warning' : 'info',
        categoria: 'freight_runtime', evento: event, status: 'observed', mensagem: event, detalhe: detail,
      }),
    });
  } catch {}
}

function fpOutbound(body: any, url: string): { field: 'message' | 'value' | 'texto'; phone: string; text: string; zapi: boolean } | null {
  if (/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) {
    return { field: 'message', phone: fpDigits(body?.phone), text: String(body?.message ?? ''), zapi: true };
  }
  const bm = url.match(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/([^/]+)\/send_message\/?(?:\?|$)/i);
  if (bm && String(body?.type ?? '').toLowerCase() === 'text') {
    const cached = fpSubscriberPhone.get(bm[1]);
    const phone = cached && Date.now() - cached.at < 10 * 60 * 1000 ? cached.phone : '';
    return { field: 'value', phone, text: String(body?.value ?? ''), zapi: false };
  }
  if (url.includes('/functions/v1/joao-tts')) {
    return { field: 'texto', phone: fpDigits(body?.phone), text: String(body?.texto ?? ''), zapi: false };
  }
  return null;
}

async function fpCall(input: RequestInfo | URL, init?: RequestInit): Promise<Response> { return await fpBaseFetch(input, init); }

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = fpUrl(input);
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();

  const lookup = url.match(/\/subscriber\/get_by_phone\/([^/?]+)\/?(?:\?|$)/i);
  if (lookup) {
    const response = await fpCall(input, init);
    if (response.ok) {
      try {
        const data = await response.clone().json();
        const sid = String(data?.id || '');
        const phone = fpDigits(decodeURIComponent(lookup[1]));
        if (sid && phone) fpSubscriberPhone.set(sid, { phone, at: Date.now() });
      } catch {}
    }
    return response;
  }

  if (method !== 'POST') return fpCall(input, init);
  const raw = await fpRaw(input, init);
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { return fpCall(input, init); }
  if (!body) return fpCall(input, init);

  const outbound = fpOutbound(body, url);
  let callInput = input;
  let callInit = init;

  if (outbound && outbound.text && outbound.phone && fpFreightDenial(outbound.text)) {
    const quote = await fpLatestPositiveQuote(outbound.phone, outbound.text);
    if (quote) {
      const rewritten = fpRewriteWithQuote(outbound.text, quote);
      if (rewritten !== outbound.text) {
        body[outbound.field] = rewritten;
        const rebuilt = fpRebuild(input, init, JSON.stringify(body));
        callInput = rebuilt[0]; callInit = rebuilt[1];
        void fpAudit('positive_quote_contradiction_rewritten', {
          phone_suffix: outbound.phone.slice(-4), quote_id: quote?.quote_id ?? null,
          cep_suffix: fpDigits(quote?.cep_destino).slice(-3), options_count: Array.isArray(quote?.opcoes) ? quote.opcoes.length : 0,
        });
      }
    }
  }

  const response = await fpCall(callInput, callInit);
  if (!outbound?.zapi || response.ok) return response;

  void fpAudit('zapi_rejected_before_fallback', {
    phone_suffix: outbound.phone.slice(-4), http_status: response.status,
    transient: FP_TRANSIENT_ZAPI.has(response.status),
  });
  if (!FP_TRANSIENT_ZAPI.has(response.status)) return response;

  await new Promise((resolve) => setTimeout(resolve, 300));
  const retry = await fpCall(callInput, callInit);
  void fpAudit(retry.ok ? 'zapi_transient_retry_recovered' : 'zapi_transient_retry_failed', {
    phone_suffix: outbound.phone.slice(-4), first_http_status: response.status, retry_http_status: retry.status,
  });
  return retry;
};
