declare const Deno: any;

// João Skill Orchestrator v1.4 — 10/09/2026
// v1.4 preserva v1.3 e corrige duas falhas reais de turno atual:
// - correio/correios passa a ser intenção logística canônica;
// - pergunta explícita sobre fornecedor recebe prioridade sobre contexto antigo e não pode virar silêncio.
// Mantém: closing estrito, continuidade de slots, CEP em contexto logístico e dedupe curto.

const JO_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const JO_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const joBaseFetch = globalThis.fetch.bind(globalThis);
const JO_VERSION = 'joao-skill-orchestrator/v1.4';
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
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(pix|cart[aã]o|credito|cr[eé]dito|debito|d[eé]bito)[.!?\s]*$/i.test(t)) return true;
  return /\b(?:quero|vou|vamos|pode|podemos|posso)\s+(?:pagar|fechar)\b/i.test(t)
    || /\b(?:manda|mandar|envia|enviar|gera|gerar)\s+(?:outro\s+|novo\s+)?(?:o\s+)?(?:pix|link(?:\s+de\s+pagamento)?)\b/i.test(t)
    || /\b(?:esse|o|meu)\s+pix\b/i.test(t)
    || /\b(?:novo|outro)\s+pix\b/i.test(t)
    || /\blink\s+de\s+pagamento\b/i.test(t)
    || /\b(?:fechado|fechamos|pode\s+fechar|vamos\s+fechar)\b/i.test(t)
    || /\b(?:vou\s+fazer|fazer|efetuar)\s+(?:o\s+)?pagamento\b/i.test(t);
}
function joWaitingIntent(text: string): boolean {
  let t = String(text || '').trim();
  if (!t || t.length > 180) return false;
  t = t.replace(/^jo[aã]o\s*[,!:;-]?\s*/i, '');
  return /^(?:j[aá]\s+te\s+(?:passo|mando|envio)|j[aá]\s+(?:passo|mando|envio)|um\s+minut(?:o|inho)|s[oó]\s+um\s+moment(?:o|inho)|pera(?:í|i)|aguarda(?:\s+um\s+pouco)?|vou\s+(?:conferir|ver|checar|olhar|separar|preparar|terminar|montar|abrir)|ainda\s+(?:estou|t[oô])\s+(?:fazendo|montando|preparando|terminando)|estou\s+(?:fazendo|montando|preparando|terminando)|deixa\s+eu\s+(?:ver|conferir|checar|olhar)|(?:s[oó]\s+)?n[aã]o\s+(?:gera|manda|envia)\b[^\n]{0,50}\bagora\b|deixa\s+pra\s+depois)\b/i.test(t);
}
function joLogisticsIntent(text: string): boolean {
  return /\b(cep|frete|correio|correios|sedex|pac|motoboy|retirada|retirar|envio|entrega|transportadora)\b/i.test(text);
}
function joSupplierQuestionIntent(text: string): boolean {
  const t = String(text || '').trim();
  if (!/\bforneced(?:or|ores|ora|oras)\b/i.test(t)) return false;
  return /\?/.test(t) || /\b(quantos?|qual|quais|ainda|s[oó]|somente|possui|possuem|tem|t[eê]m|voc[eê]s)\b/i.test(t);
}
function joCepLike(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length > 40) return false;
  return /^\D*\d{2}\D?\d{3}\D?\d{3}\D*$/.test(t);
}
function joStrongQuoteIntent(text: string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|proposta)\b/i.test(text);
}
function joQuoteIntent(text: string): boolean {
  return joStrongQuoteIntent(text) || /\b(pre[cç]o|valor|quanto\s+(?:fica|custa))\b/i.test(text);
}
function joSlotAnswerIntent(text: string): boolean {
  return /\b(?:quantidade|medida|tamanho)\b[^\n]{0,40}\d/i.test(text) || /\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?/i.test(text);
}
function joShortContinuation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  return /^(sim|n[aã]o|mesm[ao]|isso|esse|essa|outro|outra|de novo|novamente|manda|envia|pode|continua|segue|igual|o mesmo|a mesma)[.!?\s]*$/i.test(t)
    || /\b(mesm[ao]|outro|de novo|novamente|manda|envia|esse|isso)\b/i.test(t);
}
function joRecentCloseContext(d:{role:string;text:string}[]): boolean {
  const prior = d.slice(0, -1).slice(-6).map(x => x.text).join('\n');
  return /\b(?:pix|link\s+de\s+pagamento|quero\s+pagar|vou\s+pagar|pode\s+fechar|fechamos|cobran[cç]a)\b/i.test(prior);
}
function joRecentLogisticsContext(d:{role:string;text:string}[]): boolean {
  const prior = d.slice(0, -1).slice(-6).map(x => x.text).join('\n');
  return /\b(?:cep|frete|correio|correios|sedex|pac|entrega|envio|retirada)\b/i.test(prior);
}
function joJourney(messages: any[]): { stage:string; source:string; inbound:string } {
  const d = joDialogue(messages);
  const inbound = [...d].reverse().find(x => x.role === 'user')?.text ?? '';
  if (!inbound) return { stage:'UNKNOWN', source:'NO_INBOUND', inbound:'' };
  if (joCloseIntent(inbound)) return { stage:'CLOSING', source:'CURRENT_STRONG_CLOSE_INTENT', inbound };
  if (joWaitingIntent(inbound)) return { stage:'WAITING', source:'CUSTOMER_WILL_PROVIDE_OR_PAUSE', inbound };
  if (joSupplierQuestionIntent(inbound)) return { stage:'CONVERSATION', source:'CURRENT_SUPPLIER_QUESTION', inbound };
  if (joShortContinuation(inbound) && joRecentCloseContext(d)) return { stage:'CLOSING', source:'RECENT_CLOSE_CONTEXT', inbound };
  if (joStrongQuoteIntent(inbound)) return { stage:'QUALIFICATION', source:'CURRENT_EXPLICIT_QUOTE_INTENT', inbound };
  if (joLogisticsIntent(inbound) || (joCepLike(inbound) && joRecentLogisticsContext(d))) return { stage:'LOGISTICS', source: joCepLike(inbound) ? 'CEP_IN_LOGISTICS_CONTEXT' : 'CURRENT_LOGISTICS_INTENT', inbound };
  if (joQuoteIntent(inbound) || joSlotAnswerIntent(inbound)) return { stage:'QUALIFICATION', source: joSlotAnswerIntent(inbound) ? 'CURRENT_SLOT_ANSWER' : 'CURRENT_QUOTE_INTENT', inbound };
  return { stage:'CONVERSATION', source:'DEFAULT', inbound };
}
function joJsonValueAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  let start = -1;
  for (let i = mi + marker.length; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') { start = i; break; }
    if (!/\s|=/.test(text[i])) break;
  }
  if (start < 0) return null;
  const opener = text[start], closer = opener === '{' ? '}' : ']';
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function joConfirmedSlots(system:string): any {
  const f = system.lastIndexOf('[FICHA:');
  if (f < 0) return {};
  const raw = joJsonValueAfter(system, 'slots=', f);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const keep = ['produto','quantidade','arte','medida','tamanho','cep','envio_retirada','modalidade_logistica','cor','modelo'];
  const out:any = {};
  for (const k of keep) {
    const v = raw[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') out[k] = v;
  }
  return out;
}
function joContinuityRule(slots:any): string {
  const keys = Object.keys(slots || {});
  if (!keys.length) return '';
  const compact = JSON.stringify(slots).slice(0,1200);
  return `\n[CORTEX CONTINUIDADE v1 confirmed_slots=${compact}]\nEstes dados já foram confirmados nesta venda. NÃO pergunte novamente por nenhum deles e NÃO volte uma etapa por ausência no texto atual. Reutilize-os. Só substitua um dado se o cliente o corrigir ou alterar explicitamente. Se a pergunta atual for informativa (ex.: diferença entre produtos, venda por metro/unidade, prazo ou funcionamento), responda primeiro a pergunta sem forçar nova coleta de quantidade/medida.\n[/CORTEX CONTINUIDADE]`;
}
function joWaitingRule(stage:string): string {
  if (stage !== 'WAITING') return '';
  return `\n[CORTEX ESPERA v1]\nO cliente acabou de informar que vai conferir, terminar, preparar ou enviar algo, ou pediu para não executar agora. NÃO abra nova pergunta, NÃO mude de assunto, NÃO requalifique e NÃO execute cobrança/frete/orçamento por conta própria. Responda de forma curta apenas confirmando que vai aguardar ou que não executará agora. Preserve todo o contexto já resolvido.\n[/CORTEX ESPERA]`;
}
function joSupplierQuestionRule(source:string): string {
  if (source !== 'CURRENT_SUPPLIER_QUESTION') return '';
  return `\n[CORTEX PERGUNTA ATUAL v1]\nO cliente fez uma pergunta explícita sobre fornecedor(es) NESTE TURNO. Responda a pergunta atual antes de continuar qualquer assunto antigo de fechamento, frete ou espera. Não invente quantidade, identidade ou condição de fornecedor. Se o histórico não tiver evidência suficiente para responder com segurança, faça uma única pergunta curta de esclarecimento. Não encerre o turno em silêncio.\n[/CORTEX PERGUNTA ATUAL]`;
}
function joToolFingerprint(messages:any[]): string {
  const parts:string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) {
      if (x?.type !== 'tool_result') continue;
      let s=''; try { s = typeof x.content === 'string' ? x.content : JSON.stringify(x.content); } catch {}
      if (s) parts.push(s.slice(0,800));
    }
  }
  return parts.slice(-3).join('|');
}
// Retry intencional do core: mensagem user iniciada por "[SISTEMA:" (joDialogue a ignora para
// a jornada; aqui ela ENTRA na identidade, senão o retry recebe a resposta original do cache).
function joRetryFingerprint(messages:any[]): string {
  const parts:string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || joHasToolResult(m?.content)) continue;
    const t = joText(m?.content);
    if (/^\s*\[SISTEMA:/i.test(t)) parts.push(t.slice(0,400));
  }
  return parts.join('|');
}
function joKey(body:any, journey:{stage:string;inbound:string}): string {
  const model = String(body?.model ?? '');
  const q = typeof body?.system === 'string' ? (body.system.match(/\[VOCÊ ACABOU DE PERGUNTAR:[\s\S]{0,300}/)?.[0] ?? '') : '';
  return [model, journey.stage, journey.inbound, q, joRetryFingerprint(body?.messages ?? []), joToolFingerprint(body?.messages ?? [])].join('§').slice(0,5000);
}
function joPrune(now:number) { for (const [k,v] of joCache) if (now - v.at > JO_TTL_MS * 3) joCache.delete(k); }
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
  const confirmed = joConfirmedSlots(body.system);
  body.system += `\n\n[CORTEX JOURNEY v1 stage=${journey.stage} precedence=CLOSING>WAITING>LOGISTICS>QUALIFICATION source=${journey.source}]\nO estágio da jornada define precedência entre skills. Skills de estágio inferior não podem reabrir dados já resolvidos sem mudança explícita do cliente. Menção informativa a pagamento NÃO significa intenção de fechar.\n[/CORTEX JOURNEY]${joContinuityRule(confirmed)}${joWaitingRule(journey.stage)}${joSupplierQuestionRule(journey.source)}`;

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
  void joAudit('journey_stage_resolved', { stage:journey.stage, source:journey.source, inbound:journey.inbound.slice(0,240), confirmed_slots:Object.keys(confirmed) });
  return res;
};