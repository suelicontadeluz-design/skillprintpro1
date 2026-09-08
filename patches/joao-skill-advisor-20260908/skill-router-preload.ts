declare const Deno: any;

// João Skill Router v1 — 08/09/2026
// Escopo deliberadamente pequeno: quando qualification/v2 tem um próximo passo
// inequívoco, o Córtex produz a decisão cognitiva e NÃO gasta uma chamada de LLM.
// O agente-noturno continua responsável por todas as guardas e pelo transporte.
// Nenhuma skill ganha autoridade de preço, frete, cobrança ou efeito externo.

const SR_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SR_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const srBaseFetch = globalThis.fetch.bind(globalThis);
const SR_VERSION = 'joao-skill-router/v1';
let srCfgAt = 0;
let srCfg = false;

function srUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function srBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function srEnabled(): Promise<boolean> {
  if (Date.now() - srCfgAt < 15000) return srCfg;
  srCfgAt = Date.now();
  try {
    const r = await srBaseFetch(`${SR_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_skill_router_ativo&limit=1`, {
      headers: { apikey: SR_SERVICE, authorization: `Bearer ${SR_SERVICE}` }, signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    srCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { srCfg = false; }
  return srCfg;
}
function srText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function srToolResults(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function srInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || srToolResults(m?.content)) continue;
    const t = srText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function srJsonAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  const start = text.indexOf('{', mi + marker.length); if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function srQuestion(system: string): string {
  const tag = '[VOCÊ ACABOU DE PERGUNTAR:'; const i = system.lastIndexOf(tag); if (i < 0) return '';
  const e = system.indexOf('O CLIENTE RESPONDEU:', i); if (e < 0) return '';
  return system.slice(i + tag.length, e).replace(/^\s*["“]|["”]\s*$/g, '').trim();
}
function srShortInt(text: string): number | null {
  const c = text.trim();
  if (c.length > 80 || /\d\s*[x×]\s*\d/i.test(c) || /\d+[,.]\d+/.test(c) || /\b\d{8}\b/.test(c)) return null;
  const m = c.match(/(?:^|\D)(\d{1,5})(?:\D|$)/); if (!m) return null;
  const n = Number(m[1]); return Number.isInteger(n) && n > 0 ? n : null;
}
function srSlots(system: string, inbound: string): any {
  const f = system.lastIndexOf('[FICHA:');
  const s0 = f >= 0 ? srJsonAfter(system, 'slots=', f) : null;
  const s = s0 && typeof s0 === 'object' ? { ...s0 } : {};
  const q = srQuestion(system).toLowerCase();
  if (!(Number(s.quantidade) > 0) && /quant|c[oó]pia|unidade|pe[cç]a|quantas|quantos/.test(q)) {
    const n = srShortInt(inbound); if (n) s.quantidade = n;
  }
  if (!s.cep && /\bcep\b/.test(q)) {
    const cep = inbound.replace(/\D/g, ''); if (/^\d{8}$/.test(cep)) s.cep = cep;
  }
  if (!s.envio_retirada && /(retirada|retirar|envio|receber|buscar|motoboy)/.test(q)) {
    if (/\b(retir|buscar|busco|vou buscar)\w*/i.test(inbound)) s.envio_retirada = 'retirada';
    else if (/\b(motoboy|moto)\b/i.test(inbound)) s.envio_retirada = 'motoboy';
    else if (/\b(envio|enviar|receber|entrega|correios|transportadora)\b/i.test(inbound)) s.envio_retirada = 'envio';
  }
  return s;
}
async function srQual(snapshot: any): Promise<any | null> {
  try {
    const r = await srBaseFetch(`${SR_URL}/rest/v1/rpc/fn_qualification_evaluate_v2`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: SR_SERVICE, authorization: `Bearer ${SR_SERVICE}` },
      body: JSON.stringify({ p_snapshot: snapshot, p_as_of: new Date().toISOString() }), signal: AbortSignal.timeout(3000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
function srDirect(inbound: string): boolean {
  return /\?\s*$/.test(inbound.trim()) || /\b(qual|quanto|como|quando|prazo|material|arquivo|formato|tamanho|funciona|aceita|consegue|pode|voc[eê]s)\b/i.test(inbound);
}
function srClose(inbound: string): boolean {
  return /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|link\s+de\s+pagamento)\b/i.test(inbound);
}
function srProductFamily(slots: any): string {
  const p = String(slots?.produto ?? '').toLowerCase();
  if (/camiset|baby|oversized|moletom|polo/.test(p)) return 'apparel';
  if (/dtf.*uv|adesiv.*uv/.test(p)) return 'dtf_uv';
  if (/dtf.*text|t[eê]xtil/.test(p)) return 'dtf_textil';
  return p;
}
function srDecision(status: string, slots: any, inbound: string): any | null {
  if (srDirect(inbound) || srClose(inbound)) return null;
  const fam = srProductFamily(slots);
  if (status === 'HOLD_MISSING_QUANTITY') {
    const msg = fam === 'apparel' ? 'Quantas peças você precisa?'
      : fam === 'dtf_textil' ? 'Quantas cópias dessa arte você precisa?'
      : fam === 'dtf_uv' ? 'Quantos adesivos você precisa?'
      : 'Qual quantidade você precisa?';
    return { responde: true, mensagem: msg, tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  }
  if (status === 'HOLD_MISSING_CEP_FOR_SHIPPING') {
    return { responde: true, mensagem: 'Me passa o CEP de entrega que eu calculo as opções de frete.', tema: 'frete', encaminhou_venda: false, etapa: 'orcamento', slots };
  }
  return null;
}
function srAnthropic(decision: any): Response {
  const text = JSON.stringify(decision);
  const payload = {
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'message', role: 'assistant', model: 'cortex-skill-router',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'x-cortex-skill-router': SR_VERSION } });
}
async function srAudit(status: string, route: string) {
  try {
    await srBaseFetch(`${SR_URL}/rest/v1/sistema_logs`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: SR_SERVICE, authorization: `Bearer ${SR_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'joao-skill-router', versao: SR_VERSION, nivel: 'info', categoria: 'skill_runtime', evento: 'deterministic_route', status: 'applied', mensagem: route, detalhe: { qualification_status: status, effect_class: 'NONE', authority_granted: false } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = srUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return srBaseFetch(input, init);
  if (!(await srEnabled())) return srBaseFetch(input, init);
  const raw = await srBody(input, init); if (!raw) return srBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return srBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return srBaseFetch(input, init);
  const inbound = srInbound(body.messages); if (!inbound) return srBaseFetch(input, init);
  const slots = srSlots(body.system, inbound);
  const q = await srQual({ slots_after: slots, invalidations: [], produto_macro: String(slots?.produto ?? ''), cep_disponivel: /^\d{8}$/.test(String(slots?.cep ?? '').replace(/\D/g, '')), latest_inbound_message: inbound, source_temporality: 'PRE_MODEL_CURRENT_TURN' });
  const status = String(q?.status ?? '');
  const decision = srDecision(status, slots, inbound);
  if (!decision) return srBaseFetch(input, init);
  void srAudit(status, decision.tema);
  return srAnthropic(decision);
};
