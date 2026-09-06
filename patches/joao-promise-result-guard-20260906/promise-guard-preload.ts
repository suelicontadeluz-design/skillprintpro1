declare const Deno: any;

// Joao promise-to-result guard v1 — 2026-09-06
// Scope intentionally narrow: customer-facing promises to calculate/quote with no value.
// If this turn produced financial calculation operations, verbalize them deterministically.
// If no calculation exists, replace the false promise with the missing-data question.

const PG_SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PG_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const pgBaseFetch = globalThis.fetch.bind(globalThis);
const PG_WINDOW_MS = 60_000;

function pgUrlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function pgBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

function pgRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}

function pgMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pgNeedsGuard(text: string): boolean {
  if (!text || /R\s*\$/i.test(text)) return false;
  return /\b(?:vou|irei|j[aá]\s+vou|deixa\s+eu)\b[\s\S]{0,80}\b(?:calcular|cotar|or[cç]ar|fazer\s+(?:o\s+|os\s+|um\s+|uns\s+)?or[cç]amentos?)\b/i.test(text);
}

function pgFallback(original: string): string {
  if (/camiset|polo|moletom/i.test(original)) {
    return '*João Barros:*\nPra eu fechar o valor sem chutar, me confirma o tamanho aproximado de cada estampa: pequena, A4, A3 ou maior?';
  }
  if (/frete|cep/i.test(original)) {
    return '*João Barros:*\nPra eu fechar o orçamento certinho, me confirma o CEP de entrega.';
  }
  if (/uv|adesiv|r[oó]tulo/i.test(original)) {
    return '*João Barros:*\nPra eu fechar o valor sem chutar, me confirma as medidas do adesivo e a quantidade.';
  }
  return '*João Barros:*\nPra eu fechar o valor sem chutar, me confirma as medidas da arte e a quantidade.';
}

async function pgResolveLead(phone: string): Promise<string | null> {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const suffix = digits.slice(-8);
  const url = `${PG_SUPABASE_URL}/rest/v1/fact_conversations?select=lead_id&phone=like.*${encodeURIComponent(suffix)}&order=timestamp.desc&limit=1`;
  const r = await pgBaseFetch(url, { headers: { apikey: PG_SERVICE_KEY, authorization: `Bearer ${PG_SERVICE_KEY}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  const lead = Array.isArray(rows) ? rows[0]?.lead_id : null;
  return lead ? String(lead) : null;
}

async function pgRecentOps(leadId: string): Promise<any[]> {
  const since = new Date(Date.now() - PG_WINDOW_MS).toISOString();
  const tools = 'calcular_rendimento_uv,calcular_dtf_por_arte,calcular_dtf_uv_metro,calcular_dtf_metro,orcar_camisetas,calcular_frete,calcular_copo';
  const url = `${PG_SUPABASE_URL}/rest/v1/operacoes_financeiras?select=id,amount,kind,source_tool,components,created_at,status&lead_id=eq.${encodeURIComponent(leadId)}&status=eq.ativa&source_tool=in.(${tools})&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc`;
  const r = await pgBaseFetch(url, { headers: { apikey: PG_SERVICE_KEY, authorization: `Bearer ${PG_SERVICE_KEY}` } });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function pgLine(op: any, idx: number): string {
  const c = op?.components && typeof op.components === 'object' ? op.components : {};
  const amount = pgMoney(op?.amount);
  const tool = String(op?.source_tool || '');
  if (!amount) return '';
  if (tool === 'calcular_rendimento_uv' && Number(c.quantidade) > 0) return `${Number(c.quantidade)} adesivos: *R$ ${amount}*`;
  if (tool === 'orcar_camisetas' && Number(c.quantidade_total) > 0) return `${Number(c.quantidade_total)} camisetas: *R$ ${amount}*`;
  if (tool === 'calcular_frete') return `Frete: *R$ ${amount}*`;
  if (tool === 'calcular_copo' && Number(c.quantidade) > 0) return `${Number(c.quantidade)} copos: *R$ ${amount}*`;
  if ((tool === 'calcular_dtf_uv_metro' || tool === 'calcular_dtf_metro') && Number(c.consumo_m ?? c.metros) > 0) {
    const m = Number(c.consumo_m ?? c.metros);
    return `${String(m).replace('.', ',')} m: *R$ ${amount}*`;
  }
  return `Orçamento${idx > 0 ? ` ${idx + 1}` : ''}: *R$ ${amount}*`;
}

function pgResultMessage(ops: any[], original: string): string {
  const lines = ops.map(pgLine).filter(Boolean);
  if (!lines.length) return pgFallback(original);
  const unique = [...new Set(lines)];
  return `*João Barros:*\nPronto, calculei:\n${unique.join('\n')}`;
}

async function pgRewrite(input: RequestInfo | URL, init?: RequestInit): Promise<[RequestInfo | URL, RequestInit | undefined] | null> {
  const url = pgUrlOf(input);
  const raw = await pgBodyText(input, init);
  if (!raw) return null;
  let body: any;
  try { body = JSON.parse(raw); } catch { return null; }

  let text = '';
  let phone = '';
  let field: 'message' | 'value' | 'texto' | null = null;

  if (/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) {
    text = String(body?.message ?? '');
    phone = String(body?.phone ?? '');
    field = 'message';
  } else if (/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/[^/]+\/send_message\/?(?:\?|$)/i.test(url) && String(body?.type ?? '').toLowerCase() === 'text') {
    text = String(body?.value ?? '');
    field = 'value';
  } else if (url.includes('/functions/v1/joao-tts')) {
    text = String(body?.texto ?? '');
    field = 'texto';
  } else {
    return null;
  }

  if (!field || !pgNeedsGuard(text)) return null;

  let rewritten = pgFallback(text);
  try {
    const lead = phone ? await pgResolveLead(phone) : null;
    const ops = lead ? await pgRecentOps(lead) : [];
    rewritten = pgResultMessage(ops, text);
  } catch {}

  body[field] = rewritten;
  console.warn(JSON.stringify({ event: 'JOAO_PROMISE_GUARD_REWRITE', route: field, had_result: /R\s*\$/i.test(rewritten) }));
  return pgRebuild(input, init, JSON.stringify(body));
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rewritten = await pgRewrite(input, init);
  if (rewritten) return pgBaseFetch(rewritten[0], rewritten[1]);
  return pgBaseFetch(input, init);
};
