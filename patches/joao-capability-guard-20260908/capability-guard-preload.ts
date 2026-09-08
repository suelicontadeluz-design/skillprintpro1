declare const Deno: any;

// João Production Capability Guard v1 — 08/09/2026
// Evita confirmar/cotar técnica de personalização não oferecida quando o pedido depende
// de referência visual. Fotos não são prova persistente de técnica: até o cliente confirmar
// cobertura localizada vs impressão total, o orçamento e o avanço para pagamento ficam
// bloqueados. Sublimação total, silk/serigrafia e bordado falham fechado.

const CG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cgBaseFetch = globalThis.fetch.bind(globalThis);
const CG_VERSION = 'joao-capability-guard/v1';
let cgCfgAt = 0;
let cgCfg = false;

function cgUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function cgBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function cgEnabled(): Promise<boolean> {
  if (Date.now() - cgCfgAt < 15000) return cgCfg;
  cgCfgAt = Date.now();
  try {
    const r = await cgBaseFetch(`${CG_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_capability_guard_ativo&limit=1`, {
      headers: { apikey: CG_SERVICE, authorization: `Bearer ${CG_SERVICE}` }, signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    cgCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { cgCfg = false; }
  return cgCfg;
}
function cgNorm(v: string): string {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function cgText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function cgHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function cgHasImage(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'image');
}
function cgLastAssistant(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      const t = cgText(messages[i]?.content); if (t) return t;
    }
  }
  return '';
}
function cgUserFacts(messages: any[]): { all: string[]; current: string; imageIndex: number; afterImage: string[]; hasImage: boolean } {
  const all: string[] = [];
  let current = '';
  let imageIndex = -1;
  let hasImage = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== 'user' || cgHasToolResult(m?.content)) continue;
    const t = cgText(m?.content);
    if (t && !/^\s*\[SISTEMA:/i.test(t)) { all.push(t); current = t; }
    const marker = /\(foto enviada pelo cliente\)|\[imagem\]|imagem enviada|foto enviada/i.test(t || '');
    if (cgHasImage(m?.content) || marker) { imageIndex = all.length - 1; hasImage = true; }
  }
  const afterImage = imageIndex >= 0 ? all.slice(imageIndex) : [];
  return { all, current, imageIndex, afterImage, hasImage };
}
function cgExplicitUnsupported(text: string): 'sublimacao_total'|'silk'|'bordado'|null {
  const t = cgNorm(text);
  if (/\b(sublimacao|sublimacao total|estampa total|impressao total|full\s*print|all\s*over|camiseta inteira|camisa inteira|peca inteira)\b/.test(t)) return 'sublimacao_total';
  if (/\b(silk|serigrafia)\b/.test(t)) return 'silk';
  if (/\bbordad[oa]\b|\bbordado\b/.test(t)) return 'bordado';
  if (/(mangas?|laterais?).{0,30}(inteira|toda|total)|(inteira|toda|total).{0,30}(mangas?|laterais?)/.test(t)) return 'sublimacao_total';
  return null;
}
function cgLocalizedProof(text: string): boolean {
  const t = cgNorm(text);
  return /\b(dtf|estampa localizada|aplicacao localizada|logo no peito|logo pequeno|a3 nas costas|a4 nas costas|a3 na frente|a4 na frente|somente na frente|so na frente|apenas na frente|somente nas costas|so nas costas|apenas nas costas)\b/.test(t)
    || /\b(frente|costas|peito)\b.{0,25}\b(a3|a4|pequena|pequeno|logo|localizada)\b/.test(t);
}
function cgVisualCapabilityQuestion(text: string): boolean {
  const t = cgNorm(text);
  return /\b(consegue|conseguem|faz|fazem|fazer|produzir|igual|igualzinho|igualzinha|mesmo jeito|essa arte|esta arte|essa foto|esta foto|esse tipo|este tipo|esse modelo|este modelo|como mandei|como enviei)\b/.test(t);
}
function cgCommercialAdvance(text: string): boolean {
  const t = cgNorm(text);
  return /\b(pix|cartao|pagar|pagamento|fechar|pedido|frete|envio|entrega|retirada|cep|sedex|pac|standard|j&t|jet|valor|quanto|prazo|vamos|sim|isso)\b/.test(t);
}
function cgPendingQuestion(text: string): boolean {
  const t = cgNorm(text);
  return /confirmar a tecnica/.test(t) && /estampa localizada/.test(t) && /(impressao total|camiseta inteira)/.test(t);
}
function cgQuestion(): string {
  return 'Só pra eu confirmar a técnica antes de orçar: essa arte é uma estampa localizada na frente/costas ou é impressão total, pegando a camiseta inteira, mangas e laterais?';
}
function cgUnsupportedMessage(kind: string): string {
  if (kind === 'sublimacao_total') return 'Esse tipo de personalização é sublimação total e nós não fazemos essa técnica. Trabalhamos com DTF para estampas localizadas em tecido.';
  if (kind === 'silk') return 'Silk/serigrafia nós não fazemos. Trabalhamos com DTF para estampas localizadas em tecido.';
  if (kind === 'bordado') return 'Bordado nós não fazemos. Trabalhamos com DTF para estampas localizadas em tecido.';
  return 'Essa técnica não faz parte do que produzimos. Trabalhamos com DTF para estampas localizadas em tecido.';
}
function cgAnthropic(message: string): Response {
  const decision = { responde: true, mensagem: message, tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots: {} };
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    type: 'message', role: 'assistant', model: 'cortex-capability-guard',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-cortex-capability-guard': CG_VERSION } });
}
async function cgAudit(evento: string, detalhe: any) {
  try {
    await cgBaseFetch(`${CG_URL}/rest/v1/sistema_logs`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: CG_SERVICE, authorization: `Bearer ${CG_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'production-capability-guard', versao: CG_VERSION, nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: evento, detalhe: { ...detalhe, skill_ref: 'discovery', strategy_key: 'production_capability_validation_v1', effect_class: 'NONE', authority_granted: false } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}
const CG_RULE = `\n\n[SKILL: DISCOVERY / production_capability_validation_v1 — REGRA OBRIGATORIA]\nAntes de confirmar que a Skillprint consegue reproduzir uma referência visual em camiseta/polo/moletom, valide a técnica/cobertura. Sublimação total, silk/serigrafia e bordado NÃO são produzidos. DTF é para estampas localizadas. Uma foto anterior não é prova persistente da técnica. Se a cobertura não estiver explicitamente confirmada como localizada, NÃO chame orcar_camisetas, NÃO informe preço, NÃO avance para frete/pagamento e NÃO diga "consigo sim" ou equivalente; faça uma pergunta curta para distinguir estampa localizada de impressão total.\n[/SKILL]\n`;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = cgUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return cgBaseFetch(input, init);
  if (!(await cgEnabled())) return cgBaseFetch(input, init);
  const raw = await cgBody(input, init); if (!raw) return cgBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return cgBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return cgBaseFetch(input, init);

  const f = cgUserFacts(body.messages);
  const current = f.current;
  const after = f.afterImage.join('\n');
  const unsupportedCurrent = cgExplicitUnsupported(current);
  const unsupportedAfter = cgExplicitUnsupported(after);
  const localized = cgLocalizedProof(after);
  const pending = cgPendingQuestion(cgLastAssistant(body.messages));
  const riskAsked = f.hasImage && f.afterImage.some(cgVisualCapabilityQuestion);
  const unresolvedVisual = f.hasImage && riskAsked && !localized && !unsupportedAfter;

  if (unsupportedCurrent || (pending && unsupportedAfter)) {
    const kind = unsupportedCurrent || unsupportedAfter || 'unsupported';
    void cgAudit('unsupported_technique_blocked', { kind, inbound: current.slice(0, 240) });
    return cgAnthropic(cgUnsupportedMessage(kind));
  }
  if (pending && !localized) {
    void cgAudit('capability_ambiguity_blocked', { inbound: current.slice(0, 240), pending: true });
    return cgAnthropic(cgQuestion());
  }
  if (unresolvedVisual && (cgVisualCapabilityQuestion(current) || cgCommercialAdvance(current))) {
    void cgAudit('capability_ambiguity_blocked', { inbound: current.slice(0, 240), pending: false, historical_visual_risk: true });
    return cgAnthropic(cgQuestion());
  }
  if ((f.hasImage && (localized || riskAsked)) || pending) {
    body.system += CG_RULE;
    const nextInit: RequestInit = { ...(init ?? {}), body: JSON.stringify(body) };
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    headers.delete('content-length'); nextInit.headers = headers;
    void cgAudit('capability_rule_injected', { inbound: current.slice(0, 240), localized_proof: localized });
    return cgBaseFetch(input, nextInit);
  }
  return cgBaseFetch(input, init);
};
