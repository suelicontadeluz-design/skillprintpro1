declare const Deno: any;

// João Artwork Context Guard v1 — 09/09/2026
// Runtime enforcement for artwork_intake + media_handling + discovery.
// Goals:
// 1) inspect the recent attachment bundle instead of trusting filenames/customer wording;
// 2) distinguish ZIPs containing separate image files from mounted print sheets;
// 3) recover already-known product/size/CEP facts from conversation history;
// 4) never repeat a generic question when the answer is already present;
// 5) every clarification about an artwork/order starts by paraphrasing what is understood.
// No authority over price, freight, payment, or external commercial effects.
// Kill switch: public.sistema_config.chave = 'joao_artwork_context_guard_ativo'.

const AC_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const AC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const acBaseFetch = globalThis.fetch.bind(globalThis);
const AC_VERSION = 'joao-artwork-context-guard/v1';
let acCfgAt = 0;
let acCfg = false;

function acUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function acBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function acRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  const headers = new Headers(init?.headers ?? undefined); headers.delete('content-length');
  return [input, { ...(init || {}), headers, body }];
}
async function acEnabled(): Promise<boolean> {
  if (Date.now() - acCfgAt < 15000) return acCfg;
  acCfgAt = Date.now();
  try {
    const r = await acBaseFetch(`${AC_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_artwork_context_guard_ativo&limit=1`, {
      headers: { apikey: AC_SERVICE, authorization: `Bearer ${AC_SERVICE}` },
      signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    acCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { acCfg = false; }
  return acCfg;
}
function acText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text' && typeof x?.text === 'string').map((x: any) => x.text).join('\n').trim();
}
function acHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function acUserTexts(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || acHasToolResult(m?.content)) continue;
    const t = acText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.push(t);
  }
  return out.slice(-24);
}
function acInbound(messages: any[]): string {
  const xs = acUserTexts(messages);
  return xs.length ? xs[xs.length - 1] : '';
}
function acJsonAfter(text: string, marker: string, from = 0): any | null {
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
function acSlots(system: string): any {
  const f = system.lastIndexOf('[FICHA:');
  const s = f >= 0 ? acJsonAfter(system, 'slots=', f) : null;
  return s && typeof s === 'object' && !Array.isArray(s) ? { ...s } : {};
}
function acNorm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function acPhone(system: string, texts: string[], slots: any): string | null {
  const direct = [slots?.phone, slots?.telefone, slots?.whatsapp, slots?.lead_phone, slots?.celular]
    .map((x: any) => String(x ?? '').replace(/\D/g, '')).find((x: string) => /^55\d{10,11}$/.test(x));
  if (direct) return direct;
  const source = `${system}\n${texts.join('\n')}`;
  const labeled = source.match(/(?:phone|telefone|whatsapp|celular)\s*[=:"']*\s*(55\d{10,11})\b/i);
  if (labeled) return labeled[1];
  const all = [...source.matchAll(/\b(55\d{10,11})\b/g)].map(x => x[1]);
  return all.find(x => x !== '5511992769857') ?? all[0] ?? null;
}

type AckKnown = { product: string | null; dims: string[]; cep: string | null; hasA3: boolean; hasA4: boolean; hasFourUnits: boolean; fullText: string };
function acKnown(texts: string[], slots: any): AckKnown {
  const fullText = texts.join('\n');
  const n = acNorm(fullText);
  let product: string | null = null;
  if (/dtf\s*uv|adesiv.*uv/.test(n) || acNorm(String(slots?.produto ?? '')) === 'dtf_uv') product = 'dtf_uv';
  else if (/dtf\s*(?:textil|t[eê]xtil)/.test(n)) product = 'dtf_textil';
  const dims: string[] = [];
  for (const m of fullText.matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:cm)?\b/gi)) {
    const d = `${m[1].replace(',', '.')}x${m[2].replace(',', '.')}cm`;
    if (!dims.includes(d)) dims.push(d);
  }
  const ceps = [...fullText.matchAll(/\b(\d{5})-?(\d{3})\b/g)].map(m => `${m[1]}${m[2]}`);
  const cep = String(slots?.cep ?? '').replace(/\D/g, '').match(/^\d{8}$/)?.[0] ?? ceps[ceps.length - 1] ?? null;
  return {
    product,
    dims: dims.slice(0, 6),
    cep,
    hasA3: /\b(?:folha\s*)?a3\b/i.test(fullText),
    hasA4: /\b(?:folha\s*)?a4\b/i.test(fullText),
    hasFourUnits: /\b4\s*(?:unidades?|c[oó]pias?|adesivos?)\b/i.test(fullText),
    fullText,
  };
}

type ZipInspection = { status: string; fileCount: number; imageCount: number; names: string[] };
async function acInspectZip(url: string): Promise<ZipInspection> {
  try {
    const r = await acBaseFetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { status: 'ZIP_FETCH_FAILED', fileCount: 0, imageCount: 0, names: [] };
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 25_000_000) return { status: 'ZIP_TOO_LARGE', fileCount: 0, imageCount: 0, names: [] };
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
      if (name && !name.endsWith('/')) names.push(name);
      i = end + extraLen + commentLen;
    }
    const files = names.filter(Boolean);
    const imageCount = files.filter(x => /\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(x)).length;
    const sheetNamed = files.some(x => /(?:folha|sheet|a3|a4|montad|pronto[_ -]?impress|gang|metro)/i.test(x));
    const status = files.length > 1 && imageCount === files.length && !sheetNamed ? 'ZIP_SEPARATE_IMAGES' : files.length ? 'ZIP_CONTENTS_KNOWN' : 'ZIP_EMPTY_OR_UNPARSED';
    return { status, fileCount: files.length, imageCount, names: files.slice(0, 12) };
  } catch {
    return { status: 'ZIP_INSPECTION_ERROR', fileCount: 0, imageCount: 0, names: [] };
  }
}

