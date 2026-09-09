declare const Deno: any;

// João Artwork Media Refinement v1 — 09/09/2026
// Refinement layer after artwork-context-preload.
// Resolves the customer phone from the exact current inbound when it is absent from the model payload,
// inspects the real WhatsApp attachment batch (including ZIP central directory), and replaces generic
// repeated questions with one paraphrased, specific clarification.
// No price/freight/payment authority.

const AM_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const AM_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const amBaseFetch = globalThis.fetch.bind(globalThis);
const AM_VERSION = 'joao-artwork-media-refinement/v1';
let amCfgAt = 0;
let amCfg = false;

function amUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function amBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function amRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  const headers = new Headers(init?.headers ?? undefined); headers.delete('content-length');
  return [input, { ...(init || {}), headers, body }];
}
async function amEnabled(): Promise<boolean> {
  if (Date.now() - amCfgAt < 15000) return amCfg;
  amCfgAt = Date.now();
  try {
    const r = await amBaseFetch(`${AM_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_artwork_context_guard_ativo&limit=1`, {
      headers: { apikey: AM_SERVICE, authorization: `Bearer ${AM_SERVICE}` }, signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    amCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { amCfg = false; }
  return amCfg;
}
function amText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text' && typeof x?.text === 'string').map((x: any) => x.text).join('\n').trim();
}
function amHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function amUserTexts(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || amHasToolResult(m?.content)) continue;
    const t = amText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.push(t);
  }
  return out.slice(-30);
}
function amNorm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function amJsonAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  const start = text.indexOf('{', mi + marker.length); if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function amSlots(system: string): any {
  const f = system.lastIndexOf('[FICHA:');
  const s = f >= 0 ? amJsonAfter(system, 'slots=', f) : null;
  return s && typeof s === 'object' && !Array.isArray(s) ? { ...s } : {};
}
async function amResolvePhone(inbound: string, system: string, slots: any): Promise<string | null> {
  const direct = [slots?.phone, slots?.telefone, slots?.whatsapp, slots?.lead_phone, slots?.celular]
    .map((x: any) => String(x ?? '').replace(/\D/g, '')).find((x: string) => /^55\d{10,11}$/.test(x));
  if (direct) return direct;
  const labeled = system.match(/(?:phone|telefone|whatsapp|celular)\s*[=:"']*\s*(55\d{10,11})\b/i);
  if (labeled) return labeled[1];
  try {
    const since = new Date(Date.now() - 2 * 3600_000).toISOString();
    const u = `${AM_URL}/rest/v1/whatsapp_message_log?select=phone,created_at,payload&direction=eq.inbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=120`;
    const r = await amBaseFetch(u, { headers: { apikey: AM_SERVICE, authorization: `Bearer ${AM_SERVICE}` }, signal: AbortSignal.timeout(3000) });
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows)) return null;
    const target = amNorm(inbound);
    for (const row of rows) {
      const t = String(row?.payload?.text?.message ?? '');
      if (t && amNorm(t) === target) {
        const p = String(row?.phone ?? row?.payload?.phone ?? '').replace(/\D/g, '');
        if (/^55\d{10,11}$/.test(p)) return p;
      }
    }
  } catch {}
  return null;
}

type ZipInfo = { status: string; fileCount: number; imageCount: number; names: string[] };
async function amInspectZip(url: string): Promise<ZipInfo> {
  try {
    const r = await amBaseFetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { status: 'ZIP_FETCH_FAILED', fileCount: 0, imageCount: 0, names: [] };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > 25_000_000) return { status: 'ZIP_TOO_LARGE', fileCount: 0, imageCount: 0, names: [] };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    const names: string[] = [];
    for (let i = 0; i + 46 <= bytes.length;) {
      if (dv.getUint32(i, true) !== 0x02014b50) { i++; continue; }
      const nameLen = dv.getUint16(i + 28, true);
      const extraLen = dv.getUint16(i + 30, true);
      const commentLen = dv.getUint16(i + 32, true);
      const end = i + 46 + nameLen;
      if (end > bytes.length) break;
      const name = dec.decode(bytes.subarray(i + 46, end));
      if (name && !name.endsWith('/') && !/^__MACOSX\//i.test(name)) names.push(name);
      i = end + extraLen + commentLen;
    }
    const files = names.filter(Boolean);
    const imageCount = files.filter(x => /\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(x)).length;
    const sheetNamed = files.some(x => /(?:folha|sheet|a3|a4|montad|pronto[_ -]?impress|gang|metro)/i.test(x));
    const separate = files.length > 1 && imageCount === files.length && !sheetNamed;
    return { status: separate ? 'ZIP_SEPARATE_IMAGES' : files.length ? 'ZIP_CONTENTS_KNOWN' : 'ZIP_EMPTY_OR_UNPARSED', fileCount: files.length, imageCount, names: files.slice(0, 16) };
  } catch {
    return { status: 'ZIP_INSPECTION_ERROR', fileCount: 0, imageCount: 0, names: [] };
  }
}

