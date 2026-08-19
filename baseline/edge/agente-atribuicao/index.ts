import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const META_PAGE_TOKEN = Deno.env.get('META_PAGE_TOKEN')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const ALESSANDRO_SUBSCRIBER_ID = '773845540';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
const AGENT_VERSION = 'agente-atribuicao-v2.3.0';
// v2.3.0 (12/08/2026): monitoramento deixa de ser cego, e a instrumentacao de descarte
//   passa a contar nos ramos que faltavam. Deploy unico, aprovado pelo Alessandro.
//   NENHUMA mudanca na logica de atribuicao. A janela de 30 dias fica como esta:
//   "o R$894,33 excluido agora quantifica o trade-off; nao demonstra que a regra esteja errada".
//
//   1. PONTO CEGO CORRIGIDO. leads_sem_utm_24h EXCLUIA canal_conversao='WhatsApp Business' —
//      exatamente o canal que esta agente existe para corrigir. Agora a serie cobre todos os
//      canais. A serie antiga continua publicada como leads_sem_utm_24h_exclui_wa, para o
//      corte de regime ficar visivel em vez de virar degrau inexplicado no historico.
//      ⚠️ DECISAO DELE: SEM alerta por enquanto. "Ao incluir WhatsApp Business a serie muda de
//      regime; precisamos primeiro observar o novo baseline. Colocar um numero hoje seria
//      arbitrario." Por isso o antigo alerta de pct_sem_utm > 30 foi REMOVIDO.
//
//   2. fila_recuperavel — metrica nova, a fila REAL da agente, ate agora invisivel: leads de
//      WhatsApp Business sem utm_ad_id que TEM toque de anuncio valido no zapi E anuncio com
//      veiculacao comprovada no dia. Ou seja, casos que ela CONSEGUE resolver.
//      🔑 O ALERTA E DE IDADE, NAO DE VOLUME — regra dele: "a existencia da fila e normal. O
//      defeito e ela envelhecer sem ser processada." Como a Luciana roda de hora em hora,
//      o SLA e de 2 ciclos: alerta se houver recuperavel parado ha mais de 2h.
//      Janela de varredura de 7 dias: depois do backfill de 12/08 o estoque historico foi
//      zerado, entao o que interessa e o fluxo novo. Publica tambem quantos tem toque mas
//      NAO tem veiculacao comprovada — esses nunca serao resolvidos e nao devem alertar.
//
//   3. pixel_sem_source_24h continua publicado e SEM alerta, por decisao dele: "os 16 que
//      vimos provam que o fenomeno existe, nao qual volume caracteriza anomalia. Primeiro
//      baseline; depois limiar." Ganhou quebra por tipo de evento para o baseline ser util.
//
//   4. CONTADOR DE DESCARTE CORRIGIDO. compras_fora_da_janela so era incrementado no ramo em
//      que a origem foi gravada. Leads descartados ANTES (veiculacao, ad nao resolvido) tinham
//      as compras deles nao contadas em lugar nenhum. Isso produziu uma divergencia fantasma
//      no backfill ("1 compra nao explicada") que na verdade era a janela agindo duas vezes.
//      Agora os ramos com toque valido tambem contam as compras que deixaram de ser atribuidas.
//      O ramo sem_toque_valido NAO conta de proposito: la nao existe evidencia de anuncio
//      nenhuma, entao "compra barrada" nao teria significado.
//
// v2.2.0 (12/08/2026): modo 'backfill' — operacao unica e controlada. NAO alterou o cron.
//   Executado no mesmo dia: 5 paginas, 1.309 candidatos, fim=true, zero erros, 126 origens
//   gravadas, 9 compras atribuidas (R$2.184,81), 3 toques recusados por falta de veiculacao
//   no dia e 2 compras barradas pela janela de 30 dias (34d e 42d).
//
// v2.1.0 (12/08/2026): FRENTE atribuicao-vendas-v2. Conserto do RECUPERADOR DE ORIGEM DE LEAD.
//   O ledger maior fica FORA. Separacao dele: "Luciana atual = recuperadora de origem de lead;
//   Luciana desejada pela frente = atribuidora de venda. Sao loops diferentes."
//   - GATE SEM FUNCAO removido: o WHERE exigia ctwa_clid IS NOT NULL, mas o metodo posterior
//     cruza TELEFONE contra zapi_webhook_inbox e nao usa ctwa_clid. 136 dos 137 recuperaveis
//     eram barrados so por isso.
//   - TELEFONE CANONICO: leads_marketing.ph tem 11 e 13 digitos; zapi tem 12 e 13.
//   - REGRA TEMPORAL: toque <= lead.created_at; anuncio com veiculacao COMPROVADA na data do
//     toque (exigir a data exata custou 3 casos de 130); compra >= toque.
//   - JANELA DE 30 DIAS so para ATRIBUIR A COMPRA. A ORIGEM do lead nao depende de compra.
//   - Origem NUNCA sobrescreve origem existente: guarda .is('utm_ad_id', null) no UPDATE.
//
// v2.0.0 (23/05/2026): Observabilidade honesta — agent_version, dry_run e resultado real.

