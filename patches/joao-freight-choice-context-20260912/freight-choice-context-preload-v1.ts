declare const Deno: any;

// João Freight Choice Context v1 — 12/09/2026
// Fecha o caso real em que o cliente escolhe uma opção de frete pelo PREÇO/ORDEM
// (ex.: "Poderia ser 20,76") em vez de repetir o nome da transportadora.
//
// Princípios:
// 1) estreito: só entra quando o turno anterior do João apresentou 2+ opções de frete;
// 2) contextual: resolve preço exato, "mais barato" e ordinal (primeira/segunda/terceira);
// 3) fail-closed: valida o conjunto apresentado contra joao_freight_quote_snapshots sale-backed;
// 4) financeiro: emite/reusa autorização de frete e, se houver produto ativo compatível,
//    compõe o total pelo contrato canônico fn_compor_total;
// 5) idempotente: a RPC reutiliza total já materializado para a mesma quote/escolha;
// 6) anti-silêncio: quando o total foi materializado, a resposta é determinística e não depende
//    de o LLM reinterpretar a referência do cliente;
// 7) não altera o caminho que já funciona quando o cliente escreve PAC/Sedex/J&T explicitamente.

const FCC_VERSION = 'joao-freight-choice-context/v1';
const FCC_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const FCC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const fccBaseFetch = globalThis.fetch.bind(globalThis);
let fccCfgAt = 0;
let fccCfg = false;

type FccOption = { servico: string; preco: number; index: number };
type FccChoice = { option: FccOption; method: 'amount' | 'cheapest' | 'ordinal' };

function fccUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function fccBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function fccText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function fccHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function fccNorm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function fccServiceCanon(s: string): string | null {
  const t = fccNorm(s);
  if (/(^|\W)pac(\W|$)/i.test(t)) return 'PAC';
  if (/(^|\W)sedex(\W|$)/i.test(t)) return 'Sedex';
  if (/j\s*&\s*t|j\s+e\s+t|(^|\W)jt(\W|$)/i.test(t)) return 'J&T Standard';
  return null;
}
function fccMoney(n: number): string {
  return Number(n).toFixed(2).replace('.', ',');
}
function fccParseOptions(text: string): FccOption[] {
  const out: FccOption[] = [];
  const seen = new Set<string>();
  for (const line of String(text || '').split(/\r?\n/)) {
    const service = fccServiceCanon(line);
    if (!service) continue;
    const m = line.match(/R\$\s*([0-9]{1,4}(?:[.,][0-9]{2}))/i);
    if (!m) continue;
    const preco = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(preco) || preco <= 0) continue;
    const key = `${service}|${preco.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ servico: service, preco, index: out.length });
  }
  return out;
}
function fccExplicitService(text: string): string | null {
  const t = String(text || '');
  const hits = new Set<string>();
  if (/(^|\W)pac(\W|$)/i.test(t)) hits.add('PAC');
  if (/(^|\W)sedex(\W|$)/i.test(t)) hits.add('Sedex');
  if (/j\s*&\s*t|j\s+e\s+t|(^|\W)jt(\W|$)/i.test(t)) hits.add('J&T Standard');
  return hits.size === 1 ? [...hits][0] : null;
}
function fccResolveChoice(text: string, options: FccOption[]): FccChoice | null {
  if (options.length < 2) return null;
  // O caminho nominal já é coberto pelo core. Este patch só trata referência contextual.
  if (fccExplicitService(text)) return null;

  const amounts = [...String(text || '').matchAll(/([0-9]{1,4}[.,][0-9]{2})/g)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
  const amountHits = options.filter((o) => amounts.some((n) => Math.abs(n - o.preco) <= 0.01));
  if (amountHits.length === 1) return { option: amountHits[0], method: 'amount' };
  if (amountHits.length > 1) return null;

  const t = fccNorm(text);
  if (/\b(mais barato|mais em conta|menor valor|menor preco)\b/.test(t)) {
    const min = Math.min(...options.map((o) => o.preco));
    const hits = options.filter((o) => Math.abs(o.preco - min) <= 0.01);
    return hits.length === 1 ? { option: hits[0], method: 'cheapest' } : null;
  }

  let ordinal: number | null = null;
  if (/\b(primeir[oa]|1\s*[aoªº]?)\b/.test(t)) ordinal = 0;
  else if (/\b(segund[oa]|2\s*[aoªº]?)\b/.test(t)) ordinal = 1;
  else if (/\b(terceir[oa]|3\s*[aoªº]?)\b/.test(t)) ordinal = 2;
  if (ordinal !== null && options[ordinal]) return { option: options[ordinal], method: 'ordinal' };
  return null;
}
function fccDialogue(messages: any[]): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || fccHasToolResult(m.content)) continue;
    const text = fccText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({ role: m.role, text });
  }
  return out;
}
function fccContext(messages: any[]): { inbound: string; assistant: string; cep: string; options: FccOption[]; choice: FccChoice } | null {
  const d = fccDialogue(messages);
  let userIdx = -1;
  for (let i = d.length - 1; i >= 0; i--) if (d[i].role === 'user') { userIdx = i; break; }
  if (userIdx < 1) return null;
  const inbound = d[userIdx].text;
  let assistant = '';
  for (let i = userIdx - 1; i >= 0; i--) if (d[i].role === 'assistant') { assistant = d[i].text; break; }
  if (!assistant) return null;
  const options = fccParseOptions(assistant);
  if (options.length < 2 || !/qual\s+(?:voc[eê]\s+)?prefere|qual\s+op[cç][aã]o|qual\s+deles|qual\s+frete/i.test(assistant)) return null;

  let cep = '';
  for (let i = userIdx - 1; i >= 0; i--) {
    if (d[i].role !== 'user') continue;
    const m = d[i].text.match(/\b(\d{5})-?(\d{3})\b/);
    if (m) { cep = m[1] + m[2]; break; }
  }
  if (!cep) return null;
  const choice = fccResolveChoice(inbound, options);
  if (!choice) return null;
  return { inbound, assistant, cep, options, choice };
}
async function fccEnabled(): Promise<boolean> {
  if (Date.now() - fccCfgAt < 15000) return fccCfg;
  fccCfgAt = Date.now();
  try {
    const r = await fccBaseFetch(`${FCC_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_freight_choice_context_v1_ativo&limit=1`, {
      headers: { apikey: FCC_SERVICE, authorization: `Bearer ${FCC_SERVICE}` }, signal: AbortSignal.timeout(1600),
    });
    if (!r.ok) return fccCfg;
    const rows = await r.json();
    fccCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch {}
  return fccCfg;
}
async function fccAuthorize(ctx: ReturnType<typeof fccContext>): Promise<any | null> {
  if (!ctx) return null;
  try {
    const r = await fccBaseFetch(`${FCC_URL}/rest/v1/rpc/fn_joao_authorize_freight_choice_v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: FCC_SERVICE, authorization: `Bearer ${FCC_SERVICE}` },
      body: JSON.stringify({
        p_cep: ctx.cep,
        p_service: ctx.choice.option.servico,
        p_amount: ctx.choice.option.preco,
        p_presented_options: ctx.options.map((o) => ({ servico: o.servico, preco: o.preco })),
        p_resolution_method: ctx.choice.method,
        p_customer_text: ctx.inbound.slice(0, 240),
      }),
      signal: AbortSignal.timeout(2200),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function fccAudit(evento: string, detail: any) {
  try {
    await fccBaseFetch(`${FCC_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: FCC_SERVICE, authorization: `Bearer ${FCC_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'joao-freight-choice-context', versao: FCC_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied',
        mensagem: String(detail?.status || detail?.method || evento), detalhe: detail,
      }), signal: AbortSignal.timeout(1200),
    });
  } catch {}
}
function fccSyntheticAnthropic(body: any, ctx: NonNullable<ReturnType<typeof fccContext>>, resolved: any): Response {
  const total = Number(resolved?.total_amount);
  const frete = Number(resolved?.amount ?? ctx.choice.option.preco);
  const service = String(resolved?.service ?? ctx.choice.option.servico);
  const totalTxt = Number.isFinite(total) && total > 0 ? ` Com o frete, o total fica *R$ ${fccMoney(total)}*.` : '';
  const mensagem = `Fechado! Vamos de ${service} por R$ ${fccMoney(frete)}.${totalTxt} Você prefere Pix ou cartão?`;
  const decision = {
    responde: true,
    mensagem,
    tema: 'fechamento',
    encaminhou_venda: false,
    etapa: 'pagamento',
    slots: {
      modalidade_logistica: 'envio',
      envio_retirada: 'envio',
      cep: ctx.cep,
      frete_servico_escolhido: service,
      frete_valor_escolhido: frete,
      frete_quote_id: resolved?.quote_id ?? null,
      frete_escolha_metodo: ctx.choice.method,
      freight_operation_id: resolved?.freight_operation_id ?? null,
      pedido_total_operation_id: resolved?.total_operation_id ?? null,
    },
  };
  const text = JSON.stringify(decision);
  const payload = {
    id: `msg_fcc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    type: 'message', role: 'assistant', model: body?.model || 'claude',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.ceil(text.length / 4) },
  };
  const headers = new Headers({ 'content-type': 'application/json', 'x-cortex-freight-choice-context': FCC_VERSION });
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = fccUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return fccBaseFetch(input, init);
  if (!(await fccEnabled())) return fccBaseFetch(input, init);

  const raw = await fccBody(input, init);
  if (!raw) return fccBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return fccBaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return fccBaseFetch(input, init);

  const ctx = fccContext(body.messages);
  if (!ctx) return fccBaseFetch(input, init);

  const resolved = await fccAuthorize(ctx);
  const status = String(resolved?.status || 'NO_RESULT');
  void fccAudit('freight_choice_context_resolution', {
    status, method: ctx.choice.method, cep_suffix: ctx.cep.slice(-3),
    service: ctx.choice.option.servico, amount: ctx.choice.option.preco,
    quote_id: resolved?.quote_id ?? null, total_operation_id: resolved?.total_operation_id ?? null,
  });

  if (status === 'RESOLVED_TOTAL' || status === 'RESOLVED_TOTAL_REUSED') {
    return fccSyntheticAnthropic(body, ctx, resolved);
  }

  if (status === 'RESOLVED_FREIGHT_ONLY') {
    body.system = String(body.system || '') + `\n\n[CORTEX FREIGHT CHOICE CONTEXT v1]\nO cliente acabou de escolher inequivocamente ${resolved.service} por R$ ${fccMoney(Number(resolved.amount))}, referindo-se à lista de fretes do turno anterior pelo método ${ctx.choice.method}. A escolha foi validada contra a cotação canônica sale-backed quote_id=${resolved.quote_id} e já existe autorização financeira de frete operation_id=${resolved.freight_operation_id}. NÃO peça para ele repetir PAC/Sedex/J&T. NÃO escolha outra opção e NÃO chame calcular_frete de novo. Recalcule/recupere somente a autorização do PRODUTO pelo mecanismo canônico e componha o total com esta autorização de frete; entregue o resultado no mesmo turno.\n[/CORTEX FREIGHT CHOICE CONTEXT]`;
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    headers.delete('content-length');
    return fccBaseFetch(input, { ...(init ?? {}), headers, body: JSON.stringify(body) });
  }

  // Qualquer ambiguidade, ausência de snapshot ou conflito: caminho antigo intacto.
  return fccBaseFetch(input, init);
};
