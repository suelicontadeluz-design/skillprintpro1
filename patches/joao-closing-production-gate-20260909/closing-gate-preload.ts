declare const Deno: any;

// João Closing Production Gate v1.1 — 09/09/2026
// Promove a skill closing certificada para autoridade cognitiva limitada.
// Escopo: impedir fechamento prematuro, promessa de cobrança inexistente e confirmação
// de PIX/link sem tool_result canônico. Não cria cobrança, não altera preço/frete e não
// concede efeito externo. Usa fn_closing_evaluate_v1 quando há evidência canônica suficiente.
// Kill switch: public.sistema_config.chave = 'joao_closing_gate_ativo'.

const CL_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CL_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const clBaseFetch = globalThis.fetch.bind(globalThis);
const CL_VERSION = 'joao-closing-gate/v1.1';
let clCfgAt = 0;
let clCfg = false;

function clUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function clBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function clEnabled(): Promise<boolean> {
  if (Date.now() - clCfgAt < 15000) return clCfg;
  clCfgAt = Date.now();
  try {
    const r = await clBaseFetch(`${CL_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_closing_gate_ativo&limit=1`, {
      headers: { apikey: CL_SERVICE, authorization: `Bearer ${CL_SERVICE}` }, signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    clCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { clCfg = false; }
  return clCfg;
}
function clText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function clHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function clInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || clHasToolResult(m?.content)) continue;
    const t = clText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function clToolResults(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) {
      if (x?.type !== 'tool_result') continue;
      if (typeof x?.content === 'string') out.push(x.content);
      else if (x?.content != null) { try { out.push(JSON.stringify(x.content)); } catch {} }
    }
  }
  return out.slice(-12);
}
function clCloseIntent(text: string): boolean {
  return /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|manda(?:r)?\s+(?:o\s+)?pix|gera(?:r)?\s+(?:o\s+)?pix|link\s+de\s+pagamento|vou\s+pagar)\b/i.test(text);
}
async function clExplicitSignal(text: string): Promise<boolean> {
  try {
    const r = await clBaseFetch(`${CL_URL}/rest/v1/rpc/fn_joao_explicit_close_signal_v2`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: CL_SERVICE, authorization: `Bearer ${CL_SERVICE}` },
      body: JSON.stringify({ p_text: text }), signal: AbortSignal.timeout(2500),
    });
    return r.ok ? (await r.json()) === true : false;
  } catch { return false; }
}
function clParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}
function clPaymentObject(value: any): any | null {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    const text = (() => { try { return JSON.stringify(value); } catch { return ''; } })();
    const marker = /pix_copia_e_cola|checkout_url|payment_id|cobranca|cobrança/i.test(text);
    if (value.ok === true && marker) return value;
  }
  for (const v of Array.isArray(value) ? value : Object.values(value)) {
    const hit = clPaymentObject(v); if (hit) return hit;
  }
  return null;
}
function clMoney(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/R\$/gi, '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function clFirstNumber(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const n = clMoney(obj[k]);
    if (n != null) return n;
  }
  return null;
}
function clFirstText(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]).trim();
  return null;
}
async function clEvaluate(snapshot: any): Promise<any | null> {
  try {
    const r = await clBaseFetch(`${CL_URL}/rest/v1/rpc/fn_closing_evaluate_v1`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: CL_SERVICE, authorization: `Bearer ${CL_SERVICE}` },
      body: JSON.stringify({ p_snapshot: snapshot, p_as_of: new Date().toISOString() }), signal: AbortSignal.timeout(3000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function clAudit(evento: string, detalhe: any) {
  try {
    await clBaseFetch(`${CL_URL}/rest/v1/sistema_logs`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: CL_SERVICE, authorization: `Bearer ${CL_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'closing-production-gate', versao: CL_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: detalhe?.closing_status ?? evento,
        detalhe: { skill_ref: 'closing', authority_granted: true, authority_scope: 'cognitive_close_gate', external_authority: false, ...detalhe },
      }), signal: AbortSignal.timeout(2000),
    });
  } catch {}
}
function clInject(body: any, text: string): string {
  return String(body.system) + `\n\n[SKILL closing/v1 — PRODUCTION GATE]\n${text}\nA skill pode bloquear avanço cognitivo, mas NÃO cria cobrança, NÃO autoriza preço/frete e NÃO altera estado externo.\n[/SKILL]`;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = clUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return clBaseFetch(input, init);
  if (!(await clEnabled())) return clBaseFetch(input, init);
  const raw = await clBody(input, init); if (!raw) return clBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return clBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return clBaseFetch(input, init);

  const inbound = clInbound(body.messages); if (!inbound) return clBaseFetch(input, init);
  const results = clToolResults(body.messages);
  const joined = results.join('\n');
  const closeIntent = clCloseIntent(inbound);
  const paymentFailure = /\"ok\"\s*:\s*false/i.test(joined) && /(pix|cobran[cç]a|pagamento|checkout|payment)/i.test(joined);
  const paymentSuccess = /\"ok\"\s*:\s*true/i.test(joined) && /(pix_copia_e_cola|checkout_url|payment_id)/i.test(joined);

  if (paymentFailure) {
    body.system = clInject(body, 'CLOSING BLOCKED: a ferramenta de cobrança falhou ou recusou a operação. É PROIBIDO afirmar que o Pix/link foi gerado ou que o pedido foi fechado. Use o erro/ação do tool_result para corrigir AGORA; nunca encerre em promessa futura.');
    void clAudit('closing_payment_failure_enforced', { closing_status: 'BLOCKED_BY_TOOL_RESULT', inbound: inbound.slice(0, 240), effect_class: 'HARD_RULE_INJECTION' });
  } else if (paymentSuccess) {
    let pobj: any | null = null;
    for (let i = results.length - 1; i >= 0 && !pobj; i--) pobj = clPaymentObject(clParseJson(results[i]));
    const explicit = await clExplicitSignal(inbound);
    const amount = clFirstNumber(pobj, ['canonical_charge_amount_brl','transaction_amount','amount_brl','valor_total','total_cobranca','amount','valor']);
    const paymentId = clFirstText(pobj, ['canonical_payment_id','payment_id','id']);
    const operationId = clFirstText(pobj, ['canonical_operation_id','operation_id']);
    const chargedShipping = clFirstText(pobj, ['charged_shipping_service','shipping_service','frete_servico','servico_frete']);
    let evalResult: any | null = null;
    if (amount != null) {
      evalResult = await clEvaluate({
        payment_tool_invoked: true,
        explicit_customer_signal: explicit,
        customer_signal_text: inbound,
        customer_signal_at: new Date().toISOString(),
        canonical_charge_amount_brl: amount,
        accepted_proposal_total_brl: null,
        customer_shipping_signal: null,
        charged_shipping_service: chargedShipping,
        canonical_payment_id: paymentId,
        canonical_operation_id: operationId,
      });
    }
    const status = String(evalResult?.status ?? 'CANONICAL_TOOL_RESULT_CONFIRMED');
    if (status === 'BLOCK_PREMATURE_CLOSE' || status === 'BLOCK_CLOSE_TERMS_MISMATCH' || status === 'HOLD_NO_CANONICAL_CHARGE') {
      body.system = clInject(body, `CLOSING BLOCKED pelo evaluator certificado: ${status}. Não confirme fechamento, não envie dado inventado e resolva apenas a condição material indicada antes de avançar.`);
      void clAudit('closing_evaluator_block_enforced', { closing_status: status, inbound: inbound.slice(0, 240), effect_class: 'HARD_RULE_INJECTION' });
    } else {
      body.system = clInject(body, 'CLOSING READY por tool_result canônico. Envie somente o PIX/link/código EXATOS retornados pela ferramenta neste turno. Não diga “vou gerar”, não invente URL/código e não repita pergunta já resolvida.');
      void clAudit('closing_canonical_success_enforced', { closing_status: status, inbound: inbound.slice(0, 240), effect_class: 'HARD_RULE_INJECTION', canonical_payment_id: paymentId });
    }
  } else if (closeIntent) {
    body.system = clInject(body, 'CLOSING INTENT explícito. Neste MESMO turno execute as ferramentas necessárias. É proibido terminar com “vou gerar/enviar o Pix” ou qualquer promessa futura. Só afirme existência de cobrança depois de tool_result canônico confirmado.');
    void clAudit('closing_intent_execution_required', { closing_status: 'INTENT_DETECTED', inbound: inbound.slice(0, 240), effect_class: 'HARD_RULE_INJECTION' });
  } else {
    return clBaseFetch(input, init);
  }

  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  return clBaseFetch(input, { ...(init ?? {}), headers, body: JSON.stringify(body) });
};