const JANELA_ATRIBUICAO_VENDA_DIAS = 30;
const LIMITE_LEADS_POR_RODADA = 50;
const LIMITE_MAX_BACKFILL = 300;
const FILA_JANELA_DIAS = 7;
const FILA_SLA_CICLOS = 2; // a Luciana roda de hora em hora -> 2 ciclos ~ 2 horas

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
function log(step: string, status: string, detail: any = {}) { console.log(JSON.stringify({ step, status, v: AGENT_VERSION, ...detail })); }

async function registrarDecisao(params: { acao: string; resultado: string; contexto: any; decisao: any }) {
  try {
    await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-atribuicao',
      p_acao_executada: params.acao,
      p_resultado: params.resultado,
      p_nivel_autonomia: 2,
      p_lead_id: null,
      p_contexto: params.contexto,
      p_decisao: params.decisao,
      p_impacto_financeiro: null,
      p_agent_version: AGENT_VERSION,
      p_dry_run: false,
    });
  } catch (e: any) {
    console.error('LUCIANA_DECISAO_LOG_ERR:', e?.message || String(e));
  }
}

async function enviarWhatsApp(msg: string) {
  try {
    await fetch(`${BOT_BASE}/subscriber/${ALESSANDRO_SUBSCRIBER_ID}/send_message/`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify({ type: 'text', value: msg }),
    });
  } catch (e) { log('whatsapp', 'erro', { error: String(e) }); }
}

async function getAdDataFromMeta(adId: string): Promise<any | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v24.0/${adId}?fields=name,adset_id,campaign_id,adset{name},campaign{name}&access_token=${META_PAGE_TOKEN}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.campaign_id) return null;
    return {
      utm_ad_id: adId, utm_ad_name: data.name,
      utm_adset_id: data.adset_id, utm_content: data.adset?.name,
      utm_campaign_id: data.campaign_id, utm_campaign_name: data.campaign?.name,
      utm_source: 'fb', utm_medium: 'cpc'
    };
  } catch (e) { log('getAdDataFromMeta', 'erro', { adId, error: String(e) }); return null; }
}

async function getAdDataFromDimAds(adId: string): Promise<any | null> {
  try {
    const { data } = await sb.from('dim_ads')
      .select('ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name')
      .eq('ad_id', adId).maybeSingle();
    if (!data?.campaign_id) return null;
    return {
      utm_ad_id: data.ad_id, utm_ad_name: data.ad_name,
      utm_adset_id: data.adset_id, utm_content: data.adset_name,
      utm_campaign_id: data.campaign_id, utm_campaign_name: data.campaign_name,
      utm_source: 'fb', utm_medium: 'cpc'
    };
  } catch (e) { log('getAdDataFromDimAds', 'erro', { adId, error: String(e) }); return null; }
}

function variantesTelefone(ph: string | null): string[] {
  if (!ph) return [];
  const limpo = String(ph).replace(/\D/g, '');
  if (!limpo) return [];
  const v = new Set<string>([limpo]);
  if (!limpo.startsWith('55')) v.add('55' + limpo);
  return [...v];
}

async function primeiroToqueValido(ph: string | null, leadCriadoEm: string): Promise<{ src: string; toque_em: string } | null> {
  const fones = variantesTelefone(ph);
  if (!fones.length) return null;
  const { data, error } = await sb.from('zapi_webhook_inbox')
    .select('created_at, payload')
    .in('phone_normalized', fones)
    .not('payload->externalAdReply->sourceId', 'is', null)
    .lte('created_at', leadCriadoEm)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const src = (data.payload as any)?.externalAdReply?.sourceId;
  if (!src) return null;
  return { src: String(src), toque_em: data.created_at as string };
}

