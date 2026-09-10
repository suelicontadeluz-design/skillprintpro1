declare const Deno: any;

// João Freight Comparison v1 — 09/09/2026
// Corrige regressão real: cliente pede comparar frete para 2+ CEPs, mas o runtime
// pergunta "envio ou retirada" e o guard bloqueia calcular_frete por modalidade indefinida.
// Regra: comparação explícita de fretes implica ENVIO apenas para fins de COTAÇÃO;
// o destino final continua pendente até o cliente escolher uma opção.

const FC_VERSION = 'joao-freight-comparison/v1';
const fcBaseFetch = globalThis.fetch.bind(globalThis);

function fcUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function fcBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}

function fcText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((x: any) => x?.type === 'text')
    .map((x: any) => String(x?.text ?? ''))
    .join('\n')
    .trim();
}

function fcHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}

function fcUserTurns(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages || []) {
    if (m?.role !== 'user' || fcHasToolResult(m?.content)) continue;
    const text = fcText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

function fcAssistantTurns(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages || []) {
    if (m?.role !== 'assistant') continue;
    const text = fcText(m.content);
    if (text) out.push(text);
  }
  return out;
}

function fcCeps(text: string): string[] {
  const set = new Set<string>();
  for (const m of String(text || '').matchAll(/\b(\d{5})-?(\d{3})\b/g)) set.add(m[1] + m[2]);
  return [...set];
}

function fcComparisonIntent(text: string): boolean {
  const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(comparar|comparacao|mais barato|mais em conta|qual fica mais barato|preco dos fretes|valor dos fretes|frete para os dois|frete pros dois|dois ceps|2 ceps|dois locais|2 locais|um seria|outro seria)\b/.test(t)
    || /\b(registro|sao paulo)\b[\s\S]{0,120}\b(ou|e)\b[\s\S]{0,120}\b(registro|sao paulo)\b/.test(t);
}

function fcQuantity(userTurns: string[], assistantTurns: string[]): number | null {
  const recentUsers = userTurns.slice(-10);
  for (let i = recentUsers.length - 1; i >= 0; i--) {
    const t = recentUsers[i];
    let m = t.match(/\b(\d{1,4})\s+(?:pecas?|polos?|camisas?|camisetas?|no\s+total)\b/i);
    if (m) return Number(m[1]);
    m = t.match(/\b(?:total|quantidade)\D{0,20}(\d{1,4})\b/i);
    if (m) return Number(m[1]);
  }
  const lastUser = recentUsers.at(-1)?.trim() || '';
  const lastAssistant = assistantTurns.at(-1) || '';
  if (/^\d{1,4}$/.test(lastUser) && /quantas?\s+pecas?|quantidade/i.test(lastAssistant)) return Number(lastUser);
  return null;
}

function fcJsonResponse(original: Response, text: string): Response {
  const headers = new Headers(original.headers);
  headers.set('content-length', String(new TextEncoder().encode(text).length));
  headers.set('x-cortex-freight-comparison', FC_VERSION);
  return new Response(text, { status: original.status, statusText: original.statusText, headers });
}

function fcPatchDecisionEnvelope(raw: string, ceps: string[], qty: number | null): string {
  try {
    const envelope = JSON.parse(raw);
    if (!Array.isArray(envelope?.content)) return raw;
    const block = envelope.content.find((x: any) => x?.type === 'text' && typeof x?.text === 'string');
    if (!block) return raw;
    let decision: any;
    try { decision = JSON.parse(block.text); } catch { return raw; }
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return raw;

    const slots = decision.slots && typeof decision.slots === 'object' && !Array.isArray(decision.slots)
      ? { ...decision.slots }
      : {};

    // Para a guarda de ferramenta, comparar fretes é modalidade de ENVIO.
    // Isso NÃO escolhe o destino final.
    slots.modalidade_logistica = 'envio';
    slots.envio_retirada = 'envio';
    slots.freight_comparison_pending = true;
    slots.ceps_cotacao = ceps;
    if (qty && Number.isFinite(qty) && qty > 0) slots.quantidade = qty;
    decision.slots = slots;

    block.text = JSON.stringify(decision);
    return JSON.stringify(envelope);
  } catch {
    return raw;
  }
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = fcUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return fcBaseFetch(input, init);

  const raw = await fcBody(input, init);
  if (!raw) return fcBaseFetch(input, init);

  let body: any;
  try { body = JSON.parse(raw); } catch { return fcBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return fcBaseFetch(input, init);

  const users = fcUserTurns(body.messages);
  const assistants = fcAssistantTurns(body.messages);
  const recent = users.slice(-10).join('\n');
  const ceps = fcCeps(recent);
  const comparison = ceps.length >= 2 && fcComparisonIntent(recent);

  if (!comparison) return fcBaseFetch(input, init);

  const qty = fcQuantity(users, assistants);
  const qtyText = qty ? ` Quantidade já confirmada: ${qty} peças.` : '';
  body.system += `\n\n[CORTEX FREIGHT COMPARISON v1]\nO cliente pediu explicitamente COMPARAÇÃO DE FRETE entre ${ceps.length} CEPs: ${ceps.join(', ')}.${qtyText}\nPara fins de COTAÇÃO, modalidade_logistica=envio e envio_retirada=envio. Isso NÃO significa que o destino final já foi escolhido. NÃO pergunte novamente "envio ou retirada" e NÃO peça novamente quantidade já informada. Calcule o frete para CADA CEP informado, uma chamada de calcular_frete por CEP, apresente as opções separadas por CEP e só depois peça ao cliente para escolher o destino/opção. Preserve os CEPs de comparação até a escolha final.\n[/CORTEX FREIGHT COMPARISON]`;

  const nextInit: RequestInit = { ...(init || {}), body: JSON.stringify(body) };
  const response = await fcBaseFetch(input, nextInit);
  if (!response.ok) return response;

  let responseText = '';
  try { responseText = await response.text(); } catch { return response; }
  const patched = fcPatchDecisionEnvelope(responseText, ceps, qty);
  return fcJsonResponse(response, patched);
};
