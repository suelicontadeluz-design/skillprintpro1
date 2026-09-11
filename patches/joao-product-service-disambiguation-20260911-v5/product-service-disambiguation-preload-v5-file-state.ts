declare const Deno: any;

import { pd5BuildDecision } from './file-state-core.ts';

// João Product/Service Disambiguation v5 — 11/09/2026
// Supersede pontual da v4 para DTF textil:
// - resolve aplicacao explicita em vestuario como dtf_textil;
// - antes de perguntar tamanho/copia, descobre o ESTADO DO ARQUIVO;
// - MOUNTED_FILE -> upload/preflight do proprio arquivo, sem interrogar artes internas;
// - SEPARATE_ARTWORKS -> pergunta se a Skillprint deve montar;
// - NO_ART -> pack -> Studio -> criacao;
// - reconhece "moletom" singular;
// - mistura vestuario + copo/caneca continua fora desta guarda.
//
// Esta camada NAO mede arquivo, NAO calcula preco e NAO declara print-ready.
// O laudo tecnico pertence a agente-pre-impressao-dtf e o preco ao motor canonico.

const PD5_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PD5_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const pd5BaseFetch = globalThis.fetch.bind(globalThis);
const PD5_VERSION = 'joao-product-service-disambiguation/v5-file-state';
let pd5CfgAt = 0;
let pd5Cfg = false;

function pd5Url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function pd5Body(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}

async function pd5Enabled(): Promise<boolean> {
  if (Date.now() - pd5CfgAt < 15000) return pd5Cfg;
  pd5CfgAt = Date.now();
  try {
    const r = await pd5BaseFetch(`${PD5_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_qualification_gate_ativo&limit=1`, {
      headers: { apikey: PD5_SERVICE, authorization: `Bearer ${PD5_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    pd5Cfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { pd5Cfg = false; }
  return pd5Cfg;
}

function pd5Text(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}

function pd5HasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}

function pd5Inbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || pd5HasToolResult(m?.content)) continue;
    const t = pd5Text(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}

function pd5PreviousAssistant(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const t = pd5Text(m?.content);
    if (t) return t;
  }
  return '';
}

function pd5RecentUserTexts(messages: any[]): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < 8; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || pd5HasToolResult(m?.content)) continue;
    const t = pd5Text(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.push(t);
  }
  return out.reverse();
}

async function pd5Audit(inbound: string, reason: string, state: unknown) {
  try {
    await pd5BaseFetch(`${PD5_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:PD5_SERVICE, authorization:`Bearer ${PD5_SERVICE}`, prefer:'return=minimal' },
      body: JSON.stringify({
        agente_slug:'agente-noturno', funcao:'product-service-disambiguation', versao:PD5_VERSION,
        nivel:'info', categoria:'skill_runtime', evento:'dtf_textile_file_state_routed', status:'applied',
        mensagem:'DTF textile routed by explicit file preparation state',
        detalhe:{
          inbound:inbound.slice(0,240),
          resolved_product:'dtf_textil',
          file_state:state ?? null,
          reason,
          source:'latest_inbound_explicit_or_trusted_followup',
          effect_class:'COGNITIVE_GUARD'
        }
      }),
      signal: AbortSignal.timeout(1800),
    });
  } catch {}
}

function pd5Anthropic(decision: any): Response {
  const { _pd5_reason, ...publicDecision } = decision;
  const text = JSON.stringify(publicDecision);
  return new Response(JSON.stringify({
    id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`, type:'message', role:'assistant',
    model:'cortex-product-resolution', content:[{type:'text',text}], stop_reason:'end_turn', stop_sequence:null,
    usage:{input_tokens:0,output_tokens:Math.max(1,Math.ceil(text.length/4))}
  }), { status:200, headers:{'content-type':'application/json','x-cortex-product-service-disambiguation':PD5_VERSION} });
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pd5Url(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return pd5BaseFetch(input, init);
  if (!(await pd5Enabled())) return pd5BaseFetch(input, init);

  const raw = await pd5Body(input, init);
  if (!raw) return pd5BaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return pd5BaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return pd5BaseFetch(input, init);

  const inbound = pd5Inbound(body.messages);
  if (!inbound) return pd5BaseFetch(input, init);

  const decision = pd5BuildDecision({
    inbound,
    previousAssistant: pd5PreviousAssistant(body.messages),
    recentUserTexts: pd5RecentUserTexts(body.messages),
  });
  if (!decision) return pd5BaseFetch(input, init);

  void pd5Audit(inbound, decision._pd5_reason, decision.slots?.arquivo_estado ?? null);
  return pd5Anthropic(decision);
};
