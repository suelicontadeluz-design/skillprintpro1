declare const Deno: any;

// João Layout Disambiguation v1 — 08/09/2026
// Skill runtime: alterações parciais de layout/pedido são tratadas como DELTA.
// Se a fala puder significar tanto "alterar uma posição" quanto "ficar somente
// com essa posição", o turno é bloqueado ANTES do modelo/ferramentas e o João
// faz uma única confirmação curta. Só depois da confirmação o orçamento volta
// a ser elegível. Sem autoridade de preço, pagamento ou efeito financeiro.

const LD_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const LD_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ldBaseFetch = globalThis.fetch.bind(globalThis);
const LD_VERSION = 'joao-layout-disambiguation/v1';
let ldCfgAt = 0;
let ldCfg = false;

function ldUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function ldBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function ldEnabled(): Promise<boolean> {
  if (Date.now() - ldCfgAt < 15000) return ldCfg;
  ldCfgAt = Date.now();
  try {
    const r = await ldBaseFetch(`${LD_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_layout_disambiguation_ativo&limit=1`, {
      headers: { apikey: LD_SERVICE, authorization: `Bearer ${LD_SERVICE}` },
      signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    ldCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { ldCfg = false; }
  return ldCfg;
}
function ldText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function ldHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function ldInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || ldHasToolResult(m?.content)) continue;
    const t = ldText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function ldLastAssistant(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const t = ldText(m?.content);
    if (t) return t;
  }
  return '';
}
function ldNorm(text: string): string {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function ldJsonAfter(text: string, marker: string, from = 0): any | null {
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
function ldSlots(system: string): any {
  const f = system.lastIndexOf('[FICHA:');
  const s0 = f >= 0 ? ldJsonAfter(system, 'slots=', f) : null;
  return s0 && typeof s0 === 'object' ? { ...s0 } : {};
}

const LD_POS = '(?:manga|manda|frente|costas|gola|nuca|lateral)';
function ldLooksLikeLayoutChange(raw: string): boolean {
  const t = ldNorm(raw);
  if (!t) return false;
  const position = new RegExp(`\\b${LD_POS}\\b`, 'i');
  if (!position.test(t)) return false;
  const partial = new RegExp(`(?:\\b(?:so|somente|apenas)\\b.{0,45}\\b${LD_POS}\\b)|(?:\\b(?:tirar|tira|remover|remove|retirar|sem|mudar|muda|alterar|altera|deixar|deixa|ficar|fica)\\b.{0,50}\\b${LD_POS}\\b)|(?:\\b${LD_POS}\\b.{0,45}\\b(?:muda|mudaria|altera|alterar|tira|tirar|remove|remover)\\b)`, 'i');
  return partial.test(t);
}
function ldExplicitReplacement(raw: string): boolean {
  const t = ldNorm(raw);
  if (!t) return false;
  if (/\b(?:so|somente|apenas)\s+(?:a\s+|uma\s+)?(?:manga|manda)\b/.test(t) && !/\b(?:tambem|frente|costas|outra|outras)\b/.test(t)) return true;
  if (/\b(?:nada|nenhuma\s+estampa)\b.{0,30}\b(?:frente|costas)\b/.test(t)) return true;
  const semFrente = /\b(?:sem|nao\s+(?:vai|tera|tem))\b.{0,25}\bfrente\b/.test(t);
  const semCostas = /\b(?:sem|nao\s+(?:vai|tera|tem))\b.{0,25}\bcostas\b/.test(t);
  return semFrente && semCostas;
}
function ldExplicitDelta(raw: string): boolean {
  const t = ldNorm(raw);
  if (!t) return false;
  if (/\b(?:mantem|manter|continua|continuar|igual|mesmo\s+layout|como\s+(?:estava|antes)|resto\s+igual|outras?\s+estampas?)\b/.test(t) && /\b(?:frente|costas|manga|manda|resto|outras?)\b/.test(t)) return true;
  if (/\b(?:frente.{0,30}costas|costas.{0,30}frente)\b/.test(t) && /\b(?:tambem|continua|mantem|igual|mesmo)\b/.test(t)) return true;
  if (/\btambem\b.{0,35}\b(?:frente|costas)\b/.test(t)) return true;
  return false;
}
function ldPendingQuestion(raw: string): boolean {
  const t = ldNorm(raw);
  return /antes de calcular/.test(t) && /somente/.test(t) && /frente/.test(t) && /costas/.test(t);
}
function ldResolvedAnswer(raw: string): boolean {
  return ldExplicitDelta(raw) || ldExplicitReplacement(raw);
}
function ldQuestion(retry = false): string {
  return retry
    ? 'Só pra eu não errar o orçamento: além da manga, vai ter estampa na frente e/ou nas costas?'
    : 'Perfeito. Só pra confirmar antes de calcular: vai estampar somente essa manga, ou também vai ter estampa na frente e/ou nas costas?';
}
function ldAnthropic(message: string, slots: any): Response {
  const decision = { responde: true, mensagem: message, tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  const text = JSON.stringify(decision);
  const payload = {
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'message', role: 'assistant', model: 'cortex-layout-disambiguation',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-cortex-layout-disambiguation': LD_VERSION },
  });
}
async function ldAudit(evento: string, detalhe: any) {
  try {
    await ldBaseFetch(`${LD_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: LD_SERVICE, authorization: `Bearer ${LD_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'order-change-disambiguation', versao: LD_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied',
        mensagem: evento, detalhe: { ...detalhe, skill_ref: 'discovery', strategy_key: 'partial_order_change_disambiguation_v1', effect_class: 'NONE', authority_granted: false },
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

const LD_RULE = `\n\n[SKILL: DISCOVERY / partial_order_change_disambiguation_v1 — REGRA OBRIGATORIA]\nEm camiseta/polo/moletom, alteracao parcial de layout e DELTA sobre a configuracao vigente, nao um pedido novo. Preserve todas as posicoes/estampas conhecidas que o cliente nao removeu explicitamente. Se a fala puder significar tanto alterar uma posicao quanto substituir o layout inteiro, NAO chame orcar_camisetas e NAO informe preco: faca uma unica pergunta curta confirmando se as outras posicoes permanecem. So trate como substituicao total quando o cliente disser inequivocamente que ficara somente com aquela(s) posicao(oes) ou remover explicitamente as demais. Depois de confirmado, ao chamar orcar_camisetas envie o conjunto COMPLETO de estampas confirmado; nunca apenas a ultima posicao mencionada.\n[/SKILL]\n`;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = ldUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return ldBaseFetch(input, init);
  if (!(await ldEnabled())) return ldBaseFetch(input, init);

  const raw = await ldBody(input, init);
  if (!raw) return ldBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return ldBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return ldBaseFetch(input, init);

  const inbound = ldInbound(body.messages);
  if (!inbound) return ldBaseFetch(input, init);
  const lastAssistant = ldLastAssistant(body.messages);
  const pending = ldPendingQuestion(lastAssistant);
  const looksChange = ldLooksLikeLayoutChange(inbound);
  const resolved = ldResolvedAnswer(inbound);

  if ((pending && !resolved) || (looksChange && !resolved)) {
    void ldAudit('layout_ambiguity_blocked', { inbound: inbound.slice(0, 240), pending_confirmation: pending });
    return ldAnthropic(ldQuestion(pending), ldSlots(body.system));
  }

  if (looksChange || (pending && resolved)) {
    body.system += LD_RULE;
    const nextInit: RequestInit = { ...(init ?? {}), body: JSON.stringify(body) };
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    headers.delete('content-length');
    nextInit.headers = headers;
    void ldAudit('partial_layout_rule_injected', { inbound: inbound.slice(0, 240), resolved_confirmation: pending && resolved });
    return ldBaseFetch(input, nextInit);
  }

  return ldBaseFetch(input, init);
};