type MediaSummary = { zipSeparateImages: ZipInspection | null; zipLabel: string | null; standaloneImages: number; pdfs: { name: string; pages: number }[]; recentCount: number };
async function acMedia(phone: string | null): Promise<MediaSummary> {
  const empty: MediaSummary = { zipSeparateImages: null, zipLabel: null, standaloneImages: 0, pdfs: [], recentCount: 0 };
  if (!phone) return empty;
  try {
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const u = `${AC_URL}/rest/v1/whatsapp_message_log?select=message_id,created_at,payload&phone=eq.${encodeURIComponent(phone)}&direction=eq.inbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=80`;
    const r = await acBaseFetch(u, { headers: { apikey: AC_SERVICE, authorization: `Bearer ${AC_SERVICE}` }, signal: AbortSignal.timeout(3500) });
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows)) return empty;
    const replies = new Map<string, string>();
    for (const row of rows) {
      const p = row?.payload ?? {};
      const ref = String(p?.referenceMessageId ?? '');
      const txt = String(p?.text?.message ?? '').trim();
      if (ref && txt) replies.set(ref, txt);
    }
    let standaloneImages = 0;
    const pdfs: { name: string; pages: number }[] = [];
    let zipSeparateImages: ZipInspection | null = null;
    let zipLabel: string | null = null;
    for (const row of rows) {
      const p = row?.payload ?? {};
      if (p?.image?.imageUrl) {
        const w = Number(p.image.width || 0), h = Number(p.image.height || 0);
        const ratio = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 0;
        const sheetLike = ratio > 1.32 && ratio < 1.50;
        if (!sheetLike) standaloneImages++;
      }
      const d = p?.document;
      if (!d?.documentUrl) continue;
      const name = String(d.fileName ?? d.title ?? 'arquivo');
      const mime = String(d.mimeType ?? '');
      if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) pdfs.push({ name, pages: Number(d.pageCount || 0) });
      if ((/zip/i.test(mime) || /\.zip$/i.test(name)) && !zipSeparateImages) {
        const z = await acInspectZip(String(d.documentUrl));
        if (z.status === 'ZIP_SEPARATE_IMAGES') {
          zipSeparateImages = z;
          zipLabel = replies.get(String(p?.messageId ?? row?.message_id ?? '')) ?? null;
        }
      }
    }
    return { zipSeparateImages, zipLabel, standaloneImages, pdfs: pdfs.slice(-8), recentCount: rows.length };
  } catch { return empty; }
}

