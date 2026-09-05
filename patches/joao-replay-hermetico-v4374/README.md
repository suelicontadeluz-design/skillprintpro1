# João replay hermético — v4.37.4

Objetivo: reativar `agente-noturno-replay` sem alterar `agente-noturno` de produção e provar a esteira Cérebro/Córtex com efeito-zero.

## Contrato

- fonte cognitiva: João vivo v4.37.4 (`5ea0aa377acf6b117b270cdcce0ea5cc3afb9091`)
- isolamento de aplicação: interceptar writes Supabase e bloquear I/O externo (Z-API, BotConversa, Mercado Pago, filas/Edges mutadoras, TTS, CRM e mídia)
- isolamento de infraestrutura: cliente hermético autenticado como `replay_runner`; nenhuma mutação operacional deve ser autorizada
- snapshot histórico: `fn_replay_snapshot`; nunca completar `agente_noturno_estado` com estado atual
- juiz: `fn_replay_comparar`
- prova secundária de efeito-zero: `fn_replay_efeito_zero_veredito`

## Correções em relação ao candidato de 30/08

1. Rebase determinístico de todo o delta live v4.37.1 → v4.37.4 sobre o candidato hermético já provado.
2. `fn_compor_total` deixa a allowlist de leitura: é mutadora/SECURITY DEFINER e deve ser interceptada.
3. `fn_precificar_dtf_uv_v2` entra na allowlist de leitura/computação.

## Canário

A matriz fixa está em `canario-5.json`: 1 sentinela + 1 controle_ok + 1 controle_oposto + 1 controle_similar + 1 borda.

Gate: zero escrita, zero I/O externo, sentinela=MELHOROU, controles sem REGREDIU, nenhum INDETERMINADO.

## Bloqueador atual medido em 05/09/2026

O papel Postgres `replay_runner` existe e não tem EXECUTE nas RPCs financeiras mutadoras, mas a Edge dedicada não possui uma identidade utilizável para assumir esse papel. O candidato antigo exigia `REPLAY_RUNNER_JWT`; a Edge `agente-noturno-replay` permanece neutralizada por esse motivo.

Não reativar o slug usando `service_role` como substituto: isso removeria a segunda barreira de segurança aprovada para o protocolo de promoção do Córtex.
