declare const Deno: any;

// João Artwork Context v1.1 — current-turn precedence patch — 09/09/2026
// Same skill/config as Artwork Context. This runs immediately inside the base v1 wrapper so that
// current explicit product intent is the final instruction before model execution.
// Fixes production evidence where stale DTF UV / dimensions leaked into a later apparel turn.

const ACP_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const ACP_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const acpBaseFetch = globalThis.fetch.bind(globalThis);
const ACP_VERSION = 'joao-artwork-context-guard/v1.1';
let acpCfgAt = 0;
let acpCfg = false;

function acpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function acpBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function acpEnabled(): Promise<boolean> {
  if (Date.now() - acpCfgAt < 15000) return acpCfg;
  acpCfgAt = Date.now();
  try {
    const r = await acpBaseFetch(`${ACP_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_artwork_context_guard_ativo&limit=1`, {
      headers: { apikey: ACP_SERVICE, authorization: `Bearer ${ACP_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    acpCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { acpCfg = false; }
  return acpCfg;
}
function acpText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function acpHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function acpUserTexts(messages:any[]): string[] {
  const out:string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || acpHasToolResult(m?.content)) continue;
    const t = acpText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.push(t);
  }
  return out.slice(-24);
}
function acpNorm(s:string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
type AcpProduct = { family:string; canonical:string; label:string };
function acpProduct(text:string): AcpProduct | null {
  const t = acpNorm(text);
  if (/\bdtf\s*uv\b|\badesiv(?:o|os)?\s*(?:dtf\s*)?uv\b/.test(t)) return { family:'dtf_uv', canonical:'dtf_uv', label:'DTF UV' };
  if (/\bdtf\s*(?:textil|textil)\b/.test(t)) return { family:'dtf_textil', canonical:'dtf_textil', label:'DTF têxtil' };
  if (/\b(?:camiseta|camisa|baby\s*look|oversized|moletom|polo|uniforme)\b/.test(t)) {
    if (/\bmoletom\b/.test(t)) return { family:'apparel', canonical:'moletom', label:'moletom' };
    if (/\bpolo\b/.test(t)) return { family:'apparel', canonical:'polo', label:'camiseta polo' };
    if (/\bbaby\s*look\b/.test(t)) return { family:'apparel', canonical:'baby_look', label:'baby look' };
    return { family:'apparel', canonical:'camiseta', label:/\bcamisa\b/.test(t) ? 'camisa/camiseta' : 'camiseta' };
  }
  if (/\bcaneca\b/.test(t)) return { family:'drinkware', canonical:'caneca', label:'caneca' };
  if (/\bcopo\b/.test(t)) return { family:'drinkware', canonical:'copo', label:'copo' };
  if (/\bgarrafa|garrafinha\b/.test(t)) return { family:'drinkware', canonical:'garrafa', label:'garrafa' };
  if (/\b(?:sacola|ecobag)\b/.test(t)) return { family:'bag', canonical:/ecobag/.test(t)?'ecobag':'sacola', label:/ecobag/.test(t)?'ecobag':'sacola' };
  return null;
}
function acpJsonAfter(text:string, marker:string, from=0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  const start = text.indexOf('{', mi + marker.length); if (start < 0) return null;
  let depth=0, quoted=false, escaped=false;
  for (let i=start;i<text.length;i++) {
    const ch=text[i];
    if (quoted) { if (escaped) escaped=false; else if (ch==='\\') escaped=true; else if (ch==='"') quoted=false; continue; }
    if (ch==='"') { quoted=true; continue; }
    if (ch==='{') depth++;
    else if (ch==='}' && --depth===0) { try { return JSON.parse(text.slice(start,i+1)); } catch { return null; } }
  }
  return null;
}
function acpSlotProduct(system:string): AcpProduct | null {
  const f = system.lastIndexOf('[FICHA:');
  const slots = f >= 0 ? acpJsonAfter(system, 'slots=', f) : null;
  const raw = String(slots?.produto ?? '');
  if (!raw) return null;
  return acpProduct(raw.replace(/_/g,' '))
    ?? (raw === 'dtf_uv' ? {family:'dtf_uv',canonical:'dtf_uv',label:'DTF UV'} : null)
    ?? (raw === 'dtf_textil' ? {family:'dtf_textil',canonical:'dtf_textil',label:'DTF têxtil'} : null);
}
function acpCompatible(a:AcpProduct|null,b:AcpProduct|null): boolean {
  if (!a || !b) return true;
  if (a.family === b.family) return true;
  if ((a.family === 'dtf_uv' && b.family === 'drinkware') || (a.family === 'drinkware' && b.family === 'dtf_uv')) return true;
  if ((a.family === 'dtf_textil' && (b.family === 'apparel' || b.family === 'bag')) || (b.family === 'dtf_textil' && (a.family === 'apparel' || a.family === 'bag'))) return true;
  return false;
}
function acpPreviousProduct(texts:string[], system:string): AcpProduct | null {
  for (let i=texts.length-2;i>=0;i--) {
    const p = acpProduct(texts[i]);
    if (p) return p;
  }
  return acpSlotProduct(system);
}
function acpAck(p:AcpProduct): string {
  if (p.family === 'apparel') return `Entendi: agora você está falando de ${p.label}.`;
  if (p.family === 'drinkware') return `Entendi: é para ${p.label}.`;
  if (p.family === 'bag') return `Entendi: agora o produto é ${p.label}.`;
  return `Entendi: agora é ${p.label}.`;
}
function acpConflictingMessage(msg:string, current:AcpProduct): boolean {
  const n = acpNorm(msg);
  if (current.family === 'apparel' || current.family === 'bag' || current.family === 'dtf_textil') {
    return /\bdtf\s*uv\b|\bquantos?\s+adesivos?\b|\badesivo\s+uv\b/.test(n);
  }
  if (current.family === 'dtf_uv') return /\bdtf\s*(?:textil|textil)\b/.test(n);
  return false;
}
async function acpAudit(evento:string, detail:any) {
  try {
    await acpBaseFetch(`${ACP_URL}/rest/v1/sistema_logs`, {
      method:'POST', headers:{'content-type':'application/json',apikey:ACP_SERVICE,authorization:`Bearer ${ACP_SERVICE}`,prefer:'return=minimal'},
      body:JSON.stringify({ agente_slug:'agente-noturno', funcao:'artwork-context-guard', versao:ACP_VERSION, nivel:'info', categoria:'skill_runtime', evento, status:'applied', mensagem:evento, detalhe:{...detail, skill_refs:['artwork_intake','media_handling','discovery'], authority_granted:false, effect_class:'COGNITIVE_GUARD'} }),
      signal:AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = acpUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return acpBaseFetch(input, init);
  if (!(await acpEnabled())) return acpBaseFetch(input, init);
  const raw = await acpBody(input, init); if (!raw) return acpBaseFetch(input, init);
  let body:any; try { body = JSON.parse(raw); } catch { return acpBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return acpBaseFetch(input, init);

  const texts = acpUserTexts(body.messages);
  const inbound = texts[texts.length-1] ?? '';
  const current = acpProduct(inbound);
  const previous = acpPreviousProduct(texts, body.system);
  const switched = !!current && !!previous && !acpCompatible(current, previous);
  const baseArtworkInjected = body.system.includes('[CORTEX ARTWORK CONTEXT');
  const artworkTurn = /\b(?:arquivo|arte|anexo|imagem|foto|zip|pdf|layout|folha|medida|tamanho|montad|upload|estampa|logo)\b/i.test(inbound) || /\[ARTE_PROCESSADA_CORTEX\]/i.test(inbound);

  if (current && switched) {
    body.system += `\n\n[CORTEX ARTWORK CURRENT TURN v1 product=${current.canonical} precedence=CURRENT_EXPLICIT>CONFIRMED_SLOTS>HISTORICAL_ARTWORK]\nO cliente acabou de mudar explicitamente o produto/objeto para ${current.label}. Esse dado atual vence qualquer produto recuperado de mensagens, imagens, arquivos ou ficha anterior. NÃO associe a este produto medidas, A3/A4, quantidade, técnica ou arte que pertenciam ao produto anterior sem o cliente repetir ou confirmar. Imagem/arquivo nunca troca produto sozinho.\n[/CORTEX ARTWORK CURRENT TURN]`;
  } else if (baseArtworkInjected && !artworkTurn) {
    body.system += `\n\n[CORTEX ARTWORK SCOPE v1]\nA mensagem atual NÃO é uma solicitação sobre arte/arquivo. Não despeje medidas, A3/A4, ZIP ou outros fatos antigos da arte na resposta e não deixe esses fatos mudarem o assunto atual. Use contexto de arte antigo somente se for estritamente necessário para responder ao pedido atual.\n[/CORTEX ARTWORK SCOPE]`;
  }

  const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
  headers.delete('content-length');
  const response = await acpBaseFetch(input, { ...(init ?? {}), headers, body:JSON.stringify(body) });
  if (!response.ok) return response;
  if ((!current || !switched) && !(baseArtworkInjected && !artworkTurn)) return response;

  try {
    const payload = await response.clone().json();
    if (!Array.isArray(payload?.content) || payload.content.length !== 1 || payload.content[0]?.type !== 'text' || typeof payload.content[0]?.text !== 'string') return response;
    let decision:any; try { decision = JSON.parse(payload.content[0].text); } catch { return response; }
    if (!decision || typeof decision !== 'object' || typeof decision.mensagem !== 'string') return response;

    decision.slots = decision.slots && typeof decision.slots === 'object' ? { ...decision.slots } : {};
    if (current && switched) {
      decision.slots.produto = current.canonical;
      const ack = acpAck(current);
      if (acpConflictingMessage(decision.mensagem, current)) {
        decision.mensagem = `${ack} Vou considerar este produto atual e ignorar o produto/técnica anterior. Vou usar somente os dados já confirmados para ele.`;
      } else if (!/^(?:entendi|perfeito|certo|beleza|recebi|pelo que entendi)\b/i.test(decision.mensagem.trim())) {
        decision.mensagem = `${ack} ${decision.mensagem}`;
      }
    } else if (baseArtworkInjected && !artworkTurn && decision.mensagem.includes('?') && !/^(?:entendi|perfeito|certo|beleza|recebi|pelo que entendi)\b/i.test(decision.mensagem.trim())) {
      decision.mensagem = `Certo, ${decision.mensagem}`;
    }
    payload.content[0].text = JSON.stringify(decision);
    const outHeaders = new Headers(response.headers);
    outHeaders.set('x-cortex-artwork-current-turn', ACP_VERSION);
    void acpAudit(current && switched ? 'artwork_current_product_locked' : 'artwork_historical_context_scoped', { inbound:inbound.slice(0,240), current_product:current?.canonical ?? null, previous_product:previous?.canonical ?? null, switched, artwork_turn:artworkTurn });
    return new Response(JSON.stringify(payload), { status:response.status, statusText:response.statusText, headers:outHeaders });
  } catch { return response; }
};
