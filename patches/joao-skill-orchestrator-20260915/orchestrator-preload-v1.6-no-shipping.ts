declare const Deno: any;

// João Skill Orchestrator v1.6 — 15/09/2026
// Fase 1 FreightAgent: remove toda semântica de CEP/frete/logística do prompt do João.
// O domínio de shipping passa a ser estado canônico externo (FreteAgent/state gate).
// Preserva: closing, waiting, qualification, continuidade comercial, fornecedor e dedupe.

const JO16_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const JO16_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const jo16BaseFetch = globalThis.fetch.bind(globalThis);
const JO16_VERSION = 'joao-skill-orchestrator/v1.6-no-shipping';
const JO16_TTL_MS = 2200;
let jo16CfgAt = 0;
let jo16Cfg = true;
const jo16Cache = new Map<string, { at:number; status:number; statusText:string; headers:[string,string][]; body:string }>();

function jo16Url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function jo16Body(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function jo16Enabled(): Promise<boolean> {
  if (Date.now() - jo16CfgAt < 15000) return jo16Cfg;
  jo16CfgAt = Date.now();
  try {
    const r = await jo16BaseFetch(`${JO16_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_skill_orchestrator_ativo&limit=1`, {
      headers: { apikey: JO16_SERVICE, authorization: `Bearer ${JO16_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows.length) jo16Cfg = rows[0]?.valor_bool === true;
    }
  } catch {}
  return jo16Cfg;
}
function jo16Text(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function jo16HasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function jo16Dialogue(messages:any[]): {role:string;text:string}[] {
  const out:{role:string;text:string}[] = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || jo16HasToolResult(m.content)) continue;
    const text = jo16Text(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({ role:String(m.role), text });
  }
  return out;
}
function jo16CloseIntent(text:string): boolean {
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
function jo16WaitingIntent(text:string): boolean {
  let t = String(text || '').trim();
  if (!t || t.length > 180) return false;
  t = t.replace(/^jo[aã]o\s*[,!:;-]?\s*/i, '');
  return /^(?:j[aá]\s+te\s+(?:passo|mando|envio)|j[aá]\s+(?:passo|mando|envio)|um\s+minut(?:o|inho)|s[oó]\s+um\s+moment(?:o|inho)|pera(?:í|i)|aguarda(?:\s+um\s+pouco)?|vou\s+(?:conferir|ver|checar|olhar|separar|preparar|terminar|montar|abrir)|ainda\s+(?:estou|t[oô])\s+(?:fazendo|montando|preparando|terminando)|estou\s+(?:fazendo|montando|preparando|terminando)|deixa\s+eu\s+(?:ver|conferir|checar|olhar)|(?:s[oó]\s+)?n[aã]o\s+(?:gera|manda|envia)\b[^\n]{0,50}\bagora\b|deixa\s+pra\s+depois)\b/i.test(t);
}
function jo16SupplierQuestionIntent(text:string): boolean {
  const t = String(text || '').trim();
  return /\bforneced(?:or|ores|ora|oras)\b/i.test(t)
    && (/\?/.test(t) || /\b(quantos?|qual|quais|ainda|s[oó]|somente|possui|possuem|tem|t[eê]m|voc[eê]s)\b/i.test(t));
}
function jo16StrongQuoteIntent(text:string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|proposta)\b/i.test(text);
}
function jo16QuoteIntent(text:string): boolean {
  return jo16StrongQuoteIntent(text) || /\b(pre[cç]o|valor|quanto\s+(?:fica|custa))\b/i.test(text);
}
function jo16SlotAnswerIntent(text:string): boolean {
  return /\b(?:quantidade|medida|tamanho)\b[^\n]{0,40}\d/i.test(text)
    || /\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?/i.test(text);
}
function jo16ShortContinuation(text:string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length > 90) return false;
  return /^(sim|n[aã]o|mesm[ao]|isso|esse|essa|outro|outra|de novo|novamente|manda|envia|pode|continua|segue|igual|o mesmo|a mesma)[.!?\s]*$/i.test(t)
    || /\b(mesm[ao]|outro|de novo|novamente|manda|envia|esse|isso)\b/i.test(t);
}
function jo16RecentCloseContext(d:{role:string;text:string}[]): boolean {
  const prior = d.slice(0,-1).slice(-6).map(x => x.text).join('\n');
  return /\b(?:pix|link\s+de\s+pagamento|quero\s+pagar|vou\s+pagar|pode\s+fechar|fechamos|cobran[cç]a)\b/i.test(prior);
}
function jo16Journey(messages:any[]): {stage:string;source:string;inbound:string} {
  const d = jo16Dialogue(messages);
  const inbound = [...d].reverse().find(x => x.role === 'user')?.text ?? '';
  if (!inbound) return { stage:'UNKNOWN', source:'NO_INBOUND', inbound:'' };
  if (jo16CloseIntent(inbound)) return { stage:'CLOSING', source:'CURRENT_STRONG_CLOSE_INTENT', inbound };
  if (jo16WaitingIntent(inbound)) return { stage:'WAITING', source:'CUSTOMER_WILL_PROVIDE_OR_PAUSE', inbound };
  if (jo16SupplierQuestionIntent(inbound)) return { stage:'CONVERSATION', source:'CURRENT_SUPPLIER_QUESTION', inbound };
  if (jo16ShortContinuation(inbound) && jo16RecentCloseContext(d)) return { stage:'CLOSING', source:'RECENT_CLOSE_CONTEXT', inbound };
  if (jo16StrongQuoteIntent(inbound)) return { stage:'QUALIFICATION', source:'CURRENT_EXPLICIT_QUOTE_INTENT', inbound };
  if (jo16QuoteIntent(inbound) || jo16SlotAnswerIntent(inbound)) return { stage:'QUALIFICATION', source:jo16SlotAnswerIntent(inbound) ? 'CURRENT_SLOT_ANSWER' : 'CURRENT_QUOTE_INTENT', inbound };
  return { stage:'CONVERSATION', source:'DEFAULT', inbound };
}
function jo16JsonValueAfter(text:string, marker:string, from=0): any | null {
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
    if (quoted) { if (escaped) escaped=false; else if (ch === '\\') escaped=true; else if (ch === '"') quoted=false; continue; }
    if (ch === '"') { quoted=true; continue; }
    if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) { try { return JSON.parse(text.slice(start,i+1)); } catch { return null; } }
  }
  return null;
}
function jo16ConfirmedSlots(system:string): any {
  const f = system.lastIndexOf('[FICHA:');
  if (f < 0) return {};
  const raw = jo16JsonValueAfter(system,'slots=',f);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // Intencionalmente NÃO inclui CEP, modalidade de entrega ou qualquer estado de shipping.
  const keep = ['produto','quantidade','arte','medida','tamanho','cor','modelo'];
  const out:any = {};
  for (const k of keep) {
    const v = raw[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') out[k]=v;
  }
  return out;
}
function jo16ContinuityRule(slots:any): string {
  if (!Object.keys(slots || {}).length) return '';
  const compact = JSON.stringify(slots).slice(0,1200);
  return `\n[CORTEX CONTINUIDADE v2 confirmed_slots=${compact}]\nEstes dados comerciais já foram confirmados nesta venda. NÃO pergunte novamente por nenhum deles e NÃO volte uma etapa por ausência no texto atual. Só substitua um dado se o cliente o corrigir ou alterar explicitamente. Se a pergunta atual for informativa, responda primeiro sem forçar nova coleta de quantidade/medida.\n[/CORTEX CONTINUIDADE]`;
}
function jo16WaitingRule(stage:string): string {
  if (stage !== 'WAITING') return '';
  return `\n[CORTEX ESPERA v2]\nO cliente informou que vai conferir, terminar, preparar ou enviar algo, ou pediu para não executar agora. NÃO abra nova pergunta, NÃO mude de assunto, NÃO requalifique e NÃO execute cobrança/orçamento por conta própria. Responda de forma curta confirmando que vai aguardar ou que não executará agora. Preserve o contexto comercial já resolvido.\n[/CORTEX ESPERA]`;
}
function jo16SupplierRule(source:string): string {
  if (source !== 'CURRENT_SUPPLIER_QUESTION') return '';
  return `\n[CORTEX PERGUNTA ATUAL v2]\nO cliente fez uma pergunta explícita sobre fornecedor(es) NESTE TURNO. Responda a pergunta atual antes de continuar outro assunto antigo. Não invente quantidade, identidade ou condição de fornecedor. Se o histórico não tiver evidência suficiente, faça uma única pergunta curta de esclarecimento. Não encerre o turno em silêncio.\n[/CORTEX PERGUNTA ATUAL]`;
}
function jo16Clarification(messages:any[]): string {
  const ctx = jo16Dialogue(messages).slice(-8).map(x => x.text).join('\n');
  if (/camiset/i.test(ctx) && /algod[aã]o/i.test(ctx)) return 'Você está falando dos fornecedores da camiseta 100% algodão, certo?';
  if (/camiset/i.test(ctx)) return 'Você está falando dos fornecedores das camisetas, certo?';
  if (/dtf\s*uv/i.test(ctx)) return 'Você está falando dos fornecedores do DTF UV, certo?';
  if (/dtf/i.test(ctx)) return 'Você está falando dos fornecedores do DTF, certo?';
  return 'Você está falando dos fornecedores desse produto, certo?';
}
function jo16PatchSupplierNoSilence(raw:string, messages:any[]): {changed:boolean; body:string} {
  try {
    const outer = JSON.parse(raw);
    const block = Array.isArray(outer?.content) ? outer.content.find((x:any)=>x?.type==='text' && typeof x?.text==='string') : null;
    if (!block) return {changed:false,body:raw};
    let decision:any; try { decision=JSON.parse(block.text); } catch { return {changed:false,body:raw}; }
    if (!decision || decision.responde !== false) return {changed:false,body:raw};
    decision.responde=true;
    decision.mensagem=jo16Clarification(messages);
    decision.tema=String(decision.tema || 'complexo');
    decision.encaminhou_venda=false;
    delete decision.slots;
    block.text=JSON.stringify(decision);
    return {changed:true,body:JSON.stringify(outer)};
  } catch { return {changed:false,body:raw}; }
}
function jo16ToolFingerprint(messages:any[]): string {
  const parts:string[]=[];
  for (const m of messages || []) {
    if (m?.role!=='user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) if (x?.type==='tool_result') {
      let s=''; try { s=typeof x.content==='string'?x.content:JSON.stringify(x.content); } catch {}
      if (s) parts.push(s.slice(0,800));
    }
  }
  return parts.slice(-3).join('|');
}
function jo16RetryFingerprint(messages:any[]): string {
  const parts:string[]=[];
  for (const m of messages || []) {
    if (m?.role!=='user' || jo16HasToolResult(m?.content)) continue;
    const t=jo16Text(m?.content);
    if (/^\s*\[SISTEMA:/i.test(t)) parts.push(t.slice(0,400));
  }
  return parts.join('|');
}
function jo16Key(body:any, journey:{stage:string;inbound:string}): string {
  const model=String(body?.model ?? '');
  const q=typeof body?.system==='string' ? (body.system.match(/\[VOCÊ ACABOU DE PERGUNTAR:[\s\S]{0,300}/)?.[0] ?? '') : '';
  return [model,journey.stage,journey.inbound,q,jo16RetryFingerprint(body?.messages ?? []),jo16ToolFingerprint(body?.messages ?? [])].join('§').slice(0,5000);
}
function jo16Prune(now:number) { for (const [k,v] of jo16Cache) if (now-v.at > JO16_TTL_MS*3) jo16Cache.delete(k); }
async function jo16Audit(evento:string, detail:any) {
  try {
    await jo16BaseFetch(`${JO16_URL}/rest/v1/sistema_logs`, {
      method:'POST',
      headers:{'content-type':'application/json',apikey:JO16_SERVICE,authorization:`Bearer ${JO16_SERVICE}`,'prefer':'return=minimal'},
      body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-skill-orchestrator',versao:JO16_VERSION,nivel:'info',categoria:'skill_runtime',evento,status:'applied',mensagem:detail?.stage ?? evento,detalhe:{...detail,shipping_prompt_authority:false}}),
      signal:AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input:RequestInfo|URL, init?:RequestInit): Promise<Response> => {
  const url=jo16Url(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return jo16BaseFetch(input,init);
  if (!(await jo16Enabled())) return jo16BaseFetch(input,init);
  const raw=await jo16Body(input,init); if (!raw) return jo16BaseFetch(input,init);
  let body:any; try { body=JSON.parse(raw); } catch { return jo16BaseFetch(input,init); }
  if (typeof body?.system!=='string' || !Array.isArray(body?.messages)) return jo16BaseFetch(input,init);

  const journey=jo16Journey(body.messages);
  const confirmed=jo16ConfirmedSlots(body.system);
  body.system += `\n\n[CORTEX JOURNEY v2 stage=${journey.stage} precedence=CLOSING>WAITING>QUALIFICATION source=${journey.source}]\nO estágio comercial define precedência entre skills. Skills de estágio inferior não podem reabrir dados comerciais já resolvidos sem mudança explícita do cliente. Menção informativa a pagamento NÃO significa intenção de fechar.\n[/CORTEX JOURNEY]${jo16ContinuityRule(confirmed)}${jo16WaitingRule(journey.stage)}${jo16SupplierRule(journey.source)}`;

  const key=jo16Key(body,journey); const now=Date.now(); jo16Prune(now);
  if (body?.stream!==true) {
    const hit=jo16Cache.get(key);
    if (hit && now-hit.at<=JO16_TTL_MS) {
      void jo16Audit('duplicate_model_call_suppressed',{stage:journey.stage,source:journey.source,inbound:journey.inbound.slice(0,240),dedupe_window_ms:JO16_TTL_MS});
      return new Response(hit.body,{status:hit.status,statusText:hit.statusText,headers:new Headers(hit.headers)});
    }
  }
  const headers=new Headers(init?.headers ?? (typeof Request!=='undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  const res=await jo16BaseFetch(input,{...(init ?? {}),headers,body:JSON.stringify(body)});
  if (body?.stream!==true && res.ok) {
    try {
      let text=await res.clone().text();
      if (journey.source==='CURRENT_SUPPLIER_QUESTION') {
        const patched=jo16PatchSupplierNoSilence(text,body.messages);
        if (patched.changed) text=patched.body;
      }
      jo16Cache.set(key,{at:Date.now(),status:res.status,statusText:res.statusText,headers:[...res.headers.entries()],body:text});
      if (text !== await res.clone().text().catch(()=>text)) {
        const h=new Headers(res.headers); h.delete('content-length');
        void jo16Audit('supplier_no_silence_fallback_enforced',{stage:journey.stage,source:journey.source});
        return new Response(text,{status:res.status,statusText:res.statusText,headers:h});
      }
    } catch {}
  }
  void jo16Audit('journey_stage_resolved',{stage:journey.stage,source:journey.source,inbound:journey.inbound.slice(0,240),confirmed_slots:Object.keys(confirmed)});
  return res;
};
