declare const Deno: any;

// João Current Turn Priority Guard v1 — 10/09/2026
// Narrow production patch based on two real failures:
// 1) "correio/correios" with no CEP was not treated as current-turn logistics;
// 2) an explicit supplier question was swallowed by stale logistics/closing context.
// This guard only patches the model decision envelope. It never sends messages itself.

const CTP_VERSION = 'joao-current-turn-priority/v1';
const CTP_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CTP_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ctpBaseFetch = globalThis.fetch.bind(globalThis);
let ctpCfgAt = 0;
let ctpCfg = false;

function ctpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function ctpBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}

function ctpText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((x: any) => x?.type === 'text')
    .map((x: any) => String(x?.text ?? ''))
    .join('\n')
    .trim();
}

function ctpHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}

function ctpLatestUser(messages: any[]): string {
  for (let i = (messages ?? []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || ctpHasToolResult(m?.content)) continue;
    const text = ctpText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    return text;
  }
  return '';
}

function ctpNorm(v: string): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function ctpHasCep(text: string): boolean {
  return /\b\d{5}[- .]?\d{3}\b/.test(text);
}

function ctpCorreiosNeedsCep(text: string): boolean {
  const t = ctpNorm(text);
  return /\b(correio|correios)\b/.test(t) && !ctpHasCep(t);
}

function ctpSupplierQuestion(text: string): boolean {
  const t = ctpNorm(text);
  const supplier = /\bforneced(?:or|ores|ora|oras)\b/.test(t);
  const question = /\?|\b(quantos?|qual|quais|ainda|so|somente|possui|possuem|tem|temos|voces)\b/.test(t);
  return supplier && question;
}

