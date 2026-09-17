declare const Deno: any;

// Halftone identity resolver v1 — 17/09/2026
// Narrow responsibility: when the halftone router cannot see a full phone in the Anthropic
// request, reconcile the latest customer-authored inbound against fact_conversations.
// Fail closed unless exactly one recent phone matches the exact inbound text.
// No customer-specific hardcode; no writes; no pricing or routing authority.

const HPR_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const HPR_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const hprBaseFetch = globalThis.fetch.bind(globalThis);

function hprUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function hprBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function hprText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text' && typeof x?.text === 'string')
    .map((x:any) => String(x.text)).join('\n').trim();
}
function hprHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function hprInbound(messages:any[]): string {
  for (let i=messages.length-1;i>=0;i--) {
    const m=messages[i];
    if (m?.role !== 'user' || hprHasToolResult(m?.content)) continue;
    const t=hprText(m.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function hprHasFullPhone(system:string): boolean {
  return /\b55\d{10,11}\b/.test(system);
}
async function hprResolvePhone(inbound:string): Promise<string|null> {
  if (!inbound || inbound.length > 1000) return null;
  try {
    const cutoff = new Date(Date.now() - 15*60*1000).toISOString();
    const u = `${HPR_URL}/rest/v1/fact_conversations?select=phone,timestamp&direction=eq.inbound&message_text=eq.${encodeURIComponent(inbound)}&timestamp=gte.${encodeURIComponent(cutoff)}&order=timestamp.desc&limit=5`;
    const r = await hprBaseFetch(u, {
      headers:{apikey:HPR_SERVICE, authorization:`Bearer ${HPR_SERVICE}`},
      signal:AbortSignal.timeout(1800),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(()=>[]);
    const phones = [...new Set((Array.isArray(rows)?rows:[])
      .map((x:any)=>String(x?.phone ?? '').replace(/\D/g,''))
      .filter((x:string)=>/^55\d{10,11}$/.test(x)))];
    return phones.length === 1 ? phones[0] : null;
  } catch { return null; }
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = hprUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return hprBaseFetch(input, init);

  const raw = await hprBody(input, init);
  if (!raw) return hprBaseFetch(input, init);
  let body:any;
  try { body = JSON.parse(raw); } catch { return hprBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return hprBaseFetch(input, init);
  if (hprHasFullPhone(body.system)) return hprBaseFetch(input, init);

  const inbound = hprInbound(body.messages);
  const phone = await hprResolvePhone(inbound);
  if (!phone) return hprBaseFetch(input, init);

  body.system += `\n[HALFTONE_IDENTITY_RESOLVED phone=${phone} source=fact_conversations_exact_recent]\n`;
  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  return hprBaseFetch(input, { ...(init ?? {}), headers, body:JSON.stringify(body) });
};
