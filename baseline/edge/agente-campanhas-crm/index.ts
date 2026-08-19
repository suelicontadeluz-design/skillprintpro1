import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const AGENT_VERSION = 'agente-campanhas-crm-v1.6.0';
// v1.6.0 — CORRECAO SEMANTICA DO TERMINAL. Decisao do Alessandro em 11/08/2026:
//   para o Tiago, 'executada' significa EFEITO EXTERNO REAL — campanha efetivamente
//   ENFILEIRADA para disparo. Materializar rascunho NAO e execucao.
//   DEFEITO CORRIGIDO: terminalFinal era 'executada' INCONDICIONAL, com o mesmo
//   terminal_fonte, nos dois caminhos — dry-run (so rascunho) e nao dry-run (enfileira
//   disparo real). O terminal nao distinguia sugerir de disparar.
//   CONTRATO VERIFICADO ANTES (nao suposto): 'executada' = efeito externo, corroborado
//   por escritor independente fn_vera_observar_eventos (status 'enviado' -> 'executada'
//   + efeito_externo). 'nao_executavel' = terminou sem efeito externo / nao autorizado,
//   precedente do agente-pipeline v4.4.0 ('nivel 0 e decisao sem task') e desta propria
//   edge no ramo sem_candidatos. 'bloqueada_guardrail' ja cobre 'barrado'. Sem colisao,
//   sem alteracao do CHECK chk_terminal_op.
//   CONSUMIDORES CONFERIDOS: vw_tiago_execucoes_sem_terminal le apenas IS NOT NULL, nao
//   o valor. trg_vera_waba_status tem WHEN evento='vigia_ciclo_compra' e NAO alcanca as
//   linhas do Tiago (evento='crm_campaign'). Nenhum consumidor le terminal_fonte.
//   RENOMEACAO: criarCampanhaDryRun -> materializarCampanhaRascunho. O nome antigo mentia.
//   Chamador unico confirmado: safeStep('criar_campanha') nesta mesma edge. Nenhuma
//   referencia SQL; o literal so aparece em terminal_fonte de 2 linhas historicas.
//   NAO MUDA: publico, copy, guardrail, gate autonomo, campos da campanha, tetos,
//   mensagem, cron, politica, autonomia. NENHUM caminho de disparo foi aberto.
//   ROLLBACK: version 47.
// v1.4.0 — CONTRATO S3: identidade -> efeito -> terminal como TRES FATOS DISTINTOS.
//   Derivada da v1.3.2 (version 43), que nunca executou.
//   1) A DECISAO NASCE NO INICIO e vira a espinha (abrirDecisao + carimbarTerminal).
//   2) resultado='proposta' e acerto=NULL DO INICIO AO FIM.
//   3) acao_executada NASCE 'nenhum' e so vira 'campanha_sugerida' depois do efeito.
//   4) terminal_* gravados APENAS no fim, por UPDATE, com RELEITURA. FAIL-CLOSED.
//   5) terminal_fonte SAI do JSONB; execution_id fica como identidade legada.
//   6) 'campanha_criada' era IMPOSSIVEL (fora do CHECK). Agora 'campaign_created'.
//   7) Fault injection com TRES portas conjuntivas. Provoca falha REAL do banco.
//   NAO MUDA: publico, copy, guardrail, campos da campanha, tetos, mensagem, cron.
//   ROLLBACK: version 43.

const NIVEL_MAXIMO = 1;
const TETO_LEADS_POR_CAMPANHA = 200;

// FAULT INJECTION — PORTA 1 de 3. Default FALSE.
const FAULT_INJECTION = (Deno.env.get('TIAGO_FAULT_INJECTION') ?? 'false').toLowerCase() === 'true';
// PORTA 2 de 3 — token efemero. A edge tem verify_jwt=false, entao env + parametro
// publico nao isola. Comprimento minimo NAO e decorativo: sem ele, env ausente ('')
// casaria com header ausente ('') e a porta se abriria sozinha.
const FAULT_TOKEN = Deno.env.get('TIAGO_FAULT_TOKEN') ?? '';
const FAULT_TOKEN_MIN = 32;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function log(step: string, status: string, detail: any = {}) {
  console.log(JSON.stringify({ step, status, agent: AGENT_VERSION, ...detail }));
}

