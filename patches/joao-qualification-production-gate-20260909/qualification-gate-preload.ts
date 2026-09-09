declare const Deno: any;

// João Qualification Production Gate v1 — 09/09/2026
// Converte qualification/v2 de advisor/shadow em gate cognitivo obrigatório antes
// de orçamento/frete/fechamento. A skill NÃO ganha autoridade de preço, frete,
// cobrança ou qualquer efeito externo; ela apenas impede avanço comercial quando
// a própria qualification/v2 informa HOLD.
// Kill switch: public.sistema_config.chave = 'joao_qualification_gate_ativo'.

const QG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const QG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const qgBaseFetch = globalThis.fetch.bind(globalThis);
const QG_VERSION = 'joao-qualification-gate/v1';
let qgCfgAt = 0;
let qgCfg = false;

function qgUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function qgBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function qgEnabled(): Promise<boolean> {
  if (Date.now() - qgCfgAt < 15000) return qgCfg;
  qgCfgAt = Date.now();
  try {
    const r = await qgBaseFetch(`${QG_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_qualification_gate_ativo&limit=1`, {
      headers: { apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}` },
      signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    qgCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { qgCfg = false; }
  return qgCfg;
}
function qgText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function qgHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function qgInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || qgHasToolResult(m?.content)) continue;
    const t = qgText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function qgJsonAfter(text: string, marker: string, from = 0): any | null {
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
function qgQuestion(system: string): string {
  const tag = '[VOCÊ ACABOU DE PERGUNTAR:'; const i = system.lastIndexOf(tag); if (i < 0) return '';
  const e = system.indexOf('O CLIENTE RESPONDEU:', i); if (e < 0) return '';
  return system.slice(i + tag.length, e).replace(/^\s*["“]|["”]\s*$/g, '').trim();
}
function qgShortInt(text: string): number | null {
  const c = text.trim();
  if (!c || c.length > 80 || /\d\s*[x×]\s*\d/i.test(c) || /\d+[,.]\d+/.test(c) || /\b\d{8}\b/.test(c)) return null;
  const m = c.match(/(?:^|\D)(\d{1,5})(?:\D|$)/); if (!m) return null;
  const n = Number(m[1]); return Number.isInteger(n) && n > 0 ? n : null;
}
function qgExplicitQuantity(text: string): number | null {
  const m = String(text || '').match(/\b(\d{1,5})\s*(?:c[oó]pias?|unidades?|pe[cç]as?|adesivos?|camisetas?)\b/i);
  if (!m) return null;
  const n = Number(m[1]); return Number.isInteger(n) && n > 0 ? n : null;
}
function qgSlots(system: string, inbound: string): any {
  const f = system.lastIndexOf('[FICHA:');
  const s0 = f >= 0 ? qgJsonAfter(system, 'slots=', f) : null;
  const s = s0 && typeof s0 === 'object' ? { ...s0 } : {};
  const q = qgQuestion(system).toLowerCase();
  if (!(Number(s.quantidade) > 0)) {
    const explicit = qgExplicitQuantity(inbound);
    if (explicit) s.quantidade = explicit;
    else if (/quant|c[oó]pia|unidade|pe[cç]a|quantas|quantos/.test(q)) {
      const n = qgShortInt(inbound); if (n) s.quantidade = n;
    }
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
async function qgEval(snapshot: any): Promise<any | null> {
  try {
    const r = await qgBaseFetch(`${QG_URL}/rest/v1/rpc/fn_qualification_evaluate_v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}` },
      body: JSON.stringify({ p_snapshot: snapshot, p_as_of: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
function qgCommercialIntent(text: string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|cot(?:ar|e)|pre[cç]o|valor|quanto(?:\s+(?:fica|custa))?|total|frete|cep|envio|entrega|retirada|prazo|pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|pedido|comprar|quero\s+fechar)\b/i.test(text);
}
function qgProductFamily(slots: any): string {
  const p = String(slots?.produto ?? '').toLowerCase();
  if (/camiset|baby|oversized|moletom|polo/.test(p)) return 'apparel';
  if (/dtf.*uv|adesiv.*uv/.test(p)) return 'dtf_uv';
  if (/dtf.*text|t[eê]xtil/.test(p)) return 'dtf_textil';
  return p;
}
function qgDecision(status: string, slots: any): any | null {
  const fam = qgProductFamily(slots);
  if (status === 'HOLD_PRODUCT_CONFLICT' || status === 'HOLD_TOPIC_SHIFT_REQUALIFY') {
    return { responde: true, mensagem: 'Só pra eu não misturar com o pedido anterior: qual produto você quer orçar agora?', tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  }
  if (status === 'HOLD_MISSING_PRODUCT') {
    return { responde: true, mensagem: 'Qual produto você quer orçar?', tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  }
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
function qgAnthropic(decision: any): Response {
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'message', role: 'assistant', model: 'cortex-qualification-gate',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-cortex-qualification-gate': QG_VERSION } });
}
async function qgAudit(status: string, inbound: string) {
  try {
    await qgBaseFetch(`${QG_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'qualification-production-gate', versao: QG_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento: 'qualification_hold_enforced', status: 'applied',
        mensagem: status,
        detalhe: {
          skill_ref: 'qualification', qualification_status: status,
          authority_granted: true, authority_scope: 'cognitive_pre_quote_gate', external_authority: false,
          effect_class: 'MODEL_BYPASS', inbound: inbound.slice(0, 240),
        },
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

const QG_RULE = `\n\n[SKILL qualification/v2 — PRODUCTION GATE]\nQualification é obrigatória antes de orçamento, frete ou fechamento. Se o status atual for HOLD_*, NÃO orce, NÃO gere cobrança, NÃO avance para pagamento e NÃO reutilize dados conflitantes/antigos. Pergunte somente o dado material faltante. A skill não autoriza preço, frete ou cobrança; esses continuam dependentes das ferramentas canônicas.\n[/SKILL]\n`;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = qgUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return qgBaseFetch(input, init);
  if (!(await qgEnabled())) return qgBaseFetch(input, init);
  const raw = await qgBody(input, init); if (!raw) return qgBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return qgBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return qgBaseFetch(input, init);
  const inbound = qgInbound(body.messages); if (!inbound) return qgBaseFetch(input, init);
  const slots = qgSlots(body.system, inbound);
  const q = await qgEval({
    source: `${QG_VERSION}:premodel`, slots_after: slots, invalidations: [],
    produto_macro: String(slots?.produto ?? ''),
    cep_disponivel: /^\d{8}$/.test(String(slots?.cep ?? '').replace(/\D/g, '')),
    latest_inbound_message: inbound, source_temporality: 'PRE_MODEL_CURRENT_TURN',
  });
  const status = String(q?.status ?? '');
  const decision = qgDecision(status, slots);
  if (decision && qgCommercialIntent(inbound)) {
    void qgAudit(status, inbound);
    return qgAnthropic(decision);
  }
  if (status.startsWith('HOLD_')) {
    body.system += `${QG_RULE}\nStatus atual: ${status}.`;
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    headers.delete('content-length');
    return qgBaseFetch(input, { ...(init ?? {}), headers, body: JSON.stringify(body) });
  }
  return qgBaseFetch(input, init);
};
