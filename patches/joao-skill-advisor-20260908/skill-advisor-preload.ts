declare const Deno: any;

// João Skill Advisor v1 — 08/09/2026
// Objetivo: fazer o runtime REAL consumir skills já provadas em shadow sem conceder
// autoridade externa às skills. O advisor só adiciona orientação estrutural ao system
// imediatamente ANTES da chamada do modelo.
//
// Fase 1:
// - qualification: chama o MESMO fn_qualification_evaluate_v2 usado pelo shadow v33.
// - closing: aplica o contrato de fechamento ao loop de tools; PIX só é tratado como
//   existente quando o tool_result contém cobrança canônica confirmada.
//
// Efeito externo da skill: ZERO. Quem continua decidindo/enviando é o agente-noturno.
// Kill switch: public.sistema_config.chave = 'joao_skill_advisor_ativo'.

const SG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const sgBaseFetch = globalThis.fetch.bind(globalThis);
const SG_VERSION = 'joao-skill-advisor/v1';
const SG_MARKER = '[CORTEX SKILL ADVISOR v1]';

let sgCfgAt = 0;
let sgCfgValue = false;

function sgUrlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function sgBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

function sgRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}

async function sgEnabled(): Promise<boolean> {
  const now = Date.now();
  if (now - sgCfgAt < 15000) return sgCfgValue;
  sgCfgAt = now;
  try {
    const r = await sgBaseFetch(`${SG_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_skill_advisor_ativo&limit=1`, {
      headers: { apikey: SG_SERVICE, authorization: `Bearer ${SG_SERVICE}` },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) { sgCfgValue = false; return false; }
    const rows = await r.json();
    sgCfgValue = Array.isArray(rows) && rows[0]?.valor_bool === true;
    return sgCfgValue;
  } catch {
    sgCfgValue = false;
    return false;
  }
}

function sgTextContent(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((x: any) => x?.type === 'text' && typeof x?.text === 'string')
    .map((x: any) => x.text)
    .join('\n')
    .trim();
}

function sgIsToolResultContent(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}

function sgCurrentInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || sgIsToolResultContent(m?.content)) continue;
    const t = sgTextContent(m?.content);
    if (!t) continue;
    // retries internos são instruções do sistema, não fala do cliente.
    if (/^\s*\[SISTEMA:/i.test(t)) continue;
    if (/Retorne APENAS o JSON/i.test(t) && /bloquead|retry|resposta/i.test(t)) continue;
    return t;
  }
  return '';
}

function sgToolResults(messages: any[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m?.content)) continue;
    for (const x of m.content) {
      if (x?.type !== 'tool_result') continue;
      if (typeof x?.content === 'string') out.push(x.content);
      else if (x?.content != null) {
        try { out.push(JSON.stringify(x.content)); } catch {}
      }
    }
  }
  return out.slice(-12);
}

function sgBalancedJsonAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from);
  if (mi < 0) return null;
  const start = text.indexOf('{', mi + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function sgQuestionLink(system: string): string {
  const tag = '[VOCÊ ACABOU DE PERGUNTAR:';
  const i = system.lastIndexOf(tag);
  if (i < 0) return '';
  const end = system.indexOf('O CLIENTE RESPONDEU:', i);
  if (end < 0) return '';
  return system.slice(i + tag.length, end).replace(/^\s*["“]|["”]\s*$/g, '').trim();
}

function sgShortInteger(text: string): number | null {
  const clean = text.trim();
  if (clean.length > 80) return null;
  // Não tratar dimensão 10x15, decimal 2,5 ou CEP de 8 dígitos como quantidade.
  if (/\d\s*[x×]\s*\d/i.test(clean) || /\d+[,.]\d+/.test(clean) || /\b\d{8}\b/.test(clean)) return null;
  const m = clean.match(/(?:^|\D)(\d{1,5})(?:\D|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sgEnrichSlots(system: string, inbound: string, slots0: any): any {
  const slots = slots0 && typeof slots0 === 'object' ? { ...slots0 } : {};
  const q = sgQuestionLink(system).toLowerCase();

  if (!(slots.quantidade > 0) && /quant|c[oó]pia|unidade|pe[cç]a|quantas|quantos/.test(q)) {
    const n = sgShortInteger(inbound);
    if (n) slots.quantidade = n;
  }

  if (!slots.cep && /\bcep\b/.test(q)) {
    const cep = inbound.replace(/\D/g, '');
    if (/^\d{8}$/.test(cep)) slots.cep = cep;
  }

  if (!slots.envio_retirada && /(retirada|retirar|envio|receber|buscar|motoboy)/.test(q)) {
    if (/\b(retir|buscar|busco|vou buscar)\w*/i.test(inbound)) slots.envio_retirada = 'retirada';
    else if (/\b(motoboy|moto)\b/i.test(inbound)) slots.envio_retirada = 'motoboy';
    else if (/\b(envio|enviar|receber|entrega|correios|transportadora)\b/i.test(inbound)) slots.envio_retirada = 'envio';
  }

  return slots;
}

async function sgQualification(snapshot: any): Promise<any | null> {
  try {
    const r = await sgBaseFetch(`${SG_URL}/rest/v1/rpc/fn_qualification_evaluate_v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SG_SERVICE, authorization: `Bearer ${SG_SERVICE}` },
      body: JSON.stringify({ p_snapshot: snapshot, p_as_of: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function sgDirectQuestion(inbound: string): boolean {
  return /\?\s*$/.test(inbound.trim()) || /\b(qual|quanto|como|quando|prazo|material|arquivo|formato|tamanho|funciona|aceita|pode|voc[eê]s)\b/i.test(inbound);
}

function sgQualificationGuidance(ev: any, inbound: string): string {
  const s = String(ev?.status ?? '');
  const direct = sgDirectQuestion(inbound);
  const prefix = `SKILL qualification=${s}. `;
  if (s === 'HOLD_PRODUCT_CONFLICT' || s === 'HOLD_TOPIC_SHIFT_REQUALIFY') {
    return prefix + 'O produto/contexto mudou ou conflitou. Priorize o pedido mais recente do cliente; NÃO reutilize preço, quantidade, frete ou autorização do produto anterior. Responda pergunta direta primeiro e requalifique somente o dado material faltante.';
  }
  if (s === 'HOLD_MISSING_PRODUCT') {
    return prefix + (direct
      ? 'Responda a pergunta direta se ela puder ser respondida sem inventar produto; depois faça no máximo UMA pergunta para identificar o produto. Não pule para CEP, pagamento ou fechamento.'
      : 'Falta produto confiável. Faça UMA pergunta curta para identificar o produto. Não pergunte CEP, pagamento ou fechamento antes disso.');
  }
  if (s === 'HOLD_MISSING_QUANTITY') {
    return prefix + (direct
      ? 'Responda primeiro a pergunta direta. Se quantidade ainda for necessária para o próximo cálculo, termine com UMA pergunta de quantidade/cópias. Não volte a produto já conhecido e não pule para CEP/pagamento.'
      : 'Produto já está conhecido e falta quantidade. Pergunte SOMENTE quantidade/cópias necessárias ao cálculo. Não repita produto e não pule para CEP/pagamento.');
  }
  if (s === 'HOLD_MISSING_CEP_FOR_SHIPPING') {
    return prefix + 'Envio já foi escolhido e falta CEP. Peça/ confirme SOMENTE o CEP e depois cote frete. Não prometa valor ou prazo de frete sem ferramenta.';
  }
  if (s === 'QUALIFIED_FOR_QUOTE_SHADOW') {
    return prefix + 'Os dados centrais para cotação estão presentes. Se o cliente pediu valor/orçamento, COTE AGORA usando a ferramenta correta; não faça nova sondagem nem repita pergunta já respondida.';
  }
  return '';
}

function sgClosingGuidance(inbound: string, toolResults: string[]): string {
  const wantsClose = /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|manda(?:r)?\s+(?:o\s+)?pix|gera(?:r)?\s+(?:o\s+)?pix|link\s+de\s+pagamento)\b/i.test(inbound);
  const joined = toolResults.join('\n');
  const pixOk = /"ok"\s*:\s*true/i.test(joined) && /pix_copia_e_cola/i.test(joined);
  const paymentFailure = /"ok"\s*:\s*false/i.test(joined)
    && /(cobran[cç]a|pix|autorizacao|autoriza[cç][aã]o|envio_sem_total_composto|modalidade_logistica_pendente|falha_ao_gerar_cobranca)/i.test(joined);

  if (pixOk) {
    return 'SKILL closing=CLOSING_READY_BY_TOOL_RESULT. Existe cobrança canônica confirmada neste turno. Envie o PIX/link EXATOS do tool_result; não invente URL/código, não diga que ainda vai gerar e não peça dado já resolvido.';
  }
  if (paymentFailure) {
    return 'SKILL closing=BLOCKED_BY_TOOL_RESULT. A cobrança NÃO foi confirmada. É PROIBIDO dizer que gerou/enviou PIX ou link. Siga agora o campo acao/erro do tool_result, pedindo apenas o dado realmente faltante ou refazendo a etapa necessária. Nunca encerre em silêncio ou em promessa futura.';
  }
  if (wantsClose) {
    return 'SKILL closing=INTENT_DETECTED. O cliente quer fechar/pagar. Neste MESMO turno execute as ferramentas necessárias. Não termine com “vou gerar/enviar o Pix”. Só afirme que existe PIX/link depois de tool_result canônico; se faltar condição, peça UMA condição específica e continue.';
  }
  return '';
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = sgUrlOf(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return sgBaseFetch(input, init);
  if (!(await sgEnabled())) return sgBaseFetch(input, init);

  const raw = await sgBodyText(input, init);
  if (!raw) return sgBaseFetch(input, init);

  let body: any;
  try { body = JSON.parse(raw); } catch { return sgBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return sgBaseFetch(input, init);

  const system = String(body.system);
  const inbound = sgCurrentInbound(body.messages);
  const toolResults = sgToolResults(body.messages);
  if (!inbound) return sgBaseFetch(input, init);

  const fichaAt = system.lastIndexOf('[FICHA:');
  const slots0 = fichaAt >= 0 ? sgBalancedJsonAfter(system, 'slots=', fichaAt) : null;
  const slots = sgEnrichSlots(system, inbound, slots0 || {});
  const snapshot = {
    source: `${SG_VERSION}:premodel`,
    slots_after: slots,
    invalidations: [],
    produto_macro: String(slots?.produto ?? ''),
    cep_disponivel: !!String(slots?.cep ?? '').replace(/\D/g, '').match(/^\d{8}$/),
    latest_inbound_message: inbound,
    source_temporality: 'PRE_MODEL_CURRENT_TURN',
  };

  const q = await sgQualification(snapshot);
  const guidance = [sgQualificationGuidance(q, inbound), sgClosingGuidance(inbound, toolResults)].filter(Boolean);
  if (!guidance.length) return sgBaseFetch(input, init);

  const skillBlock = `\n\n${SG_MARKER}\n${guidance.join('\n')}\nEstas skills são ADVISOR: não concedem autoridade externa, não autorizam preço/frete/pagamento e não substituem tool_result canônico.`;
  body.system = system + skillBlock;

  console.log(JSON.stringify({
    event: 'JOAO_SKILL_ADVISOR_APPLIED',
    version: SG_VERSION,
    qualification: q?.status ?? null,
    closing: guidance.find((x) => x.startsWith('SKILL closing='))?.split('.')[0] ?? null,
    added_chars: skillBlock.length,
    tool_results: toolResults.length,
  }));

  const rebuilt = sgRebuild(input, init, JSON.stringify(body));
  return sgBaseFetch(rebuilt[0], rebuilt[1]);
};