// Campanha materializada mas ponte nao registrada. O EFEITO existe, a
// OBSERVABILIDADE falhou. Nunca recriar a campanha.
class PonteNaoRegistrada extends Error {
  constructor(public campaignId: string, public executionId: string) {
    super(`campaign_created nao persistido para campaign_id=${campaignId}`);
    this.name = 'PonteNaoRegistrada';
  }
}

// 1) A DECISAO NASCE AQUI. Primeiro write duravel. Tres provas: RPC sem erro,
// uuid devolvido, linha relida. fn_registrar_decisao_agente engole excecao e
// devolve NULL, entao o UUID e a prova que carrega o peso.
async function abrirDecisao(executionId: string, dryRunSolicitado: boolean): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-campanhas-crm',
      p_acao_executada: 'nenhum',
      p_resultado: 'proposta',
      p_nivel_autonomia: 0,
      p_lead_id: null,
      p_contexto: { execution_id: executionId },
      p_decisao: {},
      p_agent_version: AGENT_VERSION,
      p_dry_run: dryRunSolicitado,
    });
    if (error) { log('decisao', 'rpc_error', { execution_id: executionId, error: error.message }); return null; }
    const id = typeof data === 'string' ? data : null;
    if (!id) { log('decisao', 'sem_uuid_rpc_engoliu', { execution_id: executionId }); return null; }
    const { data: lido, error: errLeitura } = await sb
      .from('agente_decisoes_log').select('id').eq('id', id).maybeSingle();
    if (errLeitura || !lido?.id) {
      log('decisao', 'releitura_falhou', { execution_id: executionId, decisao_id: id, error: errLeitura?.message ?? 'linha nao encontrada' });
      return null;
    }
    log('decisao', 'aberta', { execution_id: executionId, decisao_id: id });
    return id;
  } catch (e: any) {
    log('decisao', 'excecao', { execution_id: executionId, error: String(e).slice(0, 200) });
    return null;
  }
}

// 4) TERMINAL — ULTIMA ESCRITA, COM RELEITURA. NAO toca em resultado. NUNCA lanca.
async function carimbarTerminal(decisionId: string, terminal: string, fonte: string): Promise<boolean> {
  try {
    const { data, error } = await sb.from('agente_decisoes_log')
      .update({
        terminal_operacional: terminal,
        terminal_em: new Date().toISOString(),
        terminal_fonte: fonte,
      })
      .eq('id', decisionId)
      .select('id, terminal_operacional, terminal_em, terminal_fonte')
      .single();
    if (error) {
      log('terminal', 'update_erro', { decisao_id: decisionId, terminal, error: error.message });
      return false;
    }
    const ok = data?.terminal_operacional === terminal && !!data?.terminal_em && data?.terminal_fonte === fonte;
    if (!ok) log('terminal', 'releitura_divergente', { decisao_id: decisionId, esperado: terminal, lido: data });
    else log('terminal', 'carimbado', { decisao_id: decisionId, terminal });
    return ok;
  } catch (e: any) {
    log('terminal', 'excecao', { decisao_id: decisionId, error: String(e).slice(0, 200) });
    return false;
  }
}

// ANCORA context_loaded, agora com decision_id estruturado.
async function persistirInicio(executionId: string, decisionId: string, pDryRun: boolean): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_execution_event', {
      p_agente_slug: 'agente-campanhas-crm',
      p_event_type: 'context_loaded',
      p_status: 'ok',
      p_decision_id: decisionId,
      p_payload: { execution_id: executionId, dry_run_solicitado: pDryRun, agent_version: AGENT_VERSION },
    });
    if (error) { log('inicio', 'rpc_error', { execution_id: executionId, error: error.message }); return null; }
    const eventoId = typeof data === 'string' ? data : null;
    if (!eventoId) { log('inicio', 'sem_uuid_rpc_engoliu', { execution_id: executionId }); return null; }
    const { data: lido, error: errLeitura } = await sb
      .from('agente_execution_events').select('id').eq('id', eventoId).maybeSingle();
    if (errLeitura || !lido?.id) {
      log('inicio', 'releitura_falhou', { execution_id: executionId, evento_id: eventoId, error: errLeitura?.message ?? 'linha nao encontrada' });
      return null;
    }
    log('inicio', 'persistido', { execution_id: executionId, evento_id: eventoId });
    return eventoId;
  } catch (e: any) {
    log('inicio', 'excecao', { execution_id: executionId, error: String(e).slice(0, 200) });
    return null;
  }
}

