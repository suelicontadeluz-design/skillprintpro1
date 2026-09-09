declare const Deno: any;

// João Production Capability Guard v1.1 — 09/09/2026
// Corrige falsos positivos observados organicamente em 09/09:
// - menção descritiva a bordado ("espaço/barrinha/foto de bordado") não é pedido de bordado;
// - risco visual antigo não atravessa troca explícita para caneca/copo/garrafa/DTF UV;
// - "consegue confirmar" não é pergunta de capacidade visual;
// - "na frente/nas costas" prova cobertura localizada;
// - imagem antiga expira para esta guarda após poucos turnos.
// Mantém fail-closed para pedido REAL de técnica não suportada e para referência visual de roupa sem cobertura definida.

const CG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cgBaseFetch = globalThis.fetch.bind(globalThis);
const CG_VERSION = 'joao-capability-guard/v1.1';
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
function cgTechniqueMention(text: string): 'sublimacao_total'|'silk'|'bordado'|null {
  const t = cgNorm(text);
  if (/\b(sublimacao total|impressao total|full\s*print|all\s*over|camiseta inteira|camisa inteira|peca inteira)\b/.test(t)) return 'sublimacao_total';
  if (/(mangas?|laterais?).{0,30}(inteira|toda|total)|(inteira|toda|total).{0,30}(mangas?|laterais?)/.test(t)) return 'sublimacao_total';
  if (/\b(silk|serigrafia)\b/.test(t)) return 'silk';
  if (/\b(bordado|bordada|bordar)\b/.test(t)) return 'bordado';
  return null;
}
function cgDescriptiveTechniqueContext(text: string): boolean {
  const t = cgNorm(text);
  return /\b(espaco|area|barrinha|parte|local|foto|imagem|referencia|exemplo)\s+(?:do|de|da)?\s*(bordado|silk|serigrafia)\b/.test(t)
    || /\b(bordado|silk|serigrafia)\s+(?:aqui|ali|nessa|nesta)?\s*(area|parte|faixa|barrinha|espaco)\b/.test(t);
}
function cgTechniqueRequest(text: string, kind: 'sublimacao_total'|'silk'|'bordado'): boolean {
  const t = cgNorm(text);
  if (kind !== 'sublimacao_total' && cgDescriptiveTechniqueContext(t)) return false;
  if (kind === 'sublimacao_total') {
    return /\b(sublimacao total|impressao total|full\s*print|all\s*over)\b/.test(t)
      || /\b(quero|queria|preciso|gostaria|consegue|faz|fazer|orcamento|valor|quanto)\b.{0,50}\b(camiseta inteira|camisa inteira|peca inteira|mangas? inteira|laterais? inteira)\b/.test(t);
  }
  const tech = kind === 'silk' ? '(?:silk|serigrafia)' : '(?:bordado|bordada|bordar)';
  const action = '(?:faz|fazem|fazer|trabalha|trabalham|quero|queria|preciso|gostaria|consegue|conseguem|orcamento|cotar|valor|quanto)';
  return new RegExp(`\\b${action}\\b.{0,45}\\b${tech}\\b|\\b${tech}\\b.{0,30}\\b${action}\\b`, 'i').test(t);
}
function cgUnsupportedRequest(text: string): 'sublimacao_total'|'silk'|'bordado'|null {
  const kind = cgTechniqueMention(text);
  return kind && cgTechniqueRequest(text, kind) ? kind : null;
}
function cgLocalizedProof(text: string): boolean {
  const t = cgNorm(text);
  return /\b(dtf|estampa localizada|aplicacao localizada|logo no peito|logo pequeno|a3 nas costas|a4 nas costas|a3 na frente|a4 na frente|somente na frente|so na frente|apenas na frente|somente nas costas|so nas costas|apenas nas costas)\b/.test(t)
    || /\b(frente|costas|peito)\b.{0,25}\b(a3|a4|pequena|pequeno|logo|localizada)\b/.test(t)
    || /\b(?:na|nas|no)\s+(?:frente|costas?|peito)\b/.test(t);
}
function cgExplicitNonApparel(text: string): boolean {
  const t = cgNorm(text);
  return /\b(caneca|copo|garrafa|garrafinha|vidro|acrilico|mdf|madeira|metal|adesivo|dtf uv)\b/.test(t)
    && !/\b(camiseta|camisa|polo|moletom|baby look|tecido)\b/.test(t);
}
function cgVisualCapabilityQuestion(text: string): boolean {
  const t = cgNorm(text);
  return /\b(consegue|conseguem|faz|fazem|fazer|produzir)\b.{0,45}\b(essa arte|esta arte|essa foto|esta foto|esse tipo|este tipo|esse modelo|este modelo|esse trabalho|este trabalho|igual|igualzinho|igualzinha|assim|desse jeito)\b/.test(t)
    || /\b(igualzinho|igualzinha|mesmo jeito|como mandei|como enviei)\b/.test(t);
}
function cgCommercialAdvance(text: string): boolean {
  const t = cgNorm(text);
  return /\b(pix|cartao|pagar|pagamento|fechar|pedido|frete|envio|entrega|retirada|cep|sedex|pac|standard|j&t|jet|valor|quanto|prazo)\b/.test(t);
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
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'production-capability-guard', versao: CG_VERSION, nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: evento, detalhe: { ...detalhe, skill_ref: 'discovery', strategy_key: 'production_capability_validation_v1.1', effect_class: 'NONE', authority_granted: false } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}
const CG_RULE = `\n\n[SKILL: DISCOVERY / production_capability_validation_v1.1 — REGRA OBRIGATORIA]\nAntes de confirmar que a Skillprint consegue reproduzir uma referência visual em camiseta/polo/moletom, valide a técnica/cobertura quando houver dúvida REAL. Menção descritiva a uma técnica não é pedido daquela técnica. Uma referência visual antiga não deve contaminar assunto novo. Se a cobertura de roupa ainda estiver realmente indefinida, não avance para orçamento/pagamento antes de esclarecer se é localizada ou impressão total.\n[/SKILL]\n`;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = cgUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return cgBaseFetch(input, init);
  if (!(await cgEnabled())) return cgBaseFetch(input, init);
  const raw = await cgBody(input, init); if (!raw) return cgBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return cgBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return cgBaseFetch(input, init);

  const f = cgUserFacts(body.messages);
  const current = f.current;
  const userTurnsSinceImage = f.imageIndex >= 0 ? Math.max(0, f.all.length - 1 - f.imageIndex) : 999;
  const recentImage = f.hasImage && userTurnsSinceImage <= 4;
  const recentAfter = recentImage ? f.afterImage.slice(-5).join('\n') : '';
  const unsupportedCurrent = cgUnsupportedRequest(current);
  const unsupportedAfter = cgUnsupportedRequest(recentAfter);
  const localized = cgLocalizedProof(recentAfter) || cgLocalizedProof(current);
  const pending = cgPendingQuestion(cgLastAssistant(body.messages));
  const explicitNonApparel = cgExplicitNonApparel(current);
  const riskAsked = recentImage && f.afterImage.slice(-5).some(cgVisualCapabilityQuestion);
  const unresolvedVisual = recentImage && riskAsked && !localized && !unsupportedAfter;

  if (unsupportedCurrent || (pending && unsupportedAfter)) {
    const kind = unsupportedCurrent || unsupportedAfter || 'unsupported';
    void cgAudit('unsupported_technique_blocked', { kind, inbound: current.slice(0, 240), intent_proven: true });
    return cgAnthropic(cgUnsupportedMessage(kind));
  }
  if (explicitNonApparel) {
    void cgAudit('capability_context_bypassed', { inbound: current.slice(0, 240), reason: 'EXPLICIT_NON_APPAREL_CONTEXT' });
    return cgBaseFetch(input, init);
  }
  if (pending && !localized) {
    void cgAudit('capability_ambiguity_blocked', { inbound: current.slice(0, 240), pending: true, recent_image: recentImage });
    return cgAnthropic(cgQuestion());
  }
  if (unresolvedVisual && (cgVisualCapabilityQuestion(current) || cgCommercialAdvance(current))) {
    void cgAudit('capability_ambiguity_blocked', { inbound: current.slice(0, 240), pending: false, historical_visual_risk: true, recent_image: recentImage });
    return cgAnthropic(cgQuestion());
  }
  if ((recentImage && (localized || riskAsked)) || pending) {
    body.system += CG_RULE;
    const nextInit: RequestInit = { ...(init ?? {}), body: JSON.stringify(body) };
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    headers.delete('content-length'); nextInit.headers = headers;
    void cgAudit('capability_rule_injected', { inbound: current.slice(0, 240), localized_proof: localized, recent_image: recentImage });
    return cgBaseFetch(input, nextInit);
  }
  return cgBaseFetch(input, init);
};
