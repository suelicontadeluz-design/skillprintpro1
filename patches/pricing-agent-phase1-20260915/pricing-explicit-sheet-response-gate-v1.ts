declare const Deno: any;

// PricingAgent Phase 1 — explicit DTF UV sheet quote gate v1 — 15/09/2026
// Narrow scope: current-turn explicit N x A4/A3 sheet orders only.
// ERP is the only pricing source. No financial/proposal/customer mutation occurs here.
// This gate is intended to wrap the exact v295 LKG; all unrelated turns pass through unchanged.

const PES_BASE_SERVE = Deno.serve.bind(Deno);
const PES_BASE_FETCH = globalThis.fetch.bind(globalThis);
const PES_ERP_URL = (Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/, '');
const PES_ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const PES_VERSION = 'pricing-agent-explicit-sheet/v1';

type SheetOrder = { format: 'a4' | 'a3'; count: number };

function pesNorm(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function pesCountWord(v: string): number | null {
  const m: Record<string, number> = { um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10 };
  if (/^\d{1,3}$/.test(v)) return Number(v);
  return m[v] ?? null;
}
function pesParse(text: string): SheetOrder | null {
  const t = pesNorm(text);
  const hits: SheetOrder[] = [];
  const explicit = /(?:^|\b)(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:x\s*)?(?:folhas?|fls?\.?)[\s:-]*a\s*([34])\b/g;
  for (const m of t.matchAll(explicit)) {
    const count = pesCountWord(m[1]);
    if (count && count >= 1 && count <= 100) hits.push({ format: m[2] === '4' ? 'a4' : 'a3', count });
  }
  const compact = /(?:^|\b)(\d{1,3})\s*x\s*a\s*([34])\b/g;
  for (const m of t.matchAll(compact)) {
    const count = Number(m[1]);
    if (count >= 1 && count <= 100) hits.push({ format: m[2] === '4' ? 'a4' : 'a3', count });
  }
  if (!hits.length) return null;
  const formats = [...new Set(hits.map(h => h.format))];
  if (formats.length !== 1) return null;
  const count = hits.filter(h => h.format === formats[0]).reduce((sum,h) => sum + h.count, 0);
  if (count < 1 || count > 100) return null;
  return { format: formats[0] as 'a4'|'a3', count };
}
function pesExplicitUvContext(incoming: string, payload: any): boolean {
  const t = pesNorm(incoming);
  const slotProduct = pesNorm(payload?.slots?.produto ?? payload?.produto ?? '');
  return /\b(folha|folhas|adesivo|adesivos|dtf\s*uv|uv)\b/.test(t) || slotProduct === 'dtf_uv' || slotProduct === 'dtf uv';
}
function pesMoney(v: number): string {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}
async function pesQuote(order: SheetOrder): Promise<any | null> {
  if (!PES_ERP_KEY) return null;
  try {
    const r = await PES_BASE_FETCH(`${PES_ERP_URL}/rest/v1/rpc/fn_cortex_pricing_explicit_sheet_quote_v1`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:PES_ERP_KEY, authorization:`Bearer ${PES_ERP_KEY}` },
      body: JSON.stringify({ p_format: order.format, p_count: order.count }),
      signal: AbortSignal.timeout(2500),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || data?.ok !== true || data?.canonical !== true || data?.system_of_record !== 'ERP') return null;
    const unit = Number(data?.unit_price), total = Number(data?.total_price);
    if (!(unit > 0) || !(total > 0) || Math.abs(total - unit * order.count) > 0.011) return null;
    return data;
  } catch { return null; }
}
function pesLooksRelevantBase(text: string, format: 'a4'|'a3'): boolean {
  const t = pesNorm(text);
  const formatHit = new RegExp(`\\ba\\s*${format === 'a4' ? '4' : '3'}\\b`).test(t);
  const productHit = /\b(folha|folhas|adesivo|adesivos|dtf|uv|cabem|cabe)\b/.test(t);
  const conflictingFlow = /\b(frete|sedex|pac|pix|pagamento|chave pix|transportadora)\b/.test(t);
  return formatHit && productHit && !conflictingFlow;
}
function pesContainsAmount(text: string, amount: number): boolean {
  const t = String(text ?? '').replace(/\s/g,'');
  const br = Number(amount).toFixed(2).replace('.', ',');
  const dot = Number(amount).toFixed(2);
  return t.includes(`R$${br}`) || t.includes(`R$${dot}`) || t.includes(br) || t.includes(dot);
}

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== 'function') throw new TypeError('Deno.serve handler missing');

  args[handlerIndex] = async (req: Request, info: any) => {
    let reqBody: any = null;
    try {
      if (req.method === 'POST' && (req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        reqBody = await req.clone().json().catch(() => null);
      }
    } catch {}

    const res = await handler(req, info);
    if (!reqBody || !res.ok) return res;

    const incoming = String(reqBody?.mensagem ?? reqBody?.message ?? '').trim();
    const order = pesParse(incoming);
    if (!order) return res;

    let raw = '';
    try { raw = await res.clone().text(); } catch { return res; }
    if (!raw.trim().startsWith('{')) return res;
    let payload: any;
    try { payload = JSON.parse(raw.trim()); } catch { return res; }
    if (!payload || typeof payload !== 'object') return res;

    if (!pesExplicitUvContext(incoming, payload)) return res;

    const quote = await pesQuote(order);
    const metaBase = {
      gate: 'ERP_CANONICAL_EXPLICIT_SHEET_QUOTE',
      current_turn: true,
      format: order.format,
      count: order.count,
      dry_run: reqBody?._dry_run === true,
      source: 'ERP',
      version: PES_VERSION,
    };

    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.set('content-type','application/json; charset=utf-8');
    headers.set('x-cortex-pricing-agent', PES_VERSION);

    if (!quote) {
      const next = { ...payload, pricing_agent: { ...metaBase, mode:'FAIL_CLOSED', canonical:false } };
      next.respondeu = true;
      next.resposta = 'Não consegui confirmar o preço canônico dessas folhas agora. Vou manter o orçamento sem valor até o ERP responder corretamente.';
      headers.set('x-cortex-pricing-agent-mode','fail-closed');
      return new Response(JSON.stringify(next), { status:res.status, statusText:res.statusText, headers });
    }

    const unit = Number(quote.unit_price), total = Number(quote.total_price);
    const fmt = order.format.toUpperCase();
    const noun = order.count === 1 ? 'folha' : 'folhas';
    const canonicalLine = order.count === 1
      ? `1 folha ${fmt}: ${pesMoney(total)}.`
      : `${order.count} ${noun} ${fmt}: ${pesMoney(total)} (${pesMoney(unit)} cada).`;

    const baseResponse = String(payload?.resposta ?? '').trim();
    let finalText = canonicalLine;
    if (baseResponse && pesLooksRelevantBase(baseResponse, order.format)) {
      finalText = pesContainsAmount(baseResponse,total) ? baseResponse : `${baseResponse}\n\n${canonicalLine}`;
    }

    const next = {
      ...payload,
      respondeu:true,
      resposta:finalText,
      pricing_agent:{
        ...metaBase,
        mode:'ENFORCE_EXPLICIT_SHEET',
        canonical:true,
        unit_price:unit,
        total_price:total,
        pricing_source:quote.pricing_source ?? 'produtos.metadata.dtf_uv_pricing_v1',
        system_of_record:'ERP',
        base_was_relevant:pesLooksRelevantBase(baseResponse,order.format),
      },
    };

    headers.set('x-cortex-pricing-agent-mode','enforce-explicit-sheet');
    console.log(JSON.stringify({ event:'PRICING_AGENT_EXPLICIT_SHEET_ENFORCED', version:PES_VERSION, format:order.format, count:order.count, unit_price:unit, total_price:total, dry_run:reqBody?._dry_run===true }));
    return new Response(JSON.stringify(next), { status:res.status, statusText:res.statusText, headers });
  };

  return PES_BASE_SERVE(...args as any);
};
