declare const Deno: any;

// João Halftone -> Arte Final router v1 — 17/09/2026
// Scope:
// - Detect explicit/ambiguous requests for halftone/art-final image treatment.
// - Ambiguous direction: ask one confirmation question, no task.
// - Confirmed request: create idempotent INTERNAL human task with no ai_decision_id/script,
//   so the legacy crm_task->WhatsApp trigger fails closed and does not queue outbound.
// - Mixed request (halftone + DTF textile meter price): preserve the art-final request and
//   answer from canonical dtf_precos_faixa. Never invent a halftone service price.
// - Dry-run safety: all writes use the wrapped fetch chain; joao dry-run effect-zero blocks them.
// - No phone-specific or phrase-specific hardcode.

const HAF_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const HAF_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const hafBaseFetch = globalThis.fetch.bind(globalThis);
const HAF_VERSION = 'joao-halftone-art-final-router/v1.2';
const HAF_CONFIG_KEY = 'joao_halftone_art_final_router_ativo';
const HAF_STAGE = 'arte_final_halftone';
let hafCfgAt = 0;
let hafCfg = false;

type HafClassification = 'NONE' | 'CLARIFY' | 'CONFIRMED' | 'PROVIDER' | 'OPEN_TASK_PRICE_ONLY';
type HafLead = { lead_id: string | null; nome: string | null; phone: string | null };
type HafTaskResult = { ok: boolean; action: string | null; task_id: string | null; blockedDryRun: boolean };

