import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const ALESSANDRO_PHONE = '5511939490508';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
const ALESSANDRO_SUBSCRIBER_ID = '773845540';
const AGENT_VERSION = 'agente-aprovacao-v3.3.0';
// v3.3.0 (30/08/2026): nasce a rota de execucao aprovada de OBJECOES.
// O branch ehObjecaoTask deixa de falhar fechado em executor_indisponivel e
// passa a despachar para a RPC fn_objecao_aprovada_criar_task (SECURITY
// DEFINER, service_role only), que valida vinculo decisao/aprovacao/objecao,
// cria EXATAMENTE UMA crm_task (idempotente via lead_objections.task_id) e
// grava status_aprovacao='aprovado_virou_task' atomicamente. Identidade,
// autoridade e guards permanecem os mesmos; recusa da RPC = bloqueado.
// v3.2.1 (29/08/2026): objecoes passam a ser acao DELEGADA.
// Patricia nao envia mais script ao cliente. Exige decisao_id e prova o vinculo
// lead_objections.decision_id antes de consultar autoridade.
// v3.2.0: contrato canonico de aprovacao de MIDIA.

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const AUTO_APROVACAO_WHITELIST = ['aprovado', 'ajustado'];
const AUTO_APROVACAO_HORAS = 48;

function log(step: string, status: string, detail: any = {}) {
  console.log(JSON.stringify({ step, status, agent: AGENT_VERSION, ...detail }));
}

async function registrarDecisao(params: { acao: string; resultado: string; contexto: any; decisao: any }): Promise<void> {
  try {
    await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-aprovacao', p_acao_executada: params.acao,
      p_resultado: params.resultado, p_nivel_autonomia: 1, p_lead_id: null,
      p_contexto: params.contexto, p_decisao: params.decisao,
      p_impacto_financeiro: null, p_agent_version: AGENT_VERSION, p_dry_run: false,
    });
  } catch (e: any) { console.error('decisao_log_err:', e?.message || String(e)); }
}

async function verificarAutonomia(agenteSlug: string, acao: string): Promise<{ pode: boolean; modo?: string; motivo: string }> {
  if (acao.startsWith('liberar_nivel_') || acao === 'emergencia' || acao === 'reativar' || acao === 'aprovado' || acao === 'ajustado') {
    return { pode: true, modo: 'sistema', motivo: 'acao_de_sistema' };
  }
  try {
    const { data, error } = await sb.rpc('fn_agente_pode_executar', { p_slug: agenteSlug, p_acao: acao });
    if (error) return { pode: false, motivo: 'erro_ao_verificar_autonomia' };
    return { pode: data?.pode ?? false, modo: data?.modo, motivo: data?.motivo ?? 'desconhecido' };
  } catch { return { pode: false, motivo: 'excecao_ao_verificar_autonomia' }; }
}

async function enviarWhatsApp(mensagem: string): Promise<void> {
  try {
    await fetch(`${BOT_BASE}/subscriber/${ALESSANDRO_SUBSCRIBER_ID}/send_message/`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify({ type: 'text', value: mensagem }),
    });
  } catch (e) { log('whatsapp', 'erro', { error: String(e) }); }
}

function normalizarResposta(texto: string): 'sim' | 'nao' | 'parar' | 'reativar' | 'status' | 'desconhecido' {
  const t = texto.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['sim', 's', 'yes', 'ok', 'pode', 'aprovo', 'aprovado', '1'].some(p => t === p || t.startsWith(p + ' '))) return 'sim';
  if (['nao', 'n', 'no', 'nope', 'rejeito', 'rejeitado', 'negar', '0'].some(p => t === p || t.startsWith(p + ' '))) return 'nao';
  if (['parar tudo', 'para tudo', 'stop', 'emergencia', 'pausar tudo'].some(p => t.includes(p))) return 'parar';
  if (t === 'reativar' || t === 'reativar sistema') return 'reativar';
  if (['status', 'situacao', 'relatorio', 'como estao', 'como esta'].some(p => t.includes(p))) return 'status';
  return 'desconhecido';
}

type AcaoExecResult = { ok: boolean; resultado: string; chegou_executor?: boolean; bloqueado?: boolean; http_status?: number | null; executor_body?: any; payload?: any; identidade?: string };
type MidiaDispatch = { ok: boolean; chegou_executor: boolean; bloqueado: boolean; resultado: string; http_status: number | null; executor_body: any; payload: any };

async function registrarEventoVinculado(decisaoId: string, eventType: string, status: string, payload: any, error?: string | null) {
  try {
    await sb.rpc('fn_registrar_execution_event', {
      p_agente_slug: 'agente-aprovacao', p_event_type: eventType, p_status: status,
      p_decision_id: decisaoId, p_payload: payload, p_error: error ?? null, p_duration_ms: null,
    });
  } catch (e: any) { log('evento_vinculado', 'erro', { error: e?.message || String(e), decisao_id: decisaoId }); }
}

