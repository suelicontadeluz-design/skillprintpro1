// Replay-only recurring DTF order prehandler — 2026-09-13
// Purpose: prove the intended flow BEFORE production changes:
// ERP delivered history -> new upload confirmation -> frozen canonical yield/quote -> PDF next action.
// No production write, no ERP write and no message send happens here.

declare const Deno: any;

const RO_BASE_FETCH = globalThis.fetch.bind(globalThis);
const RO_NATIVE_SERVE = Deno.serve.bind(Deno);
const RO_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const RO_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RO_VERSION = 'repeat_order_file_confirm/replay-v1';

function roJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-cortex-skill': RO_VERSION,
    },
  });
}

function digits(v: unknown) { return String(v ?? '').replace(/\D/g, ''); }
function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? `R$ ${n.toFixed(2).replace('.', ',')}` : '';
}
function meters(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return `${n.toFixed(1).replace('.', ',')} m`;
}
function affirmative(v: unknown) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /^(sim\b|confirmo\b|correto\b|esta correto\b|ta correto\b|pode seguir\b|isso\b|isso mesmo\b)/.test(s);
}
function firstName(v: unknown) {
  return String(v ?? '').trim().split(/\s+/)[0] || 'cliente';
}
function greeting() {
  try {
    const h = Number(new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
    }).format(new Date()));
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  } catch { return 'Olá'; }
}

async function getRows(path: string): Promise<any[]> {
  if (!RO_URL || !RO_SERVICE) return [];
  try {
    const r = await RO_BASE_FETCH(`${RO_URL}/rest/v1/${path}`, {
      headers: { apikey: RO_SERVICE, authorization: `Bearer ${RO_SERVICE}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

async function repeatDecision(phone: string, inbound: string): Promise<any | null> {
  if (!affirmative(inbound) || !/^\d{10,13}$/.test(phone)) return null;

  const ph = encodeURIComponent(`eq.${phone}`);
  const [stateRows, uploadRows, outRows] = await Promise.all([
    getRows(`agente_noturno_estado?select=phone,etapa,slots,updated_at&phone=${ph}&limit=1`),
    getRows(`arte_uploads?select=id,created_at,arquivos,total_arquivos,phone&phone=${ph}&order=created_at.desc&limit=1`),
    getRows(`fact_conversations?select=message_text,direction,created_at,timestamp,source&phone=${ph}&direction=eq.outbound&order=created_at.desc&limit=8`),
  ]);

  const st = stateRows[0];
  const slots = st?.slots && typeof st.slots === 'object' ? st.slots : {};
  if (String(slots?.produto ?? '').toLowerCase() !== 'dtf_textil') return null;
  if (slots?.cliente_recorrente_erp !== true) return null;
  if (String(slots?.erp_ultimo_pedido_status ?? '').toLowerCase() !== 'entregue') return null;

  const upload = uploadRows[0];
  if (!upload || String(upload.id ?? '') !== String(slots?.arquivo_upload_id ?? '')) return null;
  const file = Array.isArray(upload?.arquivos) ? upload.arquivos[0] : null;
  const analysis = file?.analise ?? {};
  const w = Number(analysis?.width_cm);
  const h = Number(analysis?.height_cm);
  const copies = Number(analysis?.copies ?? file?.quantidade ?? slots?.copias);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(copies) || copies <= 0) return null;

  const sw = Number(slots?.largura_cm), sh = Number(slots?.altura_cm);
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || Math.abs(sw - w) > 0.02 || Math.abs(sh - h) > 0.02) return null;

  const recentConfirm = outRows.some((r: any) => {
    const t = String(r?.message_text ?? '');
    return /confirma pra gente se entendemos corretamente/i.test(t) && /dayane lima/i.test(t);
  });
  if (!recentConfirm) return null;

  const m = Number(slots?.metros_para_lancar_erp);
  const unit = Number(slots?.preco_por_metro);
  const total = Number(slots?.valor_orcamento);
  if (!Number.isFinite(m) || !Number.isFinite(unit) || !Number.isFinite(total) || m <= 0 || total <= 0) return null;
  if (String(slots?.rendimento_fonte ?? '') !== 'fn_dtf_rendimento_por_arte_v1') return null;
  if (!String(slots?.orcamento_fonte ?? '').startsWith('ERP:')) return null;
  if (String(slots?.proxima_acao ?? '') !== 'gerar_e_enviar_pdf_orcamento') return null;

  const nome = firstName(slots?.cliente_primeiro_nome || slots?.cliente_nome_erp);
  const g = greeting();
  const msg = `${g}, ${nome}! Tudo bem com você? Conferi o seu arquivo novo: ele ficou em ${meters(m)} de DTF têxtil. O orçamento ficou em ${money(total)}. Já vou te enviar o PDF do orçamento por aqui.`;

  return {
    ok: true,
    dry_run: true,
    tema: 'dtf_metro',
    etapa: 'orcamento_pronto_erp',
    fallback: false,
    mudou_produto: false,
    objecao_preco: false,
    lost_canonico: null,
    resposta: msg,
    slots: {
      produto: 'dtf_textil',
      arte: String(file?.nome_original ?? file?.nome ?? slots?.arte ?? 'arquivo_enviado'),
      quantidade: copies,
      metros: m,
      preco_por_metro: unit,
      valor_total: total,
      cliente_recorrente_erp: true,
      ultimo_pedido_status: 'entregue',
      pdf_proxima_acao: 'gerar_e_enviar',
    },
    tools: [
      { name: 'fn_joao_pedidos_status_v1', mode: 'frozen_replay_proof', result: { venda_status: 'entregue' } },
      { name: 'fn_dtf_rendimento_por_arte_v1', mode: 'frozen_replay_proof', result: { largura_cm: w, altura_cm: h, copias: copies, metros_para_lancar_erp: m } },
      { name: 'fn_joao_lancar_orcamento_produto_canonico_v2', mode: 'hypothetical_write_blocked', result: { preco_por_metro: unit, valor_total: total } },
      { name: 'joao-proposta-pdf-enviar', mode: 'hypothetical_send_blocked', result: { would_generate_pdf: true, would_send_whatsapp: true } },
    ],
    repeat_order_replay: {
      version: RO_VERSION,
      deterministic: true,
      upload_id: upload.id,
      production_write: false,
      whatsapp_send: false,
    },
  };
}

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== 'function') throw new TypeError('Deno.serve handler missing');

  args[handlerIndex] = async (req: Request, info: any) => {
    if (req.method === 'POST') {
      try {
        const b = await req.clone().json().catch(() => null);
        const phone = digits(b?.phone ?? b?.telefone ?? '');
        const inbound = String(b?.mensagem ?? b?.message ?? '');
        const decision = await repeatDecision(phone, inbound);
        if (decision) return roJson(decision, 200);
      } catch {}
    }
    return handler(req, info);
  };

  return RO_NATIVE_SERVE(...args);
};
