import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { MetaConnector } from './connectors/meta.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const ALESSANDRO_SUBSCRIBER_ID = '773845540';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
const AGENT_VERSION = 'agente-midia-v8.8.0';
// v8.8.0 (12/08/2026): acao de CAMPANHA passa a ser comprovavel ponta a ponta.
//   FRENTE resultado-executada-prova-intencao. Escopo decidido pelo Alessandro:
//   SO Gustavo. NAO altera a semantica global de 'executada' e NAO toca em
//   nenhum outro agente.
//   PROBLEMA MEDIDO: processarDecisoes recebia {ok,resultado} da Meta e NAO
//   ESCREVIA NADA no banco. Publico ja tinha livro (agente_midia_experimentos);
//   campanha nao tinha nada. Resultado: 3 decisoes de escalar_orcamento da CP136
//   (mai/2026) constam 'executada' com execucao_sucesso, executed_at e
//   efeito_externo NULOS, sem nenhuma forma de provar o que aconteceu na Meta.
//   O QUE MUDA:
//     1. persistir TENTATIVA antes de chamar a Meta (livro agente_midia_experimentos,
//        tipo='acao_campanha', com decision_id, endpoint, payload e estado ANTES);
//     2. chamar a Meta COM TIMEOUT (15s);
//     3. persistir a resposta CRUA (http_status, body, fbtrace_id);
//     4. RELER o estado na Meta depois;
//     5. comparar desejado x observado e classificar.
//   CLASSIFICACAO (nunca inventa sucesso):
//     confirmada_na_meta      -> Meta aceitou E a releitura mostra o estado desejado
//     aceita_sem_confirmacao  -> Meta aceitou mas o estado observado diverge
//     falhou                  -> Meta recusou com erro explicito
//     incerta                 -> timeout, rede caida, JSON invalido ou releitura falhou
//     bloqueada_por_flag      -> execucao externa desligada (ver abaixo)
//   Os campos execucao_sucesso / executed_at / efeito_externo de agente_decisoes_log
//   (hoje NULOS em 100% das linhas, sem consumidor) passam a ser preenchidos SO nesse
//   caminho: true apenas em confirmada_na_meta, false em falhou, NULO em incerta.
//   O campo 'resultado' NAO e tocado — reconciliar 'executada' com a prova e a
//   proxima decisao, e depende de levantar os consumidores desse campo.
//   TRAVA: EXECUCAO_CAMPANHA_HABILITADA=false. Enquanto estiver false, o agente
//   registra a tentativa e o payload que MANDARIA, e NAO chama a Meta. Ligar isso
//   e o canario, e depende de autorizacao explicita do Alessandro.
// v8.7.0 (05/08/2026): expirado deixa de ser gatilho de criacao de publico
//   DECISAO (Claude + ChatGPT, rodada 3): pela regra da Meta,
//   delivery_status=300 significa mais de 2 anos SEM USO em ad set ativo —
//   nao significa janela de retencao vencida. Logo expirado e sinal de
//   abandono, nao ordem de clonagem. Medido: 215 publicos expirados na conta
//   (64 IG_BUSINESS, ~119 mil pessoas). A 2 por rodada seriam ~107 dias
//   clonando inventario morto.
//   ALEM DISSO o payload de criacao estava errado. Quatro vocabularios
//   distintos que NAO podem ser copiados entre campos:
//     IG_BUSINESS         -> subtype devolvido na LEITURA
//     IG_BUSINESS_EVENTS  -> classificacao de data_source
//     ENGAGEMENT          -> subtype usado na CRIACAO
//     ig_business         -> type do event_source dentro da rule
//   E a retencao de ENGAGEMENT vai em rule.retention_seconds, nunca em
//   retention_days no topo.
//   FIX: montarConfigCriacao() so devolve config quando ela e integralmente
//   reproduzivel. Sem rule persistida (event_sources + retencao), nenhuma
//   proposta e gerada e o motivo fica registrado como nao_proposto.
//   Caminho LAL (criar_lal) segue ATIVO: o gatilho dele e necessidade
//   comercial real (campanha com ROAS alto), nao abandono.
//   PARA REATIVAR expirados: backfill de creation_rule/event_sources em
//   dim_audiences + criterio de necessidade comercial (campanha ou ad set
//   planejado que realmente precise do publico).
// v8.6.0 (05/08/2026): processarPublicos deixa de abortar em silencio
//   .catch() nao existe em PostgrestFilterBuilder (thenable, nao Promise):
//   lancava TypeError sincrona e o fetch nunca saia, entao meta.criarPublico
//   jamais era chamada. Corrigido lendo {data,error}; .select().single() nos
//   updates; r.ok sem audience_id vira indeterminado; WhatsApp de sucesso so
//   apos confirmacao local do update.
// v8.5.0 (10/06/2026): pausarCampanha confirma effective_status real (Bug 1)
// v8.4.0 (10/06/2026): dedup por campaign_id dentro da execucao (Bug 3)
// v8.3.2 (25/05): fix insert agente_aprovacoes via RPC fn_inserir_aprovacao_midia
// v8.3.0 (25/05): Sprint Gustavo Fase 1 - 4 fixes logica
// v8.2.0 (23/05): feedback loop Diego -> Gustavo (avaliarRecomendacoesDiego)
// v8.1.0: helper centralizado registrarDecisao

// v8.8.0: trava de execucao externa de campanha. Ligar SO com autorizacao explicita.
const EXECUCAO_CAMPANHA_HABILITADA = false;

const THRESHOLDS_FALLBACK: Record<string, any> = {
  lead_gen:    { roas_min_pausar: 0.5,  roas_bom_escalar: 2.0, gasto_min_pausar: 1000, clientes_min_escalar: 3 },
  remarketing: { roas_min_pausar: 0.8,  roas_bom_escalar: 2.5, gasto_min_pausar: 500,  clientes_min_escalar: 2 },
  prospeccao:  { roas_min_pausar: 0.3,  roas_bom_escalar: 1.5, gasto_min_pausar: 1500, clientes_min_escalar: 3 },
  engajamento: { roas_min_pausar: 0.2,  roas_bom_escalar: 1.5, gasto_min_pausar: 800,  clientes_min_escalar: 2 },
  outro:       { roas_min_pausar: 0.5,  roas_bom_escalar: 2.0, gasto_min_pausar: 1000, clientes_min_escalar: 3 },
};

const OBJETIVO_IDEAL: Record<string, { objetivo: string; motivo: string }> = {
  lead_gen:    { objetivo: 'LEAD_GENERATION', motivo: 'Meta otimiza para quem preenche formulario, nao apenas clica.' },
  remarketing: { objetivo: 'CONVERSIONS',     motivo: 'Publico ja te conhece, objetivo e comprar.' },
  prospeccao:  { objetivo: 'CONVERSIONS',     motivo: 'Encontra perfil de compra real no historico do Meta.' },
  engajamento: { objetivo: 'ENGAGEMENT',      motivo: 'Correto por design, manter.' },
};

