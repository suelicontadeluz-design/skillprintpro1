-- Migration aplicada em 30/08/2026 no projeto ldrdtaibazplvrbwyrvx (cerebro-vendas)
-- como supabase_migrations.schema_migrations version com name = 'fn_objecao_registrar_uso_upgrade_handoff'.
-- Copia de referencia para o repositorio; a fonte de verdade e o banco.
-- =====================================================================
-- Correcao da corrida "mensagem_enviada antes do handoff" (30/08/2026).
--
-- Problema: agente-exploracao registra 'mensagem_enviada' primeiro
-- (aguardando -> aprovado_sem_acao) e o 'handoff_humano' que chega minutos
-- depois batia no guard WHERE status_aprovacao='aguardando' e nao promovia
-- mais a objecao para 'aprovado_virou_task' (ultimos casos promovidos por
-- esta rota: 03/06 e 12/06/2026, quando o handoff era o primeiro toque).
--
-- Nova transicao permitida (UPGRADE ONLY, documentada tambem na
-- fn_objecao_aprovada_criar_task):
--   'aguardando'        -> 'aprovado_sem_acao' | 'aprovado_virou_task' (como antes)
--   'aprovado_sem_acao' -> 'aprovado_virou_task'                       (NOVA)
-- Nunca regride: 'aprovado_virou_task' e 'rejeitado' permanecem terminais;
-- 'aprovado_sem_acao' nunca sobrescreve outro 'aprovado_sem_acao' nem um
-- 'aprovado_virou_task'. Esta funcao NAO cria task (semantica historica
-- preservada), logo nao ha risco de task duplicada por esta rota.
--
-- Rollback: executar o campo definicao de backup_funcoes_objecao_loop_20260830
-- (nome='fn_objecao_registrar_uso') verbatim.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.backup_funcoes_objecao_loop_20260830 (
  nome text PRIMARY KEY,
  definicao text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.backup_funcoes_objecao_loop_20260830 IS
  'Baseline pre-correcao do loop de objecoes (30/08/2026). Rollback = executar definicao verbatim. NAO APAGAR.';
ALTER TABLE public.backup_funcoes_objecao_loop_20260830 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.backup_funcoes_objecao_loop_20260830 (nome, definicao)
SELECT 'fn_objecao_registrar_uso', pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fn_objecao_registrar_uso'
ON CONFLICT (nome) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_objecao_registrar_uso(p_lead_id uuid, p_objection_id uuid, p_playbook_id uuid, p_agente_slug text, p_modo text, p_contexto jsonb DEFAULT '{}'::jsonb, p_usage_type text DEFAULT NULL::text, p_conversation_message_id uuid DEFAULT NULL::uuid, p_enviado_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status_aprovacao text;
  v_direction        text;
BEGIN
  -- valida cedo: usage_type fora do enum e erro do chamador, nao silencio
  IF p_usage_type IS NOT NULL
     AND p_usage_type NOT IN ('consultado','aplicado','adaptado','ignorado') THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'usage_type invalido: ' || p_usage_type,
      'validos', jsonb_build_array('consultado','aplicado','adaptado','ignorado'));
  END IF;

  -- ===================================================================
  -- COERENCIA DE 'aplicado' (2026-08-09).
  -- 'aplicado' afirma que o script foi para o cliente. Essa afirmacao so
  -- vale com uma linha outbound real. IS NOT DISTINCT FROM porque
  -- p_usage_type pode ser NULL e `NULL = 'aplicado'` devolve NULL, o que
  -- faria o IF pular em silencio.
  -- Guarda DORMENTE por desenho: nenhum chamador emite 'aplicado' hoje,
  -- porque contexto + outbound associado NAO provam influencia do script.
  -- Ela existe para impedir que um chamador futuro reivindique de graca.
  -- ===================================================================
  IF p_usage_type IS NOT DISTINCT FROM 'aplicado' THEN
    IF p_conversation_message_id IS NULL THEN
      RETURN jsonb_build_object('ok', false,
        'error', 'usage_type_aplicado_exige_conversation_message_id');
    END IF;

    SELECT fc.direction INTO v_direction
      FROM fact_conversations fc
     WHERE fc.id = p_conversation_message_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false,
        'error', 'conversation_message_id_inexistente',
        'conversation_message_id', p_conversation_message_id);
    END IF;

    IF v_direction IS DISTINCT FROM 'outbound' THEN
      RETURN jsonb_build_object('ok', false,
        'error', 'conversation_message_id_nao_e_outbound',
        'direction', COALESCE(v_direction, '(null)'));
    END IF;
  END IF;

  -- Auditoria imutavel (sempre insere - audit trail completo)
  INSERT INTO objection_playbook_usage(
    lead_id, objection_id, playbook_id, agente_slug, modo, contexto,
    usage_type, conversation_message_id, enviado_em)
  VALUES (
    p_lead_id, p_objection_id, p_playbook_id, p_agente_slug, p_modo,
    COALESCE(p_contexto, '{}'),
    -- enviado_em NAO e mais fabricado. Sem observacao, NULL.
    -- Semantica congelada nesta versao: quando preenchido, significa o
    -- instante observado do HTTP 2xx do BotConversa, isto e,
    -- requisicao_aceita_pelo_provedor. NAO significa entrega no WhatsApp.
    p_usage_type, p_conversation_message_id, p_enviado_em);

  v_status_aprovacao := CASE
    WHEN p_modo IN ('task', 'handoff', 'handoff_humano', 'escalar_tamires', 'aprovado_virou_task')
      THEN 'aprovado_virou_task'
    ELSE 'aprovado_sem_acao'
  END;

  -- ===================================================================
  -- MAQUINA DE ESTADOS (corrigida em 30/08/2026 - corrida do handoff).
  -- Antes: so 'aguardando' podia transicionar, entao um 'mensagem_enviada'
  -- anterior (aguardando -> aprovado_sem_acao) bloqueava para sempre o
  -- 'handoff_humano' legitimo que chegava minutos depois.
  -- Agora: 'aprovado_sem_acao' -> 'aprovado_virou_task' e permitido
  -- (UPGRADE ONLY). Estados terminais nao regridem:
  --   - 'aprovado_virou_task' nunca e sobrescrito;
  --   - 'rejeitado' nunca e sobrescrito;
  --   - 'aprovado_sem_acao' nao e re-gravado por outro 'aprovado_sem_acao'
  --     (apenas o upgrade para 'aprovado_virou_task' o toca).
  -- Esta funcao continua NAO criando task: a task e responsabilidade da
  -- rota de execucao aprovada (fn_objecao_aprovada_criar_task).
  -- ===================================================================
  UPDATE lead_objections
  SET tratado_por      = p_agente_slug,
      tratado_em       = NOW(),
      status_aprovacao = v_status_aprovacao
  WHERE id = p_objection_id
    AND (
      status_aprovacao = 'aguardando'
      OR (status_aprovacao = 'aprovado_sem_acao' AND v_status_aprovacao = 'aprovado_virou_task')
    );

  IF p_playbook_id IS NOT NULL THEN
    UPDATE objection_playbooks
    SET vezes_usado = COALESCE(vezes_usado, 0) + 1,
        updated_at  = NOW()
    WHERE id = p_playbook_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'objection_id',  p_objection_id,
    'playbook_id',   p_playbook_id,
    'agente_slug',   p_agente_slug,
    'modo',          p_modo,
    'usage_type',    p_usage_type,
    'com_evidencia', (p_conversation_message_id IS NOT NULL));
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebra o agente chamador
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
