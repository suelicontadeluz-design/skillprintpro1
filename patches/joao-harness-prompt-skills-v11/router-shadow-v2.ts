declare const Deno: any;

// Harness-only: classifica o turno para um futuro router/prompt por skill.
// NUNCA altera body, tools ou resposta. So chama a qualification v2 e emite numeros/rotulos
// para harness-metrics.invalid, que a jaula bloqueia e registra.
const RS_BASE_FETCH = globalThis.fetch.bind(globalThis);
const RS_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const RS_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function rsUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function rsBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}
function rsText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function rsHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function rsInbound(messages:any[]): string {
  for (let i=messages.length-1;i>=0;i--) {
    const m=messages[i]; if (m?.role !== 'user' || rsHasToolResult(m?.content)) continue;
    const t=rsText(m?.content); if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function rsJsonAfter(text:string, marker:string, from=0): any | null {
  const mi=text.indexOf(marker,from); if (mi<0) return null;
  const start=text.indexOf('{',mi+marker.length); if (start<0) return null;
  let depth=0,quoted=false,escaped=false;
  for (let i=start;i<text.length;i++) {
    const ch=text[i];
    if (quoted) { if (escaped) escaped=false; else if (ch==='\\') escaped=true; else if (ch==='"') quoted=false; continue; }
    if (ch==='"') { quoted=true; continue; }
    if (ch==='{') depth++;
    else if (ch==='}' && --depth===0) { try { return JSON.parse(text.slice(start,i+1)); } catch { return null; } }
  }
  return null;
}
function rsQuestion(system:string): string {
  const tag='[VOCÊ ACABOU DE PERGUNTAR:'; const i=system.lastIndexOf(tag); if (i<0) return '';
  const e=system.indexOf('O CLIENTE RESPONDEU:',i); if (e<0) return '';
  return system.slice(i+tag.length,e).replace(/^\s*["“]|["”]\s*$/g,'').trim();
}
function rsExplicitQuantity(text:string): number | null {
  const c=String(text||'').trim(); if (!c || /\b\d{8}\b/.test(c)) return null;
  const m=c.match(/\b(\d{1,5})\s*(?:c[oó]pias?|unidades?|pe[cç]as?|adesivos?|camisetas?)\b/i);
  if (!m) return null; const n=Number(m[1]); return Number.isInteger(n)&&n>0?n:null;
}
function rsLeadingQuantity(text:string): number | null {
  const c=String(text||'').trim();
  if (!c || /^\d{8}(?:\D|$)/.test(c) || /^\d+[,.]\d+/.test(c) || /^\d+\s*[x×]\s*\d+/i.test(c)) return null;
  const m=c.match(/^(\d{1,5})(?=\s|$|\n)/); if (!m) return null;
  const n=Number(m[1]); return Number.isInteger(n)&&n>0?n:null;
}
function rsShortInt(text:string): number | null {
  const c=text.trim(); if (c.length>80 || /\d\s*[x×]\s*\d/i.test(c) || /\d+[,.]\d+/.test(c) || /\b\d{8}\b/.test(c)) return null;
  const m=c.match(/(?:^|\D)(\d{1,5})(?:\D|$)/); if (!m) return null;
  const n=Number(m[1]); return Number.isInteger(n)&&n>0?n:null;
}
function rsSlots(system:string,inbound:string): any {
  const f=system.lastIndexOf('[FICHA:'); const s0=f>=0?rsJsonAfter(system,'slots=',f):null;
  const s=s0&&typeof s0==='object'?{...s0}:{}; const q=rsQuestion(system).toLowerCase();
  if (!(Number(s.quantidade)>0)) {
    const explicit=rsExplicitQuantity(inbound);
    if (explicit) s.quantidade=explicit;
    else if (/quant|c[oó]pia|unidade|pe[cç]a|quantas|quantos/.test(q)) {
      const n=rsLeadingQuantity(inbound) ?? rsShortInt(inbound); if (n) s.quantidade=n;
    }
  }
  if (!s.cep && /\bcep\b/.test(q)) { const cep=inbound.replace(/\D/g,''); if (/^\d{8}$/.test(cep)) s.cep=cep; }
  if (!s.envio_retirada && /(retirada|retirar|envio|receber|buscar|motoboy)/.test(q)) {
    if (/\b(retir|buscar|busco|vou buscar)\w*/i.test(inbound)) s.envio_retirada='retirada';
    else if (/\b(motoboy|moto)\b/i.test(inbound)) s.envio_retirada='motoboy';
    else if (/\b(envio|enviar|receber|entrega|correios|transportadora)\b/i.test(inbound)) s.envio_retirada='envio';
  }
  return s;
}
function rsDirect(t:string): boolean {
  return /\?\s*$/.test(t.trim()) || /\b(qual|quanto|como|quando|prazo|material|arquivo|formato|tamanho|funciona|aceita|consegue|pode|voc[eê]s)\b/i.test(t);
}
function rsClose(t:string): boolean {
  return /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|link\s+de\s+pagamento)\b/i.test(t);
}
function rsFamily(slots:any): string {
  const p=String(slots?.produto??'').toLowerCase();
  if (/camiset|baby|oversized|moletom|polo/.test(p)) return 'apparel';
  if (/dtf.*uv|adesiv.*uv/.test(p)) return 'dtf_uv';
  if (/dtf.*text|t[eê]xtil/.test(p)) return 'dtf_textil';
  if (/pack/.test(p)) return 'pack';
  return p||'unknown';
}
async function rsQual(snapshot:any): Promise<any|null> {
  try {
    const r=await RS_BASE_FETCH(`${RS_URL}/rest/v1/rpc/fn_qualification_evaluate_v2`,{
      method:'POST',headers:{'content-type':'application/json',apikey:RS_SERVICE,authorization:`Bearer ${RS_SERVICE}`},
      body:JSON.stringify({p_snapshot:snapshot,p_as_of:new Date().toISOString()}),signal:AbortSignal.timeout(3000)
    });
    return r.ok?await r.json():null;
  } catch { return null; }
}
async function rsEmit(v:Record<string,string|number|boolean>) {
  try { const q=new URLSearchParams(); for (const [k,x] of Object.entries(v)) q.set(k,String(x)); await RS_BASE_FETCH(`https://harness-metrics.invalid/router-shadow-v2?${q}`,{method:'GET'}); } catch {}
}
function rsRoute(status:string,direct:boolean,close:boolean,fam:string,inbound:string): string {
  if (close) return 'full_closing';
  if (status==='HOLD_MISSING_PRODUCT') return direct?'compact_answer_then_product':'skill_ask_product';
  if (status==='HOLD_MISSING_QUANTITY') return direct?'compact_answer_then_quantity':'skill_ask_quantity';
  if (status==='HOLD_MISSING_CEP_FOR_SHIPPING') return direct?'compact_answer_then_cep':'skill_ask_cep';
  if (status==='QUALIFIED_FOR_QUOTE_SHADOW') {
    if (/\b(tabela|valores?|pre[cç]os?)\b/i.test(inbound) && (fam==='dtf_textil'||fam==='dtf_uv')) return 'skill_quote_table';
    return 'full_qualified';
  }
  return 'full_fallback';
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=rsUrl(input); if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return RS_BASE_FETCH(input,init);
  const raw=await rsBody(input,init);
  if (raw) {
    try {
      const body=JSON.parse(raw); if (typeof body?.system==='string'&&Array.isArray(body?.messages)) {
        const inbound=rsInbound(body.messages); const slots=rsSlots(body.system,inbound); const fam=rsFamily(slots);
        const q=await rsQual({slots_after:slots,invalidations:[],produto_macro:String(slots?.produto??''),cep_disponivel:/^\d{8}$/.test(String(slots?.cep??'').replace(/\D/g,'')),latest_inbound_message:inbound,source_temporality:'PRE_MODEL_CURRENT_TURN'});
        const status=String(q?.status??'UNKNOWN'); const direct=rsDirect(inbound), close=rsClose(inbound);
        await rsEmit({status,direct,close,family:fam,route:rsRoute(status,direct,close,fam,inbound),has_quantity:Number(slots?.quantidade)>0,has_cep:/^\d{8}$/.test(String(slots?.cep??'').replace(/\D/g,''))});
      }
    } catch {}
  }
  const res=await RS_BASE_FETCH(input,init);
  try { await rsEmit({status:'ACTUAL_ROUTER',direct:false,close:false,family:'na',route:res.headers.get('x-cortex-skill-router')?'routed':'provider',has_quantity:false,has_cep:false}); } catch {}
  return res;
};