const MAX_DECISOES = 5;
const MAX_PUBLICOS = 2;
const DELAY_MS = 2500;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const clog = (s: string, t: string, d: any = {}) => console.log(JSON.stringify({ s, t, v: AGENT_VERSION, ts: new Date().toISOString(), ...d }));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// v8.8.0: passa a DEVOLVER o id da decisao, para ligar a tentativa ao registro.
async function registrarDecisao(params: { acao: string; resultado: string; nivel: number; contexto: any; decisao: any; impacto: number | null; dry_run: boolean }): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-midia',
      p_acao_executada: params.acao,
      p_resultado: params.resultado,
      p_nivel_autonomia: params.nivel,
      p_lead_id: null,
      p_contexto: params.contexto,
      p_decisao: params.decisao,
      p_impacto_financeiro: params.impacto,
      p_agent_version: AGENT_VERSION,
      p_dry_run: params.dry_run,
    });
    if (error) { console.error('GUSTAVO_DECISAO_LOG_ERR:', error.message); return null; }
    return (data as string) ?? null;
  } catch (e: any) {
    console.error('GUSTAVO_DECISAO_LOG_ERR:', e?.message || String(e));
    return null;
  }
}

// v8.8.0: livro de tentativa de acao de CAMPANHA.
// Reusa agente_midia_experimentos de proposito: a tabela ja e usada com
// campaign_id em audience_source (jaExperimentouHoje('variacao_criativo', campaign_id)),
// ja provou entregar causa raiz vinda da Meta e nao exige arquitetura nova.
async function abrirTentativaCampanha(p: { decisionId: string | null; acao: string; campaignId: string; campaignName: string; segmento: string; motivo: string; endpoint: string; payload: any; estadoDesejado: any; estadoAntes: any; dryRun: boolean }): Promise<{ id: string | null; contextoBase: any }> {
  const contextoBase = {
    objeto: 'campanha',
    agent_version: AGENT_VERSION,
    decision_id: p.decisionId,
    campaign_id: p.campaignId,
    segmento: p.segmento,
    endpoint: p.endpoint,
    payload_pretendido: p.payload,
    estado_desejado: p.estadoDesejado,
    estado_antes: p.estadoAntes,
    tentativa_em: new Date().toISOString(),
    execucao_habilitada: EXECUCAO_CAMPANHA_HABILITADA,
  };
  try {
    const { data, error } = await sb.from('agente_midia_experimentos').insert({
      tipo: 'acao_campanha',
      acao: p.acao,
      audience_source: p.campaignId,
      audience_name: p.campaignName,
      motivo: p.motivo,
      resultado: 'tentativa_iniciada',
      dry_run: p.dryRun,
      contexto: contextoBase,
    }).select('id').single();
    if (error || !data?.id) {
      await logErro('abrir_tentativa_campanha', error?.message ?? 'insert sem retorno', { acao: p.acao, campaign_id: p.campaignId, code: error?.code ?? null, details: error?.details ?? null });
      return { id: null, contextoBase };
    }
    return { id: data.id as string, contextoBase };
  } catch (e: any) {
    await logErro('abrir_tentativa_campanha', e?.message ?? String(e), { acao: p.acao, campaign_id: p.campaignId });
    return { id: null, contextoBase };
  }
}