async function anuncioVeiculavaNoToque(adId: string, toqueEm: string): Promise<boolean> {
  try {
    const dia = new Date(new Date(toqueEm).getTime() - 3 * 3600000).toISOString().slice(0, 10);
    const { count, error } = await sb.from('meta_ads_insights')
      .select('*', { count: 'exact', head: true })
      .eq('ad_id', adId).eq('date', dia);
    if (error) { log('veiculacao', 'erro', { adId, dia, error: error.message }); return false; }
    return (count || 0) > 0;
  } catch (e) { log('veiculacao', 'erro', { adId, error: String(e).slice(0, 150) }); return false; }
}

// v2.3.0: usado pelos ramos de descarte que TEM toque valido, para o funil parar de subcontar.
async function comprasSemOrigem(leadId: string): Promise<number> {
  try {
    const { count } = await sb.from('pixel_events')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId).is('source', null).eq('event_name', 'Purchase');
    return count || 0;
  } catch { return 0; }
}

async function corrigirLeadsSemUtm(opts?: { limite?: number; antesDe?: string | null }): Promise<any> {
  const limite = Math.min(opts?.limite ?? LIMITE_LEADS_POR_RODADA, LIMITE_MAX_BACKFILL);
  const m: any = {
    limite, antes_de: opts?.antesDe ?? null,
    candidatos: 0, com_toque: 0, sem_toque_valido: 0,
    descartado_anuncio_nao_veiculava: 0, descartado_ad_nao_resolvido: 0,
    origem_gravada: 0, compras_atribuidas: 0, eventos_nao_compra_marcados: 0,
    compras_fora_da_janela: 0,
    // v2.3.0: ramos que antes nao contavam nada
    compras_perdidas_por_veiculacao: 0, compras_perdidas_por_ad_nao_resolvido: 0,
    erros: 0, proximo_cursor: null, fim: false,
  };

  try {
    let q = sb.from('leads_marketing')
      .select('lead_id, ph, created_at')
      .eq('canal_conversao', 'WhatsApp Business')
      .is('utm_ad_id', null);
    if (opts?.antesDe) q = q.lt('created_at', opts.antesDe);
    const { data: leads, error } = await q.order('created_at', { ascending: false }).limit(limite);

    if (error) { log('corrigir_select', 'erro', { error: error.message }); return m; }
    if (!leads?.length) { m.fim = true; return m; }

    m.candidatos = leads.length;
    m.proximo_cursor = leads[leads.length - 1].created_at;
    m.fim = leads.length < limite;
    log('corrigir', 'iniciando', { total: leads.length, antes_de: opts?.antesDe ?? null });

    for (const lead of leads) {
      try {
        const toque = await primeiroToqueValido(lead.ph, lead.created_at as string);
        if (!toque) { m.sem_toque_valido++; continue; }
        m.com_toque++;

        if (!(await anuncioVeiculavaNoToque(toque.src, toque.toque_em))) {
          m.descartado_anuncio_nao_veiculava++;
          m.compras_perdidas_por_veiculacao += await comprasSemOrigem(lead.lead_id);
          log('descartado', 'anuncio_nao_veiculava', { lead_id: lead.lead_id, ad_id: toque.src, toque_em: toque.toque_em });
          continue;
        }

        const adData = await getAdDataFromDimAds(toque.src) || await getAdDataFromMeta(toque.src);
        if (!adData) {
          m.descartado_ad_nao_resolvido++;
          m.compras_perdidas_por_ad_nao_resolvido += await comprasSemOrigem(lead.lead_id);
          continue;
        }

        const { data: leadUpd, error: leadErr } = await sb.from('leads_marketing').update({
          utm_ad_id: adData.utm_ad_id,
          utm_ad_name: adData.utm_ad_name,
          utm_adset_id: adData.utm_adset_id,
          utm_content: adData.utm_content,
          utm_campaign_id: adData.utm_campaign_id,
          utm_campaign_name: adData.utm_campaign_name,
          utm_source: adData.utm_source,
          utm_medium: adData.utm_medium,
          updated_at: new Date().toISOString(),
        }).eq('lead_id', lead.lead_id).is('utm_ad_id', null).select('lead_id');

        if (leadErr || !leadUpd?.length) {
          m.erros++;
          log('origem', 'nao_gravada', { lead_id: lead.lead_id, error: leadErr?.message ?? 'ja tinha origem (corrida)' });
          continue;
        }
        m.origem_gravada++;

        const { data: evUpd } = await sb.from('pixel_events').update({
          source: 'fb', medium: 'cpc',
          campaign_id: adData.utm_campaign_id,
          adset_id: adData.utm_adset_id,
          ad_id: adData.utm_ad_id,
        }).eq('lead_id', lead.lead_id).is('source', null).neq('event_name', 'Purchase').select('event_id');
        m.eventos_nao_compra_marcados += evUpd?.length || 0;

        const limiteJanela = new Date(new Date(toque.toque_em).getTime() + JANELA_ATRIBUICAO_VENDA_DIAS * 86400000).toISOString();
        const { data: cpUpd } = await sb.from('pixel_events').update({
          source: 'fb', medium: 'cpc',
          campaign_id: adData.utm_campaign_id,
          adset_id: adData.utm_adset_id,
          ad_id: adData.utm_ad_id,
        }).eq('lead_id', lead.lead_id).is('source', null).eq('event_name', 'Purchase')
          .gte('event_time', toque.toque_em).lte('event_time', limiteJanela).select('event_id');
        m.compras_atribuidas += cpUpd?.length || 0;

        m.compras_fora_da_janela += await comprasSemOrigem(lead.lead_id);

        log('corrigido', 'ok', { lead_id: lead.lead_id, ad_id: toque.src, toque_em: toque.toque_em, compras: cpUpd?.length || 0 });
      } catch (e) {
        m.erros++;
        log('corrigir_lead', 'erro', { lead_id: lead.lead_id, error: String(e).slice(0, 200) });
      }
    }
  } catch (e) {
    log('corrigirLeadsSemUtm', 'fatal', { error: String(e).slice(0, 200) });
  }

  return m;
}