function hafUrl(input: RequestInfo | URL): string { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; }
async function hafBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) { try { return await input.clone().text(); } catch {} }
  return '';
}
function hafText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text' && typeof x?.text === 'string').map((x: any) => String(x.text)).join('\n').trim();
}
function hafHasToolResult(content: any): boolean { return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result'); }
function hafLatestInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || hafHasToolResult(m?.content)) continue;
    const t = hafText(m.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function hafPreviousAssistant(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]; if (m?.role !== 'assistant') continue;
    const t = hafText(m.content); if (t) return t;
  }
  return '';
}
function hafNorm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function hafMentionsHalftone(text: string): boolean {
  const t = hafNorm(text);
  return /\bhalftone\b|\bmeio[- ]?tom\b|\breticul(?:a|ar|ado|acao)\b/.test(t);
}
function hafMentionsArtService(text: string): boolean {
  const t = hafNorm(text);
  return hafMentionsHalftone(t) || /\barte\s+final\b|\btratamento\s+de\s+arte\b|\btrat(?:ar|amento)\s+(?:a\s+)?(?:imagem|arte)\b/.test(t);
}
function hafRequesterExplicit(text: string): boolean {
  const t = hafNorm(text);
  if (!hafMentionsArtService(t)) return false;
  return /\b(?:quero|preciso|gostaria|necessito|pode|podem|consegue|conseguem|faz|fazem|fazer|trate|tratar|ajuste|ajustar|corrija|corrigir|melhore|melhorar)\b.{0,120}\b(?:halftone|arte final|tratamento de arte|imagem|arte)\b/.test(t)
    || /\b(?:halftone|arte final|tratamento de arte)\b.{0,120}\b(?:pra mim|para mim|nas minhas|nas imagens|na minha arte|da minha arte)\b/.test(t)
    || /\b(?:contratar|contrato|orcamento|orcar|cotacao|cotar)\b.{0,100}\b(?:halftone|arte final|tratamento de arte)\b/.test(t);
}
function hafOfferishOrDirectionAmbiguous(text: string): boolean {
  const t = hafNorm(text);
  return /\bse\s+precisarem\b|\bestou\s+a\s+disposicao\b|\boferec(?:o|emos|er)\b|\bpresto\s+servico\b|\btrabalho\s+com\b|\bvender\s+o\s+servico\b/.test(t);
}
function hafPreviousAskedConfirmation(previous: string): boolean {
  const t = hafNorm(previous);
  return /arte-finalista|arte final/.test(t) && hafMentionsHalftone(t) && /correto|certo|confirma|quer que/.test(t);
}
function hafPreviousAskedDirection(previous: string): boolean {
  const t = hafNorm(previous);
  return hafMentionsHalftone(t) && /contratar\s+a\s+skillprint/.test(t) && /oferecendo\s+(?:esse|o)\s+servico/.test(t);
}
function hafHiringReply(text: string): boolean {
  const t = hafNorm(text);
  return /\b(?:quero|vou|gostaria|preciso)\s+(?:contratar|que\s+voc[eê]s\s+(?:facam|façam|tratem|ajustem))\b/.test(t)
    || /\b(?:e|é)\s+(?:pra|para)\s+voc[eê]s\s+(?:fazer|tratar|ajustar)\b/.test(t)
    || /\bskillprint\b.{0,40}\b(?:fazer|tratar|ajustar)\b/.test(t);
}
function hafProviderReply(text: string): boolean {
  const t = hafNorm(text);
  return /\b(?:estou|to)\s+oferecendo\b|\bquero\s+oferecer\b|\b(?:eu\s+)?presto\s+(?:esse\s+)?servico\b|\bsou\s+(?:prestador|fornecedor)\b/.test(t);
}
function hafAffirmative(text: string): boolean {
  const t = hafNorm(text);
  return /^(?:sim|isso|isso mesmo|correto|certo|exato|pode|podem|podemos|vamos|quero|e isso|é isso|fechado|combinado)\b/.test(t)
    || /\bpodemos\s+fazer\b/.test(t);
}
function hafDtfMeterPriceInquiry(text: string): boolean {
  const t = hafNorm(text);
  if (/\bdtf\s*uv\b/.test(t)) return false;
  const hasDtf = /\bdtf\b/.test(t);
  const hasMeter = /\bmetr(?:o|os)\b|\bpor\s+metro\b/.test(t);
  const hasPrice = /\bquanto\b|\bpreco\b|\bvalor\b|\bcusta\b|\bsai\b/.test(t);
  return hasDtf && hasMeter && hasPrice;
}
function hafPriceInquiryAnyDtf(text: string): boolean {
  const t = hafNorm(text);
  if (/\bdtf\s*uv\b/.test(t)) return false;
  return /\bdtf\b/.test(t) && /\bquanto\b|\bpreco\b|\bvalor\b|\bcusta\b|\bsai\b/.test(t);
}
function hafOuterRequestContext(): { phone?: string | null; chatName?: string | null; dryRun?: boolean } {
  try {
    return (globalThis as any).__HAF_REQUEST_CONTEXT_V1__?.getStore?.() ?? {};
  } catch { return {}; }
}
function hafPhone(system: string, messages: any[]): string | null {
  const userTexts: string[] = [];
  for (const m of messages || []) {
    if (m?.role !== 'user' || hafHasToolResult(m?.content)) continue;
    const t = hafText(m?.content);
    if (t && !/^\s*\[SISTEMA:/i.test(t)) userTexts.push(t);
  }
  const source = `${system}\n${userTexts.slice(-24).join('\n')}`;
  const labeled = source.match(/(?:phone|telefone|whatsapp|celular)\s*[=:"']*\s*(55\d{10,11})\b/i);
  if (labeled) return labeled[1];
  const all = [...source.matchAll(/\b(55\d{10,11})\b/g)].map((m) => m[1]);
  return all.find((x) => x !== '5511992769857') ?? all[0] ?? null;
}
async function hafEnabled(): Promise<boolean> {
  if (Date.now() - hafCfgAt < 15000) return hafCfg;
  hafCfgAt = Date.now();
  try {
    const r = await hafBaseFetch(`${HAF_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.${encodeURIComponent(HAF_CONFIG_KEY)}&limit=1`, {
      headers: { apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}` }, signal: AbortSignal.timeout(1800),
    });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    hafCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { hafCfg = false; }
  return hafCfg;
}
async function hafLoadLead(phone: string | null): Promise<HafLead> {
  if (!phone) return { lead_id: null, nome: null, phone: null };
  try {
    const u = `${HAF_URL}/rest/v1/leads_marketing?select=lead_id,fn,fullname,ph&ph=eq.${encodeURIComponent(phone)}&limit=1`;
    const r = await hafBaseFetch(u, { headers: { apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}` }, signal: AbortSignal.timeout(1800) });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const row = Array.isArray(rows) ? rows[0] : null;
    const nome = String(row?.fn ?? row?.fullname ?? '').trim() || null;
    return { lead_id: row?.lead_id ? String(row.lead_id) : null, nome, phone };
  } catch { return { lead_id: null, nome: null, phone }; }
}
async function hafOpenTask(phone: string | null): Promise<boolean> {
  if (!phone) return false;
  try {
    const u = `${HAF_URL}/rest/v1/crm_tasks?select=id&phone=eq.${encodeURIComponent(phone)}&etapa_funil=eq.${encodeURIComponent(HAF_STAGE)}&status=in.(pendente,em_andamento)&limit=1`;
    const r = await hafBaseFetch(u, { headers: { apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}` }, signal: AbortSignal.timeout(1800) });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}
async function hafCreateTask(lead: HafLead, inbound: string): Promise<HafTaskResult> {
  if (!lead.phone) return { ok: false, action: null, task_id: null, blockedDryRun: false };
  const orientation = [
    'Cliente solicitou tratamento de imagens/arte em halftone.',
    `Mensagem atual: ${inbound.slice(0, 500)}`,
    'Ação: Arte Final deve avaliar/tratar o material em halftone e devolver para aprovação do cliente antes de qualquer impressão.',
    'Não inventar preço do serviço de Arte Final; confirmar valor humano/canônico se necessário.',
  ].join(' ');
  try {
    const r = await hafBaseFetch(`${HAF_URL}/rest/v1/rpc/create_human_task_safe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}` },
      body: JSON.stringify({
        p_phone: lead.phone, p_lead_id: lead.lead_id, p_nome_cliente: lead.nome ?? 'Cliente',
        p_etapa_funil: HAF_STAGE, p_urgencia: 'media', p_titulo: 'Arte Final — tratamento em halftone',
        p_orientacao: orientation, p_script: null, p_due_horas: 4,
        p_origem: 'joao_halftone_art_final_router', p_decision_id: null,
      }),
      signal: AbortSignal.timeout(2500),
    });
    const body = await r.json().catch(() => ({}));
    const dryBlocked = r.status === 409 && String(body?.error ?? '').includes('dry_run_effect_zero_write_blocked');
    return {
      ok: r.ok && ['created', 'updated'].includes(String(body?.action ?? '')),
      action: body?.action ? String(body.action) : null,
      task_id: body?.task_id ? String(body.task_id) : null,
      blockedDryRun: dryBlocked,
    };
  } catch { return { ok: false, action: null, task_id: null, blockedDryRun: false }; }
}
type HafPriceRow = { metros_min: number; metros_max: number | null; preco_por_metro: number };
async function hafDtfTextilePrices(): Promise<HafPriceRow[]> {
  try {
    const u = `${HAF_URL}/rest/v1/dtf_precos_faixa?select=metros_min,metros_max,preco_por_metro&produto=eq.dtf_textil&order=metros_min.asc`;
    const r = await hafBaseFetch(u, { headers: { apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}` }, signal: AbortSignal.timeout(1800) });
    if (!r.ok) return [];
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    return rows.map((x: any) => ({
      metros_min: Number(x.metros_min),
      metros_max: x.metros_max == null ? null : Number(x.metros_max),
      preco_por_metro: Number(x.preco_por_metro),
    })).filter((x: HafPriceRow) => x.metros_min > 0 && x.preco_por_metro > 0);
  } catch { return []; }
}
function hafBRL(n: number): string { return `R$${n.toFixed(2).replace('.', ',')}`; }
function hafRenderPriceTable(rows: HafPriceRow[]): string | null {
  if (!rows.length) return null;
  const parts = rows.map((r) => {
    const min = Number.isInteger(r.metros_min) ? String(r.metros_min) : String(r.metros_min).replace('.', ',');
    const max = r.metros_max == null ? null : (Number.isInteger(r.metros_max) ? String(r.metros_max) : String(r.metros_max).replace('.', ','));
    const faixa = max == null ? `${min}+ m` : `${min} a ${max} m`;
    return `${faixa}: ${hafBRL(r.preco_por_metro)}/m`;
  });
  return parts.join(' | ');
}
function hafClassify(inbound: string, previousAssistant: string, taskOpen: boolean): HafClassification {
  const mentions = hafMentionsArtService(inbound);
  if (hafPreviousAskedDirection(previousAssistant)) {
    if (hafHiringReply(inbound)) return 'CONFIRMED';
    if (hafProviderReply(inbound)) return 'PROVIDER';
  }
  const affirmativeContext = hafPreviousAskedConfirmation(previousAssistant) && hafAffirmative(inbound);
  if (affirmativeContext) return 'CONFIRMED';
  if (taskOpen && hafPriceInquiryAnyDtf(inbound)) return 'OPEN_TASK_PRICE_ONLY';
  if (!mentions) return 'NONE';
  if (hafRequesterExplicit(inbound) && !hafOfferishOrDirectionAmbiguous(inbound)) return 'CONFIRMED';
  return 'CLARIFY';
}
function hafDecision(message: string, extra: Record<string, any> = {}): Response {
  const decision = { responde: true, mensagem: message, tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', ...extra };
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, type: 'message', role: 'assistant',
    model: 'cortex-halftone-art-final-router', content: [{ type: 'text', text }],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-cortex-halftone-art-final': HAF_VERSION } });
}
async function hafAudit(evento: string, detail: any) {
  try {
    await hafBaseFetch(`${HAF_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: HAF_SERVICE, authorization: `Bearer ${HAF_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno', funcao: 'halftone-art-final-router', versao: HAF_VERSION,
        nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: evento,
        detalhe: { ...detail, authority_scope: 'cognitive_art_final_handoff', external_effect_allowed: false },
      }),
      signal: AbortSignal.timeout(1600),
    });
  } catch {}
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = hafUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return hafBaseFetch(input, init);
  if (!(await hafEnabled())) return hafBaseFetch(input, init);

  const raw = await hafBody(input, init);
  if (!raw) return hafBaseFetch(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return hafBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return hafBaseFetch(input, init);

  const inbound = hafLatestInbound(body.messages);
  if (!inbound) return hafBaseFetch(input, init);
  const previous = hafPreviousAssistant(body.messages);
  const outer = hafOuterRequestContext();
  const phone = hafPhone(body.system, body.messages) ?? (outer.phone ? String(outer.phone).replace(/\D/g, '') : null);
  const taskOpen = await hafOpenTask(phone);
  const classification = hafClassify(inbound, previous, taskOpen);
  if (classification === 'NONE') return hafBaseFetch(input, init);

  const priceInquiry = hafDtfMeterPriceInquiry(inbound) || hafPriceInquiryAnyDtf(inbound);
  const rows = priceInquiry ? await hafDtfTextilePrices() : [];
  const table = hafRenderPriceTable(rows);

  if (classification === 'PROVIDER') {
    void hafAudit('halftone_provider_direction_confirmed', {
      phone_suffix: phone?.slice(-4) ?? null, inbound: inbound.slice(0, 240),
      task_open: taskOpen, effect_class: 'NONE',
    });
    return hafDecision('Entendi — você está oferecendo o serviço de halftone para a Skillprint, não pedindo tratamento de Arte Final. Vou manter isso separado de um pedido de DTF.');
  }

  if (classification === 'CLARIFY') {
    const suffix = priceInquiry && table ? ` E sobre o DTF têxtil por metro, a tabela atual é: ${table}.` : '';
    void hafAudit('halftone_intent_direction_clarification', {
      phone_suffix: phone?.slice(-4) ?? null, inbound: inbound.slice(0, 240),
      price_inquiry: priceInquiry, task_open: taskOpen, effect_class: 'NONE',
    });
    return hafDecision(`Só pra eu não inverter: você quer contratar a Skillprint para tratar suas imagens em halftone, ou está oferecendo esse serviço para a Skillprint?${suffix}`);
  }

  if (classification === 'OPEN_TASK_PRICE_ONLY') {
    if (table) {
      void hafAudit('halftone_open_task_dtf_price_answered', {
        phone_suffix: phone?.slice(-4) ?? null, inbound: inbound.slice(0, 240),
        task_open: true, effect_class: 'READ_ONLY_CANONICAL_PRICE',
      });
      return hafDecision(`O tratamento em halftone continua com a Arte Final. Sobre o DTF têxtil por metro, a tabela atual é: ${table}. O valor do tratamento de Arte Final é separado e eu não vou inventar esse preço.`);
    }
    return hafBaseFetch(input, init);
  }

  const lead = await hafLoadLead(phone);
  const task = await hafCreateTask(lead, inbound);
  const taskEffective = task.ok || task.blockedDryRun;
  const taskText = task.ok
    ? 'Perfeito — encaminhei suas imagens para a Arte Final fazer o tratamento em halftone. O ajuste deve voltar para sua aprovação antes de qualquer impressão.'
    : task.blockedDryRun
      ? 'Perfeito — em operação normal essa solicitação é encaminhada para a Arte Final fazer o tratamento em halftone, com aprovação antes de qualquer impressão.'
      : 'Entendi que você quer o tratamento em halftone. Não vou misturar isso com o DTF nem inventar valor de Arte Final; essa solicitação precisa seguir para a equipe de Arte Final.';
  const priceText = priceInquiry && table ? ` Sobre o DTF têxtil por metro, a tabela atual é: ${table}.` : '';

  void hafAudit(task.ok ? 'halftone_art_final_task_upserted' : task.blockedDryRun ? 'halftone_art_final_task_dry_run_blocked' : 'halftone_art_final_task_failed', {
    phone_suffix: phone?.slice(-4) ?? null, lead_id: lead.lead_id, inbound: inbound.slice(0, 240),
    task_action: task.action, task_id: task.task_id, task_effective: taskEffective,
    dry_run_blocked: task.blockedDryRun, price_inquiry: priceInquiry,
    effect_class: task.ok ? 'INTERNAL_HUMAN_TASK' : task.blockedDryRun ? 'DRY_RUN_EFFECT_ZERO' : 'FAIL_CLOSED',
  });
  return hafDecision(`${taskText}${priceText}`);
};

export const __test = { hafNorm, hafMentionsHalftone, hafMentionsArtService, hafRequesterExplicit, hafOfferishOrDirectionAmbiguous, hafPreviousAskedConfirmation, hafPreviousAskedDirection, hafHiringReply, hafProviderReply, hafAffirmative, hafDtfMeterPriceInquiry, hafPriceInquiryAnyDtf, hafClassify, hafRenderPriceTable, hafOuterRequestContext };