// 6) PONTE decision_id -> campaign_id. NULL nao e ambiguo: o corpo do logger tem
// dois caminhos e NULL so vem do EXCEPTION. Logo NULL = o INSERT falhou.
async function registrarCampaignCreated(p: {
  decisionId: string; campaignId: string; executionId: string;
  audiencias_gravadas: number; bloqueados: number; lote_limit: number;
}): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_execution_event', {
      p_agente_slug: 'agente-campanhas-crm',
      p_event_type: 'campaign_created',
      p_status: 'ok',
      p_decision_id: p.decisionId,
      p_payload: {
        campaign_id: p.campaignId,
        execution_id: p.executionId,
        audiencias_gravadas: p.audiencias_gravadas,
        bloqueados: p.bloqueados,
        lote_limit: p.lote_limit,
      },
    });
    if (error) { log('campaign_created', 'rpc_error', { decisao_id: p.decisionId, error: error.message }); return null; }
    const id = typeof data === 'string' ? data : null;
    if (!id) { log('campaign_created', 'sem_uuid_rpc_engoliu', { decisao_id: p.decisionId, campaign_id: p.campaignId }); return null; }
    log('campaign_created', 'persistido', { decisao_id: p.decisionId, campaign_id: p.campaignId, evento_id: id });
    return id;
  } catch (e: any) {
    log('campaign_created', 'excecao', { decisao_id: p.decisionId, error: String(e).slice(0, 200) });
    return null;
  }
}

async function safeStep<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    log(name, 'ok');
    return result;
  } catch (e: any) {
    log(name, 'ERROR', { message: e.message, stack: e.stack?.slice(0, 500) });
    // CORRECAO DE AUDITORIA: PonteNaoRegistrada tem que ATRAVESSAR intacta.
    // Embrulhar em Error generico destruia o instanceof do catch global e fazia
    // o CASO B virar CASO C — campanha existente ganhava terminal 'erro_inesperado'
    // em vez de ficar SEM terminal. Quebrava o T2 E o contrato [C1] em producao.
    if (e instanceof PonteNaoRegistrada) throw e;
    throw new Error(`step=${name} | ${e.message}`);
  }
}

async function getDryRunEfetivo(pDryRun: boolean): Promise<boolean> {
  const { data, error } = await sb.rpc('fn_dry_run_efetivo', {
    p_agente_slug: 'agente-campanhas-crm',
    p_dry_run: pDryRun,
  });
  if (error) throw new Error('fn_dry_run_efetivo: ' + error.message);
  return data as boolean;
}

