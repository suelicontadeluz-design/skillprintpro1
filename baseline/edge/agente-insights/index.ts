// agente-insights v2.6.0
// v2.6.0: shadow fail-closed durante a janela de midia. Diego NAO chama Gustavo,
// NAO autoriza acao e correlaciona cada campanha ao obs:cron: do mesmo dia.
// Fontes deixam de transformar erro em array vazio; acerto deixa de ser carimbado true.
// v2.5.0: FRENTE diego-prompt-forca-recomendacao. M1: prompt recebe SO campanhas ATIVAS (pausadas viram contagem). M2: piso de 2 recomendacoes removido, lista vazia e resposta valida. M3: escalar alinhado ao criterio de avaliarRecomendacoesDiego (ROAS>=2.0 E clientes>=3 E gasto>=200). M4: relatorio nao afirma que Gustavo esta executando quando nao ha recomendacao. Log passa a gravar ativas/pausadas/elegiveis para o aceite.
// v2.4.0: FIX RAIZ - max_tokens 1500->4000 (JSON truncava e parse falhava silencioso). Motivos concisos. Debug removido.
// v2.3.1: instrui ignorar rotulo performance, julgar por clientes_reais
// v2.3.0: prompt agressivo - minimo 2 recs, prioriza escalar, regra anti-atribuicao-perdida no pausar
// v2.2.1: fix modelo depreciado claude-sonnet-4-20250514 -> claude-sonnet-4-6
// v2.2.0: Log resiliente em agente_decisoes_log com padrao 2-fases
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const ALESSANDRO_SUBSCRIBER_ID = '773845540';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
const AGENT_VERSION = 'agente-insights-v2.6.0';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// M3: mesmos limiares usados por avaliarRecomendacoesDiego() no agente-midia.
// NAO sao os criterios dinamicos por segmento (vw_criterios_midia) de proposito:
// unificar as duas politicas e a frente criterios-midia-inconsistentes.
const ESCALAR_ROAS_MIN = 2.0;
const ESCALAR_CLIENTES_MIN = 3;
const ESCALAR_GASTO_MIN = 200;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const clog = (s: string, t: string, d: any = {}) => console.log(JSON.stringify({ s, t, v: AGENT_VERSION, ts: new Date().toISOString(), ...d }));

const ehAtiva = (c: any) => c?.status_real === 'ATIVA';
const elegivelEscalar = (c: any) => Number(c?.roas_pixel || 0) >= ESCALAR_ROAS_MIN && Number(c?.clientes_reais || 0) >= ESCALAR_CLIENTES_MIN && Number(c?.gasto_30d || 0) >= ESCALAR_GASTO_MIN;

async function execStart(modo: string, inputs: any = {}): Promise<string | null> {
  try { const { data } = await sb.rpc('fn_exec_start', { p_agente: 'agente-insights', p_versao: AGENT_VERSION, p_modo: modo, p_inputs: inputs }); return data; } catch { return null; }
}
async function execFinish(id: string | null, status: string, ms: number, outputs: any = {}, erros: any[] = []): Promise<void> {
  if (!id) return;
  try { await sb.rpc('fn_exec_finish', { p_exec_id: id, p_status: status, p_ms: ms, p_outputs: outputs, p_erros: erros }); } catch {}
}
async function logErro(passo: string, erro: string, ctx: any = {}): Promise<void> {
  clog(passo, 'erro', { error: erro.slice(0, 200), ...ctx });
  try { await sb.rpc('fn_log_erro', { p_agente: 'agente-insights', p_versao: AGENT_VERSION, p_passo: passo, p_erro: erro.slice(0, 500), p_contexto: ctx }); } catch {}
}