async function validarIdentidadeMidia(aprovacao: any): Promise<{ ok: boolean; motivo: string; decisao?: any }> {
  if (!aprovacao?.decisao_id) return { ok: false, motivo: 'aprovacao_sem_decisao_id' };
  const { data: d, error } = await sb.from('agente_decisoes_log').select('id,agente_slug,contexto,decisao,dry_run').eq('id', aprovacao.decisao_id).maybeSingle();
  if (error || !d) return { ok: false, motivo: 'decisao_nao_encontrada' };
  if (d.agente_slug !== aprovacao.agente_slug) return { ok: false, motivo: 'agente_diverge_da_decisao' };
  const op = aprovacao.opcoes?.[0] || {};
  const acaoDecisao = d.decisao?.acao ?? null;
  if (!op.acao || !acaoDecisao || op.acao !== acaoDecisao) return { ok: false, motivo: 'acao_diverge_da_decisao' };
  const alvoAprovacao = op.campaign_id ?? null;
  const alvoDecisao = d.contexto?.campaign_id ?? d.decisao?.campaign_id ?? null;
  if (!alvoAprovacao || !alvoDecisao || String(alvoAprovacao) !== String(alvoDecisao)) return { ok: false, motivo: 'alvo_diverge_da_decisao' };
  return { ok: true, motivo: 'identidade_ok', decisao: d };
}

async function validarIdentidadeObjecao(aprovacao: any): Promise<{ ok: boolean; motivo: string; decisao?: any }> {
  if (!aprovacao?.decisao_id) return { ok: false, motivo: 'aprovacao_sem_decisao_id' };
  const op = aprovacao.opcoes?.[0] || {};
  if (!op.lead_id || !op.objecao_id) return { ok: false, motivo: 'objecao_sem_alvo_estruturado' };
  const { data: d, error: de } = await sb.from('agente_decisoes_log')
    .select('id,agente_slug,lead_id,contexto,decisao,dry_run').eq('id', aprovacao.decisao_id).maybeSingle();
  if (de || !d) return { ok: false, motivo: 'decisao_nao_encontrada' };
  if (d.agente_slug !== aprovacao.agente_slug) return { ok: false, motivo: 'agente_diverge_da_decisao' };
  if (!d.lead_id || String(d.lead_id) !== String(op.lead_id)) return { ok: false, motivo: 'lead_diverge_da_decisao' };
  const { data: lo, error: oe } = await sb.from('lead_objections').select('id,lead_id,decision_id').eq('id', op.objecao_id).maybeSingle();
  if (oe || !lo) return { ok: false, motivo: 'objecao_nao_encontrada' };
  if (!lo.decision_id || String(lo.decision_id) !== String(aprovacao.decisao_id)) return { ok: false, motivo: 'objecao_diverge_da_decisao' };
  if (String(lo.lead_id) !== String(op.lead_id)) return { ok: false, motivo: 'objecao_diverge_do_lead' };
  if (op.acao !== 'criar_task_tamires_analisar_objecao') return { ok: false, motivo: 'acao_objecao_invalida' };
  return { ok: true, motivo: 'identidade_ok', decisao: d };
}