async function monitorarQualidade(): Promise<{ alertas: string[]; stats: any }> {
  const alertas: string[] = [];
  const stats: any = {};

  // 1. v2.3.0: a serie passa a INCLUIR WhatsApp Business. A serie antiga continua publicada
  //    ao lado, para o corte de regime ficar explicito. SEM alerta ate haver baseline.
  try {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: leads24h } = await sb.from('leads_marketing')
      .select('canal_conversao, utm_source')
      .gte('created_at', since);

    const total24h = leads24h?.length || 0;
    const semUtmTodos = leads24h?.filter(l => !l.utm_source).length || 0;
    const semUtmExcluiWa = leads24h?.filter(l => !l.utm_source && l.canal_conversao !== 'WhatsApp Business').length || 0;

    stats.total_leads_24h = total24h;
    stats.leads_sem_utm_24h = semUtmTodos;
    stats.leads_sem_utm_24h_exclui_wa = semUtmExcluiWa;
    stats.pct_sem_utm = total24h > 0 ? Math.round(semUtmTodos / total24h * 100) : 0;
    stats.serie_ampliada_em = '2026-08-12';
    stats.limiar_sem_utm = 'sem_limiar_coletando_baseline';
  } catch (e) { log('mon_leads', 'erro', { error: String(e).slice(0, 200) }); }

  // 2. v2.3.0: fila REAL da agente. Alerta por IDADE, nunca por volume.
  try {
    const desde = new Date(Date.now() - FILA_JANELA_DIAS * 86400000).toISOString();
    const { data: pendentes } = await sb.from('leads_marketing')
      .select('lead_id, ph, created_at')
      .eq('canal_conversao', 'WhatsApp Business')
      .is('utm_ad_id', null)
      .gte('created_at', desde)
      .order('created_at', { ascending: true });

    let fila = 0, comToque = 0, maisAntigoH = 0;
    for (const l of (pendentes || [])) {
      const t = await primeiroToqueValido(l.ph, l.created_at as string);
      if (!t) continue;
      comToque++;
      if (!(await anuncioVeiculavaNoToque(t.src, t.toque_em))) continue;
      fila++;
      const h = (Date.now() - new Date(l.created_at as string).getTime()) / 3600000;
      if (h > maisAntigoH) maisAntigoH = h;
    }

    stats.fila_janela_dias = FILA_JANELA_DIAS;
    stats.fila_avaliados = pendentes?.length || 0;
    stats.fila_recuperavel = fila;
    stats.fila_com_toque_sem_veiculacao = comToque - fila;
    stats.fila_mais_antigo_h = Math.round(maisAntigoH * 10) / 10;
    stats.fila_sla_ciclos = FILA_SLA_CICLOS;

    if (fila > 0 && maisAntigoH > FILA_SLA_CICLOS) {
      alertas.push(`${fila} lead(s) recuperavel(is) parado(s) na fila; o mais antigo ha ${maisAntigoH.toFixed(1)}h (SLA: ${FILA_SLA_CICLOS} ciclos horarios)`);
    }
  } catch (e) { log('mon_fila', 'erro', { error: String(e).slice(0, 200) }); }

  try {
    const { count } = await sb.from('leadads_retry_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente');
    if ((count || 0) > 20) alertas.push(`${count} leads na fila de retry`);
    stats.retry_pendente = count || 0;
  } catch (e) { log('mon_retry', 'erro', { error: String(e).slice(0, 200) }); }

  // 3. v2.3.0: continua SEM alerta, por decisao dele. Ganhou quebra por tipo de evento
  //    para o baseline ser util quando formos definir o limiar a partir da distribuicao.
  try {
    const desde24h = new Date(Date.now() - 24 * 3600000).toISOString();
    const semSource = async (evento?: string) => {
      let q = sb.from('pixel_events').select('*', { count: 'exact', head: true })
        .is('source', null).gte('event_time', desde24h);
      if (evento) q = q.eq('event_name', evento);
      const { count } = await q;
      return count || 0;
    };
    stats.pixel_sem_source_24h = await semSource('Lead');
    stats.pixel_sem_source_24h_total = await semSource();
    stats.pixel_sem_source_24h_purchase = await semSource('Purchase');
    stats.limiar_pixel_sem_source = 'sem_limiar_coletando_baseline';
  } catch (e) { log('mon_pixel', 'erro', { error: String(e).slice(0, 200) }); }

  return { alertas, stats };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const modo = body.mode || 'corrigir';

    log('start', modo);

    let m: any = {};
    let corrigidos = 0;
    let alertas: string[] = [];
    let stats: any = {};

    if (modo === 'backfill') {
      m = await corrigirLeadsSemUtm({ limite: body.limite ?? 150, antesDe: body.antes_de ?? null });
      corrigidos = m.origem_gravada || 0;
      log('backfill', 'done', m);
      await registrarDecisao({
        acao: corrigidos > 0 ? 'backfill_atribuicao' : 'nenhum',
        resultado: 'executada',
        contexto: { trigger: 'manual_backfill', modo, funil: m, janela_venda_dias: JANELA_ATRIBUICAO_VENDA_DIAS },
        decisao: { corrigidos, compras_atribuidas: m.compras_atribuidas || 0, motivo: corrigidos > 0 ? 'trabalho_realizado' : 'sem_trabalho_elegivel' },
      });
      return new Response(JSON.stringify({ ok: true, versao: AGENT_VERSION, modo, corrigidos, funil: m }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (modo === 'corrigir' || modo === 'ambos') {
      m = await corrigirLeadsSemUtm();
      corrigidos = m.origem_gravada || 0;
      log('corrigir', 'done', m);
    }

    if (modo === 'monitorar' || modo === 'ambos') {
      const r = await monitorarQualidade();
      alertas = r.alertas; stats = r.stats;

      if (alertas.length > 0) {
        await enviarWhatsApp(`\u26a0\ufe0f *Agente de Atribuicao*\n\n${alertas.map(a => `\u2022 ${a}`).join('\n')}`);
      }
    }

    const fezTrabalho = corrigidos > 0 || alertas.length > 0;
    await registrarDecisao({
      acao: fezTrabalho ? `${modo}_atribuicao` : 'nenhum',
      resultado: 'executada',
      contexto: { trigger: 'cron', modo, stats, funil: m, janela_venda_dias: JANELA_ATRIBUICAO_VENDA_DIAS },
      decisao: { corrigidos, compras_atribuidas: m.compras_atribuidas || 0, alertas, motivo: fezTrabalho ? 'trabalho_realizado' : 'sem_trabalho_elegivel' },
    });

    return new Response(JSON.stringify({ ok: true, versao: AGENT_VERSION, modo, corrigidos, funil: m, alertas, stats }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    log('fatal', 'erro', { error: String(e) });
    await registrarDecisao({
      acao: 'execucao_fatal',
      resultado: 'falhou',
      contexto: { erro: String(e).slice(0, 300) },
      decisao: { motivo: 'excecao_fatal' },
    });
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
