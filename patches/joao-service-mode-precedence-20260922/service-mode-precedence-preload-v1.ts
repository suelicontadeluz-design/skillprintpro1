declare const Deno: any;

import {
  SERVICE_MODE,
  smAllowedTools,
  smPatchDecision,
  smResolve,
} from './service-mode-precedence-core.mjs';

// P0 2026-09-22 — service-mode precedence for apparel vs DTF textile transfer.
// Organic anchor: 5511993546694.
// No price is invented here. No DB/schema mutation. No transport side effect.

const SMP_VERSION = 'joao-service-mode-precedence/v1';
const smpBaseFetch = globalThis.fetch.bind(globalThis);

function smpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function smpRaw(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

function smpText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((x: any) => x?.type === 'text' && typeof x?.text === 'string')
    .map((x: any) => String(x.text))
    .join('\n')
    .trim();
}

function smpHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}

function smpConversation(messages: any[]): Array<{ role: 'user' | 'assistant'; text: string }> {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue;
    if (m.role === 'user' && smpHasToolResult(m.content)) continue;
    const text = smpText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({ role: m.role, text });
  }
  return out;
}

function smpSystemBlock(resolution: any): string {
  if (!resolution?.mode || !resolution?.canonicalProduct) return '';
  const evidence = String(resolution.evidence ?? '').replace(/\s+/g, ' ').slice(0, 180);
  if (resolution.mode === SERVICE_MODE.FINISHED) {
    return `\n\n[CANONICAL SERVICE MODE — P0]
mode=FINISHED_PERSONALIZED
produto_macro=camiseta
evidencia_cliente=${JSON.stringify(evidence)}
DTF textil citado depois desta escolha e tecnica de estampagem, NAO troca o pedido para DTF avulso por si so. Somente nova manifestacao explicita do cliente por transfer-only pode mudar o modo. Preco de camiseta vem do fluxo/orcamento de camiseta; nao use tabela/rendimento de DTF avulso.
[/CANONICAL SERVICE MODE — P0]`;
  }
  return `\n\n[CANONICAL SERVICE MODE — P0]
mode=TRANSFER_ONLY
produto_macro=dtf_textil
evidencia_cliente=${JSON.stringify(evidence)}
O cliente explicitamente escolheu somente a impressao/transfer. Nao transforme em camiseta pronta sem nova manifestacao explicita.
[/CANONICAL SERVICE MODE — P0]`;
}

function smpRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return [new Request(input, { ...init, headers, body }), undefined];
  }
  return [input, { ...(init || {}), headers, body }];
}

function smpPatchPayload(payload: any, resolution: any): { changed: boolean; payload: any; contradiction: boolean } {
  if (!Array.isArray(payload?.content)) return { changed: false, payload, contradiction: false };
  let changed = false;
  let contradiction = false;
  const content = payload.content.map((block: any) => {
    if (block?.type !== 'text' || typeof block?.text !== 'string') return block;
    let decision: any;
    try { decision = JSON.parse(block.text); } catch { return block; }
    const patched = smPatchDecision(decision, resolution);
    contradiction = contradiction || patched.contradiction;
    if (!patched.changed) return block;
    changed = true;
    return { ...block, text: JSON.stringify(patched.decision) };
  });
  return { changed, contradiction, payload: changed ? { ...payload, content } : payload };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = smpUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return smpBaseFetch(input, init);

  const raw = await smpRaw(input, init);
  if (!raw) return smpBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return smpBaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return smpBaseFetch(input, init);

  const resolution = smResolve(smpConversation(body.messages));
  if (!resolution?.mode || !resolution?.canonicalProduct) return smpBaseFetch(input, init);

  const oldTools = Array.isArray(body.tools) ? body.tools : [];
  body.tools = smAllowedTools(oldTools, resolution);
  if (typeof body.system === 'string') body.system += smpSystemBlock(resolution);

  console.log(JSON.stringify({
    event: 'JOAO_SERVICE_MODE_PRECEDENCE_APPLIED',
    version: SMP_VERSION,
    mode: resolution.mode,
    canonical_product: resolution.canonicalProduct,
    weak_technique: resolution.weakTechnique,
    tools_before: oldTools.map((t: any) => t?.name).filter(Boolean),
    tools_after: body.tools.map((t: any) => t?.name).filter(Boolean),
    evidence: String(resolution.evidence ?? '').slice(0, 180),
  }));

  const [nextInput, nextInit] = smpRebuild(input, init, JSON.stringify(body));
  const response = await smpBaseFetch(nextInput, nextInit);
  if (!response.ok) return response;

  let payload: any;
  try { payload = await response.clone().json(); } catch { return response; }
  const patched = smpPatchPayload(payload, resolution);
  if (!patched.changed) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-cortex-service-mode-precedence', SMP_VERSION);
  console.warn(JSON.stringify({
    event: 'JOAO_SERVICE_MODE_CONTRADICTION_CORRECTED',
    version: SMP_VERSION,
    mode: resolution.mode,
    canonical_product: resolution.canonicalProduct,
    contradiction: patched.contradiction,
  }));
  return new Response(JSON.stringify(patched.payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
