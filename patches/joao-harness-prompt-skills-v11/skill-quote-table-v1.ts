declare const Deno: any;

// Harness-only active candidate: deterministic DTF price-table skill.
// Narrow trigger only: explicit DTF family + explicit request for table/prices.
// It NEVER invents prices: first response asks the existing consultar_tabela_dtf tool;
// second response formats only that tool_result. Everything else passes through unchanged.
const QT_BASE_FETCH = globalThis.fetch.bind(globalThis);
const QT_VERSION = 'skill_quote_table/v1';
const QT_ID_PREFIX = 'toolu_skill_quote_table_';

function qtUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function qtBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}
function qtText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function qtIsToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function qtInbound(messages:any[]): string {
  for (let i=messages.length-1;i>=0;i--) {
    const m=messages[i]; if (m?.role !== 'user' || qtIsToolResult(m?.content)) continue;
    const t=qtText(m?.content); if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function qtFamily(text:string): 'dtf_uv'|'dtf_textil'|null {
  const t=String(text||'');
  if (/\bdtf\s*uv\b|\bimpress[aã]o\s+do\s+dtf\s*uv\b/i.test(t)) return 'dtf_uv';
  if (/\bdtf\s*t[eê]xtil\b|\bdtf\s+para\s+tecido\b/i.test(t)) return 'dtf_textil';
  return null;
}
function qtEligible(inbound:string): 'dtf_uv'|'dtf_textil'|null {
  const fam=qtFamily(inbound); if (!fam) return null;
  if (!/\b(valor(?:es)?|pre[cç]o(?:s)?|tabela)\b/i.test(inbound)) return null;
  // Anything needing a calculation, logistics, payment or negotiation stays full-path.
  if (/\b(frete|entrega|cep|sedex|pac|pix|cart[aã]o|pagar|pagamento|fechar|desconto|caro|barato|concorr|comparando)\b/i.test(inbound)) return null;
  if (/\b\d+(?:[.,]\d+)?\s*(?:m|metro|metros)\b/i.test(inbound)) return null;
  if (/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+/i.test(inbound)) return null;
  return fam;
}
function qtFindOwnToolResult(messages:any[]): { family:'dtf_uv'|'dtf_textil'; content:string } | null {
  let family:'dtf_uv'|'dtf_textil'|null=null;
  const ownIds=new Set<string>();
  for (const m of messages) {
    if (m?.role==='assistant' && Array.isArray(m?.content)) {
      for (const x of m.content) {
        if (x?.type==='tool_use' && String(x?.id||'').startsWith(QT_ID_PREFIX) && x?.name==='consultar_tabela_dtf') {
          ownIds.add(String(x.id));
          const p=String(x?.input?.produto||''); if (p==='dtf_uv'||p==='dtf_textil') family=p;
        }
      }
    }
  }
  if (!family || !ownIds.size) return null;
  for (let i=messages.length-1;i>=0;i--) {
    const m=messages[i]; if (m?.role!=='user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) {
      if (x?.type==='tool_result' && ownIds.has(String(x?.tool_use_id||''))) {
        return { family, content: typeof x.content==='string' ? x.content : JSON.stringify(x.content??{}) };
      }
    }
  }
  return null;
}
function qtMoney(v:any): string {
  const n=Number(v); return Number.isFinite(n) ? `R$${n.toFixed(2).replace('.',',')}` : '';
}
function qtFinalDecision(family:'dtf_uv'|'dtf_textil', raw:string): any | null {
  let j:any; try { j=JSON.parse(raw); } catch { return null; }
  if (j?.ok !== true || !j?.display_data) return null;
  const d=j.display_data;
  const lines:string[]=[];
  if (family==='dtf_textil') {
    for (const f of Array.isArray(d?.faixas)?d.faixas:[]) {
      if (f?.faixa && f?.preco_por_metro != null) lines.push(`${String(f.faixa)}: R$${String(f.preco_por_metro).replace('.',',')}/m`);
    }
    if (!lines.length) return null;
    return {
      responde:true,
      mensagem:`Tabela de DTF têxtil:\n${lines.join('\n')}\nSe quiser, me passa a metragem total ou a arte + quantidade de cópias que eu calculo certinho.`,
      tema:'dtf_metro', encaminhou_venda:false, etapa:'orcamento',
      slots:{ produto:'dtf_textil' }
    };
  }

  for (const f of Array.isArray(d?.folhas)?d.folhas:[]) {
    const code=String(f?.codigo||'').toUpperCase(); const price=qtMoney(f?.preco);
    if (code && price) lines.push(`${code}: ${price}`);
  }
  if (d?.excedente && Number(d.excedente.consumo_de_m)>=0 && Number(d.excedente.consumo_ate_m)>0) {
    const de=Number(d.excedente.consumo_de_m).toFixed(2).replace('.',',');
    const ate=Number(d.excedente.consumo_ate_m).toFixed(2).replace('.',',');
    const base=qtMoney(d.excedente.preco_base); const taxa=qtMoney(d.excedente.preco_excedente_por_m);
    if (base && taxa) lines.push(`${de}m a ${ate}m: ${base} + ${taxa}/m no excedente`);
  }
  for (const f of Array.isArray(d?.faixas_metro)?d.faixas_metro:[]) {
    const de=Number(f?.de_m); const ate=f?.ate_m==null?null:Number(f.ate_m); const pm=qtMoney(f?.preco_por_m);
    if (!Number.isFinite(de)||!pm) continue;
    lines.push(ate==null ? `a partir de ${de}m: ${pm}/m` : `${de}m a ${String(ate).replace('.',',')}m: ${pm}/m`);
  }
  if (!lines.length) return null;
  return {
    responde:true,
    mensagem:`Tabela de DTF UV:\n${lines.join('\n')}\nSe me passar o tamanho dos adesivos e a quantidade, eu calculo o consumo exato.`,
    tema:'adesivo_uv', encaminhou_venda:false, etapa:'orcamento',
    slots:{ produto:'dtf_uv' }
  };
}
function qtAnthropicText(decision:any): Response {
  const text=JSON.stringify(decision);
  const payload={ id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`, type:'message', role:'assistant', model:'cortex-skill-quote-table', content:[{type:'text',text}], stop_reason:'end_turn', stop_sequence:null, usage:{input_tokens:0,output_tokens:0} };
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json','x-cortex-skill':QT_VERSION}});
}
function qtAnthropicTool(family:'dtf_uv'|'dtf_textil'): Response {
  const id=QT_ID_PREFIX+crypto.randomUUID().replace(/-/g,'').slice(0,18);
  const payload={ id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`, type:'message', role:'assistant', model:'cortex-skill-quote-table', content:[{type:'tool_use',id,name:'consultar_tabela_dtf',input:{produto:family}}], stop_reason:'tool_use', stop_sequence:null, usage:{input_tokens:0,output_tokens:0} };
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json','x-cortex-skill':QT_VERSION}});
}
async function qtMetric(event:string,family:string) {
  try { await QT_BASE_FETCH(`https://harness-metrics.invalid/skill-quote-table?event=${encodeURIComponent(event)}&family=${encodeURIComponent(family)}`,{method:'GET'}); } catch {}
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=qtUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return QT_BASE_FETCH(input,init);
  const raw=await qtBody(input,init); if (!raw) return QT_BASE_FETCH(input,init);
  let body:any; try { body=JSON.parse(raw); } catch { return QT_BASE_FETCH(input,init); }
  if (!Array.isArray(body?.messages)) return QT_BASE_FETCH(input,init);

  const ownResult=qtFindOwnToolResult(body.messages);
  if (ownResult) {
    const decision=qtFinalDecision(ownResult.family,ownResult.content);
    if (!decision) { await qtMetric('tool_result_unusable',ownResult.family); return QT_BASE_FETCH(input,init); }
    await qtMetric('final_deterministic',ownResult.family);
    return qtAnthropicText(decision);
  }

  const inbound=qtInbound(body.messages);
  const family=qtEligible(inbound);
  if (!family) return QT_BASE_FETCH(input,init);
  // Media stays full-path; this skill is text-only.
  const current=body.messages[body.messages.length-1]?.content;
  if (Array.isArray(current) && current.some((x:any)=>x?.type==='image')) return QT_BASE_FETCH(input,init);

  await qtMetric('tool_request',family);
  return qtAnthropicTool(family);
};