async function enviarWhatsApp(msg: string) {
  try {
    const res = await fetch(`${BOT_BASE}/subscriber/${ALESSANDRO_SUBSCRIBER_ID}/send_message/`, {
      method: 'POST', headers: { 'accept': 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify({ type: 'text', value: msg }),
    });
    if (!res.ok) {
      await logErro('enviar_whatsapp', `HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e: any) { await logErro('enviar_whatsapp', e.message); return false; }
}

async function getNivel() {
  try {
    const { data } = await sb.from('agentes').select('nivel_autonomia_atual,dry_run_ativo').eq('slug','agente-insights').maybeSingle();
    return { nivel: data?.nivel_autonomia_atual ?? 0, dryRun: data?.dry_run_ativo ?? true };
  } catch { return { nivel: 0, dryRun: true }; }
}

async function coletarDados() {
  clog('coletar_dados', 'iniciando');
  try {
    const [cacR, ouroR, campanhasR, leadsR, comprasR, metaR] = await Promise.all([
      sb.from('vw_cac_por_segmento').select('*').order('receita_total',{ascending:false}),
      sb.rpc('fn_contexto_midia_ouro',{p_segmento:null,p_campaign_id:null}),
      sb.from('vw_agente_midia_campanhas').select('*'),
      sb.from('leads_marketing').select('content_category,utm_campaign_id').gte('created_at',new Date(Date.now()-7*86400000).toISOString()),
      sb.from('pixel_events').select('lead_id,value,event_time').eq('event_name','Purchase').gte('event_time',new Date(Date.now()-7*86400000).toISOString()),
      sb.rpc('fn_contexto_meta_cerebro'),
    ]);
    const respostas = [
      ['vw_cac_por_segmento', cacR], ['fn_contexto_midia_ouro', ouroR],
      ['vw_agente_midia_campanhas', campanhasR], ['leads_marketing', leadsR],
      ['pixel_events', comprasR], ['fn_contexto_meta_cerebro', metaR],
    ] as const;
    const falhas = respostas.filter(([,r])=>r.error).map(([fonte,r])=>`${fonte}: ${r.error?.message}`);
    if (falhas.length) throw new Error(`fontes_indisponiveis: ${falhas.join(' | ')}`);
    const cac = cacR.data || [];
    const ouro = ouroR.data || {};
    const campanhas = campanhasR.data || [];
    const leadsRecentes = leadsR.data || [];
    const comprasRecentes = comprasR.data || [];
    const meta = (metaR.data as any)?.meta ?? {};
    clog('coletar_dados', 'ok', { cac: cac.length, campanhas: campanhas.length, ativas: campanhas.filter(ehAtiva).length, leads7d: leadsRecentes.length, compras7d: comprasRecentes.length });
    return { cac, ouro, campanhas, leadsRecentes, comprasRecentes, meta };
  } catch (e: any) {
    await logErro('coletar_dados', e.message);
    throw e;
  }
}

function validarRecomendacoes(recs: any[], campanhas: any[]): any[] {
  const permitidas = new Set(['escalar_orcamento','pausar_campanha','criar_criativo','criar_publico','testar_segmento']);
  const porId = new Map((campanhas||[]).map((c:any)=>[String(c.campaign_id),c]));
  const vistas = new Set<string>();
  const validas: any[] = [];
  for (const r of recs || []) {
    if (!permitidas.has(r?.acao)) continue;
    const campaignId = r?.campaign_id ? String(r.campaign_id) : null;
    const exigeCampanha = ['escalar_orcamento','pausar_campanha','criar_criativo'].includes(r.acao);
    const campanha = campaignId ? porId.get(campaignId) : null;
    if (exigeCampanha && (!campanha || !ehAtiva(campanha))) continue;
    // Uma recomendacao por campanha: o livro tem uma participacao do Diego por
    // campanha/run e nao deve escolher silenciosamente entre acoes concorrentes.
    const chave = campaignId ?? `sem_campanha:${r.acao}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    validas.push({
      ...r,
      campaign_id: campaignId,
      campaign_name: campanha?.campaign_name ?? r.campaign_name ?? null,
      execucao_habilitada: false,
      contrato: 'shadow_diagnostico_v1',
    });
  }
  return validas.slice(0,5);
}

async function gerarRecomendacoes(dados: any): Promise<any[]> {
  clog('gerar_recomendacoes', 'iniciando');
  const { cac, ouro, campanhas, leadsRecentes, comprasRecentes, meta } = dados;
  const leadsPorCampanha: Record<string, number> = {};
  for (const l of leadsRecentes) { if (l.utm_campaign_id) leadsPorCampanha[l.utm_campaign_id] = (leadsPorCampanha[l.utm_campaign_id]||0)+1; }
  const receitaSemana = comprasRecentes.reduce((s:number,c:any)=>s+(c.value||0),0);
  const vendasSemana = comprasRecentes.length;
  const cacStr = (cac||[]).slice(0,10).map((r:any)=>`${r.segmento}: ${r.taxa_conversao_pct}% conv | ticket R$${r.ticket_medio||0} | receita R$${r.receita_total} | CAC R$${r.cac||'N/A'} | perf:${r.performance}`).join('\n');

  // M1: so campanhas ATIVAS entram como candidatas. Pausadas viram contagem.
  const ativas = (campanhas||[]).filter(ehAtiva);
  const pausadas = (campanhas||[]).filter((c:any)=>!ehAtiva(c));
  const campanhasStr = ativas.map((c:any)=>`${c.campaign_name}: status=${c.status_real} | ROAS_pixel=${c.roas_pixel} | ROAS_d3=${c.roas_d3} | clientes=${c.clientes_reais} | gasto30d=R$${c.gasto_30d} | leads=${c.leads_30d} | perf=${c.performance} | leads_semana=${leadsPorCampanha[c.campaign_id]||0}`).join('\n') || '(nenhuma campanha ativa no periodo)';
  const pausadasStr = `Existem ${pausadas.length} campanhas pausadas no periodo. Sao historico e estao FORA de qualquer recomendacao.`;

  const ourosegStr = (ouro.segmentos||[]).map((s:any)=>`${s.segmento}: ${s.taxa_conversao}% conv | ticket R$${s.ticket_medio} | receita R$${s.receita_total}`).join('\n');
  const prompt = `Voce e Diego Alves, analista de performance senior da Skillprint Estamparia.\nSua funcao e analisar dados e gerar recomendacoes ESPECIFICAS e ACIONAVEIS para o gestor de midia Gustavo Leal executar.\n\n== META DO MES ==\nFaturamento: R$${meta.faturamento_realizado||0} / R$${meta.meta_faturamento||0}\nGap: R$${meta.gap_faturamento||0} | Dias restantes: ${meta.dias_restantes||'?'}\nSemana: ${vendasSemana} vendas | R$${receitaSemana.toFixed(0)}\n\n== CAMPANHAS ATIVAS (as unicas sobre as quais voce pode recomendar acao) ==\n${campanhasStr}\n\n${pausadasStr}\n\n== CAC POR SEGMENTO ==\n${cacStr}\n\n== CONVERSAO REAL POR SEGMENTO ==\n${ourosegStr}\n\n== MELHOR TIMING ==\n${(ouro.melhor_timing||[]).map((t:any)=>`${t.hora}h dia ${t.dia_semana}: ${t.conversoes} conversoes`).join(' | ')}\n\n== COMO RECOMENDAR ==\nGere de 0 a 5 recomendacoes. Recomende APENAS o que atende aos criterios abaixo. Nao complete cota: ausencia de candidato elegivel deve resultar em [], e lista vazia e resposta correta e esperada, nao falha.\nNunca recomende acao sobre campanha pausada, encerrada ou que nao esteja listada no bloco CAMPANHAS ATIVAS acima.\nCRITERIOS:\n- escalar_orcamento: somente se ROAS_pixel >= ${ESCALAR_ROAS_MIN} E clientes >= ${ESCALAR_CLIENTES_MIN} E gasto30d >= R$${ESCALAR_GASTO_MIN}. Se qualquer uma dessas condicoes falhar, NAO recomende escalar. urgencia alta e SEMPRE preencha campaign_id.\n- pausar_campanha: ROAS baixo sozinho NAO prova campanha ruim: parte da venda chega sem rastreamento (utm null = atribuicao perdida). Confira clientes_reais e receita antes; na duvida NAO pause, recomende otimizar.\n- criar_publico / criar_criativo / testar_segmento: para segmentos de alto valor sem campanha ativa forte.\nPara recomendacao urgencia alta, campaign_id e OBRIGATORIO (sem ele o Gustavo nao executa). Seja CONCISO: motivo em no maximo 2 frases, campo 'dados' com no maximo 4 chaves. Priorize completar o JSON inteiro.\n\nRetorne SOMENTE JSON array (use [] se nada for elegivel):\n[{"campaign_id":"id ou null","campaign_name":"nome","segmento":"segmento","acao":"escalar_orcamento|pausar_campanha|criar_criativo|criar_publico|testar_segmento","motivo":"com numeros","urgencia":"alta|media|baixa","impacto_estimado_r":0,"dados":{}}]`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await res.json();
    if (d.error) { await logErro('claude_recomendacoes', d.error.message, { type: d.error.type }); return []; }
    const rawText = d.content?.[0]?.text || '';
    if (d.stop_reason === 'max_tokens') { await logErro('claude_truncado', 'resposta cortada por max_tokens', { usage: d.usage }); }
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g,'').trim());
    } catch(pe:any) {
      await logErro('parse_recomendacoes', pe.message, { raw: rawText.slice(0, 500) });
      return [];
    }
    const recs = validarRecomendacoes(Array.isArray(parsed) ? parsed : [], campanhas);
    clog('gerar_recomendacoes', 'ok', { count: recs.length, alta: recs.filter((r:any)=>r.urgencia==='alta').length, ativas: ativas.length, pausadas: pausadas.length });
    return recs;
  } catch(e:any) { await logErro('gerar_recomendacoes', e.message); return []; }
}

