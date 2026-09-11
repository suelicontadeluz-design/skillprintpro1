declare const Deno: any;

// Artwork Context v2 — extensão técnica do guard existente.
// IMPORTANTE: este módulo importa o v1 e o envolve; não cria cérebro/estado/tabela paralela.
// A única responsabilidade nova é anexar ao prompt o laudo canônico já persistido em
// arte_uploads.arquivos[].analise pelo pipeline de pré-impressão.
//
// Fail-closed:
// - sem telefone confiável ou sem upload recente => nenhuma injeção;
// - metragem só aparece como provada quando preflight-context-core confirmar todos os arquivos;
// - nunca calcula preço nem arredondamento faturável;
// - usa o MESMO kill switch do Artwork Context v1.

import '../joao-artwork-context-20260909/artwork-context-preload.ts';
import { renderPreflightContext, summarizePreflightRows } from './preflight-context-core.ts';

const PFC_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PFC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const pfcBaseFetch = globalThis.fetch.bind(globalThis); // já contém Artwork Context v1
const PFC_VERSION = 'joao-artwork-context-guard/v2-preflight';
let pfcCfgAt = 0;
let pfcCfg = false;

function pfcUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function pfcBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}

function pfcRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  const headers = new Headers(init?.headers ?? undefined);
  headers.delete('content-length');
  return [input, { ...(init || {}), headers, body }];
}

async function pfcEnabled(): Promise<boolean> {
  if (Date.now() - pfcCfgAt < 15000) return pfcCfg;
  pfcCfgAt = Date.now();
  try {
    const r = await pfcBaseFetch(`${PFC_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_artwork_context_guard_ativo&limit=1`, {
      headers: { apikey: PFC_SERVICE, authorization: `Bearer ${PFC_SERVICE}` },
      signal: AbortSignal.timeout(2200),
    });
    const rows = r.ok ? await r.json() : [];
    pfcCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { pfcCfg = false; }
  return pfcCfg;
}

function pfcText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((x: any) => x?.type === 'text' && typeof x?.text === 'string')
    .map((x: any) => x.text)
    .join('\n')
    .trim();
}

function pfcPhone(system: string, messages: any[]): string | null {
  const userTexts: string[] = [];
  for (const m of messages || []) {
    if (m?.role !== 'user') continue;
    if (Array.isArray(m?.content) && m.content.some((x: any) => x?.type === 'tool_result')) continue;
    const t = pfcText(m?.content);
    if (t && !/^\s*\[SISTEMA:/i.test(t)) userTexts.push(t);
  }

  const source = `${system}\n${userTexts.slice(-24).join('\n')}`;
  const labeled = source.match(/(?:phone|telefone|whatsapp|celular)\s*[=:"']*\s*(55\d{10,11})\b/i);
  if (labeled) return labeled[1];
  const all = [...source.matchAll(/\b(55\d{10,11})\b/g)].map((m) => m[1]);
  return all.find((x) => x !== '5511992769857') ?? all[0] ?? null;
}

type PfcContext = {
  text: string;
  fileCount: number;
  allQuoteReady: boolean;
  allPrintReady: boolean;
  totalPhysicalMeters: number | null;
  uploadId: string | null;
};

async function pfcLoad(phone: string | null): Promise<PfcContext> {
  const empty: PfcContext = { text: '', fileCount: 0, allQuoteReady: false, allPrintReady: false, totalPhysicalMeters: null, uploadId: null };
  if (!phone) return empty;
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const u = `${PFC_URL}/rest/v1/arte_uploads?select=id,created_at,arquivos&phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`;
    const r = await pfcBaseFetch(u, {
      headers: { apikey: PFC_SERVICE, authorization: `Bearer ${PFC_SERVICE}` },
      signal: AbortSignal.timeout(2800),
    });
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows) || !rows.length) return empty;
    const summary = summarizePreflightRows(rows);
    if (!summary.files.length) return empty;
    return {
      text: renderPreflightContext(summary),
      fileCount: summary.files.length,
      allQuoteReady: summary.allQuoteReady,
      allPrintReady: summary.allPrintReady,
      totalPhysicalMeters: summary.totalPhysicalMeters,
      uploadId: rows[0]?.id ? String(rows[0].id) : null,
    };
  } catch {
    return empty;
  }
}

async function pfcAudit(phone: string | null, ctx: PfcContext) {
  try {
    await pfcBaseFetch(`${PFC_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:PFC_SERVICE, authorization:`Bearer ${PFC_SERVICE}`, prefer:'return=minimal' },
      body: JSON.stringify({
        agente_slug:'agente-noturno', funcao:'artwork-context-guard', versao:PFC_VERSION,
        nivel:'info', categoria:'skill_runtime', evento:'dtf_preflight_context_injected', status:'applied',
        mensagem:'Canonical DTF preflight evidence appended to Artwork Context',
        detalhe:{
          phone_suffix: phone ? phone.slice(-4) : null,
          upload_id: ctx.uploadId,
          file_count: ctx.fileCount,
          all_quote_ready: ctx.allQuoteReady,
          all_print_ready: ctx.allPrintReady,
          total_physical_meters: ctx.totalPhysicalMeters,
          authority_granted:false,
          effect_class:'COGNITIVE_CONTEXT',
        },
      }),
      signal: AbortSignal.timeout(1600),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pfcUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return pfcBaseFetch(input, init);
  if (!(await pfcEnabled())) return pfcBaseFetch(input, init);

  const raw = await pfcBody(input, init);
  if (!raw) return pfcBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return pfcBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return pfcBaseFetch(input, init);

  const phone = pfcPhone(body.system, body.messages);
  const ctx = await pfcLoad(phone);
  if (!ctx.text) return pfcBaseFetch(input, init);

  body.system += ctx.text;
  void pfcAudit(phone, ctx);
  const [nextInput, nextInit] = pfcRebuild(input, init, JSON.stringify(body));
  return pfcBaseFetch(nextInput, nextInit);
};
