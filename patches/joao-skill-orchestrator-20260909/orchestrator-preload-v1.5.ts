declare const Deno: any;

// João Skill Orchestrator v1.5 — 10/09/2026
// Extensão mínima da v1.4 canônica. Preserva integralmente roteamento, continuidade e dedupe da v1.4.
// Única adição: pergunta explícita sobre fornecedor não pode terminar com responde:false.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/04378e47dac832c7969855e6084c4f2b95213a10/patches/joao-skill-orchestrator-20260909/orchestrator-preload-v1.4.ts";

const JO15_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const JO15_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const jo15BaseFetch = globalThis.fetch.bind(globalThis);
const JO15_VERSION = 'joao-skill-orchestrator/v1.5';
let jo15CfgAt = 0;
let jo15Cfg = true;

function jo15Url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function jo15Body(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function jo15Enabled(): Promise<boolean> {
  if (Date.now() - jo15CfgAt < 15000) return jo15Cfg;
  jo15CfgAt = Date.now();
  try {
    const r = await jo15BaseFetch(`${JO15_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_skill_orchestrator_ativo&limit=1`, {
      headers: { apikey: JO15_SERVICE, authorization: `Bearer ${JO15_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) jo15Cfg = rows[0]?.valor_bool === true;
    }
  } catch {}
  return jo15Cfg;
}
function jo15Text(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function jo15HasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function jo15LatestInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || jo15HasToolResult(m?.content)) continue;
    const t = jo15Text(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function jo15SupplierQuestion(text: string): boolean {
  const t = String(text || '').trim();
  return /\bforneced(?:or|ores|ora|oras)\b/i.test(t)
    && (/\?/.test(t) || /\b(quantos?|qual|quais|ainda|s[oó]|somente|possui|possuem|tem|t[eê]m|voc[eê]s)\b/i.test(t));
}
function jo15RecentContext(messages:any[]): string {
  const out:string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < 8; i--) {
    const m = messages[i];
    if ((m?.role !== 'user' && m?.role !== 'assistant') || jo15HasToolResult(m?.content)) continue;
    const t = jo15Text(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.unshift(t);
  }
  return out.join('\n');
}
function jo15Clarification(messages:any[]): string {
  const ctx = jo15RecentContext(messages);
  if (/camiset/i.test(ctx) && /algod[aã]o/i.test(ctx)) return 'Você está falando dos fornecedores da camiseta 100% algodão, certo?';
  if (/camiset/i.test(ctx)) return 'Você está falando dos fornecedores das camisetas, certo?';
  if (/dtf\s*uv/i.test(ctx)) return 'Você está falando dos fornecedores do DTF UV, certo?';
  if (/dtf/i.test(ctx)) return 'Você está falando dos fornecedores do DTF, certo?';
  return 'Você está falando dos fornecedores desse produto, certo?';
}
function jo15PatchAnthropic(text:string, messages:any[]): { changed:boolean; body:string } {
  try {
    const outer = JSON.parse(text);
    if (!Array.isArray(outer?.content)) return { changed:false, body:text };
    const block = outer.content.find((x:any) => x?.type === 'text' && typeof x?.text === 'string');
    if (!block) return { changed:false, body:text };
    let decision:any;
    try { decision = JSON.parse(block.text); } catch { return { changed:false, body:text }; }
    if (!decision || decision.responde !== false) return { changed:false, body:text };
    decision.responde = true;
    decision.mensagem = jo15Clarification(messages);
    decision.tema = String(decision.tema || 'complexo');
    decision.encaminhou_venda = false;
    delete decision.slots;
    block.text = JSON.stringify(decision);
    return { changed:true, body:JSON.stringify(outer) };
  } catch {
    return { changed:false, body:text };
  }
}
async function jo15Audit(evento:string, detalhe:any) {
  try {
    await jo15BaseFetch(`${JO15_URL}/rest/v1/sistema_logs`, {
      method:'POST',
      headers:{ 'content-type':'application/json', apikey:JO15_SERVICE, authorization:`Bearer ${JO15_SERVICE}`, prefer:'return=minimal' },
      body:JSON.stringify({ agente_slug:'agente-noturno', funcao:'joao-skill-orchestrator', versao:JO15_VERSION, nivel:'info', categoria:'skill_runtime', evento, status:'applied', mensagem:evento, detalhe:{ skill_ref:'orchestrator', authority_granted:true, authority_scope:'current_turn_supplier_response', external_authority:false, effect_class:'RESPONSE_FALLBACK', ...detalhe } }),
      signal:AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = jo15Url(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return jo15BaseFetch(input, init);
  if (!(await jo15Enabled())) return jo15BaseFetch(input, init);
  const raw = await jo15Body(input, init);
  if (!raw) return jo15BaseFetch(input, init);
  let req:any;
  try { req = JSON.parse(raw); } catch { return jo15BaseFetch(input, init); }
  if (!Array.isArray(req?.messages) || req?.stream === true) return jo15BaseFetch(input, init);
  const inbound = jo15LatestInbound(req.messages);
  if (!jo15SupplierQuestion(inbound)) return jo15BaseFetch(input, init);

  const res = await jo15BaseFetch(input, init);
  if (!res.ok) return res;
  let original:string;
  try { original = await res.clone().text(); } catch { return res; }
  const patched = jo15PatchAnthropic(original, req.messages);
  if (!patched.changed) return res;

  void jo15Audit('supplier_no_silence_fallback_enforced', { supplier_question:true });
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(patched.body, { status:res.status, statusText:res.statusText, headers });
};