async function gerarRelatorio(dados: any, recomendacoes: any[]): Promise<string> {
  const { comprasRecentes, meta } = dados;
  const receitaSemana = comprasRecentes.reduce((s:number,c:any)=>s+(c.value||0),0);
  const vendasSemana = comprasRecentes.length;
  const recStr = recomendacoes.slice(0,5).map((r:any,i:number)=>`${i+1}. [${r.urgencia.toUpperCase()}] ${r.campaign_name}: ${r.acao} \u2014 ${r.motivo} | Impacto estimado: R$${r.impacto_estimado_r}`).join('\n');
  const statusEmoji = meta.status_meta==='batida'?'\u2705':meta.status_meta==='no_ritmo'?'\ud83d\udfe1':'\ud83d\udea8';
  // M4: sem recomendacao, nao afirmar que o Gustavo esta executando.
  const temRec = recomendacoes.length > 0;
  const blocoRec = temRec ? [`*Recomenda\u00e7\u00f5es para o Gustavo:*`, recStr] : [`*Recomenda\u00e7\u00f5es para o Gustavo:* nenhuma hoje.`];
  const rodape = temRec
    ? `_Recomenda\u00e7\u00f5es registradas em shadow. Nenhuma foi enviada ao Gustavo ou executada._`
    : `_Nenhuma recomenda\u00e7\u00e3o diagn\u00f3stica foi gerada hoje._`;
  return [`\ud83d\udcca *Diego Alves \u2014 An\u00e1lise de Performance*`,``,`${statusEmoji} *Meta:* R$${Math.round(meta.faturamento_realizado||0)} / R$${meta.meta_faturamento||0} | Gap: R$${Math.round(meta.gap_faturamento||0)} | ${meta.dias_restantes||'?'} dias`,`*Semana:* ${vendasSemana} vendas | R$${receitaSemana.toFixed(0)}`,``,...blocoRec,``,rodape].join('\n');
}