type Media = { zip: ZipInfo | null; zipLabel: string | null; standaloneImages: number; pdfCount: number };
async function amMedia(phone: string): Promise<Media> {
  const out: Media = { zip: null, zipLabel: null, standaloneImages: 0, pdfCount: 0 };
  try {
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const u = `${AM_URL}/rest/v1/whatsapp_message_log?select=message_id,created_at,payload&phone=eq.${encodeURIComponent(phone)}&direction=eq.inbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=100`;
    const r = await amBaseFetch(u, { headers: { apikey: AM_SERVICE, authorization: `Bearer ${AM_SERVICE}` }, signal: AbortSignal.timeout(3500) });
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows)) return out;
    const replies = new Map<string, string>();
    for (const row of rows) {
      const p = row?.payload ?? {};
      const ref = String(p?.referenceMessageId ?? '');
      const txt = String(p?.text?.message ?? '').trim();
      if (ref && txt) replies.set(ref, txt);
    }
    for (const row of rows) {
      const p = row?.payload ?? {};
      if (p?.image?.imageUrl) {
        const w = Number(p.image.width || 0), h = Number(p.image.height || 0);
        const ratio = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 0;
        const paperLike = ratio >= 1.35 && ratio <= 1.48;
        if (!paperLike) out.standaloneImages++;
      }
      const d = p?.document;
      if (!d?.documentUrl) continue;
      const name = String(d.fileName ?? d.title ?? 'arquivo');
      const mime = String(d.mimeType ?? '');
      if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) out.pdfCount++;
      if (!out.zip && (/zip/i.test(mime) || /\.zip$/i.test(name))) {
        const z = await amInspectZip(String(d.documentUrl));
        if (z.status === 'ZIP_SEPARATE_IMAGES') {
          out.zip = z;
          out.zipLabel = replies.get(String(p?.messageId ?? row?.message_id ?? '')) ?? null;
        }
      }
    }
  } catch {}
  return out;
}