// v1.5.0: publico completo e ordenado, opt-out explicito e gate autonomo fail-closed.
async function calcularPublicoElegivel(): Promise<any> {
  const { data: leads, error: errL } = await sb
    .from('leads_marketing')
    .select('lead_id, fn, fullname, ph, content_category, utm_source', { count: 'exact' })
    .not('ph', 'is', null)
    .gte('ph', '1')
    .order('lead_id', { ascending: true })
    .range(0, 999);
  if (errL) throw new Error('leads_marketing query: ' + errL.message);
  const leadsCompletos: any[] = [...(leads || [])];
  let offset = 1000;
  while ((leads?.length ?? 0) === 1000) {
    const { data: pagina, error: erroPagina } = await sb
      .from('leads_marketing')
      .select('lead_id, fn, fullname, ph, content_category, utm_source')
      .not('ph', 'is', null)
      .gte('ph', '1')
      .order('lead_id', { ascending: true })
      .range(offset, offset + 999);
    if (erroPagina) throw new Error('leads_marketing pagina: ' + erroPagina.message);
    if (!pagina?.length) break;
    leadsCompletos.push(...pagina);
    if (pagina.length < 1000) break;
    offset += 1000;
  }
  if (!leadsCompletos.length) return { quentes: [], mornos: [], clientes_ativos: [], total_base: 0 };

  const { data: comprasRecentes, error: e1 } = await sb
    .from('pixel_events')
    .select('lead_id')
    .eq('event_name', 'Purchase')
    .gt('value', 0)
    .gte('event_time', new Date(Date.now() - 30 * 86400000).toISOString());
  if (e1) throw new Error('compras 30d: ' + e1.message);
  const comprouSet = new Set((comprasRecentes || []).map((c: any) => c.lead_id));

  const { data: conversasAtivas, error: e2 } = await sb
    .from('fact_conversations')
    .select('lead_id')
    .gte('created_at', new Date(Date.now() - 4 * 3600000).toISOString());
  if (e2) throw new Error('fact_conversations: ' + e2.message);
  const conversaSet = new Set((conversasAtivas || []).map((c: any) => c.lead_id));

  const { data: disparosRecentes, error: e3 } = await sb
    .from('waba_disparos_lista')
    .select('lead_id')
    .eq('status', 'enviado')
    .gte('last_sent_at', new Date(Date.now() - 7 * 86400000).toISOString());
  if (e3) throw new Error('waba_disparos_lista: ' + e3.message);
  const disparosSet = new Set((disparosRecentes || []).map((d: any) => d.lead_id));

  const { data: checkouts, error: e4 } = await sb
    .from('pixel_events')
    .select('lead_id')
    .eq('event_name', 'InitiateCheckout')
    .gte('event_time', new Date(Date.now() - 30 * 86400000).toISOString());
  if (e4) throw new Error('checkouts: ' + e4.message);
  const checkoutSet = new Set((checkouts || []).map((c: any) => c.lead_id));

  const { data: propostas, error: e5 } = await sb
    .from('propostas_rd')
    .select('lead_id')
    .gte('inserido_em', new Date(Date.now() - 30 * 86400000).toISOString());
  if (e5) throw new Error('propostas_rd: ' + e5.message);
  const propostaSet = new Set((propostas || []).map((p: any) => p.lead_id));

  const { data: compras60, error: e6 } = await sb
    .from('pixel_events')
    .select('lead_id, value')
    .eq('event_name', 'Purchase')
    .gt('value', 0)
    .gte('event_time', new Date(Date.now() - 60 * 86400000).toISOString());
  if (e6) throw new Error('compras 60d: ' + e6.message);
  const clienteAtivoSet = new Set((compras60 || []).map((c: any) => c.lead_id));

  const quentes: any[] = [];
  const mornos: any[] = [];
  const clientes_ativos: any[] = [];

  for (const lead of leadsCompletos) {
    const lid = lead.lead_id;
    if (comprouSet.has(lid)) continue;
    if (conversaSet.has(lid)) continue;
    if (disparosSet.has(lid)) continue;
    if (!lead.ph || lead.ph.replace(/\D/g, '').length < 10) continue;
    if (clienteAtivoSet.has(lid)) clientes_ativos.push({ ...lead, score: 'cliente_ativo', lote: 2 });
    else if (checkoutSet.has(lid) || propostaSet.has(lid)) quentes.push({ ...lead, score: 'quente', lote: 1 });
    else mornos.push({ ...lead, score: 'morno', lote: 3 });
  }

  return {
    quentes: quentes.slice(0, 60),
    clientes_ativos: clientes_ativos.slice(0, 60),
    mornos: mornos.slice(0, 80),
    total_base: leadsCompletos.length,
  };
}

async function gerarCopyComClaude(): Promise<any> {
  return { tipo_template: 'reativacao', mensagem: 'Oi! Tudo bem? Aqui é da Skillprint. Queria saber se ainda tem interesse nos nossos serviços de estamparia. Como posso te ajudar?\n\nSe não quiser mais receber mensagens de divulgação, responda SAIR.' };
}
// ── fim do bloco intocado ─────────────────────────────────────────────────────