function ctpResponseText(original: Response, text: string): Response {
  const headers = new Headers(original.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  headers.set('x-cortex-current-turn-priority', CTP_VERSION);
  return new Response(text, { status: original.status, statusText: original.statusText, headers });
}

function ctpPatchDecisionEnvelope(raw: string, mode: 'CORREIOS_CEP' | 'SUPPLIER_CURRENT_TURN'): { raw: string; patched: boolean; reason: string } {
  try {
    const envelope = JSON.parse(raw);
    if (!Array.isArray(envelope?.content)) return { raw, patched: false, reason: 'NO_CONTENT' };
    const block = envelope.content.find((x: any) => x?.type === 'text' && typeof x?.text === 'string');
    if (!block) return { raw, patched: false, reason: 'NO_TEXT_BLOCK' };

    let decision: any;
    try { decision = JSON.parse(block.text); } catch { return { raw, patched: false, reason: 'DECISION_NOT_JSON' }; }
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return { raw, patched: false, reason: 'DECISION_NOT_OBJECT' };

    const existingMessage = String(decision.mensagem ?? '').trim();
    const existingNorm = ctpNorm(existingMessage);
    const responds = decision.responde === true || decision.responder === true;

    if (mode === 'CORREIOS_CEP') {
      if (responds && /\bcep\b/.test(existingNorm)) return { raw, patched: false, reason: 'ALREADY_ASKS_CEP' };
      decision.responde = true;
      decision.mensagem = 'Dá para seguir com uma folha para teste. Me passa o CEP de entrega que eu calculo as opções de frete para você. Se quiser, pode mandar a arte também para eu conferir.';
      decision.tema = 'frete';
      decision.encaminhou_venda = false;
      decision.slots = {
        ...(decision.slots && typeof decision.slots === 'object' && !Array.isArray(decision.slots) ? decision.slots : {}),
        modalidade_logistica: 'envio',
        envio_retirada: 'envio',
      };
      block.text = JSON.stringify(decision);
      return { raw: JSON.stringify(envelope), patched: true, reason: 'FORCED_CEP_QUESTION' };
    }

    const irrelevant = !responds
      || !existingMessage
      || /\b(cep|frete|envio|retirada|sedex|pac)\b/.test(existingNorm)
      || /\b(sem pressa|avisa quando decidir|avise quando decidir|quando decidir)\b/.test(existingNorm);

    if (!irrelevant) return { raw, patched: false, reason: 'MODEL_ANSWER_RELEVANT' };

    decision.responde = true;
    decision.mensagem = 'Você está falando dos fornecedores das camisetas de algodão? Me confirma isso que eu te respondo sem te passar informação errada.';
    decision.tema = 'produto';
    decision.encaminhou_venda = false;
    block.text = JSON.stringify(decision);
    return { raw: JSON.stringify(envelope), patched: true, reason: 'SUPPLIER_CURRENT_TURN_RECOVERED' };
  } catch {
    return { raw, patched: false, reason: 'ENVELOPE_PARSE_ERROR' };
  }
}

async function ctpEnabled(): Promise<boolean> {
  if (Date.now() - ctpCfgAt < 15000) return ctpCfg;
  ctpCfgAt = Date.now();
  try {
    const r = await ctpBaseFetch(`${CTP_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_current_turn_priority_guard_v1&limit=1`, {
      headers: { apikey: CTP_SERVICE, authorization: `Bearer ${CTP_SERVICE}` },
      signal: AbortSignal.timeout(1800),
    });
    if (!r.ok) return ctpCfg;
    const rows = await r.json();
    ctpCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch {}
  return ctpCfg;
}

async function ctpAudit(evento: string, detalhe: any) {
  try {
    await ctpBaseFetch(`${CTP_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: CTP_SERVICE,
        authorization: `Bearer ${CTP_SERVICE}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        agente_slug: 'agente-noturno',
        funcao: 'joao-current-turn-priority',
        versao: CTP_VERSION,
        nivel: 'info',
        categoria: 'guardrail_runtime',
        evento,
        status: 'applied',
        mensagem: evento,
        detalhe: { ...detalhe, effect_class: 'DECISION_ONLY', external_send: false },
      }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = ctpUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return ctpBaseFetch(input, init);
  if (!(await ctpEnabled())) return ctpBaseFetch(input, init);

  const rawBody = await ctpBody(input, init);
  if (!rawBody) return ctpBaseFetch(input, init);

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return ctpBaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return ctpBaseFetch(input, init);

  const current = ctpLatestUser(body.messages);
  if (!current) return ctpBaseFetch(input, init);

  const mode: 'CORREIOS_CEP' | 'SUPPLIER_CURRENT_TURN' | null = ctpCorreiosNeedsCep(current)
    ? 'CORREIOS_CEP'
    : ctpSupplierQuestion(current)
      ? 'SUPPLIER_CURRENT_TURN'
      : null;

  if (!mode) return ctpBaseFetch(input, init);

  if (typeof body.system === 'string') {
    body.system += mode === 'CORREIOS_CEP'
      ? '\n\n[CORTEX CURRENT TURN PRIORITY v1]\nO turno ATUAL menciona Correios e não contém CEP. Trate isso como intenção de ENVIO no turno atual. Não deixe estado antigo de fechamento/frete substituir a pergunta atual. Se ainda não houver CEP comprovado, peça o CEP agora e não invente valor de frete.\n[/CORTEX CURRENT TURN PRIORITY]'
      : '\n\n[CORTEX CURRENT TURN PRIORITY v1]\nO turno ATUAL contém uma pergunta explícita sobre fornecedor(es). Responda a pergunta atual antes de qualquer continuação de frete/fechamento antiga. Não invente quantidade ou identidade de fornecedores; se a referência do produto estiver ambígua, faça uma única pergunta curta de esclarecimento.\n[/CORTEX CURRENT TURN PRIORITY]';
  }

  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  const response = await ctpBaseFetch(input, { ...(init ?? {}), headers, body: JSON.stringify(body) });
  if (!response.ok) return response;

  let responseText = '';
  try { responseText = await response.text(); } catch { return response; }
  const patched = ctpPatchDecisionEnvelope(responseText, mode);
  if (patched.patched) void ctpAudit('current_turn_decision_recovered', { mode, reason: patched.reason, inbound: current.slice(0, 300) });
  return ctpResponseText(response, patched.raw);
};
