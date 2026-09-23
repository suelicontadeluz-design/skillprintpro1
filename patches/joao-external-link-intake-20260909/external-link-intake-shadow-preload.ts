declare const Deno: any;

import { extractUrlsFromText, telemetryForUrl, inspectAnthropicWebFetchResponse } from './external-link-intake-core.ts';

// Shadow observer for media_handling/v2 External Link Intake.
// IMPORTANT: import this BEFORE the current web-fetch-preload. The existing v1 wrapper
// then modifies the Anthropic request and calls through this observer, allowing us to
// measure the actual tool injection/result without changing behavior.

const ELS_URL = String(Deno?.env?.get?.('SUPABASE_URL') ?? '').replace(/\/$/, '');
const ELS_SERVICE = String(Deno?.env?.get?.('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const ELS_VERSION = 'joao-external-link-intake-shadow/v1';
const ELS_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const elsBaseFetch = globalThis.fetch.bind(globalThis);
let elsCfgAt = 0;
let elsCfg = false;

async function enabled(): Promise<boolean> {
  if (Date.now() - elsCfgAt < 15000) return elsCfg;
  elsCfgAt = Date.now();
  if (!ELS_URL || !ELS_SERVICE) return false;
  try {
    const r = await elsBaseFetch(`${ELS_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_external_link_intake_shadow_ativo&limit=1`, {
      headers: { apikey: ELS_SERVICE, authorization: `Bearer ${ELS_SERVICE}` },
      signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    elsCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { elsCfg = false; }
  return elsCfg;
}

function targetUrl(input: RequestInfo | URL): string {
  try { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; } catch { return ''; }
}
async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) { try { return await input.clone().text(); } catch {} }
  return '';
}
function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text' && typeof x?.text === 'string').map((x: any) => x.text).join('\n');
}
function urlsOf(messages: any[]): string[] {
  const out: string[] = [];
  const start = Math.max(0, (messages?.length || 0) - 8);
  for (let i=(messages?.length||0)-1;i>=start;i--) {
    if (messages[i]?.role !== 'user') continue;
    for (const u of extractUrlsFromText(textOf(messages[i]?.content),3)) {
      if (!out.includes(u)) out.push(u);
      if (out.length >= 3) return out;
    }
  }
  return out;
}
async function audit(evento: string, detalhe: any): Promise<void> {
  if (!ELS_URL || !ELS_SERVICE) return;
  try {
    await elsBaseFetch(`${ELS_URL}/rest/v1/sistema_logs`, {
      method:'POST',
      headers:{'content-type':'application/json',apikey:ELS_SERVICE,authorization:`Bearer ${ELS_SERVICE}`,prefer:'return=minimal'},
      body:JSON.stringify({agente_slug:'agente-noturno',funcao:'external-link-intake-shadow',versao:ELS_VERSION,nivel:'info',categoria:'skill_shadow',evento,status:'observed',mensagem:evento,detalhe:{skill_ref:'media_handling',contract_version:2,authority_granted:false,effect_class:'NONE',...detalhe}}),
      signal:AbortSignal.timeout(2000),
    });
  } catch {}
}

globalThis.fetch = async function externalLinkShadow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = targetUrl(input);
  if (!target.startsWith(ELS_ANTHROPIC) || !(await enabled())) return elsBaseFetch(input, init);
  const raw = await bodyText(input, init);
  if (!raw) return elsBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return elsBaseFetch(input, init); }
  const urls = urlsOf(Array.isArray(body?.messages) ? body.messages : []);
  if (!urls.length) return elsBaseFetch(input, init);
  const links = urls.map(telemetryForUrl).filter(Boolean);
  const toolPresent = Array.isArray(body?.tools) && body.tools.some((t:any)=>t?.name==='web_fetch'||String(t?.type||'').startsWith('web_fetch_'));
  void audit('external_link_shadow_routed',{url_count:urls.length,links,web_fetch_present_in_actual_request:toolPresent});
  const response = await elsBaseFetch(input, init);
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const observation = inspectAnthropicWebFetchResponse(await response.clone().json());
      void audit('external_link_shadow_result',{...observation,providers:[...new Set(links.map((x:any)=>x.provider))]});
    } catch {}
  } else if (ct.includes('text/event-stream')) {
    void audit('external_link_shadow_result',{status:'STREAM_NOT_INSPECTED',providers:[...new Set(links.map((x:any)=>x.provider))]});
  }
  return response;
};