async function registrarShadow(execId: string, decisionId: string, recomendacoes: any[]) {
  const hojeUtc = new Date().toISOString().slice(0,10).replaceAll('-','');
  const runId = `obs:cron:${hojeUtc}`;
  const { data, error } = await sb.rpc('fn_registrar_participantes_diego_shadow', {
    p_run_id: runId,
    p_edge_execution_id: execId,
    p_agent_decision_id: decisionId,
    p_agent_version: AGENT_VERSION,
    p_recomendacoes: recomendacoes,
  });
  if (error) throw new Error(`registrar_shadow: ${error.message}`);
  return { run_id: runId, ...(data || {}) };
}

Deno.serve(async(req)=>{
  const tInicio = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch {}
  const modo = body.mode || 'analisar';
  const execId = await execStart(modo, { modo });
  clog('start', modo, { exec_id: execId });

  let decisionId: string | null = null;
  try {
    const { data } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-insights', p_acao_executada: 'analisar_performance', p_resultado: 'pendente',
      p_nivel_autonomia: 0, p_lead_id: null, p_contexto: { modo, fase: 'iniciado' }, p_decisao: {},
      p_impacto_financeiro: null, p_agent_version: AGENT_VERSION, p_dry_run: false,
    });
    decisionId = data;
  } catch (e: any) { console.error('decisao_log_inicial_err:', e?.message); }

  try {
    const { nivel, dryRun } = await getNivel();
    if (!execId) throw new Error('exec_id_ausente');
    if (!decisionId) throw new Error('decision_id_ausente');
    const dados = await coletarDados();
    const recomendacoes = await gerarRecomendacoes(dados);

    // Numeros do aceite da frente diego-prompt-forca-recomendacao:
    // provar que corrigimos a SELECAO, nao que silenciamos o agente.
    const ativasN = (dados.campanhas||[]).filter(ehAtiva).length;
    const pausadasN = (dados.campanhas||[]).length - ativasN;
    const elegiveisN = (dados.campanhas||[]).filter((c:any)=>ehAtiva(c) && elegivelEscalar(c)).length;

    const { error: memoriaErr } = await sb.from('agente_memoria').upsert({
      agente_slug: 'agente-insights', tipo: 'recomendacao_midia',
      chave: new Date().toISOString().split('T')[0],
      valor: { recomendacoes, gerado_em: new Date().toISOString() },
      confianca: 0.9, baseado_em_n: dados.campanhas?.length||0,
      ativo: true, atualizado_em: new Date().toISOString(),
    },{ onConflict: 'agente_slug,tipo,chave' });
    if (memoriaErr) throw new Error(`agente_memoria: ${memoriaErr.message}`);

    // Apenas o run diario de analise participa do livro das 09:30. O relatorio
    // semanal e outra execucao e nao pode ocupar, nem sobrescrever, essa correlacao.
    const shadow = modo === 'analisar'
      ? await registrarShadow(execId, decisionId, recomendacoes)
      : { status: 'relatorio_nao_correlacionado' };
    clog('gustavo', 'nao_chamado', { motivo: 'shadow_sem_acao', shadow });

    if (modo === 'relatorio') {
      const msg = await gerarRelatorio(dados, recomendacoes);
      const enviado = await enviarWhatsApp(msg);
      clog('whatsapp', enviado ? 'enviado' : 'falhou');
    }

    const duracao = Date.now() - tInicio;

    if (decisionId) {
      try {
        await sb.from('agente_decisoes_log').update({
          resultado: 'executada', acerto: null,
          acao_executada: 'analise_shadow',
          contexto: { modo, fase: 'completo', nivel, dry_run: dryRun, leads_7d: dados.leadsRecentes?.length, campanhas: dados.campanhas?.length, campanhas_ativas: ativasN, campanhas_pausadas: pausadasN, elegiveis_escalar: elegiveisN, compras_7d: dados.comprasRecentes?.length },
          decisao: { recomendacoes_geradas: recomendacoes.length, alta_prioridade: recomendacoes.filter((r:any)=>r.urgencia==='alta').length, gustavo_acionado: false, campanhas_avaliadas: ativasN, candidatos_elegiveis: elegiveisN, shadow },
          nivel_autonomia_usado: nivel, tempo_execucao_ms: duracao,
        }).eq('id', decisionId);
      } catch (e: any) { console.error('decisao_log_update_err:', e?.message); }
    }

    await execFinish(execId, 'ok', duracao, { recomendacoes: recomendacoes.length, alta: recomendacoes.filter((r:any)=>r.urgencia==='alta').length, gustavo_acionado: false, shadow, campanhas: dados.campanhas?.length, campanhas_ativas: ativasN, elegiveis_escalar: elegiveisN });
    clog('done', 'ok', { recomendacoes: recomendacoes.length, ativas: ativasN, elegiveis: elegiveisN, duracao_ms: duracao });
    return new Response(JSON.stringify({ ok: true, versao: AGENT_VERSION, modelo: CLAUDE_MODEL, modo, nivel, dry_run: dryRun, recomendacoes_geradas: recomendacoes.length, recomendacoes_alta: recomendacoes.filter((r:any)=>r.urgencia==='alta').length, campanhas_ativas: ativasN, campanhas_pausadas: pausadasN, elegiveis_escalar: elegiveisN, gustavo_acionado: false, shadow, recomendacoes, decision_id: decisionId }),{ status: 200 });

  } catch(e:any) {
    const duracao = Date.now() - tInicio;
    clog('fatal', 'erro', { error: String(e) });
    await logErro('fatal', String(e));
    await execFinish(execId, 'fatal', duracao, {}, [String(e)]);
    if (decisionId) {
      try { await sb.from('agente_decisoes_log').update({ resultado: 'falhou', acerto: false, contexto: { modo, fase: 'falhou', erro: String(e).slice(0, 500) }, tempo_execucao_ms: duracao }).eq('id', decisionId); } catch {}
    }
    return new Response(JSON.stringify({ ok: false, erro: String(e) }),{ status: 500 });
  }
});