type Known = { product: string | null; dims: string[]; cep: string | null; four: boolean; a3: boolean };
function amKnown(texts: string[], slots: any): Known {
  const full = texts.join('\n');
  const n = amNorm(full);
  let product: string | null = null;
  if (/dtf\s*uv|adesiv.*uv/.test(n) || amNorm(String(slots?.produto ?? '')) === 'dtf_uv') product = 'dtf_uv';
  else if (/dtf\s*(?:textil|textil)/.test(n)) product = 'dtf_textil';
  const dims: string[] = [];
  for (const m of full.matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:cm)?\b/gi)) {
    const d = `${m[1].replace(',', '.')}x${m[2].replace(',', '.')}cm`;
    if (!dims.includes(d)) dims.push(d);
  }
  const ceps = [...full.matchAll(/\b(\d{5})-?(\d{3})\b/g)].map(m => `${m[1]}${m[2]}`);
  const slotCep = String(slots?.cep ?? '').replace(/\D/g, '');
  return { product, dims: dims.slice(0,6), cep: /^\d{8}$/.test(slotCep) ? slotCep : ceps[ceps.length - 1] ?? null, four: /\b4\s*(?:unidades?|copias?|c[oó]pias?|adesivos?)\b/i.test(full), a3: /\b(?:folha\s*)?a3\b/i.test(full) };
}
function amParaphrase(k: Known, m: Media): string {
  const p: string[] = [];
  if (k.product === 'dtf_uv') p.push('é DTF UV');
  if (k.dims.length) p.push(`você informou ${k.dims.join(' e ')}`);
  if (k.four) p.push('há item(ns) com 4 unidades já informadas');
  if (k.a3 || m.pdfCount > 0) p.push('também há arquivos em PDF/A3 no lote');
  if (m.zip) {
    const label = m.zipLabel && /6\s*[x×]\s*6/i.test(m.zipLabel) ? 'dos 6x6' : 'recebido';
    p.push(`o ZIP ${label} tem ${m.zip.imageCount} imagem(ns) separada(s), portanto não é uma folha montada`);
  }
  if (m.standaloneImages) p.push(`há ${m.standaloneImages} imagem(ns) solta(s) no lote`);
  if (k.cep) p.push(`o CEP ${k.cep.slice(0,5)}-${k.cep.slice(5)} já está informado`);
  return p.length ? `Entendi: ${p.join('; ')}.` : '';
}
function amRewrite(message: string, k: Known, m: Media): { message: string; changed: boolean; reason: string } {
  const para = amParaphrase(k, m);
  if (!para) return { message, changed: false, reason: 'NO_CONTEXT' };
  const n = amNorm(message);
  const asksProduct = /\bqual produto\b|\bproduto que voce quer\b/.test(n);
  const asksQty = /\bquantos adesivos\b|\bquantas copias\b|\bqual quantidade\b|\bquantidade voce precisa\b/.test(n);
  const asksCep = /\bcep\b/.test(n) && /\bpassa|\binforma|\bqual\b|\bme diz\b/.test(n);
  if (m.zip && k.product === 'dtf_uv' && (asksQty || asksProduct)) {
    const six = k.dims.some(x => /^6(?:\.0)?x6(?:\.0)?cm$/i.test(x));
    const subject = six ? 'Para as artes de 6x6 que vieram separadas no ZIP' : 'Para as artes que vieram separadas no ZIP';
    return { message: `${para} ${subject}, considero 1 unidade de cada arquivo ou alguma arte precisa repetir?`, changed: true, reason: 'GENERIC_QUESTION_REPLACED_WITH_MEDIA_GAP' };
  }
  if (asksProduct && k.product) return { message: `${para} Vou seguir com esse produto e conferir só o que realmente faltar.`, changed: true, reason: 'PRODUCT_ALREADY_KNOWN' };
  if (asksCep && k.cep) return { message: `${para} Vou reutilizar esse CEP no frete; não precisa informar de novo.`, changed: true, reason: 'CEP_ALREADY_KNOWN' };
  if (message.includes('?') && !/^(?:entendi|perfeito|certo|beleza|recebi|pelo que entendi)\b/i.test(message.trim())) return { message: `${para} ${message}`, changed: true, reason: 'PARAPHRASE_BEFORE_CLARIFICATION' };
  return { message, changed: false, reason: 'NO_REWRITE_NEEDED' };
}
async function amAudit(detail: any) {
  try {
    await amBaseFetch(`${AM_URL}/rest/v1/sistema_logs`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: AM_SERVICE, authorization: `Bearer ${AM_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'artwork-media-refinement', versao: AM_VERSION, nivel: 'info', categoria: 'skill_runtime', evento: 'artwork_media_refinement_applied', status: 'applied', mensagem: 'artwork_media_refinement_applied', detalhe: { ...detail, skill_refs: ['artwork_intake','media_handling','discovery'], authority_granted: false, effect_class: 'COGNITIVE_GUARD' } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = amUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return amBaseFetch(input, init);
  if (!(await amEnabled())) return amBaseFetch(input, init);
  const raw = await amBody(input, init); if (!raw) return amBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return amBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return amBaseFetch(input, init);
  const texts = amUserTexts(body.messages);
  const inbound = texts[texts.length - 1] ?? '';
  if (!inbound) return amBaseFetch(input, init);
  const slots = amSlots(body.system);
  const known = amKnown(texts, slots);
  const relevant = known.product === 'dtf_uv' || /\b(?:arquivo|arte|anexo|adesiv|a3|a4|zip|pdf)\b/i.test(texts.join('\n'));
  if (!relevant) return amBaseFetch(input, init);
  const phone = await amResolvePhone(inbound, body.system, slots);
  const media = phone ? await amMedia(phone) : { zip: null, zipLabel: null, standaloneImages: 0, pdfCount: 0 };
  const [nextInput, nextInit] = amRebuild(input, init, JSON.stringify(body));
  const response = await amBaseFetch(nextInput, nextInit);
  if (!response.ok) return response;
  try {
    const payload = await response.clone().json();
    if (!Array.isArray(payload?.content) || payload.content.length !== 1 || payload.content[0]?.type !== 'text' || typeof payload.content[0]?.text !== 'string') return response;
    let decision: any; try { decision = JSON.parse(payload.content[0].text); } catch { return response; }
    if (!decision || typeof decision?.mensagem !== 'string') return response;
    const rw = amRewrite(String(decision.mensagem), known, media);
    if (!rw.changed) return response;
    decision.mensagem = rw.message;
    payload.content[0].text = JSON.stringify(decision);
    const headers = new Headers(response.headers); headers.set('x-cortex-artwork-media-refinement', AM_VERSION);
    void amAudit({ phone, inbound: inbound.slice(0,240), reason: rw.reason, zip_status: media.zip?.status ?? null, zip_image_count: media.zip?.imageCount ?? 0, zip_names: media.zip?.names ?? [], zip_label: media.zipLabel, standalone_images: media.standaloneImages, pdf_count: media.pdfCount, paraphrase: amParaphrase(known, media) });
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  } catch { return response; }
};
