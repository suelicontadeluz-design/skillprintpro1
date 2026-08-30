-- Migration aplicada em 30/08/2026 no projeto ldrdtaibazplvrbwyrvx (cerebro-vendas)
-- como supabase_migrations.schema_migrations version com name = 'fn_objecao_aprovada_criar_task_v1'.
-- Copia de referencia para o repositorio; a fonte de verdade e o banco.
-- =====================================================================
-- Rota de execucao aprovada para objeções (frente ja existente do loop
-- de objeções; nenhuma frente nova). Chamada EXCLUSIVAMENTE pela edge
-- agente-aprovacao (service_role) depois que a aprovacao humana/governada
-- ja foi registrada como status='aprovado'.
--
-- Contrato:
--   - fail-closed: qualquer vinculo ausente ou estado incompativel recusa;
--   - atomica: task + status da objecao na mesma transacao (EXCEPTION
--     handler do plpgsql desfaz tudo em caso de erro);
--   - idempotente: chave = lead_objections.task_id (coluna existente,
--     nunca usada ate hoje: 0 linhas). Replay devolve 'ja_existia';
--   - ai_decision_id da task fica NULL DE PROPOSITO: trg_crm_task_to_disparo
--     e fail-closed com ai_decision_id NULL, logo NENHUMA mensagem
--     automatica e enfileirada ao lead. A task e humana (Tamires).
--     Automatizar o contato seria autonomia nova — fora do escopo;
--   - objecoes legadas ja finalizadas ('aprovado_virou_task' sem task_id,
--     escritas manualmente antes de 07/2026) sao RECUSADAS: esta rota nao
--     reprocessa backlog;
--   - transicao permitida alem de 'aguardando': 'aprovado_sem_acao' ->
--     'aprovado_virou_task' (upgrade only; mesma transicao documentada na
--     correcao da corrida em fn_objecao_registrar_uso). Nunca regride
--     'aprovado_virou_task' nem 'rejeitado'.
-- Ordem canonica de lock: agente_aprovacoes -> lead_objections.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_objecao_aprovada_criar_task(
  p_objecao_id  uuid,
  p_aprovacao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_apr      agente_aprovacoes%ROWTYPE;
  v_obj      lead_objections%ROWTYPE;
  v_op       jsonb;
  v_task_id  uuid;
  v_phone    text;
  v_nome     text;
  v_urgencia text;
BEGIN
  IF p_objecao_id IS NULL OR p_aprovacao_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'parametros_nulos');
  END IF;

  SELECT * INTO v_apr FROM agente_aprovacoes WHERE id = p_aprovacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_inexistente');
  END IF;

  IF v_apr.agente_slug IS DISTINCT FROM 'agente-objecoes' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'agente_invalido');
  END IF;

  v_op := COALESCE(v_apr.opcoes -> 0, '{}'::jsonb);

  IF (v_op->>'acao') IS DISTINCT FROM 'criar_task_tamires_analisar_objecao' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'acao_incompativel');
  END IF;

  IF (v_op->>'objecao_id') IS NULL OR (v_op->>'objecao_id')::uuid IS DISTINCT FROM p_objecao_id THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_de_outra_objecao');
  END IF;

  IF v_apr.status = 'expirado' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_expirada');
  END IF;
  IF v_apr.status = 'rejeitado' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_rejeitada');
  END IF;
  IF v_apr.status IS DISTINCT FROM 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_nao_aprovada');
  END IF;
  -- 'aprovado' sem resposta e ja vencida = residuo historico, nao aprovacao viva
  IF v_apr.respondido_em IS NULL AND v_apr.expira_em IS NOT NULL AND v_apr.expira_em < now() THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_expirada_sem_resposta');
  END IF;

  IF v_apr.decisao_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'aprovacao_sem_decisao_id');
  END IF;

  SELECT * INTO v_obj FROM lead_objections WHERE id = p_objecao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'objecao_inexistente');
  END IF;

  IF v_obj.decision_id IS NULL OR v_obj.decision_id IS DISTINCT FROM v_apr.decisao_id THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'vinculo_decisao_divergente');
  END IF;

  IF (v_op->>'lead_id') IS NULL OR (v_op->>'lead_id')::uuid IS DISTINCT FROM v_obj.lead_id THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'lead_divergente');
  END IF;

  -- Idempotencia: task ja registrada para esta objecao
  IF v_obj.task_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM crm_tasks WHERE id = v_obj.task_id) THEN
      RETURN jsonb_build_object('ok', true, 'resultado', 'ja_existia',
        'task_id', v_obj.task_id, 'objecao_id', p_objecao_id, 'aprovacao_id', p_aprovacao_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'estado_inconsistente_task_id_sem_task');
  END IF;

  IF v_obj.status_aprovacao = 'aprovado_virou_task' THEN
    -- finalizada manualmente antes desta rota existir; backlog nao e reprocessado aqui
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'objecao_finalizada_sem_task_rastreavel');
  END IF;
  IF v_obj.status_aprovacao = 'rejeitado' THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'objecao_rejeitada');
  END IF;
  IF v_obj.status_aprovacao NOT IN ('aguardando', 'aprovado_sem_acao') THEN
    RETURN jsonb_build_object('ok', false, 'resultado', 'recusada', 'motivo', 'estado_objecao_invalido:' || COALESCE(v_obj.status_aprovacao, '(null)'));
  END IF;

  -- Conteudo critico vem do banco (objecao/lead/aprovacao persistida), nao do chamador
  SELECT lm.ph,
         COALESCE(NULLIF(btrim(lm.fullname), ''), NULLIF(btrim(concat_ws(' ', lm.fn, lm.ln)), ''), 'Lead sem nome')
    INTO v_phone, v_nome
    FROM leads_marketing lm
   WHERE lm.lead_id = v_obj.lead_id;

  v_urgencia := CASE v_obj.forca WHEN 'forte' THEN 'alta' WHEN 'moderada' THEN 'media' ELSE 'baixa' END;

  INSERT INTO crm_tasks (
    phone, nome_cliente, etapa_funil, urgencia, titulo, orientacao,
    script_mensagem, status, vendedor, origem, due_at, lead_id, ai_decision_id
  ) VALUES (
    v_phone, v_nome, 'objecao_aprovada', v_urgencia,
    v_apr.titulo,
    'Alessandro aprovou o tratamento da objecao. Analisar o contexto e responder pelo atendimento humano, respeitando handoff.',
    NULLIF(btrim(v_op->>'script_sugerido'), ''),
    'pendente', 'Tamires', 'agente-aprovacao',
    now() + interval '24 hours',
    v_obj.lead_id,
    NULL
  ) RETURNING id INTO v_task_id;

  UPDATE lead_objections
     SET status_aprovacao = 'aprovado_virou_task',
         task_id      = v_task_id,
         aprovado_por = 'agente-aprovacao',
         aprovado_em  = now()
   WHERE id = p_objecao_id;

  RETURN jsonb_build_object('ok', true, 'resultado', 'criada',
    'task_id', v_task_id, 'objecao_id', p_objecao_id, 'aprovacao_id', p_aprovacao_id);

EXCEPTION WHEN OTHERS THEN
  -- rollback implicito de tudo que o bloco escreveu; nunca quebra o chamador
  RETURN jsonb_build_object('ok', false, 'resultado', 'erro', 'motivo', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_objecao_aprovada_criar_task(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_objecao_aprovada_criar_task(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_objecao_aprovada_criar_task(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_objecao_aprovada_criar_task(uuid, uuid) TO service_role;
