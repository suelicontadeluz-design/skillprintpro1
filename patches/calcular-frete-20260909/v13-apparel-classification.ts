import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// calcular-frete v13 — 09/09/2026
// Corrige incidente real em que Camisa Polo Personalizada foi tratada como "1 metro de DTF".
// Agora:
// 1) vestuário reconhecido usa quantidade de peças do recibo canônico do ERP;
// 2) polo tem perfil logístico explícito e estimado, separado de DTF;
// 3) produto desconhecido NÃO cai mais no fallback de metros: falha fechado.

const FRENET_TOKEN = Deno.env.get('TOKEN_FRENET')!;
const CEP_ORIGEM = '06813230';
const FRENET_URL = 'http://api.frenet.com.br/shipping/quote';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_CRON_SECRET_SHA256 = '6aa7bec30538035f4fe659bdb8e12bb8966bc51703702eda43c6f3b3e94b2f8c';
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CAIXA_ATE_40M = { comprimento: 60, largura: 13, altura: 13 };
const CAIXA_ACIMA_40M = { comprimento: 60, largura: 26, altura: 13 };
const PESO_BASE_ATE_10M_G = 1000;
const PESO_POR_METRO_EXCEDENTE_G = 100;
const JANELA_EVIDENCIA_MS = 24 * 60 * 60 * 1000;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function limparCep(cep: string): string { return (cep || '').replace(/\D/g, ''); }
function limparPhone(phone: string): string { return (phone || '').replace(/\D/g, ''); }
function norm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function extrairCeps(texto: string): string[] {
  const out = new Set<string>();
  for (const m of String(texto || '').matchAll(/\b(\d{5})-?(\d{3})\b/g)) out.add(m[1] + m[2]);
  return [...out];
}
function parecePlaceholder(cep: string): boolean {
  return /^(\d)\1{7}$/.test(cep) || cep === '12345678' || cep === '87654321';
}
function textoInbound(body: any): string {
  return String(body?.text?.message || body?.image?.caption || body?.mensagem || body?.message || '').trim();
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function autorizado(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${SUPABASE_SERVICE_KEY}`) return true;
  const cronSecret = req.headers.get('x-cron-secret') || '';
  if (!cronSecret) return false;
  try { return (await sha256Hex(cronSecret)) === INTERNAL_CRON_SECRET_SHA256; }
  catch { return false; }
}

async function houvePerguntaCepOuFrete(phone: string, desdeIso: string): Promise<boolean> {
  const sufixo = limparPhone(phone).slice(-8);
  if (!sufixo) return false;
  const { data, error } = await sb.from('fact_conversations')
    .select('message_text,timestamp').like('phone', `%${sufixo}`).eq('direction', 'outbound')
    .gte('timestamp', desdeIso).order('timestamp', { ascending: false }).limit(40);
  if (error) return false;
  return (data || []).some((r: any) => /\bcep\b|\bfrete\b|\bsedex\b|\bpac\b|j\s*&\s*t/i.test(String(r.message_text || '')));
}

async function cepTemEvidenciaCliente(cep: string): Promise<{ ok: boolean; phone: string | null; fonte: string | null; observado_em?: string | null; motivo?: string }> {
  const desdeIso = new Date(Date.now() - JANELA_EVIDENCIA_MS).toISOString();

  const { data: raws, error: rawErr } = await sb.from('inbound_fora_horario')
    .select('phone,body,created_at').gte('created_at', desdeIso).order('created_at', { ascending: false }).limit(1000);
  if (!rawErr) {
    for (const r of (raws || [])) {
      const t = textoInbound(r.body);
      if (!extrairCeps(t).includes(cep)) continue;
      const falouCep = /\bcep\b/i.test(t);
      const houveContexto = falouCep || await houvePerguntaCepOuFrete(String(r.phone || ''), desdeIso);
      if (houveContexto) return { ok: true, phone: String(r.phone || ''), fonte: falouCep ? 'inbound_com_palavra_cep' : 'inbound_apos_pergunta_cep_frete', observado_em: r.created_at };
    }
  }

  const { data: inbs, error: inbErr } = await sb.from('fact_conversations')
    .select('phone,message_text,timestamp').eq('direction', 'inbound').gte('timestamp', desdeIso)
    .order('timestamp', { ascending: false }).limit(1000);
  if (!inbErr) {
    for (const r of (inbs || [])) {
      const t = String(r.message_text || '');
      if (!extrairCeps(t).includes(cep)) continue;
      const falouCep = /\bcep\b/i.test(t);
      const houveContexto = falouCep || await houvePerguntaCepOuFrete(String(r.phone || ''), desdeIso);
      if (houveContexto) return { ok: true, phone: String(r.phone || ''), fonte: falouCep ? 'fact_inbound_com_palavra_cep' : 'fact_inbound_apos_pergunta_cep_frete', observado_em: r.timestamp };
    }
  }

  if (rawErr && inbErr) return { ok: false, phone: null, fonte: null, motivo: 'fontes_de_evidencia_indisponiveis' };
  return { ok: false, phone: null, fonte: null, motivo: 'cep_nao_informado_pelo_cliente' };
}

async function resolverLead(phone: string): Promise<string | null> {
  const p = limparPhone(phone);
  const { data: estado } = await sb.from('agente_noturno_estado')
    .select('lead_id,updated_at').eq('phone', p).not('lead_id', 'is', null).order('updated_at', { ascending: false }).limit(1);
  if (estado?.[0]?.lead_id) return String(estado[0].lead_id);

  const desdeIso = new Date(Date.now() - JANELA_EVIDENCIA_MS).toISOString();
  const { data: facts } = await sb.from('fact_conversations')
    .select('lead_id').like('phone', `%${p.slice(-8)}`).not('lead_id', 'is', null).gte('timestamp', desdeIso).limit(500);
  const ids = [...new Set((facts || []).map((r: any) => String(r.lead_id)).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

async function buscarVendaCanonica(leadId: string): Promise<any | null> {
  const desdeIso = new Date(Date.now() - JANELA_EVIDENCIA_MS).toISOString();
  const { data, error } = await sb.from('joao_erp_proposal_receipts_v1')
    .select('receipt_id,proposta_id,numero_proposta,proposal_total_brl,total_com_frete_brl,created_at,canonical,snapshot')
    .eq('lead_id', leadId).eq('canonical', true).gte('created_at', desdeIso)
    .order('created_at', { ascending: false }).limit(20);
  if (error) return null;
  const row = (data || []).find((r: any) => Number(r.proposal_total_brl) > 0);
  if (!row) return null;
  return {
    valor_venda_brl: Number(row.proposal_total_brl),
    receipt_id: row.receipt_id,
    proposta_id: row.proposta_id,
    numero_proposta: row.numero_proposta,
    receipt_created_at: row.created_at,
    items: Array.isArray(row.snapshot?.items) ? row.snapshot.items : []
  };
}

type GarmentProfile = {
  kind: string;
  pesoPorPecaKg: number;
  sku: string;
  category: string;
  regraPeso: string;
  estimado: boolean;
};

function garmentProfile(item: any): GarmentProfile | null {
  const d = norm(item?.descricao || '');
  if (/camisa polo|polo personalizada|\bpolo\b/.test(d)) {
    return { kind: 'polo_personalizada', pesoPorPecaKg: 0.25, sku: 'POLO-PERSONALIZADA', category: 'Vestuario', regraPeso: '250g_por_peca_estimativa_polo_v1', estimado: true };
  }
  if (/camiseta basica|camiseta 100% algodao|\bcamiseta\b/.test(d)) {
    return { kind: 'camiseta_personalizada', pesoPorPecaKg: 0.18, sku: 'CAMISETA', category: 'Vestuario', regraPeso: '180g_por_peca_estimativa_camiseta_v1', estimado: true };
  }
  if (/baby ?look/.test(d)) {
    return { kind: 'baby_look', pesoPorPecaKg: 0.16, sku: 'BABY-LOOK', category: 'Vestuario', regraPeso: '160g_por_peca_estimativa_babylook_v1', estimado: true };
  }
  if (/moletom/.test(d)) {
    return { kind: 'moletom', pesoPorPecaKg: 0.55, sku: 'MOLETOM', category: 'Vestuario', regraPeso: '550g_por_peca_estimativa_moletom_v1', estimado: true };
  }
  return null;
}

function perfilCaixaVestuario(qtd: number) {
  if (qtd >= 1 && qtd <= 2) return { comprimento: 40, largura: 30, altura: 6 };
  if (qtd <= 5) return { comprimento: 40, largura: 30, altura: 12 };
  if (qtd <= 10) return { comprimento: 40, largura: 30, altura: 20 };
  if (qtd <= 20) return { comprimento: 50, largura: 40, altura: 25 };
  if (qtd <= 30) return { comprimento: 60, largura: 40, altura: 30 };
  if (qtd <= 50) return { comprimento: 60, largura: 40, altura: 40 };
  return null;
}

function calcularEmbalagemDTF(metros: number) {
  const caixa = metros <= 40 ? CAIXA_ATE_40M : CAIXA_ACIMA_40M;
  const metrosExcedentes = Math.max(metros - 10, 0);
  const pesoG = PESO_BASE_ATE_10M_G + metrosExcedentes * PESO_POR_METRO_EXCEDENTE_G;
  return { ...caixa, pesoKg: pesoG / 1000, pesoG };
}

function opcaoPermitida(s: any): boolean {
  if (s?.Error) return false;
  const carrier = String(s?.Carrier || '').toLowerCase();
  const desc = String(s?.ServiceDescription || '').toLowerCase();
  const code = String(s?.ServiceCode || '').toUpperCase();
  const correios = carrier === 'correios' && (desc.includes('sedex') || desc.includes('pac'));
  const jt = code === 'JTE_INT' || carrier.includes('j&t') || desc.includes('j&t');
  return correios || jt;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!(await autorizado(req))) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const cepDestino = limparCep(body.cep_destino || '');
  const metrosInformados = parseFloat(body.metros || '0');
  if (!cepDestino || cepDestino.length !== 8) return json({ ok: false, error: 'cep_destino_invalido', acao: 'Peca ao cliente o CEP completo, com 8 digitos.' }, 400);
  if (parecePlaceholder(cepDestino)) return json({ ok: false, error: 'cep_placeholder_bloqueado' }, 422);

  const evidencia = await cepTemEvidenciaCliente(cepDestino);
  if (!evidencia.ok || !evidencia.phone) return json({ ok: false, error: 'cep_sem_evidencia_cliente', motivo: evidencia.motivo || 'phone_ausente', acao: 'Peca o CEP ao cliente e use somente o que ele informou.' }, 422);

  const leadId = await resolverLead(evidencia.phone);
  if (!leadId) return json({ ok: false, error: 'lead_nao_resolvido', acao: 'Nao calcule frete ate resolver o lead correto.' }, 409);

  const venda = await buscarVendaCanonica(leadId);
  if (!venda) return json({ ok: false, error: 'valor_venda_canonico_ausente', acao: 'Finalize e registre o total do orcamento/venda no ERP antes de calcular o frete.' }, 409);

  const items = venda.items || [];
  if (!items.length) return json({ ok: false, error: 'itens_canonicos_ausentes' }, 409);

  let shipmentKind = '';
  let quantidadeLogistica = 0;
  let unidadeLogistica = '';
  let emb: any = null;
  let sku = '';
  let category = '';
  let regraPeso = '';
  let cubagemEstimada = false;
  let metrosSnapshot = 0;

  const garmentProfiles = items.map((item: any) => ({ item, profile: garmentProfile(item) }));
  const allGarments = garmentProfiles.every((x: any) => !!x.profile);
  const allDtf = items.every((i: any) => /dtf\s*textil/.test(norm(i?.descricao || '')));

  if (allGarments) {
    const qtdTotal = garmentProfiles.reduce((acc: number, x: any) => acc + Number(x.item?.quantidade || 0), 0);
    if (!Number.isInteger(qtdTotal) || qtdTotal <= 0) return json({ ok: false, error: 'quantidade_vestuario_invalida' }, 409);
    const caixa = perfilCaixaVestuario(qtdTotal);
    if (!caixa) return json({ ok: false, error: 'vestuario_cubagem_fora_da_faixa', quantidade: qtdTotal, faixa_homologada: '1-50 pecas', acao: 'Nao estime acima de 50 pecas.' }, 409);

    const pesoKg = Number(garmentProfiles.reduce((acc: number, x: any) => acc + Number(x.item.quantidade || 0) * Number(x.profile.pesoPorPecaKg), 0).toFixed(3));
    const kinds = [...new Set(garmentProfiles.map((x: any) => x.profile.kind))];
    const regras = [...new Set(garmentProfiles.map((x: any) => x.profile.regraPeso))];
    shipmentKind = kinds.length === 1 ? kinds[0] : 'vestuario_misto';
    quantidadeLogistica = qtdTotal;
    unidadeLogistica = 'pecas';
    emb = { ...caixa, pesoKg, pesoG: Math.round(pesoKg * 1000) };
    sku = kinds.length === 1 ? garmentProfiles[0].profile.sku : 'VESTUARIO-MISTO';
    category = 'Vestuario';
    regraPeso = regras.join('+');
    cubagemEstimada = true;
    metrosSnapshot = qtdTotal;
  } else if (allDtf) {
    if (!metrosInformados || metrosInformados <= 0) return json({ ok: false, error: 'metros_invalido' }, 400);
    emb = calcularEmbalagemDTF(metrosInformados);
    shipmentKind = 'dtf_textil';
    quantidadeLogistica = metrosInformados;
    unidadeLogistica = 'metros';
    sku = 'DTF-TEXTIL';
    category = 'Tecido';
    regraPeso = '1kg_ate_10m_mais_100g_por_metro_excedente';
    cubagemEstimada = false;
    metrosSnapshot = metrosInformados;
  } else {
    return json({
      ok: false,
      error: 'produto_sem_regra_logistica',
      itens: items.map((i: any) => ({ produto_id: i?.produto_id || null, descricao: i?.descricao || null, quantidade: i?.quantidade || null })),
      acao: 'Produto nao possui perfil logistico homologado. Nao usar fallback de DTF/metros.'
    }, 409);
  }

  const valorDeclarado = venda.valor_venda_brl;
  const payload = {
    SellerCEP: CEP_ORIGEM,
    RecipientCEP: cepDestino,
    ShipmentInvoiceValue: valorDeclarado,
    ShippingItemArray: [{
      Height: emb.altura,
      Length: emb.comprimento,
      Width: emb.largura,
      Weight: emb.pesoKg,
      Quantity: 1,
      SKU: sku,
      Category: category
    }],
    RecipientCountry: 'BR'
  };

  let frenetData: any;
  try {
    const res = await fetch(FRENET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: FRENET_TOKEN },
      body: JSON.stringify(payload)
    });
    frenetData = await res.json();
  } catch (e: any) {
    return json({ ok: false, error: 'erro_ao_conectar_frenet', detail: e.message }, 500);
  }

  const lista = frenetData?.ShippingSevicesArray || frenetData?.ShippingServiceArray || [];
  if (!lista.length) return json({ ok: false, error: 'sem_resultados', raw: frenetData }, 200);

  const servicos = lista.filter(opcaoPermitida).map((s: any) => ({
    transportadora: s.Carrier || (String(s.ServiceCode || '').toUpperCase() === 'JTE_INT' ? 'J&T Express' : null),
    servico: s.ServiceDescription,
    codigo: s.ServiceCode,
    preco: parseFloat(s.ShippingPrice),
    prazo_dias: parseInt(s.DeliveryTime),
    preco_formatado: `R$${parseFloat(s.ShippingPrice).toFixed(2).replace('.', ',')}`,
    prazo_formatado: `${s.DeliveryTime} dia${String(s.DeliveryTime) === '1' ? '' : 's'} uteis`
  })).sort((a: any, b: any) => a.preco - b.preco);

  if (!servicos.length) return json({ ok: false, error: 'sem_opcoes_pac_sedex_jt' }, 200);

  const quotedAt = new Date().toISOString();
  const sourceEvidence = {
    fonte: evidencia.fonte,
    cep_observado_em: evidencia.observado_em || null,
    edge_function: 'calcular-frete/v13',
    carriers_allowed: ['Correios', 'J&T Express'],
    requires_value_and_deadline: true,
    valor_venda_brl: valorDeclarado,
    valor_declarado_source: 'joao_erp_proposal_receipts_v1.proposal_total_brl',
    shipment_kind: shipmentKind,
    quantity_value: quantidadeLogistica,
    quantity_unit: unidadeLogistica,
    freight_weight_rule: regraPeso,
    freight_weight_kg: emb.pesoKg,
    freight_box_cm: `${emb.comprimento}x${emb.largura}x${emb.altura}`,
    cubage_estimated: cubagemEstimada,
    cubage_rule: cubagemEstimada ? 'vestuario_faixas_estimadas_v2' : null,
    proposal_receipt_id: venda.receipt_id,
    proposta_id: venda.proposta_id,
    numero_proposta: venda.numero_proposta,
    proposal_receipt_created_at: venda.receipt_created_at
  };

  const { data: snapshot, error: snapshotError } = await sb.rpc('fn_joao_freight_quote_snapshot_record_v2', {
    p_phone: evidencia.phone,
    p_cep_destino: cepDestino,
    p_metros: metrosSnapshot,
    p_opcoes: servicos,
    p_quoted_at: quotedAt,
    p_source_evidence: sourceEvidence
  });

  if (snapshotError || snapshot?.status !== 'RECORDED' || !snapshot?.quote_id) return json({ ok: false, error: 'freight_snapshot_failed' }, 503);

  const linhas = servicos.map((s: any) => `${s.servico} - ${s.preco_formatado} - ${s.prazo_formatado}`);
  return json({
    ok: true,
    cep_origem: CEP_ORIGEM,
    cep_destino: cepDestino,
    lead_id: leadId,
    produto_logistico: shipmentKind,
    quantidade: quantidadeLogistica,
    unidade: unidadeLogistica,
    valor_declarado: valorDeclarado,
    valor_declarado_source: 'proposal_total_brl',
    proposta: { id: venda.proposta_id, numero: venda.numero_proposta, receipt_id: venda.receipt_id },
    embalagem: { caixa: `${emb.comprimento}x${emb.largura}x${emb.altura}cm`, peso_kg: emb.pesoKg, regra_peso: regraPeso, cubagem_estimada: cubagemEstimada },
    opcoes: servicos,
    quote_snapshot_id: snapshot.quote_id,
    quote_snapshot_status: 'RECORDED',
    regra_saida: 'OBRIGATORIO: mostrar TODAS as opcoes retornadas para este CEP, cada uma com servico + valor + prazo.',
    resposta_cliente_pronta: `CEP ${cepDestino}:\n${linhas.join('\n')}`
  });
});
