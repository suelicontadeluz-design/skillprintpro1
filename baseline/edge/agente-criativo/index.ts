// agente-criativo v3.5.0
// Frente kpis-decisivos-midia: observacao fail-closed durante o shadow.
// Contrato: zero Meta, zero geracao externa, zero WhatsApp, zero aprovacao,
// zero experimento. A Camila registra manter/abster e nao executa criativo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AGENT_VERSION = 'agente-criativo-v3.5.0';
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function execStart(modo: string, inputs: any): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_exec_start', {
      p_agente: 'agente-criativo', p_versao: AGENT_VERSION,
      p_modo: modo, p_inputs: inputs,
    });
    return error ? null : data;
  } catch { return null; }
}

async function execFinish(id: string | null, status: string, ms: number, outputs: any, erros: any[] = []) {
  if (!id) return;
  try {
    await sb.rpc('fn_exec_finish', {
      p_exec_id: id, p_status: status, p_ms: ms,
      p_outputs: outputs, p_erros: erros,
    });
  } catch {}
}

async function getConfig() {
  try {
    const { data, error } = await sb.from('agentes')
      .select('nivel_autonomia_atual,status,dry_run_ativo')
      .eq('slug','agente-criativo').maybeSingle();
    if (error) throw error;
    return {
      nivel: data?.nivel_autonomia_atual ?? 0,
      status: data?.status ?? 'pausado',
      dryRun: data?.dry_run_ativo ?? true,
    };
  } catch {
    return { nivel: 0, status: 'pausado', dryRun: true };
  }
}

async function registrar(params: {
  acao: 'manter' | 'abstido_sem_criterio' | 'nenhum';
  resultado: string;
  nivel: number;
  dryRun: boolean;
  contexto: any;
  decisao: any;
}): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-criativo',
      p_acao_executada: params.acao,
      p_resultado: params.resultado,
      p_nivel_autonomia: params.nivel,
      p_lead_id: null,
      p_contexto: params.contexto,
      p_decisao: params.decisao,
      p_impacto_financeiro: null,
      p_acerto: null,
      p_feedback: null,
      p_agent_version: AGENT_VERSION,
      p_prompt_version: 'shadow_criativo_v1',
      p_dry_run: params.dryRun,
      p_tempo_ms: null,
    });
    return error ? null : data;
  } catch { return null; }
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch {}
  const modo = String(body.mode || (body.campaign_id ? 'solicitacao_campanha' : 'standalone'));
  const execId = await execStart(modo, {
    mode: modo,
    campaign_id: body.campaign_id ?? null,
    segmento: body.segmento ?? null,
  });

  try {
    const config = await getConfig();
    const contexto = {
      mode: modo,
      campaign_id: body.campaign_id ?? null,
      campaign_name: body.campaign_name ?? null,
      segmento: body.segmento ?? null,
      origem_solicitacao: body.campaign_id ? 'campanha' : 'cron_ou_manual',
    };

    const entradaValida = Boolean(body.campaign_id && body.segmento);
    const acao = entradaValida ? 'manter' : 'abstido_sem_criterio';
    const motivo = entradaValida
      ? 'criativo_bloqueado_sem_gatilho_promovido'
      : 'solicitacao_criativa_sem_campanha_e_segmento';

    const decisionId = await registrar({
      acao,
      resultado: 'executada',
      nivel: config.nivel,
      dryRun: config.dryRun,
      contexto,
      decisao: {
        motivo,
        contrato: 'shadow_criativo_v1',
        geracao_disponivel: false,
        geracao_bloqueio: 'gatilho_criativo_validado_ausente',
        publicacao_disponivel: false,
        publicacao_bloqueio: 'acoes_externas_bloqueadas_durante_shadow',
        aprovacao_criada: false,
        experimento_criado: false,
        whatsapp_enviado: false,
        agent_version: AGENT_VERSION,
      },
    });

    const outputs = {
      acao, motivo, decision_id: decisionId,
      acoes_externas: 0, aprovacoes_criadas: 0,
      experimentos_criados: 0, whatsapp_enviado: false,
    };
    await execFinish(execId, 'ok', Date.now()-inicio, outputs);
    return new Response(JSON.stringify({
      ok: true, versao: AGENT_VERSION, nivel: config.nivel,
      dry_run: config.dryRun, ...outputs,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    const erro = String(e?.message || e);
    await execFinish(execId, 'fatal', Date.now()-inicio, {}, [erro]);
    return new Response(JSON.stringify({ ok:false, erro }), {
      status: 500, headers: { 'Content-Type':'application/json' },
    });
  }
});