function acParaphrase(k: AckKnown, m: MediaSummary): string {
  const parts: string[] = [];
  if (k.product === 'dtf_uv') parts.push('é DTF UV');
  else if (k.product === 'dtf_textil') parts.push('é DTF têxtil');
  if (k.dims.length) parts.push(`você informou ${k.dims.join(' e ')}`);
  if (k.hasFourUnits) parts.push('há item(ns) com 4 unidades já informadas');
  if (k.hasA3) parts.push('também há material A3');
  if (m.zipSeparateImages) {
    const label = m.zipLabel && /6\s*[x×]\s*6/i.test(m.zipLabel) ? 'dos 6x6' : 'recebido';
    parts.push(`o ZIP ${label} contém ${m.zipSeparateImages.imageCount} imagem(ns) separada(s), não uma folha montada`);
  }
  if (m.standaloneImages > 0) parts.push(`recebi ${m.standaloneImages} imagem(ns) individual(is) fora de proporção de folha A3/A4`);
  if (k.cep) parts.push(`o CEP ${k.cep.slice(0,5)}-${k.cep.slice(5)} já está informado`);
  if (!parts.length) return '';
  return `Entendi: ${parts.join('; ')}.`;
}
function acSpecificQuestion(k: AckKnown, m: MediaSummary): string | null {
  if (k.product === 'dtf_uv' && m.zipSeparateImages) {
    const dim = k.dims.find(x => /^6(?:\.0)?x6(?:\.0)?cm$/i.test(x));
    const subject = dim ? 'Para as artes de 6x6 que vieram separadas no ZIP' : 'Para as artes que vieram separadas no ZIP';
    return `${subject}, considero 1 unidade de cada arquivo ou alguma arte precisa repetir?`;
  }
  return null;
}
function acRecoverSlots(slots0: any, k: AckKnown): any {
  const slots = slots0 && typeof slots0 === 'object' ? { ...slots0 } : {};
  if (!slots.produto && k.product) slots.produto = k.product;
  if (!slots.cep && k.cep) slots.cep = k.cep;
  return slots;
}
function acRewriteMessage(original: string, k: AckKnown, m: MediaSummary): { message: string; changed: boolean; reason: string } {
  const p = acParaphrase(k, m);
  if (!original || !p) return { message: original, changed: false, reason: 'NO_PARAPHRASE_CONTEXT' };
  const n = acNorm(original);
  const asksProduct = /\bqual produto\b|\bproduto que voce quer\b/.test(n);
  const asksQty = /\bquant(?:os|as)|\bqual quantidade\b|\bquantidade voce precisa\b/.test(n);
  const asksCep = /\bcep\b/.test(n) && /\bpassa|\binforma|\bqual\b|\bme diz\b/.test(n);
  const specific = acSpecificQuestion(k, m);
  if ((asksProduct && k.product) || (asksQty && specific) || (asksCep && k.cep)) {
    if (specific && (asksProduct || asksQty)) return { message: `${p} ${specific}`, changed: true, reason: asksProduct ? 'PRODUCT_ALREADY_KNOWN' : 'GENERIC_QUANTITY_REPLACED' };
    if (asksCep && k.cep) return { message: `${p} Vou considerar esse CEP no frete; não precisa me passar de novo.`, changed: true, reason: 'CEP_ALREADY_KNOWN' };
    if (asksProduct && k.product) return { message: `${p} Vou seguir com esse produto e conferir somente o que ainda faltar no arquivo.`, changed: true, reason: 'PRODUCT_ALREADY_KNOWN_NO_OTHER_GAP' };
  }
  if (original.includes('?') && !/^(?:entendi|perfeito|certo|beleza|recebi|pelo que entendi)\b/i.test(original.trim())) {
    return { message: `${p} ${original}`, changed: true, reason: 'PARAPHRASE_BEFORE_CLARIFICATION' };
  }
  return { message: original, changed: false, reason: 'ALREADY_PARAPHRASED_OR_NO_QUESTION' };
}
async function acAudit(evento: string, detail: any) {
  try {
    await acBaseFetch(`${AC_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: AC_SERVICE, authorization: `Bearer ${AC_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'artwork-context-guard', versao: AC_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: evento,
        detalhe: { ...detail, skill_refs: ['artwork_intake','media_handling','discovery'], authority_granted: false, effect_class: 'COGNITIVE_GUARD' },
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

const AC_RULE = `\n\n[CORTEX ARTWORK CONTEXT — REGRA OBRIGATORIA]\nAntes de perguntar qualquer dado de um pedido com arte/anexo: (1) consolide o que o cliente já informou no histórico; (2) diferencie arquivo montado de imagens/arquivos soltos; (3) nunca repita pergunta sobre produto, medida, quantidade ou CEP já respondidos; (4) se faltar algo de verdade, comece parafraseando o entendimento e faça UMA pergunta específica sobre a lacuna; (5) nome de arquivo e frase do cliente não provam montagem — a estrutura real da mídia prevalece.\n[/CORTEX ARTWORK CONTEXT]`;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = acUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return acBaseFetch(input, init);
  if (!(await acEnabled())) return acBaseFetch(input, init);

  const raw = await acBody(input, init);
  if (!raw) return acBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return acBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return acBaseFetch(input, init);

  const texts = acUserTexts(body.messages);
  const inbound = acInbound(body.messages);
  if (!inbound) return acBaseFetch(input, init);
  const slots = acSlots(body.system);
  const known = acKnown(texts, slots);
  const relevant = known.product === 'dtf_uv' || /\b(?:arquivo|arte|anexo|adesiv|a3|a4|zip|pdf)\b/i.test(known.fullText);
  if (!relevant) return acBaseFetch(input, init);

  const phone = acPhone(body.system, texts, slots);
  const media = await acMedia(phone);
  const para = acParaphrase(known, media);
  if (para) body.system += `${AC_RULE}\nContexto consolidado desta conversa: ${para}`;

  const [nextInput, nextInit] = acRebuild(input, init, JSON.stringify(body));
  const response = await acBaseFetch(nextInput, nextInit);
  if (!response.ok) return response;

  try {
    const payload = await response.clone().json();
    if (!Array.isArray(payload?.content) || payload.content.length !== 1 || payload.content[0]?.type !== 'text' || typeof payload.content[0]?.text !== 'string') return response;
    let decision: any; try { decision = JSON.parse(payload.content[0].text); } catch { return response; }
    if (!decision || typeof decision !== 'object' || typeof decision.mensagem !== 'string') return response;

    const slotsBefore = JSON.stringify(decision.slots ?? {});
    decision.slots = acRecoverSlots(decision.slots ?? slots, known);
    const slotsChanged = JSON.stringify(decision.slots ?? {}) !== slotsBefore;
    const rw = acRewriteMessage(String(decision.mensagem), known, media);
    if (!rw.changed && !slotsChanged) return response;
    decision.mensagem = rw.message;
    payload.content[0].text = JSON.stringify(decision);
    const headers = new Headers(response.headers);
    headers.set('x-cortex-artwork-context', AC_VERSION);
    void acAudit('artwork_context_guard_applied', {
      reason: rw.reason, phone, inbound: inbound.slice(0, 240), paraphrase: para,
      zip_status: media.zipSeparateImages?.status ?? null,
      zip_image_count: media.zipSeparateImages?.imageCount ?? 0,
      standalone_images: media.standaloneImages,
      recovered_product: known.product,
      recovered_cep: !!known.cep,
    });
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
};
