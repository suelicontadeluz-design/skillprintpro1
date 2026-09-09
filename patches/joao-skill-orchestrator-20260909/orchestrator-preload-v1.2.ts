declare const Deno: any;

// João Skill Orchestrator v1.2 — 09/09/2026
// Camada única de orquestração entre skills já existentes.
// 1) deriva o estado da jornada do turno a partir do contexto conversacional atual;
// 2) publica precedência explícita para os gates internos;
// 3) deduplica chamadas Anthropic idênticas em janela curta, sem tabela nova.
// v1.1: orçamento explícito continua em QUALIFICATION mesmo quando menciona envio;
// LOGISTICS fica restrito a CEP/frete/entrega como assunto principal.
// v1.2: reconhece linguagem natural de preço ("quanto sairia", "quanto sai", "quanto ficaria")
// para não deixar uma pergunta comercial cair em CONVERSATION e perder a precedência de qualification.
// Não cria efeito externo, preço, frete, proposta ou cobrança.

const JO_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const JO_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const joBaseFetch = globalThis.fetch.bind(globalThis);
const JO_VERSION = 'joao-skill-orchestrator/v1.2';
const JO_TTL_MS = 2200;
let joCfgAt = 0;
let joCfg = true;
const joCache = new Map<string, { at: number; status: number; statusText: string; headers: [string,string][]; body: string }>();

function joUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function joBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function joEnabled(): Promise<boolean> {
  if (Date.now() - joCfgAt < 15000) return joCfg;
  joCfgAt = Date.now();
  try {
    const r = await joBaseFetch(`${JO_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_skill_orchestrator_ativo&limit=1`, {
      headers: { apikey: JO_SERVICE, authorization: `Bearer ${JO_SERVICE}` }, signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return joCfg;
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) joCfg = rows[0]?.valor_bool === true;
  } catch {}
  return joCfg;
}
function joText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function joHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function joDialogue(messages: any[]): { role:string; text:string }[] {
  const out: { role:string; text:string }[] = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || joHasToolResult(m.content)) continue;
    const text = joText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({ role: String(m.role), text });
  }
  return out;
}
function joCloseIntent(text: string): boolean {
  return /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|link\s+(?:de\s+)?pagamento|manda(?:r)?\s+(?:outro\s+)?pix|envia(?:r)?\s+(?:outro\s+)?pix|gera(?:r)?\s+(?:outro\s+)?pix|esse\s+pix|novo\s+pix)\b/i.test(text);
}
function joLogisticsIntent(text: string): boolean {
  return /\b(cep|frete|sedex|pac|motoboy|retirada|retirar|envio|entrega|transportadora)\b/i.test(text);
}
function joStrongQuoteIntent(text: string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|proposta)\b/i.test(text);
}
function joQuoteIntent(text: string): boolean {
  return joStrongQuoteIntent(text) || /\b(pre[cç]o|valor|quanto\s+(?:fica|ficaria|custa|custaria|sai|sairia))\b/i.test(text);
}
function joShortContinuation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  return /^(sim|n[aã]o|mesm[ao]|isso|esse|essa|outro|outra|de novo|novamente|manda|envia|pode|continua|segue|igual|o mesmo|a mesma)[.!?\s]*$/i.test(t)
    || /\b(mesm[ao]|outro|de novo|novamente|manda|envia|esse|isso)\b/i.test(t);
}
function joJourney(messages: any[]): { stage:string; source:string; inbound:string } {
  const d = joDialogue(messages);
  const inbound = [...d].reverse().find(x => x.role === 'user')?.text ?? '';
  if (!inbound) return { stage:'UNKNOWN', source:'NO_INBOUND', inbound:'' };
  if (joCloseIntent(inbound)) return { stage:'CLOSING', source:'CURRENT_CLOSE_INTENT', inbound };
  const prior = d.slice(0, -1).slice(-6).map(x => x.text).join('\n');
  if (joShortContinuation(inbound) && /\b(pix|pagamento|pagar|cart[aã]o|link\s+(?:de\s+)?pagamento|cobran[cç]a|fech(?:ar|amento))\b/i.test(prior)) {
    return { stage:'CLOSING', source:'RECENT_CLOSE_CONTEXT', inbound };
  }
  if (joStrongQuoteIntent(inbound)) return { stage:'QUALIFICATION', source:'CURRENT_EXPLICIT_QUOTE_INTENT', inbound };
  if (joLogisticsIntent(inbound)) return { stage:'LOGISTICS', source:'CURRENT_LOGISTICS_INTENT', inbound };
  if (joQuoteIntent(inbound)) return { stage:'QUALIFICATION', source:'CURRENT_QUOTE_INTENT', inbound };
  return { stage:'CONVERSATION', source:'DEFAULT', inbound };
}
function joToolFingerprint(messages:any[]): string {
  const parts:string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) {
      if (x?.type !== 'tool_result') continue;
      let s='';
      try { s = typeof x.content === 'string' ? x.content : JSON.stringify(x.content); } catch {}
      if (s) parts.push(s.slice(0,800));
    }
  }
  return parts.slice(-3).join('|');
}
function joKey(body:any, journey:{stage:string;inbound:string}): string {
  const model = String(body?.model ?? '');
  const q = typeof body?.system === 'string' ? (body.system.match(/\[VOCÊ ACABOU DE PERGUNTAR:[\s\S]{0,300}/)?.[0] ?? '') : '';
  return [model, journey.stage, journey.inbound, q, joToolFingerprint(body?.messages ?? [])].join('§').slice(0,5000);
}
function joPrune(now:number) {
  for (const [k,v] of joCache) if (now - v.at > JO_TTL_MS * 3) joCache.delete(k);
}
async function joAudit(evento:string, detail:any) {
  try {
    await joBaseFetch(`${JO_URL}/rest/v1/sistema_logs`, {
      method:'POST', headers:{ 'content-type':'application/json', apikey:JO_SERVICE, authorization:`Bearer ${JO_SERVICE}`, prefer:'return=minimal' },
      body:JSON.stringify({ agente_slug:'agente-noturno', funcao:'joao-skill-orchestrator', versao:JO_VERSION, nivel:'info', categoria:'skill_runtime', evento, status:'applied', mensagem:detail?.stage ?? evento, detalhe:detail }),
      signal:AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = joUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return joBaseFetch(input, init);
  if (!(await joEnabled())) return joBaseFetch(input, init);
  const raw = await joBody(input, init); if (!raw) return joBaseFetch(input, init);
  let body:any; try { body = JSON.parse(raw); } catch { return joBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return joBaseFetch(input, init);

  const journey = joJourney(body.messages);
  body.system += `\n\n[CORTEX JOURNEY v1 stage=${journey.stage} precedence=CLOSING>LOGISTICS>QUALIFICATION source=${journey.source}]\nO estágio da jornada define precedência entre skills. Skills de estágio inferior não podem reabrir dados já resolvidos sem mudança explícita do cliente.\n[/CORTEX JOURNEY]`;

  const key = joKey(body, journey);
  const now = Date.now(); joPrune(now);
  if (body?.stream !== true) {
    const hit = joCache.get(key);
    if (hit && now - hit.at <= JO_TTL_MS) {
      void joAudit('duplicate_model_call_suppressed', { stage:journey.stage, source:journey.source, inbound:journey.inbound.slice(0,240), dedupe_window_ms:JO_TTL_MS });
      return new Response(hit.body, { status:hit.status, statusText:hit.statusText, headers:new Headers(hit.headers) });
    }
  }

  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  const res = await joBaseFetch(input, { ...(init ?? {}), headers, body:JSON.stringify(body) });

  if (body?.stream !== true && res.ok) {
    try {
      const text = await res.clone().text();
      joCache.set(key, { at:Date.now(), status:res.status, statusText:res.statusText, headers:[...res.headers.entries()], body:text });
    } catch {}
  }
  void joAudit('journey_stage_resolved', { stage:journey.stage, source:journey.source, inbound:journey.inbound.slice(0,240) });
  return res;
};