async function despacharMidia(aprovacao: any): Promise<MidiaDispatch> {
  const op = aprovacao.opcoes?.[0] || {};
  const payload: any = { mode: 'executar', acao: op.acao, campaign_id: op.campaign_id, aprovacao_id: aprovacao.id, decisao_id: aprovacao.decisao_id };
  if (op.acao === 'escalar_orcamento') payload.novo_orcamento_sugerido = op.novo_orcamento_sugerido ?? op.novo_orcamento;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agente-midia`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }, body: JSON.stringify(payload),
    });
    const text = await res.text();
    let executorBody: any = null; try { executorBody = text ? JSON.parse(text) : null; } catch { executorBody = { raw: text }; }
    const bloqueado = res.status === 403 || executorBody?.ok === false || executorBody?.skipped === true || executorBody?.dia_nao_util === true;
    const ok = res.ok && executorBody?.ok === true && !bloqueado;
    const resultado = res.status === 403 ? `executor_bloqueou:${executorBody?.erro || 'http_403'}` : executorBody?.dia_nao_util ? 'executor_nao_executou:dia_nao_util' : executorBody?.skipped ? `executor_nao_executou:${executorBody?.skip || 'skipped'}` : ok ? 'executor_confirmou_recebimento_execucao' : `executor_falhou:http_${res.status}`;
    await registrarEventoVinculado(aprovacao.decisao_id, res.status === 403 ? 'guardrail_blocked' : (ok ? 'action_executed' : 'approval_received'), res.status === 403 ? 'skipped' : (ok ? 'ok' : (res.ok ? 'skipped' : 'erro')), {
      etapa: 'despacho_executor', aprovacao_id: aprovacao.id, executor: 'agente-midia', acao: op.acao, alvo: op.campaign_id, request: payload, http_status: res.status, response: executorBody,
    }, res.ok || res.status === 403 ? null : resultado);
    return { ok, chegou_executor: true, bloqueado, resultado, http_status: res.status, executor_body: executorBody, payload };
  } catch (e: any) {
    const resultado = `executor_inacessivel:${e?.message || String(e)}`;
    await registrarEventoVinculado(aprovacao.decisao_id, 'error', 'erro', { etapa: 'despacho_executor', aprovacao_id: aprovacao.id, executor: 'agente-midia', request: payload }, resultado);
    return { ok: false, chegou_executor: false, bloqueado: false, resultado, http_status: null, executor_body: null, payload };
  }
}

async function executarAcaoAprovada(aprovacao: any): Promise<AcaoExecResult> {
  const opcoes = aprovacao.opcoes as any[];
  if (!opcoes?.length) return { ok: false, resultado: 'sem_opcoes' };
  const acao = opcoes[0]?.acao as string;
  const agenteSlug = aprovacao.agente_slug;
  const ehMidiaCampanha = agenteSlug === 'agente-midia' && (acao === 'pausar_campanha' || acao === 'escalar_orcamento');
  const ehObjecaoTask = agenteSlug === 'agente-objecoes' && acao === 'criar_task_tamires_analisar_objecao';
  log('executando', acao, { aprovacao_id: aprovacao.id, agente: agenteSlug, decisao_id: aprovacao.decisao_id ?? null });

  let identidade: { ok: boolean; motivo: string; decisao?: any } | null = null;
  if (ehMidiaCampanha) identidade = await validarIdentidadeMidia(aprovacao);
  if (ehObjecaoTask) identidade = await validarIdentidadeObjecao(aprovacao);
  if ((ehMidiaCampanha || ehObjecaoTask) && !identidade?.ok) {
    log('identidade', 'bloqueou', { aprovacao_id: aprovacao.id, decisao_id: aprovacao.decisao_id ?? null, motivo: identidade?.motivo });
    return { ok: false, resultado: `identidade_bloqueou:${identidade?.motivo}`, chegou_executor: false, bloqueado: true, identidade: identidade?.motivo };
  }

  const autonomia = await verificarAutonomia(agenteSlug, acao);
  if (!autonomia.pode) {
    const { data: agente } = await sb.from('agentes').select('nome, nivel_autonomia_atual').eq('slug', agenteSlug).maybeSingle();
    const nomeAgente = agente?.nome || agenteSlug; const nivelAtual = agente?.nivel_autonomia_atual ?? '?';
    log('guardiao', 'bloqueou', { agente: agenteSlug, acao, motivo: autonomia.motivo });
    if ((ehMidiaCampanha || ehObjecaoTask) && aprovacao.decisao_id) {
      await registrarEventoVinculado(aprovacao.decisao_id, 'guardrail_blocked', 'skipped', { etapa: 'autoridade', aprovacao_id: aprovacao.id, executor: agenteSlug, acao, alvo: opcoes[0]?.campaign_id ?? opcoes[0]?.objecao_id, autoridade: autonomia });
      return { ok: false, resultado: `guardiao_bloqueou:${autonomia.motivo}`, chegou_executor: false, bloqueado: true, identidade: identidade?.motivo };
    }
    await sb.from('agente_aprovacoes').update({ status: 'rejeitado', resposta: `Bloqueado pelo guardiao: ${autonomia.motivo}`, respondido_em: new Date().toISOString() }).eq('id', aprovacao.id);
    await registrarDecisao({ acao: 'bloqueada_guardrail', resultado: 'bloqueada_guardrail', contexto: { agente_alvo: agenteSlug, acao_solicitada: acao, motivo_bloqueio: autonomia.motivo, nivel_agente: nivelAtual, aprovacao_id: aprovacao.id }, decisao: { acao_bloqueada: acao, agente_alvo: agenteSlug, motivo: autonomia.motivo } });
    await enviarWhatsApp(`🚫 *Acao bloqueada pelo Guardiao*\n\n*Agente:* ${nomeAgente}\n*Nivel atual:* ${nivelAtual}\n*Acao solicitada:* ${acao}\n*Motivo:* ${autonomia.motivo}\n\nO agente nao tem autonomia suficiente para esta acao. Quando atingir o nivel necessario, o Andre liberara automaticamente.`);
    return { ok: false, resultado: `guardiao_bloqueou:${autonomia.motivo}` };
  }

  if (ehMidiaCampanha) {
    await registrarEventoVinculado(aprovacao.decisao_id, 'approval_received', 'ok', { etapa: 'autoridade', aprovacao_id: aprovacao.id, executor: agenteSlug, acao, alvo: opcoes[0]?.campaign_id, autoridade: autonomia });
    if (aprovacao.status !== 'aprovado') {
      const { error: apErr } = await sb.from('agente_aprovacoes').update({ status: 'aprovado', respondido_em: aprovacao.respondido_em ?? new Date().toISOString() }).eq('id', aprovacao.id);
      if (apErr) return { ok: false, resultado: `falha_ao_registrar_aprovacao:${apErr.message}`, chegou_executor: false, bloqueado: true, identidade: identidade?.motivo };
      aprovacao.status = 'aprovado'; aprovacao.respondido_em = aprovacao.respondido_em ?? new Date().toISOString();
    }
    const despacho = await despacharMidia(aprovacao);
    return { ...despacho, identidade: identidade?.motivo };
  }

  if (ehObjecaoTask) {
    await registrarEventoVinculado(aprovacao.decisao_id, 'approval_received', 'ok', {
      etapa: 'autoridade', aprovacao_id: aprovacao.id, executor: 'agente-objecoes', acao,
      alvo: opcoes[0]?.objecao_id, lead_id: opcoes[0]?.lead_id, autoridade: autonomia,
    });
    // v3.3.0: rota de execucao aprovada. Espelha o contrato de midia:
    // registra a aprovacao ANTES do despacho, para a RPC (fail-closed)
    // so aceitar aprovacao com status='aprovado'.
    if (aprovacao.status !== 'aprovado') {
      const { error: apErr } = await sb.from('agente_aprovacoes').update({ status: 'aprovado', respondido_em: aprovacao.respondido_em ?? new Date().toISOString() }).eq('id', aprovacao.id);
      if (apErr) return { ok: false, resultado: `falha_ao_registrar_aprovacao:${apErr.message}`, chegou_executor: false, bloqueado: true, identidade: identidade?.motivo };
      aprovacao.status = 'aprovado'; aprovacao.respondido_em = aprovacao.respondido_em ?? new Date().toISOString();
    }
    const rpcPayload = { p_objecao_id: opcoes[0]?.objecao_id, p_aprovacao_id: aprovacao.id };
    const { data: rpcData, error: rpcErr } = await sb.rpc('fn_objecao_aprovada_criar_task', rpcPayload);
    if (rpcErr) {
      const resultado = `executor_falhou:rpc:${rpcErr.message}`;
      await registrarEventoVinculado(aprovacao.decisao_id, 'error', 'erro', { etapa: 'despacho_executor', aprovacao_id: aprovacao.id, executor: 'fn_objecao_aprovada_criar_task', acao, alvo: opcoes[0]?.objecao_id, request: rpcPayload }, resultado);
      return { ok: false, resultado, chegou_executor: false, bloqueado: false, identidade: identidade?.motivo };
    }
    const r: any = rpcData ?? {};
    const okRpc = r.ok === true && (r.resultado === 'criada' || r.resultado === 'ja_existia');
    const resultado = okRpc
      ? (r.resultado === 'criada' ? `task_criada:${r.task_id}` : `idempotente_task_ja_existia:${r.task_id}`)
      : `executor_recusou:${r.motivo || r.resultado || 'desconhecido'}`;
    await registrarEventoVinculado(aprovacao.decisao_id, okRpc ? 'action_executed' : 'guardrail_blocked', okRpc ? 'ok' : 'skipped', {
      etapa: 'despacho_executor', aprovacao_id: aprovacao.id, executor: 'fn_objecao_aprovada_criar_task', acao,
      alvo: opcoes[0]?.objecao_id, lead_id: opcoes[0]?.lead_id, request: rpcPayload, response: r,
    }, okRpc ? null : resultado);
    return { ok: okRpc, resultado, chegou_executor: true, bloqueado: !okRpc, http_status: null, executor_body: r, identidade: identidade?.motivo };
  }

  if (acao === 'aprovado' || acao === 'ajustado') {
    const op = opcoes[0]; if (!op?.kpi || !op?.agente_slug) return { ok: false, resultado: 'meta_smart_sem_kpi_ou_agente' };
    const patch: any = { atualizado_em: new Date().toISOString() };
    if (op.meta_minima !== undefined && op.meta_minima !== null) patch.meta_minima = op.meta_minima;
    if (op.meta_alvo !== undefined && op.meta_alvo !== null) patch.meta_alvo = op.meta_alvo;
    if (op.meta_stretch !== undefined && op.meta_stretch !== null) patch.meta_stretch = op.meta_stretch;
    if (op.baseline !== undefined && op.baseline !== null) patch.baseline_realizado = op.baseline;
    const { error, count } = await sb.from('agente_metas').update(patch, { count: 'exact' }).eq('agente_slug', op.agente_slug).eq('kpi', op.kpi).eq('ativo', true);
    if (error) return { ok: false, resultado: 'meta_update_err: ' + error.message };
    if (!count) return { ok: false, resultado: `meta_nao_encontrada: ${op.agente_slug}/${op.kpi}` };
    return { ok: true, resultado: `Meta ${op.kpi} (${op.agente_slug}) aplicada: min ${op.meta_minima} | alvo ${op.meta_alvo} | stretch ${op.meta_stretch}` };
  }

  if (acao?.startsWith('liberar_nivel_')) {
    const nivelNovo = parseInt(acao.replace('liberar_nivel_', '')); const agenteSlugAlvo = opcoes[0]?.agente_slug;
    const { data: agente } = await sb.from('agentes').select('nivel_autonomia_atual, nome, nivel_autonomia_maximo').eq('slug', agenteSlugAlvo).single();
    if (!agente) return { ok: false, resultado: 'agente_nao_encontrado' };
    const nivelFinal = Math.min(nivelNovo, agente.nivel_autonomia_maximo);
    await sb.from('agentes').update({ nivel_autonomia_atual: nivelFinal, updated_at: new Date().toISOString() }).eq('slug', agenteSlugAlvo);
    await sb.from('autonomia_liberacoes').insert({ agente_slug: agenteSlugAlvo, nivel_anterior: agente.nivel_autonomia_atual, nivel_novo: nivelFinal, motivo: 'Aprovado manualmente por Alessandro', aprovado_por: 'Alessandro', liberado_em: new Date().toISOString() });
    return { ok: true, resultado: `${agente.nome} liberado para nivel ${nivelFinal}` };
  }
  return { ok: false, resultado: `acao_desconhecida: ${acao}` };
}

async function rotinaAutoAprovacao(): Promise<{ auto_aprovadas: number; falhas: number; aguardando: number }> {
  const corte = new Date(Date.now() - AUTO_APROVACAO_HORAS * 3600000).toISOString();
  const { data: pendentesAntigas } = await sb.from('agente_aprovacoes').select('*').eq('status', 'pendente').lt('created_at', corte).order('created_at', { ascending: true }).limit(30);
  const aplicadas: string[] = []; const falhas: string[] = [];
  for (const ap of (pendentesAntigas || [])) {
    const acao = (ap.opcoes?.[0]?.acao as string) || ''; if (!AUTO_APROVACAO_WHITELIST.includes(acao)) continue;
    const exec = await executarAcaoAprovada(ap); const { ok, resultado } = exec;
    if (ok) {
      await sb.from('agente_aprovacoes').update({ status: 'aprovado', resposta: `auto_aprovado_politica_${AUTO_APROVACAO_HORAS}h`, respondido_em: ap.respondido_em ?? new Date().toISOString() }).eq('id', ap.id);
      aplicadas.push(ap.titulo);
      await registrarDecisao({ acao: 'auto_aprovacao_48h', resultado: 'executada', contexto: { aprovacao_id: ap.id, decisao_id: ap.decisao_id ?? null, titulo: ap.titulo, acao_alvo: acao, agente_alvo: ap.agente_slug }, decisao: { politica: `baixo_risco_${AUTO_APROVACAO_HORAS}h`, resultado } });
    } else if (!resultado.startsWith('guardiao_bloqueou')) {
      if (ap.agente_slug === 'agente-midia' && ap.decisao_id && !resultado.startsWith('identidade_bloqueou')) {
        await sb.from('agente_aprovacoes').update({ status: 'aprovado', resposta: `auto_aprovado_politica_${AUTO_APROVACAO_HORAS}h`, respondido_em: ap.respondido_em ?? new Date().toISOString() }).eq('id', ap.id);
      }
      falhas.push(`${ap.titulo} (${resultado.slice(0, 60)})`);
      await registrarDecisao({ acao: 'auto_aprovacao_48h', resultado: exec.bloqueado ? 'bloqueada_executor' : 'falhou', contexto: { aprovacao_id: ap.id, decisao_id: ap.decisao_id ?? null, titulo: ap.titulo, acao_alvo: acao, motivo_falha: resultado, chegou_executor: exec.chegou_executor ?? false, executor_status: exec.http_status ?? null }, decisao: { politica: `baixo_risco_${AUTO_APROVACAO_HORAS}h` } });
    }
  }
  const { data: todasPendentes } = await sb.from('agente_aprovacoes').select('titulo, opcoes, expira_em').eq('status', 'pendente').order('expira_em', { ascending: true });
  const aguardandoVoce = (todasPendentes || []).filter((p: any) => !AUTO_APROVACAO_WHITELIST.includes((p.opcoes?.[0]?.acao as string) || '')).map((p: any) => p.titulo);
  if (aplicadas.length || falhas.length || aguardandoVoce.length) {
    const linhas: string[] = [`🤖 *Patricia — rotina de auto-aprovacao (${AUTO_APROVACAO_HORAS}h)*`, ''];
    if (aplicadas.length) { linhas.push('✅ *Auto-aprovadas (baixo risco):*'); aplicadas.slice(0, 12).forEach(t => linhas.push(`• ${t}`)); linhas.push(''); }
    if (falhas.length) { linhas.push('⚠️ *Falharam na aplicacao:*'); falhas.slice(0, 6).forEach(t => linhas.push(`• ${t}`)); linhas.push(''); }
    if (aguardandoVoce.length) { linhas.push(`⏳ *Aguardando VOCE (${aguardandoVoce.length} — nao elegiveis a auto-aprovacao):*`); aguardandoVoce.slice(0, 8).forEach(t => linhas.push(`• ${t}`)); }
    await enviarWhatsApp(linhas.join('\n').trim());
  }
  return { auto_aprovadas: aplicadas.length, falhas: falhas.length, aguardando: aguardandoVoce.length };
}

async function modoEmergencia(): Promise<void> {
  const { data: agentes } = await sb.from('agentes').select('slug, nivel_autonomia_atual').in('status', ['ativo', 'em_desenvolvimento']);
  for (const a of (agentes || [])) await sb.from('agentes').update({ nivel_antes_pausa: a.nivel_autonomia_atual, nivel_autonomia_atual: 0, updated_at: new Date().toISOString() }).eq('slug', a.slug);
  await sb.from('sistema_config').upsert({ chave: 'sistema_pausado', valor_bool: true, motivo: `PARAR TUDO ativado por Alessandro em ${new Date().toLocaleString('pt-BR')}`, atualizado_por: 'agente-aprovacao', atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  await enviarWhatsApp('🚨 *MODO EMERGENCIA ATIVADO*\n\nTodos os agentes foram pausados (nivel 0).\nNenhuma acao externa sera executada.\n\nO sistema permanece pausado ate sua autorizacao explicita.\n\nEnvie *REATIVAR* para desbloquear o sistema.');
  await registrarDecisao({ acao: 'emergencia_ativada', resultado: 'executada', contexto: { trigger: 'manual_alessandro', total_agentes_pausados: agentes?.length || 0 }, decisao: { acao: 'PARAR TUDO', agentes_pausados: (agentes || []).map((a: any) => a.slug) } });
}

async function reativarSistema(): Promise<void> {
  await sb.from('sistema_config').upsert({ chave: 'sistema_pausado', valor_bool: false, motivo: `Sistema reativado por Alessandro em ${new Date().toLocaleString('pt-BR')}`, atualizado_por: 'agente-aprovacao', atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  const { data: agentes } = await sb.from('agentes').select('nome, nivel_autonomia_atual, nivel_antes_pausa').in('status', ['ativo', 'em_desenvolvimento']);
  const linhas = (agentes || []).map(a => `• ${a.nome}: nivel 0 (era ${a.nivel_antes_pausa ?? '?'} antes da emergencia)`);
  await enviarWhatsApp(`✅ *Sistema reativado*\n\nO bloqueio global foi removido.\n\n*Agentes permanecem no nivel 0:*\n${linhas.join('\n')}\n\nPara subir o nivel de qualquer agente, aguarde a avaliacao do Andre ou envie uma aprovacao manual.`);
  await registrarDecisao({ acao: 'sistema_reativado', resultado: 'executada', contexto: { trigger: 'manual_alessandro', total_agentes: agentes?.length || 0 }, decisao: { acao: 'REATIVAR', sistema_pausado: false } });
}

async function gerarStatusRapido(): Promise<void> {
  const { data: agentes } = await sb.from('agentes').select('nome, nivel_autonomia_atual, status, dry_run_ativo').in('status', ['ativo', 'em_desenvolvimento', 'em_teste']);
  const { data: pendentes } = await sb.from('agente_aprovacoes').select('titulo, agente_slug').eq('status', 'pendente');
  const { data: sysConfig } = await sb.from('sistema_config').select('chave, valor_bool').eq('chave', 'sistema_pausado').single();
  const sistemaPausado = sysConfig?.valor_bool ?? false;
  const nivelEmoji: Record<number, string> = { 0: '👁️', 1: '📋', 2: '⚡', 3: '💰', 4: '🎯', 5: '🤖' };
  const linhas = (agentes || []).map(a => `${nivelEmoji[a.nivel_autonomia_atual] || '?'} ${a.nome} — nivel ${a.nivel_autonomia_atual}${a.dry_run_ativo ? ' [DRY-RUN]' : ''}`);
  const msg = [`📊 *Status do Synapse*`, sistemaPausado ? '🚨 *SISTEMA PAUSADO*' : '✅ *Sistema ativo*', '', ...linhas, '', pendentes?.length ? `⏳ *${pendentes.length} aprovacao(oes) pendente(s):*\n${pendentes.map((p: any) => `• ${p.titulo}`).join('\n')}` : '✅ Sem aprovacoes pendentes'].join('\n');
  await enviarWhatsApp(msg);
  await registrarDecisao({ acao: 'status_enviado', resultado: 'executada', contexto: { sistema_pausado: sistemaPausado, total_agentes: agentes?.length || 0, aprovacoes_pendentes: pendentes?.length || 0 }, decisao: { acao: 'enviar_status', destino: 'alessandro' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body: any; try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  if (body.modo === 'auto_aprovacao') {
    const resultado = await rotinaAutoAprovacao(); return new Response(JSON.stringify({ ok: true, ...resultado }), { status: 200 });
  }

  const phoneRaw = body.phone ?? body.user_data?.ph ?? ''; const phone = phoneRaw.replace(/\D/g, '');
  const mensagem = body.text?.message ?? body.mensagem ?? ''; const fromMe = body.fromMe ?? false;
  if (fromMe) return new Response(JSON.stringify({ ok: true, skip: 'from_me' }), { status: 200 });
  if (!phone.includes(ALESSANDRO_PHONE.replace(/\D/g, ''))) return new Response(JSON.stringify({ ok: true, skip: 'nao_e_alessandro' }), { status: 200 });

  const buttonPayload = body.button?.payload ?? body.postback?.payload ?? body.interactive?.button_reply?.id ?? '';
  let respostaForcada: 'sim' | 'nao' | null = null; let aprovacaoIdForcada: string | null = null;
  if (buttonPayload.startsWith('sim_')) { respostaForcada = 'sim'; aprovacaoIdForcada = buttonPayload.replace('sim_', ''); }
  if (buttonPayload.startsWith('nao_')) { respostaForcada = 'nao'; aprovacaoIdForcada = buttonPayload.replace('nao_', ''); }
  const resposta = respostaForcada ?? normalizarResposta(mensagem);

  if (resposta === 'parar') { await modoEmergencia(); return new Response(JSON.stringify({ ok: true, acao: 'emergencia' }), { status: 200 }); }
  if (resposta === 'reativar') { await reativarSistema(); return new Response(JSON.stringify({ ok: true, acao: 'reativado' }), { status: 200 }); }
  if (resposta === 'status') { await gerarStatusRapido(); return new Response(JSON.stringify({ ok: true, acao: 'status' }), { status: 200 }); }

  if (resposta === 'sim' || resposta === 'nao') {
    let aprovacao: any = null;
    if (aprovacaoIdForcada) {
      const { data } = await sb.from('agente_aprovacoes').select('*').eq('id', aprovacaoIdForcada).single();
      aprovacao = data;
    } else {
      const { data } = await sb.from('agente_aprovacoes').select('*').eq('status', 'pendente')
        .lt('expira_em', new Date(Date.now() + 48 * 3600000).toISOString())
        .order('created_at', { ascending: false }).limit(2);
      if ((data?.length ?? 0) > 1) {
        await enviarWhatsApp('Tenho mais de uma aprovacao pendente. Use o botao da aprovacao que voce quer decidir para eu manter a identidade correta.');
        await registrarDecisao({
          acao: 'nenhum', resultado: 'executada',
          contexto: { resposta_recebida: resposta, motivo: 'resposta_livre_ambigua', aprovacoes_pendentes: (data || []).map((a: any) => a.id) },
          decisao: { motivo: 'mais_de_uma_aprovacao_pendente_exige_id' },
        });
        return new Response(JSON.stringify({ ok: true, skip: 'resposta_livre_ambigua', pendentes: data?.length ?? 0 }), { status: 200 });
      }
      aprovacao = data?.[0] ?? null;
    }

    if (!aprovacao) {
      await enviarWhatsApp('Nao encontrei nenhuma aprovacao pendente. Pode ser que ja tenha expirado.');
      await registrarDecisao({ acao: 'nenhum', resultado: 'executada', contexto: { resposta_recebida: resposta, motivo: 'sem_aprovacao_pendente' }, decisao: { motivo: 'nenhuma_aprovacao_encontrada' } });
      return new Response(JSON.stringify({ ok: true, skip: 'sem_aprovacao_pendente' }), { status: 200 });
    }

    if (resposta === 'nao') {
      await sb.from('agente_aprovacoes').update({ status: 'rejeitado', resposta: mensagem, respondido_em: new Date().toISOString() }).eq('id', aprovacao.id);
      if (aprovacao.opcoes?.[0]?.objecao_id) await sb.from('lead_objections').update({ status_aprovacao: 'rejeitado' }).eq('id', aprovacao.opcoes[0].objecao_id);
      await enviarWhatsApp(`❌ *Rejeitado*\n\n${aprovacao.titulo}`);
      await registrarDecisao({ acao: 'acao_rejeitada', resultado: 'executada', contexto: { agente_alvo: aprovacao.agente_slug, aprovacao_id: aprovacao.id, decisao_id: aprovacao.decisao_id ?? null, titulo: aprovacao.titulo }, decisao: { acao: aprovacao.opcoes?.[0]?.acao, motivo: 'alessandro_rejeitou' } });
      return new Response(JSON.stringify({ ok: true, acao: 'rejeitado' }), { status: 200 });
    }

    const exec = await executarAcaoAprovada(aprovacao); const { ok, resultado } = exec;
    const acaoSolicitada = aprovacao.opcoes?.[0]?.acao;
    const ehMidiaCampanha = aprovacao.agente_slug === 'agente-midia' && (acaoSolicitada === 'pausar_campanha' || acaoSolicitada === 'escalar_orcamento');
    const ehObjecaoTask = aprovacao.agente_slug === 'agente-objecoes' && acaoSolicitada === 'criar_task_tamires_analisar_objecao';

    if (ehMidiaCampanha || ehObjecaoTask) {
      await sb.from('agente_aprovacoes').update({ status: 'aprovado', resposta: mensagem || 'aprovado_via_botao', respondido_em: aprovacao.respondido_em ?? new Date().toISOString() }).eq('id', aprovacao.id);
      if (ok) {
        await enviarWhatsApp(`✅ *Acao executada*\n\n${aprovacao.titulo}\n\n${resultado}`);
        await registrarDecisao({ acao: 'acao_aprovada', resultado: 'executada', contexto: { agente_alvo: aprovacao.agente_slug, aprovacao_id: aprovacao.id, decisao_id: aprovacao.decisao_id, titulo: aprovacao.titulo, resultado_execucao: resultado, chegou_executor: exec.chegou_executor ?? false, executor_status: exec.http_status ?? null }, decisao: { acao: acaoSolicitada, motivo: 'alessandro_aprovou_e_executor_confirmou' } });
      } else {
        const classe = exec.bloqueado ? 'bloqueada_executor' : 'falhou';
        await enviarWhatsApp(`⚠️ *Aprovado; nao executado*\n\n${aprovacao.titulo}\n\nResultado do executor: ${resultado}`);
        await registrarDecisao({ acao: 'acao_aprovada', resultado: classe, contexto: { agente_alvo: aprovacao.agente_slug, aprovacao_id: aprovacao.id, decisao_id: aprovacao.decisao_id, titulo: aprovacao.titulo, resultado_execucao: resultado, chegou_executor: exec.chegou_executor ?? false, executor_status: exec.http_status ?? null }, decisao: { acao: acaoSolicitada, motivo: exec.bloqueado ? 'alessandro_aprovou_executor_bloqueou' : 'alessandro_aprovou_execucao_falhou' } });
      }
      return new Response(JSON.stringify({ ok: true, acao: 'aprovado', execucao: ok ? 'executada' : (exec.bloqueado ? 'bloqueada' : 'falhou'), resultado, decisao_id: aprovacao.decisao_id, chegou_executor: exec.chegou_executor ?? false }), { status: 200 });
    }

    if (ok) {
      await sb.from('agente_aprovacoes').update({ status: 'aprovado', resposta: mensagem, respondido_em: new Date().toISOString() }).eq('id', aprovacao.id);
      await enviarWhatsApp(`✅ *Acao executada*\n\n${aprovacao.titulo}\n\n${resultado}`);
      await registrarDecisao({ acao: 'acao_aprovada', resultado: 'executada', contexto: { agente_alvo: aprovacao.agente_slug, aprovacao_id: aprovacao.id, titulo: aprovacao.titulo, resultado_execucao: resultado }, decisao: { acao: aprovacao.opcoes?.[0]?.acao, motivo: 'alessandro_aprovou_e_executou' } });
    } else if (!resultado.startsWith('guardiao_bloqueou')) {
      await sb.from('agente_aprovacoes').update({ status: 'rejeitado', resposta: mensagem, respondido_em: new Date().toISOString() }).eq('id', aprovacao.id);
      await enviarWhatsApp(`⚠️ *Aprovado mas falhou*\n\n${aprovacao.titulo}\n\nMotivo: ${resultado}\n\nVerifique os logs.`);
      await registrarDecisao({ acao: 'acao_aprovada', resultado: 'falhou', contexto: { agente_alvo: aprovacao.agente_slug, aprovacao_id: aprovacao.id, titulo: aprovacao.titulo, motivo_falha: resultado }, decisao: { acao: aprovacao.opcoes?.[0]?.acao, motivo: 'alessandro_aprovou_mas_execucao_falhou' } });
    }
    return new Response(JSON.stringify({ ok: true, acao: ok ? 'aprovado' : 'bloqueado', resultado }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true, skip: 'mensagem_nao_reconhecida' }), { status: 200 });
});