// v1.6.0: RENOMEADA. O nome antigo (criarCampanhaDryRun) mentia — esta funcao cria a
// campanha de verdade, em dry run ou nao. dryRunEfetivo so rotula a decisao. O corpo
// permanece byte a byte o da v1.5.0; so o nome mudou.
async function materializarCampanhaRascunho(params: any): Promise<string> {
  const { objetivo, publico, copy, executionId, decisionId, fault } = params;
  const slug = `${objetivo}-geral-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

  const estimativaWpp = publico.filter((l: any) => ['quente', 'cliente_ativo'].includes(l.score)).length;
  const estimativaEmail = publico.filter((l: any) => l.score === 'morno').length;
  const taxaConvEstimada = objetivo === 'reativacao' ? 0.05 : 0.03;
  const ticketMedio = 340;
  const receita = Math.round(estimativaWpp * taxaConvEstimada * ticketMedio);

  const { data: camp, error } = await sb.from('crm_campaigns').insert({
    slug,
    nome: `${objetivo} - geral - ${new Date().toLocaleDateString('pt-BR')}`,
    objetivo,
    canal: 'whatsapp',
    segmentos_alvo: ['geral'],
    descricao_publico: `Leads selecionados por sinal recente.`,
    estimativa_leads: Math.min(publico.length, TETO_LEADS_POR_CAMPANHA),
    estimativa_whatsapp: estimativaWpp,
    estimativa_email: estimativaEmail,
    estimativa_bloqueados: 0,
    receita_estimada: receita,
    max_whatsapp_por_dia: 25,
    intervalo_minimo_minutos: 10,
    janela_envio_inicio: '09:00',
    janela_envio_fim: '17:30',
    dias_envio_permitidos: ['seg', 'ter', 'qua', 'qui', 'sex'],
    status: 'rascunho',
    criado_por: AGENT_VERSION,
    execution_id: executionId,
  }).select('id').single();

  if (error) throw new Error('insert crm_campaigns: ' + error.message);
  if (!camp) throw new Error('insert crm_campaigns: camp eh null');

  const loteLimit = Math.min(publico.length, TETO_LEADS_POR_CAMPANHA);
  let bloqueados = 0;
  let processados = 0;
  for (const lead of publico.slice(0, loteLimit)) {
    const { data: guard, error: gErr } = await sb.rpc('fn_tiago_guardrail_whatsapp_v2', {
      p_lead_id: lead.lead_id
    });
    if (gErr) { log('guardrail', 'erro', { error: gErr.message, lead_id: lead.lead_id }); continue; }
    const guardrail = guard as any;
    const permitido = guardrail?.permitido ?? false;
    if (!permitido) bloqueados++;

    const { error: audErr } = await sb.from('crm_campaign_audiences').insert({
      campaign_id: camp.id,
      lead_id: lead.lead_id,
      phone: lead.ph,
      segmento: lead.content_category,
      score_lead: lead.score,
      canal_recomendado: guardrail?.canal_recomendado ?? 'nenhum',
      risco_whatsapp: guardrail?.risco ?? 'bloqueado',
      motivo_canal: (guardrail?.motivos ?? []).join(', ') || 'elegivel',
      lote_envio: lead.lote,
      prioridade_envio: lead.lote === 1 ? 1 : lead.lote === 2 ? 2 : 3,
      janela_envio_sugerida: lead.lote === 1 ? 'seg-ter 09h-11h' : lead.lote === 2 ? 'ter-qua 11h-14h' : 'qua-qui 14h-17h',
      incluido: permitido,
      excluido: !permitido,
      motivo_inclusao: permitido ? `Score ${lead.score} - sinal recente` : null,
      motivo_exclusao: !permitido ? (guardrail?.motivos ?? []).join(', ') : null,
      guardrail_slug: !permitido ? 'fn_guardrail_whatsapp_campaign' : null,
    });
    if (audErr) { log('audiencia', 'erro_insert', { error: audErr.message, lead_id: lead.lead_id }); throw new Error('insert audiencia: ' + audErr.message); }
    processados++;
  }

  await sb.from('crm_campaigns').update({
    estimativa_bloqueados: bloqueados,
    estimativa_leads: loteLimit - bloqueados,
    updated_at: new Date().toISOString(),
  }).eq('id', camp.id);

  const { error: msgErr } = await sb.from('crm_campaign_messages').insert({
    campaign_id: camp.id,
    sequencia: 1,
    nome: 'Mensagem principal',
    canal: 'whatsapp',
    tipo_template: copy.tipo_template,
    mensagem: copy.mensagem,
    aprovado: false,
    aprovado_por: null,
  });
  if (msgErr) throw new Error('insert crm_campaign_messages: ' + msgErr.message);

  // PONTE. Retorno UUID OBRIGATORIO. A campanha ja existe: se a ponte nao for
  // registrada, NAO fingir que nao aconteceu e NAO recriar.
  const eventoId = await registrarCampaignCreated({
    decisionId, campaignId: camp.id, executionId,
    audiencias_gravadas: processados, bloqueados, lote_limit: loteLimit,
  });
  if (!eventoId) throw new PonteNaoRegistrada(camp.id, executionId);

  // FAULT INJECTION T2 — segunda emissao IDENTICA viola o indice unico.
  // Falha REAL do banco. Ocorre ANTES do carimbo terminal, que e o ponto do teste.
  if (fault === 'duplicate_campaign_event') {
    log('fault', 'duplicate_campaign_event', { decisao_id: decisionId, campaign_id: camp.id });
    const segundo = await registrarCampaignCreated({
      decisionId, campaignId: camp.id, executionId,
      audiencias_gravadas: processados, bloqueados, lote_limit: loteLimit,
    });
    if (!segundo) throw new PonteNaoRegistrada(camp.id, executionId);
  }

  log('campanha', 'criada', { campaign_id: camp.id, processados, bloqueados, execution_id: executionId, decisao_id: decisionId });
  return camp.id;
}

Deno.serve(async (req) => {
  const tInicio = Date.now();
  const EXECUTION_ID = crypto.randomUUID();

  const body = await req.json().catch(() => ({}));
  const pDryRun = body.dry_run ?? true;

  // FAULT INJECTION — PORTAS 2 e 3. As TRES sao obrigatorias e conjuntivas.
  // Falhando qualquer uma, `fault` e '' e todos os ramos abaixo sao codigo morto:
  // nenhum log, nenhuma variacao observavel, nenhuma resposta diferente.
  const tokenRecebido = String(req.headers.get('x-canario-token') ?? body._fault_token ?? '');
  const faultAutorizado =
    FAULT_INJECTION &&
    FAULT_TOKEN.length >= FAULT_TOKEN_MIN &&
    tokenRecebido.length === FAULT_TOKEN.length &&
    tokenRecebido === FAULT_TOKEN;
  const fault: string = faultAutorizado ? String(body._fault ?? '') : '';

  let decisionId: string | null = null;

  try {
    // 1o WRITE DURAVEL = A DECISAO. Sem ela, nada de efeito comercial.
    decisionId = await abrirDecisao(EXECUTION_ID, pDryRun);
    if (!decisionId) {
      throw new Error('step=decisao | decisao nao confirmada — abortado antes de qualquer efeito comercial');
    }

    const inicioId = await persistirInicio(EXECUTION_ID, decisionId, pDryRun);
    if (!inicioId) {
      throw new Error('step=exec_event | ancora context_loaded nao confirmada — abortado antes de qualquer efeito comercial');
    }

    const dryRunEfetivo = await safeStep('dry_run_efetivo', () => getDryRunEfetivo(pDryRun));

    const publico: any = await safeStep('publico', () => calcularPublicoElegivel());
    log('publico_resumo', 'ok', {
      execution_id: EXECUTION_ID,
      decisao_id: decisionId,
      quentes: publico.quentes.length,
      clientes_ativos: publico.clientes_ativos.length,
      mornos: publico.mornos.length,
      total_base: publico.total_base,
    });

    const todosCandidatos = [
      ...publico.quentes, ...publico.clientes_ativos, ...publico.mornos
    ].slice(0, TETO_LEADS_POR_CAMPANHA);

    // SEM CANDIDATOS: a acao ja nasceu 'nenhum'. Nada a corrigir.
    if (todosCandidatos.length === 0) {
      await sb.from('agente_decisoes_log').update({
        decisao: { motivo: 'sem_candidatos_elegiveis' },
        contexto: { execution_id: EXECUTION_ID, trigger: 'cron', total_base: publico.total_base, quentes: 0, clientes_ativos: 0, mornos: 0 },
        dry_run: dryRunEfetivo,
        tempo_execucao_ms: Date.now() - tInicio,
      }).eq('id', decisionId);

      const okTerminal = await carimbarTerminal(decisionId, 'nao_executavel', `edge:${AGENT_VERSION}:sem_candidatos`);
      if (!okTerminal) {
        return new Response(JSON.stringify({
          ok: false, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: decisionId,
          erro: 'terminal_nao_persistido', terminal_pretendido: 'nao_executavel',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        ok: true, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: decisionId,
        msg: 'sem candidatos elegiveis', publico, dry_run: dryRunEfetivo,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const copy = await safeStep('copy', () => gerarCopyComClaude());
    const campanhaId = await safeStep('criar_campanha',
      () => materializarCampanhaRascunho({
        objetivo: 'reativacao', publico: todosCandidatos, copy,
        executionId: EXECUTION_ID, decisionId, fault,
      }));

    // A ACAO SO VIRA campanha_sugerida DEPOIS QUE A CAMPANHA EXISTE.
    // resultado NAO e tocado: continua 'proposta'.
    await sb.from('agente_decisoes_log').update({
      acao_executada: 'campanha_sugerida',
      decisao: {
        campanha_id: campanhaId,
        estimativa_quentes: publico.quentes.length,
        estimativa_clientes: publico.clientes_ativos.length,
        estimativa_mornos: publico.mornos.length,
        copy_gerado: copy?.tipo_template,
      },
      contexto: { execution_id: EXECUTION_ID, total_base: publico.total_base, candidatos_processados: todosCandidatos.length },
      dry_run: dryRunEfetivo,
      tempo_execucao_ms: Date.now() - tInicio,
    }).eq('id', decisionId);

    let gateAutonomo: any = { executado: false, motivo: 'dry_run_efetivo' };
    if (!dryRunEfetivo) {
      const { data: gate, error: gateErr } = await sb.rpc('fn_tiago_autorizar_e_enfileirar', {
        p_campaign_id: campanhaId,
        p_decision_id: decisionId,
        p_simular: false,
        p_limite: null,
      });
      if (gateErr) throw new Error('step=gate_autonomo | ' + gateErr.message);
      if (!gate?.ok) throw new Error('step=gate_autonomo | ' + (gate?.erro || 'recusado'));
      gateAutonomo = { executado: true, ...gate };
    }

    // v1.6.0 — TERMINAL POR EFEITO EXTERNO REAL, NAO POR CHEGADA AO FIM DO CODIGO.
    // 'executada' EXIGE disparo efetivamente enfileirado. Rascunho materializado sem
    // enfileiramento termina 'nao_executavel' (nao houve efeito externo e o agente nao
    // estava autorizado a executar). Gate que rodou e bloqueou tudo termina
    // 'bloqueada_guardrail', que e o valor proprio para barrado.
    const enfileiradas = Number(gateAutonomo?.enfileiradas ?? 0);
    const bloqueadas = Number(gateAutonomo?.bloqueadas ?? 0);
    const gateRodou = gateAutonomo?.executado === true;
    let terminalReal: string;
    let sufixoFonte: string;
    if (gateRodou && enfileiradas > 0) {
      terminalReal = 'executada';
      sufixoFonte = 'campanha_enfileirada';
    } else if (gateRodou && enfileiradas === 0 && bloqueadas > 0) {
      terminalReal = 'bloqueada_guardrail';
      sufixoFonte = 'gate_bloqueou_tudo';
    } else {
      terminalReal = 'nao_executavel';
      sufixoFonte = 'campanha_rascunho_sem_disparo';
    }

    // FAULT INJECTION T1b — valor fora do CHECK chk_terminal_op.
    // O banco REJEITA de verdade; nenhum retorno e forjado.
    const terminalFinal = (fault === 'terminal_write_failure') ? '__fault__' : terminalReal;
    if (fault === 'terminal_write_failure') log('fault', 'terminal_write_failure', { decisao_id: decisionId });

    const okTerminal = await carimbarTerminal(decisionId, terminalFinal, `edge:${AGENT_VERSION}:${sufixoFonte}`);

    // RETURN DIRETO, NAO throw. Nao pode cair no catch global, senao haveria uma
    // segunda tentativa de terminal e o T1b deixaria de provar 'terminal ficou NULL'.
    if (!okTerminal) {
      log('resposta', 'sucesso_recusado', { execution_id: EXECUTION_ID, decisao_id: decisionId, campanha_id: campanhaId });
      return new Response(JSON.stringify({
        ok: false, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: decisionId,
        campanha_id: campanhaId, erro: 'terminal_nao_persistido', terminal_pretendido: terminalFinal,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      ok: true, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: decisionId,
      dry_run: dryRunEfetivo, campanha_id: campanhaId,
      terminal_operacional: terminalFinal,
      efeito_externo: terminalReal === 'executada',
      publico: {
        base_analisada: publico.total_base,
        quentes: publico.quentes.length,
        clientes_ativos: publico.clientes_ativos.length,
        mornos: publico.mornos.length,
      },
      gate_autonomo: gateAutonomo,
      duracao_ms: Date.now() - tInicio,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    // CASO A: nem decisao existe. NENHUMA tentativa de terminal.
    if (!decisionId) {
      log('fatal', 'sem_decisao', { execution_id: EXECUTION_ID, error: String(e?.message || e).slice(0, 300) });
      return new Response(JSON.stringify({
        ok: false, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: null,
        erro: 'decisao_nao_criada', detalhe: String(e?.message || e).slice(0, 200),
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // CASO B: campanha EXISTE, ponte falhou. NAO carimbar terminal.
    // A ausencia de terminal E a evidencia — principio [C1] da propria v1.3.1.
    if (e instanceof PonteNaoRegistrada) {
      log('fatal', 'ponte_nao_registrada', { execution_id: EXECUTION_ID, decisao_id: decisionId, campaign_id: e.campaignId });
      return new Response(JSON.stringify({
        ok: false, versao: AGENT_VERSION, erro: 'ponte_nao_registrada',
        execution_id: EXECUTION_ID, decision_id: decisionId, campaign_id: e.campaignId,
        instrucao: 'campanha criada e rastreavel por crm_campaigns.execution_id; reconciliar, NAO recriar',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // CASO C: falha generica, com decisao existente.
    log('fatal', 'erro_global', { execution_id: EXECUTION_ID, decisao_id: decisionId, error: String(e?.message || e).slice(0, 500) });
    try {
      await sb.from('agente_decisoes_log').update({
        acao_executada: 'execucao_fatal',
        decisao: { motivo: 'excecao_fatal', step_falho: String(e?.message || '').match(/step=([^|]+)/)?.[1]?.trim() || 'desconhecido' },
        contexto: { execution_id: EXECUTION_ID, erro: String(e?.message || e).slice(0, 300) },
        tempo_execucao_ms: Date.now() - tInicio,
      }).eq('id', decisionId);
    } catch { /* o terminal abaixo e o que importa */ }

    const okTerminal = await carimbarTerminal(decisionId, 'erro_inesperado', `edge:${AGENT_VERSION}:catch_global`);
    return new Response(JSON.stringify({
      ok: false, versao: AGENT_VERSION, execution_id: EXECUTION_ID, decision_id: decisionId,
      terminal_persistido: okTerminal, erro: String(e?.message || e).slice(0, 200),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  // SEM finally, como na v1.3.1: se nenhum terminal foi confirmado, a execucao
  // fica sem terminal DE PROPOSITO e o detector externo a acusa.
});