async function fecharTentativaCampanha(id: string | null, resultado: string, contexto: any, executadoEm: string | null) {
  if (!id) return;
  try {
    const { data, error } = await sb.from('agente_midia_experimentos')
      .update({ resultado, executado_em: executadoEm, contexto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, resultado')
      .single();
    if (error || data?.resultado !== resultado) {
      await logErro('fechar_tentativa_campanha', error?.message ?? 'update sem confirmacao da linha', { id, resultado, code: error?.code ?? null });
    }
  } catch (e: any) {
    await logErro('fechar_tentativa_campanha', e?.message ?? String(e), { id });
  }
}

// v8.8.0: preenche SO os campos de execucao, que hoje sao NULOS em 100% das linhas.
// NAO toca em 'resultado' — a semantica global de 'executada' fica intacta.
async function carimbarExecucaoNaDecisao(decisionId: string | null, sucesso: boolean | null, executadoEm: string | null) {
  if (!decisionId) return;
  try {
    const { error } = await sb.from('agente_decisoes_log')
      .update({ execucao_sucesso: sucesso, executed_at: executadoEm, efeito_externo: sucesso })
      .eq('id', decisionId);
    if (error) await logErro('carimbar_execucao_decisao', error.message, { decision_id: decisionId });
  } catch (e: any) {
    await logErro('carimbar_execucao_decisao', e?.message ?? String(e), { decision_id: decisionId });
  }
}

// v8.8.0: desejado x observado. Nunca devolve sucesso sem releitura conferida.
function classificarDesfecho(acao: string, r: any, estadoDepois: any, estadoDesejado: any): { resultado: string; motivo: string; sucesso: boolean | null } {
  if (r?.timeout) return { resultado: 'incerta', motivo: 'timeout_sem_resposta_da_meta', sucesso: null };
  if (r?.incerto) return { resultado: 'incerta', motivo: String(r?.resultado ?? 'resposta_ambigua'), sucesso: null };
  if (!r?.ok) return { resultado: 'falhou', motivo: String(r?.resultado ?? 'meta_recusou'), sucesso: false };
  if (!estadoDepois?.ok) return { resultado: 'incerta', motivo: 'meta_aceitou_mas_releitura_falhou', sucesso: null };
  const bate = acao === 'pausar_campanha'
    ? estadoDepois?.effective_status === 'PAUSED'
    : (estadoDepois?.daily_budget != null && String(estadoDepois.daily_budget) === String(estadoDesejado?.daily_budget));
  return bate
    ? { resultado: 'confirmada_na_meta', motivo: 'estado_observado_igual_ao_desejado', sucesso: true }
    : { resultado: 'aceita_sem_confirmacao', motivo: 'meta_respondeu_ok_mas_estado_observado_diverge', sucesso: null };
}

async function podeExecutarDiretamente(acao: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('fn_agente_pode_executar', { p_slug: 'agente-midia', p_acao: acao });
    if (error || !data?.pode) return false;
    return data.modo === 'execucao_direta';
  } catch { return false; }
}

async function buscarContextoTemporal(): Promise<any> {
  try { const { data } = await sb.rpc('fn_contexto_temporal_agentes', { p_agente_slug: 'agente-midia' }); return data || {}; } catch { return {}; }
}

async function execStart(modo: string, inputs: any = {}): Promise<string | null> {
  try { const { data } = await sb.rpc('fn_exec_start', { p_agente: 'agente-midia', p_versao: AGENT_VERSION, p_modo: modo, p_inputs: inputs }); return data; } catch { return null; }
}
async function execFinish(id: string | null, status: string, ms: number, outputs: any = {}, erros: any[] = []): Promise<void> {
  if (!id) return; try { await sb.rpc('fn_exec_finish', { p_exec_id: id, p_status: status, p_ms: ms, p_outputs: outputs, p_erros: erros }); } catch {}
}
async function logErro(passo: string, erro: string, ctx: any = {}): Promise<void> {
  clog(passo, 'erro', { error: String(erro).slice(0, 200), ...ctx });
  try { await sb.rpc('fn_log_erro', { p_agente: 'agente-midia', p_versao: AGENT_VERSION, p_passo: passo, p_erro: String(erro).slice(0, 500), p_contexto: ctx }); } catch {}
}
async function enviarWpp(msg: string, botoes?: any[]): Promise<boolean> {
  try {
    const body = botoes?.length ? { type: 'button', value: msg, buttons: botoes } : { type: 'text', value: msg };
    const r = await fetch(`${BOT_BASE}/subscriber/${ALESSANDRO_SUBSCRIBER_ID}/send_message/`, {
      method: 'POST', headers: { 'accept': 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch (e: any) { await logErro('enviar_wpp', e.message); return false; }
}
async function getConfig() {
  try {
    const { data } = await sb.from('agentes').select('nivel_autonomia_atual,status,dry_run_ativo').eq('slug','agente-midia').maybeSingle();
    return { nivel: data?.nivel_autonomia_atual ?? 0, status: data?.status ?? 'pausado', dryRun: data?.dry_run_ativo ?? true };
  } catch { return { nivel: 0, status: 'pausado', dryRun: true }; }
}
async function jaFeitoHoje(acao: string, ref: string) {
  try {
    const desde = new Date(Date.now() - 86400000).toISOString();
    const { count } = await sb.from('agente_decisoes_log').select('*',{count:'exact',head:true}).eq('agente_slug','agente-midia').eq('dry_run',false).gte('created_at',desde).eq('contexto->>campaign_id',ref).eq('decisao->>acao',acao);
    return (count??0)>0;
  } catch { return false; }
}
async function jaExperimentouHoje(tipo: string, fonte: string) {
  try {
    const desde = new Date(Date.now() - 86400000).toISOString();
    const { count } = await sb.from('agente_midia_experimentos').select('*',{count:'exact',head:true}).eq('tipo',tipo).eq('audience_source',fonte).gte('created_at',desde);
    return (count??0)>0;
  } catch { return false; }
}
async function buscarOuro(segmento?: string, campaignId?: string) {
  try { const { data } = await sb.rpc('fn_contexto_midia_ouro',{ p_segmento: segmento||null, p_campaign_id: campaignId||null }); return data || {}; } catch (e: any) { await logErro('buscar_ouro', e.message); return {}; }
}
async function resolverSegmento(campaignId: string, campaignName: string): Promise<string> {
  try { const { data } = await sb.rpc('fn_segmento_campanha', { p_campaign_id: campaignId, p_campaign_name: campaignName }); return data || 'impressao_dtf_textil'; } catch { return 'impressao_dtf_textil'; }
}
async function buscarCriterios(segmento: string): Promise<any> {
  try {
    const { data } = await sb.from('vw_criterios_midia').select('tipo, metrica, valor_minimo, unidade').in('segmento', [segmento, 'geral']);
    const map: any = {};
    for (const r of (data || [])) {
      if (!map[r.tipo]) map[r.tipo] = {};
      if (!map[r.tipo][r.metrica] || r.segmento !== 'geral') map[r.tipo][r.metrica] = r.valor_minimo;
    }
    return map;
  } catch { return {}; }
}
async function buscarAdset(campaignId: string) {
  try { const { data } = await sb.from('dim_ads').select('adset_id').eq('campaign_id',campaignId).not('adset_id','is',null).limit(1).maybeSingle(); return data?.adset_id || null; } catch { return null; }
}

// v8.7.0: mapeamento explicito leitura -> criacao.
// So devolve config quando ela e INTEGRALMENTE reproduzivel.
function montarConfigCriacao(p: any): { ok: boolean; motivo?: string; value?: any } {
  const rule = p.creation_rule ?? p.rule ?? null;
  switch (p.subtype) {
    case 'IG_BUSINESS':
    case 'ENGAGEMENT': {
      if (!rule) return { ok: false, motivo: 'rule_original_ausente' };
      const inc = rule?.inclusions?.rules;
      if (!Array.isArray(inc) || inc.length === 0) return { ok: false, motivo: 'rule_sem_inclusions' };
      const temFonte = inc.some((r: any) => Array.isArray(r?.event_sources) && r.event_sources.length > 0);
      if (!temFonte) return { ok: false, motivo: 'event_source_ausente' };
      const retSeg = p.retention_days ? Number(p.retention_days) * 86400 : null;
      if (!retSeg) return { ok: false, motivo: 'retencao_ausente' };
      return {
        ok: true,
        value: {
          name: p.name,
          subtype: 'ENGAGEMENT',
          rule: {
            inclusions: {
              operator: rule.inclusions.operator ?? 'or',
              rules: inc.map((r: any) => ({ ...r, retention_seconds: r.retention_seconds ?? retSeg })),
            },
          },
        },
      };
    }
    default:
      return { ok: false, motivo: `subtype_leitura_nao_mapeado:${p.subtype}` };
  }
}

async function chamarCamila(p: any) {
  clog('camila', 'chamando', { campaign: p.campaign_name, roas: p.roas, segmento: p.segmento, urgencia: p.urgencia });
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-criativo`,{
      method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},
      body: JSON.stringify({ campaign_id:p.campaign_id, campaign_name:p.campaign_name, adset_id:p.adset_id, account_id:p.account_id, segmento:p.segmento, roas:p.roas, objetivo:'gerar leads qualificados', n_variacoes:2, dry_run:p.dryRun, urgencia_meta:p.urgencia, dias_uteis_restantes:p.dias_uteis_restantes }),
      signal: AbortSignal.timeout(90000),
    });
    const d = await res.json();
    clog('camila', d.ok ? 'ok' : 'falhou', { ads_criados: d.ads_criados?.length });
    return { ok: d.ok, ads_criados: d.ads_criados||[], erro: d.erro };
  } catch(e:any) { await logErro('chamar_camila', e.message, { campaign: p.campaign_name }); return { ok:false, ads_criados:[], erro:e.message }; }
}

async function analisarObjetivosCampanhas(perf: any[], dryRun: boolean, meta: MetaConnector, ehDiaUtil: boolean): Promise<void> {
  if (!ehDiaUtil) { clog('objetivo_campanha','dia_nao_util',{msg:'Nao analisa objetivos em dia nao util'}); return; }
  const pode = await podeExecutarDiretamente('mudar_objetivo_campanha');
  if (!pode) { clog('objetivo_campanha','nivel_insuficiente',{msg:'Guardiao: mudar_objetivo_campanha requer nivel 3'}); return; }
  const campanhasObjetivoVistas = new Set<string>();
  for (const row of perf) {
    if (!row.campaign_id || row.status_real === 'PAUSADA') continue;
    if (campanhasObjetivoVistas.has(row.campaign_id)) continue;
    campanhasObjetivoVistas.add(row.campaign_id);
    const tipo = row.tipo_campanha || 'outro';
    const idealCfg = OBJETIVO_IDEAL[tipo];
    if (!idealCfg) continue;
    let objetivoAtual: string | null = null;
    try {
      const r = await fetch(`https://graph.facebook.com/v24.0/${row.campaign_id}?fields=objective&access_token=${Deno.env.get('META_ACCESS_TOKEN')}`,{signal:AbortSignal.timeout(8000)});
      const d = await r.json(); objetivoAtual = d.objective || null;
    } catch (e: any) { await logErro('buscar_objetivo', e.message, {campaign_id:row.campaign_id}); continue; }
    if (!objetivoAtual || objetivoAtual === idealCfg.objetivo) continue;
    if (await jaFeitoHoje('mudar_objetivo', row.campaign_id)) continue;
    const segmento = await resolverSegmento(row.campaign_id, row.campaign_name);
    const gasto = Number(row.gasto_30d) || 0;
    const roas = Number(row.roas_pixel) || 0;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/agente-criativo`,{
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},
        body: JSON.stringify({ mode:'teste_objetivo', campaign_id:row.campaign_id, campaign_name:row.campaign_name, segmento, objetivo_atual:objetivoAtual, objetivo_ideal:idealCfg.objetivo, motivo_suspeita:idealCfg.motivo, roas, gasto }),
        signal: AbortSignal.timeout(60000),
      });
    } catch(e:any){await logErro('chamar_camila_objetivo',e.message,{campaign:row.campaign_name});}
    await sleep(DELAY_MS);
  }
}

async function monitorarCriativos() {
  try {
    const limite = new Date(Date.now()-7*86400000).toISOString();
    const { data: exps } = await sb.from('agente_midia_experimentos').select('id,audience_id,audience_name,contexto').eq('tipo','variacao_criativo').eq('resultado','executado').lte('executado_em',limite).not('audience_id','is',null);
    let vencedoras=0,pausadas=0;
    for (const exp of (exps||[])) {
      const { data: perf } = await sb.from('meta_ads_insights').select('spend,leads,ctr').eq('ad_id',exp.audience_id).gte('date',new Date(Date.now()-7*86400000).toISOString().split('T')[0]);
      if (!perf?.length) continue;
      const spend=perf.reduce((s,r)=>s+(Number(r.spend)||0),0);
      const leads=perf.reduce((s,r)=>s+(Number(r.leads)||0),0);
      const ctr=perf.reduce((s,r)=>s+(Number(r.ctr)||0),0)/perf.length;
      const segmento=exp.contexto?.segmento||'geral';
      const criterios=await buscarCriterios(segmento);
      const ctrMin=criterios?.teste?.ctr_vencedor??2.0;
      const leadsMin=criterios?.teste?.leads_para_julgar??3;
      let res='testando';
      if(spend>=30){if(ctr>=ctrMin&&leads>=leadsMin)res='vencedora';else if(ctr<0.8||(spend>=50&&leads===0))res='pausar';else res='mediocre';}
      await sb.from('agente_midia_experimentos').update({resultado:res==='pausar'?'rejeitado':'executado',contexto:{...exp.contexto,performance:{spend,leads,ctr,classificacao:res}},updated_at:new Date().toISOString()}).eq('id',exp.id);
      if(res==='vencedora'){vencedoras++;const seg=exp.contexto?.segmento,copy=exp.contexto?.copy;if(seg&&copy)await sb.from('agente_memoria').upsert({agente_slug:'agente-criativo',tipo:'copy_vencedora',chave:`${seg}_${copy.angulo}`,valor:{copy,performance:{ctr,leads,spend},segmento:seg,ad_id:exp.audience_id},confianca:Math.min(0.95,0.6+leads*0.05),baseado_em_n:leads,ativo:true,atualizado_em:new Date().toISOString()},{onConflict:'agente_slug,tipo,chave'});}
      if(res==='pausar')pausadas++;
    }
    clog('monitorar_criativos','ok',{total:exps?.length||0,vencedoras,pausadas});
  } catch(e:any){await logErro('monitorar_criativos',e.message);}
}

async function analisarCampanhas(perf: any[], meta: MetaConnector, ouro: any, urgencia: string, diasUteis: number) {
  const decisoes: any[] = [];
  const campanhasJaProcessadas = new Set<string>();
  let totalSkipDedup = 0;
  const fatorUrgencia: Record<string, number> = { critica: 0.5, muito_alta: 0.65, alta: 0.80, media: 1.0, normal: 1.0 };
  const fator = fatorUrgencia[urgencia] ?? 1.0;
  const [podePausar, podeEscalar] = await Promise.all([
    podeExecutarDiretamente('pausar_campanha'),
    podeExecutarDiretamente('escalar_orcamento'),
  ]);
  for (const row of perf) {
    if (!row.campaign_id||decisoes.length>=MAX_DECISOES) break;
    if (row.status_real==='PAUSADA') continue;
    if (campanhasJaProcessadas.has(row.campaign_id)) { totalSkipDedup++; continue; }
    campanhasJaProcessadas.add(row.campaign_id);
    const tipo = row.tipo_campanha||'outro';
    const roas = row.roas_pixel>0?Number(row.roas_pixel):Number(row.roas_d3);
    const gasto = Number(row.gasto_30d)||0;
    const clientes = Number(row.clientes_reais)||0;
    const segmento = await resolverSegmento(row.campaign_id, row.campaign_name);
    const criterios = await buscarCriterios(segmento);
    const gastoMinPausar    = criterios?.pausar?.gasto    ?? THRESHOLDS_FALLBACK[tipo]?.gasto_min_pausar    ?? 600;
    const roasMinPausarBase = criterios?.pausar?.roas     ?? THRESHOLDS_FALLBACK[tipo]?.roas_min_pausar     ?? 0.5;
    const roasMinEscalarBase = criterios?.escalar?.roas   ?? THRESHOLDS_FALLBACK[tipo]?.roas_bom_escalar    ?? 2.0;
    const leadsMinEscalar   = criterios?.escalar?.leads   ?? THRESHOLDS_FALLBACK[tipo]?.clientes_min_escalar ?? 3;
    const roasMinEscalar    = roasMinEscalarBase * fator;
    const roasCamila        = roasMinEscalar * 1.5;
    const urgenciaStr       = urgencia !== 'normal' ? ` | URGENCIA: ${urgencia.toUpperCase()}, ${diasUteis} dias uteis restantes` : '';
    try {
      const roas_critico       = roas < roasMinPausarBase * 0.5;
      const sem_leads_recentes = Number(row.leads_30d || 0) === 0;
      const elegivel_pausa =
        gasto >= gastoMinPausar &&
        roas  < roasMinPausarBase &&
        (clientes <= 1 || roas_critico || (tipo === 'remarketing' && sem_leads_recentes));
      if(elegivel_pausa){
        if(await jaFeitoHoje('pausar_campanha',row.campaign_id))continue;
        const statusMeta=await meta.getStatusCampanha(row.campaign_id);
        if(statusMeta!=='ACTIVE')continue;
        decisoes.push({ acao:'pausar_campanha', campaign_id:row.campaign_id, campaign_name:row.campaign_name, tipo_campanha:tipo, segmento, motivo:`ROAS ${roas}x | gasto R$${gasto.toFixed(0)}${urgenciaStr}`, impacto_financeiro:gasto, urgencia:'alta', requer_aprovacao: !podePausar, dados:{roas,gasto,clientes,tipo} });
      } else {
        const leadsTotal          = Number(row.leads_30d || 0);
        const clientesMinAbsoluto = 3;
        const leadsSuficientes    = leadsTotal >= leadsMinEscalar;
        const clientesSuficientes = clientes   >= clientesMinAbsoluto;
        if(roas>=roasMinEscalar && leadsSuficientes && clientesSuficientes && gasto>=200){
          if(await jaFeitoHoje('escalar_orcamento',row.campaign_id))continue;
          const gerarCriativo=roas>=roasCamila&&!(await jaExperimentouHoje('variacao_criativo',row.campaign_id));
          decisoes.push({ acao:'escalar_orcamento', campaign_id:row.campaign_id, campaign_name:row.campaign_name, tipo_campanha:tipo, segmento, roas, novo_orcamento_sugerido:Math.round(gasto*(urgencia==='critica'?1.5:urgencia==='muito_alta'?1.4:1.3)/30), motivo:`ROAS ${roas}x | ${clientes} clientes | leads ${leadsTotal} | threshold: ${roasMinEscalar.toFixed(1)}x${urgenciaStr}`, impacto_financeiro:gasto*0.3, urgencia:urgencia==='critica'||urgencia==='muito_alta'?'alta':'media', requer_aprovacao: !podeEscalar, gerar_criativo:gerarCriativo, dados:{roas,gasto,clientes,tipo,urgencia_meta:urgencia,dias_uteis_restantes:diasUteis} });
        }
      }
    } catch(e:any){await logErro('analisar_campanha_row',e.message,{campaign:row.campaign_name});}
  }
  if (totalSkipDedup > 0) {
    clog('analisar_campanhas', 'dedup_aplicado', { campanhas_unicas: campanhasJaProcessadas.size, linhas_pulada_dedup: totalSkipDedup, total_linhas_perf: perf.length, decisoes_geradas: decisoes.length });
  }
  return decisoes;
}

async function analisarPublicos(perf: any[], publicos: any[], meta: MetaConnector, ouro: any) {
  const propostas: any[] = [];
  const podeCriarPublico = await podeExecutarDiretamente('criar_publico');

  // v8.7.0: expirado NAO e mais gatilho automatico de criacao.
  // So propoe se a config for integralmente reproduzivel (rule persistida).
  const naoPropostos: any[] = [];
  for (const p of publicos.filter(p => p.delivery_status?.code === 300 && ['WEBSITE','IG_BUSINESS','ENGAGEMENT'].includes(p.subtype)).slice(0, 3)) {
    if (propostas.length >= MAX_PUBLICOS) break;
    if (await jaExperimentouHoje('recriar_expirado', p.id)) continue;
    const cfg = montarConfigCriacao(p);
    if (!cfg.ok) { naoPropostos.push({ audience_id: p.id, nome: p.name, subtype: p.subtype, motivo: cfg.motivo }); continue; }
    propostas.push({ tipo:'recriar_expirado', acao:'criar_publico', audience_source:p.id, audience_name:p.name, account_id:p.account_id, motivo:`Publico expirado e integralmente reproduzivel.`, config: cfg.value, requer_aprovacao: !podeCriarPublico });
  }
  if (naoPropostos.length > 0) {
    clog('recriar_expirado', 'nao_proposto', { total: naoPropostos.length, motivo_geral: 'sem_necessidade_comercial', itens: naoPropostos.slice(0, 5) });
  }

  const boa=perf.find(r=>r.status_real==='ATIVA'&&(Number(r.roas_pixel)>=3||Number(r.roas_d3)>=3)&&Number(r.clientes_reais)>=3);
  if(boa&&propostas.length<MAX_PUBLICOS){
    const nome=`compradores_${boa.campaign_name?.slice(0,30)}_30D`;
    if(!publicos.some(p=>p.name?.toLowerCase().includes(nome.toLowerCase()))&&!(await jaExperimentouHoje('criar_lal',boa.campaign_id))){
      propostas.push({tipo:'criar_lal',acao:'criar_publico_lal',audience_source:boa.campaign_id,audience_name:`LAL 1% - ${nome}`,account_id:meta.accountId,motivo:`ROAS ${boa.roas_pixel}x. Criar LAL 1%.`,config:{name:`LAL 1% - ${nome}`,subtype:'LOOKALIKE',lookalike_spec:{country:'BR',ratio:0.01,type:'custom_ratio'}},requer_aprovacao:!podeCriarPublico});
    }
  }
  return { propostas, naoPropostos };
}

async function avaliarRecomendacoesDiego(recsDiego: any[], perf: any[], decisoes: any[], propostas: any[], nivel: number) {
  if (!recsDiego?.length) return { concordancias: 0, divergencias: 0 };
  const concordancias: any[] = [];
  const divergencias: any[] = [];
  for (const rec of recsDiego) {
    const nomeRec = rec.campaign_name || rec.campaign_id;
    if (!nomeRec) continue;
    const campanha = perf.find((p: any) => p.campaign_name === nomeRec || p.campaign_id === nomeRec);
    const decisaoBate = decisoes.find((d: any) => (d.campaign_name === nomeRec || d.campaign_id === nomeRec) && d.acao === rec.acao);
    const propostaBate = propostas.find((p: any) => p.acao === rec.acao && (p.audience_name?.includes(nomeRec) || p.audience_source === nomeRec));
    if (decisaoBate) {
      decisaoBate.dados = decisaoBate.dados || {};
      decisaoBate.dados.confirmou_diego = true;
      decisaoBate.dados.diego_impacto_est = rec.impacto_estimado_r;
      concordancias.push({ campanha: nomeRec, acao: rec.acao, diego_motivo: rec.motivo, gustavo_motivo: decisaoBate.motivo, diego_impacto_est: rec.impacto_estimado_r });
    } else if (propostaBate) {
      concordancias.push({ campanha: nomeRec, acao: rec.acao, diego_motivo: rec.motivo, gustavo_motivo: propostaBate.motivo, diego_impacto_est: rec.impacto_estimado_r });
    } else if (campanha) {
      const roas = Number(campanha.roas_pixel) || Number(campanha.roas_d3) || 0;
      const gasto = Number(campanha.gasto_30d) || 0;
      const clientes = Number(campanha.clientes_reais) || 0;
      const status = campanha.status_real || 'desconhecido';
      let motivo = 'criterio_nao_atendido';
      if (status === 'PAUSADA') motivo = 'campanha_ja_pausada';
      else if (rec.acao === 'escalar_orcamento') {
        if (roas < 2.0) motivo = `roas_baixo (${roas.toFixed(2)}x < 2.0x)`;
        else if (clientes < 3) motivo = `clientes_insuficientes (${clientes} < 3)`;
        else if (gasto < 200) motivo = `gasto_baixo (R$${gasto.toFixed(0)} < R$200)`;
      } else if (rec.acao === 'pausar_campanha') {
        if (roas >= 0.5) motivo = `roas_aceitavel (${roas.toFixed(2)}x >= 0.5x)`;
        else if (gasto < 1000) motivo = `gasto_baixo (R$${gasto.toFixed(0)} < R$1000)`;
        else if (clientes > 1) motivo = `tem_clientes (${clientes} > 1)`;
      }
      divergencias.push({ campanha: nomeRec, acao_diego: rec.acao, diego_motivo: rec.motivo, diego_impacto_est: rec.impacto_estimado_r, gustavo_dados: { roas, gasto, clientes, status }, motivo_divergencia: motivo });
    } else {
      divergencias.push({ campanha: nomeRec, acao_diego: rec.acao, diego_motivo: rec.motivo, diego_impacto_est: rec.impacto_estimado_r, motivo_divergencia: 'campanha_nao_encontrada_em_perf' });
    }
  }
  await registrarDecisao({ acao: 'avaliacao_input_diego', resultado: 'executada', nivel, contexto: { trigger: 'diego_input', total_recs_diego: recsDiego.length, concordancias: concordancias.length, divergencias: divergencias.length }, decisao: { concordancias, divergencias: divergencias.slice(0, 10), divergencias_truncadas: divergencias.length > 10 }, impacto: null, dry_run: false });
  clog('diego_input', 'avaliado', { recs: recsDiego.length, concordancias: concordancias.length, divergencias: divergencias.length });
  return { concordancias: concordancias.length, divergencias: divergencias.length };
}

async function processarDecisoes(decisoes: any[], dryRun: boolean, meta: MetaConnector, urgencia: string, diasUteis: number, nivel: number) {
  let primeiro=true;
  for(const d of decisoes){
    try{
      const decisionId = await registrarDecisao({
        acao: dryRun ? 'simulado' : (d.requer_aprovacao ? 'proposta_enviada' : d.acao),
        resultado: dryRun ? 'proposta' : (d.requer_aprovacao ? 'pendente_aprovacao' : 'sucesso'),
        nivel,
        contexto: { campaign_id:d.campaign_id, campaign_name:d.campaign_name, segmento:d.segmento, platform:'meta', urgencia_meta:urgencia, dias_uteis_restantes:diasUteis, tipo:d.tipo_campanha, dados:d.dados },
        decisao: { acao:d.acao, motivo:d.motivo, novo_orcamento:d.novo_orcamento_sugerido, requer_aprovacao:d.requer_aprovacao, gerar_criativo:d.gerar_criativo },
        impacto: d.impacto_financeiro,
        dry_run: dryRun,
      });
      if(dryRun)continue;
      if(d.requer_aprovacao){
        const rpcOpcoes=[{acao:d.acao,platform:'meta',campaign_id:d.campaign_id,campaign_name:d.campaign_name,novo_orcamento:d.novo_orcamento_sugerido,segmento:d.segmento,roas:d.dados?.roas??d.roas??null,clientes:d.dados?.clientes??null,gasto:d.dados?.gasto??null,motivo_tecnico:d.motivo??null}];
        const{data:aprData,error:aprErr}=await sb.rpc('fn_inserir_aprovacao_midia',{
          p_titulo:`${d.acao}: ${d.campaign_name}`,
          p_descricao:d.motivo,
          p_impacto_estimado:`R$${d.impacto_financeiro?.toFixed(0)}`,
          p_impacto_financeiro:d.impacto_financeiro,
          p_opcoes:rpcOpcoes,
          p_enviado_whatsapp:false,
          p_expira_em:new Date(Date.now()+86400000).toISOString(),
        });
        if(aprErr||!aprData?.ok){
          await logErro('aprovacoes_rpc_err',String(aprErr?.message??aprData?.erro??'unknown'),{acao:d.acao,campaign_id:d.campaign_id,campaign_name:d.campaign_name});
        } else {
          clog('aprovacoes_rpc','ok',{id:aprData.id,acao:d.acao,campaign_id:d.campaign_id});
        }
      }
      if(!primeiro)await sleep(DELAY_MS);primeiro=false;
      if(d.acao==='escalar_orcamento'&&d.gerar_criativo){
        const adsetId=await buscarAdset(d.campaign_id);
        const r=await chamarCamila({campaign_id:d.campaign_id,campaign_name:d.campaign_name,adset_id:adsetId,segmento:d.segmento,roas:d.roas,account_id:'act_300454634851581',dryRun,urgencia,dias_uteis_restantes:diasUteis});
        if(r.ok&&r.ads_criados.length>0)d.motivo+=` | Camila criou ${r.ads_criados.length} variacoes`;
      }
      if(d.requer_aprovacao){
        const emoji=d.acao==='pausar_campanha'?'\u23f8\ufe0f':'\ud83d\udcb0';
        const urgEmoji=urgencia==='critica'?'\ud83d\udea8':urgencia==='muito_alta'?'\ud83d\udd34':urgencia==='alta'?'\u26a0\ufe0f':'';
        const msg=[`${emoji} ${urgEmoji} *Agente de Midia*`,'',`*Acao:* ${d.acao==='pausar_campanha'?'Pausar':'Escalar'}`,`*Campanha:* ${d.campaign_name}`,`*Segmento:* ${d.segmento}`,`*Motivo:* ${d.motivo}`,d.novo_orcamento_sugerido?`*Novo orcamento:* R$${d.novo_orcamento_sugerido}/dia`:'',urgencia!=='normal'?`*Meta:* urgencia ${urgencia} | ${diasUteis} dias uteis`:'','Confirma?'].filter(Boolean).join('\n');
        const enviado=await enviarWpp(msg,[{id:`sim_campanha_${d.campaign_id}_${d.acao}`,title:'\u2705 Sim'},{id:`nao_campanha_${d.campaign_id}_${d.acao}`,title:'\u274c Nao'}]);
        clog('wpp_enviado',enviado?'ok':'falhou',{acao:d.acao,campaign_id:d.campaign_id});
      } else {
        // ===== v8.8.0: caminho de execucao direta, agora comprovavel =====
        const orcamentoCentavos = d.acao === 'escalar_orcamento' ? Math.round(Number(d.novo_orcamento_sugerido) * 100) : null;
        const estadoDesejado = d.acao === 'pausar_campanha' ? { status: 'PAUSED', effective_status: 'PAUSED' } : { daily_budget: orcamentoCentavos };
        const endpoint = `POST https://graph.facebook.com/v24.0/${d.campaign_id}`;
        const payloadPretendido = d.acao === 'pausar_campanha' ? { status: 'PAUSED' } : { daily_budget: orcamentoCentavos };

        // 1. estado ANTES (GET, nao altera nada)
        const estadoAntes = await meta.lerCampanha(d.campaign_id);

        // 2. tentativa persistida ANTES de qualquer POST
        const { id: tentativaId, contextoBase } = await abrirTentativaCampanha({
          decisionId, acao: d.acao, campaignId: d.campaign_id, campaignName: d.campaign_name,
          segmento: d.segmento, motivo: d.motivo, endpoint, payload: payloadPretendido,
          estadoDesejado, estadoAntes, dryRun: false,
        });

        if (!EXECUCAO_CAMPANHA_HABILITADA) {
          await fecharTentativaCampanha(tentativaId, 'bloqueada_por_flag', {
            ...contextoBase,
            bloqueio: 'EXECUCAO_CAMPANHA_HABILITADA=false',
            observacao: 'Nenhuma chamada de escrita foi feita a Meta. Payload registrado para conferencia antes do canario.',
            fechado_em: new Date().toISOString(),
          }, null);
          clog('acao_campanha','bloqueada_por_flag',{acao:d.acao,campaign_id:d.campaign_id,tentativa_id:tentativaId});
          await enviarWpp(`\u26d4 *Agente de Midia:* ${d.acao} em ${d.campaign_name} foi DECIDIDA mas NAO executada.\nExecucao externa de campanha esta desligada (canario pendente de autorizacao).\nTentativa registrada para conferencia.`);
          continue;
        }

        // 3. chamada com timeout
        const r: any = d.acao==='pausar_campanha' ? await meta.pausarCampanha(d.campaign_id) : await meta.escalarOrcamento(d.campaign_id, d.novo_orcamento_sugerido);

        // 4. releitura do estado observado
        const estadoDepois = await meta.lerCampanha(d.campaign_id);

        // 5. desejado x observado
        const desfecho = classificarDesfecho(d.acao, r, estadoDepois, estadoDesejado);
        const agora = new Date().toISOString();

        await fecharTentativaCampanha(tentativaId, desfecho.resultado, {
          ...contextoBase,
          http_status: r?.http_status ?? null,
          meta_response: r?.response ?? null,
          meta_trace: r?.meta_trace ?? null,
          payload_enviado: r?.payload_enviado ?? payloadPretendido,
          resposta_resumo: r?.resultado ?? null,
          estado_depois: estadoDepois,
          desfecho_motivo: desfecho.motivo,
          fechado_em: agora,
        }, agora);

        await carimbarExecucaoNaDecisao(decisionId, desfecho.sucesso, desfecho.sucesso === null ? null : agora);

        if(!r?.ok)await logErro('api_meta_'+d.acao,String(r?.resultado ?? 'sem detalhe'),{campaign_id:d.campaign_id,desfecho:desfecho.resultado});
        const icone = desfecho.resultado === 'confirmada_na_meta' ? '\u2705' : desfecho.resultado === 'falhou' ? '\u274c' : '\u26a0\ufe0f';
        await enviarWpp(`${icone} *Agente de Midia:* ${d.acao} em ${d.campaign_name}\nDesfecho: ${desfecho.resultado}\n${desfecho.motivo}`);
      }
    } catch(e:any){await logErro('processar_decisao',e.message,{acao:d.acao,campaign:d.campaign_name});}
  }
}

async function processarPublicos(propostas: any[], dryRun: boolean, meta: MetaConnector, nivel: number) {
  let primeiro = true;
  for (const p of propostas) {
    try {
      await registrarDecisao({ acao: dryRun ? 'simulado_publico' : (p.requer_aprovacao ? 'proposta_publico_enviada' : p.acao), resultado: dryRun ? 'proposta' : (p.requer_aprovacao ? 'pendente_aprovacao' : 'sucesso'), nivel, contexto: { tipo: p.tipo, audience_source: p.audience_source, audience_name: p.audience_name, account_id: p.account_id, platform: 'meta' }, decisao: { acao: p.acao, motivo: p.motivo, requer_aprovacao: p.requer_aprovacao, config: p.config }, impacto: null, dry_run: dryRun });

      const contextoBase = { config: p.config, account_id: p.account_id };

      const { data: expRow, error: expErr } = await sb
        .from('agente_midia_experimentos')
        .insert({
          tipo: p.tipo,
          acao: p.acao,
          audience_source: p.audience_source,
          audience_name: p.audience_name,
          motivo: p.motivo,
          resultado: dryRun ? 'dry_run' : 'pendente',
          dry_run: dryRun,
          contexto: contextoBase,
        })
        .select('id')
        .single();

      if (expErr || !expRow?.id) {
        await logErro('insert_experimento', expErr?.message ?? 'insert sem retorno', { tipo: p.tipo, nome: p.audience_name, code: expErr?.code ?? null, details: expErr?.details ?? null, hint: expErr?.hint ?? null });
        continue;
      }

      if (dryRun) continue;

      if (p.requer_aprovacao) {
        const rpcOpcoesPublico = [{ acao: p.acao, tipo: p.tipo, config: p.config, account_id: p.account_id, audience_source: p.audience_source }];
        const { data: pubAprData, error: pubAprErr } = await sb.rpc('fn_inserir_aprovacao_midia', {
          p_titulo: `Criar publico: ${p.audience_name}`,
          p_descricao: p.motivo,
          p_opcoes: rpcOpcoesPublico,
          p_enviado_whatsapp: false,
          p_expira_em: new Date(Date.now() + 172800000).toISOString(),
        });
        if (pubAprErr || !pubAprData?.ok) {
          await logErro('aprovacoes_publico_rpc_err', String(pubAprErr?.message ?? pubAprData?.erro ?? 'unknown'), { tipo: p.tipo, audience_source: p.audience_source, audience_name: p.audience_name });
        } else {
          clog('aprovacoes_publico_rpc', 'ok', { id: pubAprData.id, tipo: p.tipo, audience_source: p.audience_source });
        }
      }

      if (!primeiro) await sleep(DELAY_MS);
      primeiro = false;

      if (p.requer_aprovacao) {
        const emoji = p.tipo === 'criar_lal' ? '\ud83c\udfaf' : p.tipo === 'recriar_expirado' ? '\u267b\ufe0f' : '\ud83e\uddea';
        const msg = [`${emoji} *Agente de Midia - Publico*`, '', `*Nome:* ${p.audience_name}`, `*Motivo:* ${p.motivo}`, '', 'Criar?'].join('\n');
        const enviado = await enviarWpp(msg, [{ id: `sim_publico_${p.audience_source}`, title: '\u2705 Criar' }, { id: `nao_publico_${p.audience_source}`, title: '\u274c Nao' }]);
        clog('wpp_publico_enviado', enviado ? 'ok' : 'falhou', { tipo: p.tipo, audience_source: p.audience_source });
      } else {
        const r = await meta.criarPublico(p.account_id, p.config);

        if (r.ok && !r.audience_id) {
          await logErro('criar_publico_indeterminado', 'meta_ok_sem_audience_id', { nome: p.audience_name, resposta: JSON.stringify(r).slice(0, 300) });
          await sb.from('agente_midia_experimentos')
            .update({ contexto: { ...contextoBase, erro: 'meta_ok_sem_audience_id' } })
            .eq('id', expRow.id)
            .select('id')
            .single();
          continue;
        }

        if (r.ok && r.audience_id) {
          const executadoEm = new Date().toISOString();
          const { data: updatedExp, error: updErr } = await sb
            .from('agente_midia_experimentos')
            .update({ audience_id: r.audience_id, resultado: 'executado', executado_em: executadoEm })
            .eq('id', expRow.id)
            .select('id, audience_id, resultado')
            .single();

          if (updErr || updatedExp?.id !== expRow.id || updatedExp?.audience_id !== r.audience_id || updatedExp?.resultado !== 'executado') {
            await logErro('update_experimento', updErr?.message ?? 'update sem confirmacao da linha', { id: expRow.id, audience_id: r.audience_id, code: updErr?.code ?? null, details: updErr?.details ?? null, hint: updErr?.hint ?? null });
            continue;
          }

          await enviarWpp(`\u2705 *Agente de Midia:* Publico \"${p.audience_name}\" criado.`);
        } else {
          clog('criar_publico', 'falhou', { nome: p.audience_name, resposta: JSON.stringify(r).slice(0, 300) });
          await logErro('criar_publico', r.erro || 'erro', { nome: p.audience_name });
          const { data: falhaRow, error: falhaErr } = await sb
            .from('agente_midia_experimentos')
            .update({ resultado: 'falhou', contexto: { ...contextoBase, erro: r.erro ?? 'falha sem detalhe' } })
            .eq('id', expRow.id)
            .select('id, resultado')
            .single();
          if (falhaErr || falhaRow?.resultado !== 'falhou') {
            await logErro('update_experimento_falha', falhaErr?.message ?? 'update de falha sem confirmacao', { id: expRow.id, code: falhaErr?.code ?? null });
          }
        }
      }
    } catch (e: any) {
      await logErro('processar_publico', e.message, { nome: p.audience_name });
    }
  }
}

Deno.serve(async(req)=>{
  const tInicio=Date.now();
  let body:any={};
  try{body=await req.json();}catch{}
  const execId=await execStart(body.mode||'analisar',{modo:body.mode,dry_run:body.dry_run});
  try{
    const config=await getConfig();
    if(config.status==='pausado'&&!body.force_run){
      await registrarDecisao({ acao:'nenhum', resultado:'executada', nivel:config.nivel, contexto:{trigger:'cron',modo:body.mode||'analisar'}, decisao:{motivo:'agente_pausado',status_agente:config.status}, impacto:null, dry_run:false });
      await execFinish(execId,'ok',Date.now()-tInicio,{skipped:true});
      return new Response(JSON.stringify({ok:true,skipped:true}),{status:200});
    }
    const dryRun=body.dry_run===true||config.dryRun;
    const meta=new MetaConnector({META_PAGE_TOKEN:Deno.env.get('META_PAGE_TOKEN')||'',META_ACCESS_TOKEN:Deno.env.get('META_ACCESS_TOKEN')||''});
    const ctxTemporal = await buscarContextoTemporal();
    const ehDiaUtil = ctxTemporal?.hoje?.eh_dia_util ?? true;
    const urgencia = ctxTemporal?.urgencia ?? 'normal';
    const diasUteis = ctxTemporal?.mes?.dias_uteis_restantes ?? 10;
    const tom = ctxTemporal?.tom_esperado ?? 'equilibrado';
    clog('start','contexto_temporal',{ehDiaUtil,urgencia,diasUteis,tom,execucao_campanha_habilitada:EXECUCAO_CAMPANHA_HABILITADA});
    if (!ehDiaUtil && !body.force_run) {
      await monitorarCriativos();
      await registrarDecisao({ acao:'nenhum', resultado:'executada', nivel:config.nivel, contexto:{trigger:'cron',modo:body.mode||'analisar',urgencia,dias_uteis:diasUteis}, decisao:{motivo:'dia_nao_util',monitorou_criativos:true}, impacto:null, dry_run:false });
      await execFinish(execId,'ok',Date.now()-tInicio,{skipped:true,motivo:'dia_nao_util',urgencia});
      return new Response(JSON.stringify({ok:true,dia_nao_util:true,urgencia,monitorizou_criativos:true}),{status:200});
    }
    if(body.mode==='executar'){
      if (config.nivel < 2) {
        let aprovacaoValida = false;
        if (body.aprovacao_id) {
          const { data: apr } = await sb.from('agente_aprovacoes').select('id,status').eq('id',body.aprovacao_id).eq('status','aprovado').maybeSingle();
          aprovacaoValida = !!apr;
        } else {
          const { data: aprs } = await sb.from('agente_aprovacoes').select('id,status,opcoes').eq('agente_slug','agente-midia').eq('status','aprovado').gte('created_at',new Date(Date.now()-86400000).toISOString());
          aprovacaoValida = (aprs||[]).some((a:any) =>
            Array.isArray(a.opcoes) && a.opcoes.some((o:any) =>
              o?.campaign_id === body.campaign_id && o?.acao === body.acao
            )
          );
        }
        if (!aprovacaoValida) {
          await logErro('executar_bloqueado_nivel1','Execucao direta sem aprovacao registrada no nivel 1',{acao:body.acao,campaign_id:body.campaign_id,aprovacao_id:body.aprovacao_id??null});
          await execFinish(execId,'bloqueado',Date.now()-tInicio,{motivo:'nivel1_sem_aprovacao'});
          return new Response(JSON.stringify({ok:false,erro:'Bloqueado: aprovacao nao encontrada para execucao no nivel 1'}),{status:403});
        }
      }
      if(body.acao==='criar_publico'){
        const r=await meta.criarPublico(body.account_id,body.config);
        if(!r.ok)await logErro('executar_criar_publico',r.erro||'erro',{account_id:body.account_id});
        await execFinish(execId,r.ok?'ok':'erro',Date.now()-tInicio,r);
        return new Response(JSON.stringify(r),{status:200});
      }
      // v8.8.0: a trava vale tambem para o modo executar manual.
      if(!EXECUCAO_CAMPANHA_HABILITADA){
        await logErro('executar_bloqueado_flag','EXECUCAO_CAMPANHA_HABILITADA=false',{acao:body.acao,campaign_id:body.campaign_id});
        await execFinish(execId,'bloqueado',Date.now()-tInicio,{motivo:'execucao_campanha_desligada'});
        return new Response(JSON.stringify({ok:false,erro:'Bloqueado: execucao externa de campanha desligada (EXECUCAO_CAMPANHA_HABILITADA=false)'}),{status:403});
      }
      const{ok,resultado}=body.acao==='pausar_campanha'?await meta.pausarCampanha(body.campaign_id):await meta.escalarOrcamento(body.campaign_id,body.novo_orcamento_sugerido);
      if(!ok)await logErro('executar_'+body.acao,String(resultado),{campaign_id:body.campaign_id});
      await execFinish(execId,ok?'ok':'erro',Date.now()-tInicio,{ok,resultado});
      return new Response(JSON.stringify({ok,resultado}),{status:200});
    }
    clog('start','analisando',{nivel:config.nivel,dryRun,urgencia,diasUteis,recs_diego:body.recomendacoes_diego?.length||0});
    const ouro=await buscarOuro();
    await monitorarCriativos();
    const[perf,publicos]=await Promise.all([
      sb.from('vw_agente_midia_campanhas').select('*').then(r=>{if(r.error)throw new Error(r.error.message);return r.data||[];}),
      sb.from('dim_audiences').select('id,name,subtype,approximate_count,delivery_status,negocio,account_id,retention_days,data_source').eq('negocio','skillprint').order('approximate_count',{ascending:false}).then(r=>r.data||[]),
    ]);
    const decisoes=await analisarCampanhas(perf,meta,ouro,urgencia,diasUteis);
    const { propostas, naoPropostos } = await analisarPublicos(perf,publicos,meta,ouro);
    if (naoPropostos.length > 0) {
      await registrarDecisao({ acao:'nao_proposto', resultado:'executada', nivel:config.nivel, contexto:{trigger:'cron',platform:'meta',total_nao_propostos:naoPropostos.length}, decisao:{motivo:'sem_necessidade_comercial',criterio:'expirado_isolado_nao_gera_acao',itens:naoPropostos.slice(0,10)}, impacto:null, dry_run:dryRun });
    }
    const recsDiego = body.recomendacoes_diego || [];
    let avalDiego = { concordancias: 0, divergencias: 0 };
    if (recsDiego.length > 0) { avalDiego = await avaliarRecomendacoesDiego(recsDiego, perf, decisoes, propostas, config.nivel); }
    await processarDecisoes(decisoes,dryRun,meta,urgencia,diasUteis,config.nivel);
    await processarPublicos(propostas,dryRun,meta,config.nivel);
    await analisarObjetivosCampanhas(perf,dryRun,meta,ehDiaUtil);
    if (decisoes.length === 0 && propostas.length === 0) {
      await registrarDecisao({ acao:'nenhum', resultado:'executada', nivel:config.nivel, contexto:{trigger:'cron',modo:body.mode||'analisar',urgencia,dias_uteis:diasUteis,campanhas_analisadas:perf.length,publicos_analisados:publicos.length,recs_diego:recsDiego.length}, decisao:{motivo:'sem_trabalho_elegivel',monitorou_criativos:true,nao_propostos:naoPropostos.length,divergencias_diego:avalDiego.divergencias}, impacto:null, dry_run:dryRun });
    }
    const duracao=Date.now()-tInicio;
    await execFinish(execId,'ok',duracao,{campanhas:perf.length,decisoes:decisoes.length,publicos:propostas.length,nao_propostos:naoPropostos.length,urgencia,dias_uteis_restantes:diasUteis,recs_diego:recsDiego.length,concordancias_diego:avalDiego.concordancias,divergencias_diego:avalDiego.divergencias,execucao_campanha_habilitada:EXECUCAO_CAMPANHA_HABILITADA});
    return new Response(JSON.stringify({ok:true,versao:AGENT_VERSION,nivel:config.nivel,dry_run:dryRun,execucao_campanha_habilitada:EXECUCAO_CAMPANHA_HABILITADA,urgencia_meta:urgencia,dias_uteis_restantes:diasUteis,campanhas_analisadas:perf.length,decisoes_campanha:decisoes.length,propostas_publico:propostas.length,nao_propostos:naoPropostos.length,recs_diego_recebidas:recsDiego.length,concordancias:avalDiego.concordancias,divergencias:avalDiego.divergencias}),{status:200});
  }catch(e:any){
    await logErro('fatal',String(e));
    await execFinish(execId,'fatal',Date.now()-tInicio,{},[String(e)]);
    return new Response(JSON.stringify({ok:false,erro:String(e)}),{status:500});
  }
});
