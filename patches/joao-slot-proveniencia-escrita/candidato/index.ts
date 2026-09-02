import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// v4.26.6 (16/08/2026) — detector de resposta alinhado ao LOST canonico.
// v4.26.5 (16/08/2026) — LOST canonico idempotente e fail-closed.
// Desistencia inequivoca + um unico deal ongoing gera LOST via ledger proprio.
// Negacao, condicional, cancelamento parcial, pedido humano, silencio, objecao,
// deal won/ambiguo/ausente nao geram LOST. Dry-run nao escreve nem chama o RD.
// v4.26.4 (16/08/2026) — CONTINUIDADE CALCME DETERMINISTICA (FASE SEGURA).
// O PDF CalcMe outbound validado e a fonte canonica. Consulta e aceite sem alteracao
// usam exclusivamente itens, unitarios, total e condicoes extraidos do PDF.
// No aceite, a entrada segue a porcentagem escrita no PDF e a autorizacao financeira
// oficial; nenhum valor e escolhido pelo modelo. Mudancas de pedido continuam fechadas
// ate a regra deterministica de quantidade ser provada. Zero alteracao em voz/TTS/Patch A.


// v4.22.2 (10/08/2026) — REACAO EM CONFIRMACAO CURTA DE ENCERRAMENTO.
// Caso Edna 5511998038692: depois de "fico no aguardo do comprovante", "Ta bom" caiu
// no fallback "deixa eu confirmar" e reabriu uma venda ja concluida. Agora confirmacoes
// curtas so recebem coracao quando o ultimo outbound do Joao ja encerrou o assunto. A reacao
// usa o messageId real do webhook via Z-API /send-reaction; falha nao vira texto inventado.
// Rollback: version 130.

// v4.22.1 (10/08/2026) — LINK DE CARTAO COM PROVENIENCIA OBRIGATORIA.
// O checkout de cartao ja era criado por mp-pix-criar, mas o modelo podia ignorar gerar_pix
// e escrever qualquer URL. Agora checkout_url e preservado no contexto, carregado da cobranca
// pendente e enviado deterministicamente. Link de pagamento so sai se for exatamente o retorno
// do Mercado Pago; qualquer URL inventada e bloqueada. Rollback: version 129.

// v4.21.9 (10/08/2026) — HARD GUARD DA FERRAMENTA DE DTF TEXTIL.
// A v4.21.8 orientava o modelo, mas calcular_dtf_metro ainda era executavel por codigo.
// Agora, quando o contexto contem largura + altura + copias, uma tentativa de usar
// calcular_dtf_metro e interceptada ANTES da execucao e redirecionada deterministicamente
// para calcular_dtf_por_arte com os argumentos do contexto. Defesa adicional dentro do
// executor recusa calcular_dtf_metro caso algum chamador futuro contorne o roteador.
// Pedido explicito em metros continua permitido. Rollback: version 126.
//
// v4.21.8 (10/08/2026) — MINIMO DE 1 METRO EM ALTERACAO DE DTF TEXTIL.
// Caso organico 5511990007497: 4 copias de 27x40cm viraram 2 depois do Pix pendente.
// O modelo usou calcular_dtf_metro(0.5), falou R$29,95 e tentou misturar autorizacao antiga.
// Correcoes: detector inclui "mudei", "so N copias" e "pedido novo"; alteracao deixa de chamar
// Pix pendente de pago; calcular_dtf_por_arte informa minimo, capacidade do metro e instrucao
// de manter a quantidade quando o preco nao cai. calcular_dtf_metro fica proibido quando ha
// medida de arte + copias. O guardrail financeiro continua intacto.
// Rollback: version 125.
//
// v4.21.6 (07/08/2026) — INVARIANTE DE PRESERVACAO NA GUARDA pergunta_repetida.
//  Defeito comprovado no lead 5511939243211 em 07/08 (18:40:05 e 18:41:19): o retry da guarda
//  parou de repetir a pergunta MAS apagou o orcamento ja calculado ("R$59,90" e "R$143,76" viraram
//  "Vou calcular o valor" e "Deixa eu calcular o consumo de filme"). Sem pergunta_repetida_2a_falha:
//  o sistema tratou as duas destruicoes como SUCESSO. R$143,76 foi reconstruido pelas tabelas e
//  bate com a mensagem apagada. Corrigido em tres partes, todas dentro do bloco da guarda:
//   1) INVARIANTE. valoresDaMensagem() e comparado antes/depois; perdeuValor entra na condicao de
//      aceite do retry. Preservacao e SUBCONJUNTO: o retry pode ACRESCENTAR valor, nao pode apagar.
//   2) RECUPERACAO DETERMINISTICA. Perdendo valor, o retry e recusado e a saida passa a ser a
//      ORIGINAL menos a sentenca interrogativa que ehMesmaPergunta() identificou como repetida
//      (nova funcao removerPerguntaRepetida). So corte e limpeza de espacos/quebras: nao reescreve,
//      nao resume, nao recalcula. Identificacao nao inequivoca (0 ou >1 candidata, ou candidata
//      repetida no texto) => nenhuma cirurgia, resultado preservacao_falhou, original intacta e o
//      fluxo posterior de validacao decide.
//   3) TELEMETRIA SIMETRICA. Novo evento pergunta_repetida_desfecho gravado SEMPRE, com resultado
//      (aceito | rejeitado | preservado_cirurgia | preservacao_falhou), perdeu_valor,
//      resposta_original, resposta_retry, resposta_final, valores_antes, valores_depois,
//      tools_antes, tools_depois, nucleo e phone. toolsUsadas e mutavel: as copias sao feitas antes
//      do retry (toolsAntes) e depois dele (toolsDepois). pergunta_repetida_2a_falha mantem o
//      significado que ja tinha (retry NAO aceito) para nao quebrar vw_guardas_desfecho.
//  Aplicado por ancora sobre a v4.21.5 (LIVE version 118). NADA fora do bloco da guarda foi tocado:
//  guardrail_valor_diverge_cobranca_pendente, Pix, cobranca, tabela, aprendizado, lock e cortesia
//  intactos. Rollback: version 118.
//
// v4.21.5 (06/08/2026) — REENVIO DO CODIGO DA COBRANCA PENDENTE (item 6, aplicado sobre A2):
//  Quando NAO nasce Pix no turno mas existe cobranca pendente com qr_code, o codigo enviado
//  passa a vir de mp_pix_cobrancas.qr_code (lerExecucoes agora seleciona qr_code). Corrige a
//  regressao da v4.21.2, que removia a linha do codigo escrita pelo modelo e mandava mensagem
//  vazia (medido 06/08 as 18:02 e 18:06 no lead 5511948430629, log codigo_pix_sem_cobranca).
//  Invariante 3 mantida: a fonte do codigo e sempre o banco, nunca a transcricao do modelo.
//  Aplicado por ancora sobre a v4.21.4 (LIVE version 117) — preserva jaDespediuHoje (A) e
//  cortesia (A2). Rollback: version 117.
//
// v4.21.4 (06/08/2026) — ETAPA A2 DO PLANO ANTI-SILENCIO (plano auditado pelo ChatGPT em 06/08):
//  Os dois returns de cortesia (pos_despedida e pos_cobranca) deixavam o turno morrer em
//  silencio MUDO — efeito lateral da regex, nao decisao. Regra estrutural do plano: nenhum
//  return de cortesia encerra turno elegivel sem outbound seguro ou saida deliberadamente
//  registrada. Implementacao DETERMINISTICA, zero chamada ao modelo:
//  1a cortesia -> resposta segura sem numero novo (com Pix pendente: confirma a reserva;
//  pos-despedida: despede de volta no idioma do lead). Cortesias seguintes -> silencio
//  DELIBERADO, registrado em agente_decisoes_log e carimbado como cortesia_encerrada.
//  Autolimitado por construcao: a propria resposta segura contem as frases-ancora de
//  RX_ACK_CORTESIA, entao a segunda cortesia do cliente ja cai no silencio deliberado —
//  sem ping-pongue de "boa noite" com cliente educado.
//  NADA MAIS MUDA: retries, guardrails de preco, autorizacoes e Pix ficam intocados.
//  Proximas etapas ja auditadas e AINDA NAO aplicadas: B+C (retry de preco), D (tabela
//  ativa), E (envelope tipado).
// v4.21.3 (06/08/2026) — ETAPA A DO PLANO ANTI-SILENCIO (plano auditado pelo ChatGPT em 06/08):
//  MUDANCA UNICA: jaDespediuHoje deixa de casar "boa noite" em qualquer posicao do outbound.
//  O Joao ABRE a primeira mensagem da noite com "Boa noite!" (saudacao obrigatoria do bloco
//  [AGORA]) — entao toda conversa noturna nascia com jaDespediuHoje=true e o return
//  cortesia_pos_despedida virava silencio. MEDIDO: com "boa noite" previo, 58% dos eventos de
//  guardrail viravam silencio, contra 12% sem.
//  Regra nova: despedida so conta com "boa noite" no FIM da mensagem, ou "bom descanso" em
//  qualquer posicao. Matriz de 10 frases testada antes do deploy: 10/10.
//  NADA MAIS MUDA: REGEX_CORTESIA, retries, autorizacoes e Pix ficam intocados.
//  Proximas etapas ja auditadas e AINDA NAO aplicadas: A2 (returns cortesia_*), B+C (retry de
//  preco), D (tabela ativa), E (envelope tipado).
// v4.21.2 (03/08/2026) — INVARIANTES FINANCEIRAS DETERMINISTICAS
//  A v4.21.1 (version 113) foi PUBLICADA e REPROVADA na auditoria. Ela anunciava no
//  cabecalho tres correcoes e implementava apenas parte: 'preco_de_ficha' existia so no
//  comentario, a escolha de autorizacao caia em `|| lista[0]` (frete sozinho), e a guarda
//  exigia !toolsUsadas.includes('gerar_pix') — justamente o caso que a motivou.
//  LICAO DE PROCESSO: este cabecalho foi escrito DEPOIS do codigo, descrevendo o que esta
//  implementado. Foi a ordem inversa que produziu a mentira da versao anterior.
//
//  O que esta implementado aqui, verificavel linha a linha:
//
//  1. PRECO DE FICHA VIRA AUTORIZACAO TIPADA, com o banco confirmando a NATUREZA do valor.
//     Tres condicoes cumulativas: um unico valor na mensagem, valor pertencente a
//     PRECOS_FICHA_FECHADOS (folha A4/A3, copo avulso, pack — a tabela por METRO fica fora,
//     porque la o numero e unitario), e inexistencia de autorizacao de produto ativa.
//     Valor unico sozinho NAO basta: nao prova que aquele valor e o produto.
//
//  2. FRETE JAMAIS ELEGIVEL SOZINHO. O fallback `|| lista[0]` saiu. Sem total e sem produto
//     nao existe autorizacao elegivel, e o caminho correto e calcular o produto.
//
//  3. SUCESSO DE PIX VEM DO RETORNO DA FERRAMENTA. gerar_pix grava ctx.pixGerado com ok,
//     qr_code e payment_id. A guarda pergunta "o Pix existe?" em vez de "a tool foi chamada?",
//     o retry so e aceito com cobranca confirmada, e o CODIGO ENVIADO sai do retorno —
//     nunca da transcricao do modelo.
//
//  4. FALHA DE FERRAMENTA NAO E SUCESSO. Chamar gerar_pix e receber recusa deixa
//     ctx.pixGerado null, e a guarda de recuperacao continua valendo.
//
//  5. SEGUNDO ENVIO CONFIRMADO. O retorno do envio do codigo e conferido; se falhar, o
//     codigo NAO e gravado como enviado e o inbound NAO e carimbado — a fila fica pendente
//     e o sweep tenta de novo.
//
//  FORA DE ESCOPO, ainda abertos e conhecidos: o lock ainda falha ABERTO e libera por
//  telefone sem token (as RPCs fn_joao_adquirir_lock_v2 / fn_joao_liberar_lock_v2 ja existem
//  no banco, testadas 7/7, e NAO sao usadas aqui — a troca exige corte controlado porque a
//  v113 apaga lock por telefone). O fallback de DTF textil foi alinhado ao banco na v4.22.7:
//  41-50 = R$39,90 e 51+ = R$35,90.
// Rollback: version 112 (mas atencao: a v112 tem o mesmo furo do frete e nao tem o
// bloqueio de operation_id inventado).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const ERP_SERVICE_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const ZAPI_INSTANCE_ID = Deno.env.get('ZAPI_INSTANCE_ID') ?? '';
const ZAPI_TOKEN = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT_TOKEN = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
// v4.24.0 (14/08/2026) — PATCH A: guarda de preco sensivel a produto + fim do bypass.
// fn_valor_e_legitimo passa a receber o produto em contexto. Cruzamento de produto
// (ex: R$99 do UV numa conversa de DTF Textil) derruba e refaz. Valor sem fonte
// PERMITE e registra. Produto indeterminado PERMITE e registra. Falha tecnica da
// guarda nunca engole a resposta. Rollback: redeploy version 150.
// v4.25.0 (15/08/2026) — PATCH 2: voz do Joao como camada de apresentacao.
// O Joao segue produzindo UM texto canonico; entregarComoJoao decide texto ou
// audio ANTES do transporte e executa exatamente um envio. Cortesia passa a ter
// linha em joao_envios (antes enviava fora do ledger). Kill switch joao_tts_ativo
// continua FALSE: com ele desligado o comportamento e identico ao da v4.24.0.
// Rollback: redeploy version 151.
// v4.28.0 (16/08/2026) — P14: observabilidade de slots + guarda de ferramenta em SHADOW.
// Duas camadas puramente observacionais. Nenhuma bloqueia execucao, altera slots ou muda
// resposta. Modalidade e conceito NOVO, separado de slots.produto. enforcement_ativo=false.
// Rollback: redeploy do v164 (Edge version 163).
// v4.29.0 (16/08/2026) — P15: sinais de frete/CEP por turno, observacional.
// Estende a CAMADA 1 (que grava mesmo com tools:[]) para separar organicamente:
// saudavel | oportunidade_perdida | risco_inventado | contexto_ignorado.
// Nao chama ferramenta, nao altera slots, nao bloqueia, nao muda debounce.
// Rollback: redeploy do v4.28.0 (SHA 98e7b6f5...d81c7c0).
// v4.30.0 (16/08/2026) — A GUARDA DE PRECO SO BLOQUEIA COM VALOR EFETIVAMENTE JULGADO.
// Defeito residual provado no v4.29.0, fora do mapa A/A2/B+C: o else terminal da guarda
// nao foi atualizado pelo Patch A e bloqueava tambem quando naMsg vinha VAZIO. Isso ocorre
// porque temPreco usa /R\$\s?\d/ enquanto RX_MOEDA exige centavos (,\d{2}) — uma resposta
// dizendo "R$ 99" acende temPreco, nao produz nenhum valor extraido e caia em
// decisao.responde=false com nao_conferidos:[]. A guarda derrubava a resposta tendo
// reprovado preco NENHUM, e o turno seguia para retry/terminal e podia virar silencio.
// CONTRATO VIGENTE (Patch A, vivo desde 15/08 01:08 UTC) — preservado sem alteracao:
//   preco_de_outro_produto -> BLOQUEIA (continua bloqueando, no mesmo ponto de sempre)
//   valor_sem_fonte        -> PERMITE + registra
//   falha tecnica          -> PERMITE + registra (fail-open)
// MUDANCA: o ramo naMsg vazio deixa de bloquear e passa a registrar
// guarda_preco_sem_valor_extraido. O ramo cruzados>0 fica com comportamento e log
// IDENTICOS (ja bloqueado acima; guardrail_preco_sem_tool preservado byte a byte).
// Nao altera fn_valor_e_legitimo, nao amplia regex monetario, nao toca A/A2, produtoSlot,
// P14/P15, TTS, debounce, flags ou crons. Rollback: redeploy do v4.29.0 (SHA dc6f3071...53a3fa).
// v4.31.0 (22/08/2026) — CORRELACAO INBOUND<->OUTBOUND EM RAJADA (P0).
// Uma resposta de um turno antigo podia dar por atendida uma mensagem nova do cliente.
// Caso 5513974079782 em 21/08: A 16:06:57 entrou em processamento, B 16:07:20 chegou
// com A em voo, a decisao saiu 16:07:24 e B terminou atendido_joao sem resposta propria;
// as 16:40 o cliente perguntou "E aqui?". Em 14 dias: 33 pares candidatos, 28 clientes.
// Causa: causalidade inferida por relogio — outbound.created_at > inbound.created_at era
// lido como "esse outbound respondeu esse inbound". Nao e, e nunca foi.
// Tres mudancas: (1) o lote passa a carregar owned_inbound_ids reais; (2) a heuristica
// temporal ja_respondida sai; (3) barreira final de frescor imediatamente antes do
// transporte suprime a resposta velha SEM carimbar nada, deixando o joao-sweep-2min
// recolher o lote inteiro. Zero alteracao em preco, Pix, frete, catalogo, TTS ou prompt.
// Rollback: redeploy do v4.30.0 (Edge 172, index.ts sha256 6c3c90bf...b024764).
//
// v4.33.0 (25/08/2026) P0 — IDENTIFICADOR FINANCEIRO INTERNO VAZANDO COMO PIX.
// Rollback: redeploy do v4.32.0 (Edge 174, index.ts sha256 ff71708ee81856cd36d7e2793391
// b678b6e52dbc6ff609b8a576558c61c47db4). Nao ha migracao nem estado novo: reverter a Edge
// restaura o comportamento anterior por completo.
//
// v4.34.0 (26/08/2026) P0 — MODALIDADE LOGISTICA E RESOLVIDA ANTES DO CEP.
// Rollback: redeploy do v4.33.0 (Edge 176, index.ts sha256 a9a4aaf143a1188b0308ec459cda
// 69d6d4479ead95704ddf61664db3401b91b4). Nao ha migracao nem tabela nova: o unico estado
// novo e a chave slots.modalidade_logistica dentro do jsonb ja existente de
// agente_noturno_estado, e ela e ignorada por qualquer versao anterior.
//
// CASO ORGANICO 5511952315439 (Carolina, 26/08/2026, cliente recorrente, 10 compras):
//   21:05:33 ela escreveu "A quantidade e 14 / Forma de retirada : retirada presencial"
//   21:08:08 o Joao respondeu "Preciso do seu CEP para gerar a cobranca correta, mesmo
//            sendo retirada."
//   21:08:24 ela passou 05893-000
//   21:08:38 o Joao chamou calcular_frete e ofereceu "Sedex R$11,93 ou PAC R$18,54"
//   21:09:11 ela repetiu "Vamos retirar"
//   21:09:27 o Joao voltou a perguntar "quantidade, medida, CEP ou forma de retirada?"
//   21:09:53 ela encerrou o assunto com "Ja passei essas informacoes".
//
// CAUSA ESTRUTURAL, nao desatencao do modelo. Tres pecas empurravam na mesma direcao:
//   (a) SLOTS tratava "envio/retirada + CEP" como UM slot unico;
//   (b) FECHAMENTO dizia "CEP -> calcular_frete -> TOTAL", fazendo do CEP requisito
//       quase obrigatorio da cobranca;
//   (c) blocoLocalizacao mandava "ASSUMA ENVIO: peca o CEP completo" para todo DDD != 11.
// CEP e CONSEQUENCIA DE ENVIO. Nunca slot universal do fechamento.
//
// O QUE ESTA IMPLEMENTADO AQUI, verificavel linha a linha:
//  1. ESTADO CANONICO POR TURNO: modalidade_logistica em {retirada, motoboy, envio,
//     desconhecida}, resolvido por PRECEDENCIA DE FONTES — (1) declaracao explicita mais
//     recente do cliente no turno, (2) declaracao recente na conversa do pedido / estado ja
//     confirmado, (3) historico confiavel do proprio cliente, (4) localizacao por DDD como
//     PISTA, (5) desconhecida. Fonte 4 NUNCA vira fato.
//  2. GUARDA DETERMINISTICA DE FERRAMENTA: com retirada/motoboy (ou produto digital, ou
//     modalidade indefinida onde retirada e plausivel), calcular_frete e INTERCEPTADA ANTES
//     DA EXECUCAO — mesmo padrao ja usado pelo redirecionamento de calcular_dtf_metro. Nao
//     e shadow: executada=false, enforcement_ativo=true.
//  3. VALIDACAO DE SAIDA: pedido de CEP e oferta de PAC/Sedex sao rejeitados na RESPOSTA
//     quando a modalidade nao admite frete. O retry so e aceito se nao apagar valor ja
//     calculado; sem retry valido, a frase ofensora e removida cirurgicamente (mesma
//     invariante de subconjunto da v4.21.6).
//  4. FALLBACK TERMINAL DEIXA DE SER LISTA FIXA: "quantidade, medida, CEP ou forma de
//     retirada?" era literal e reaparecia mesmo com tudo respondido. Agora so pergunta o
//     que de fato falta, e nunca cita CEP fora de envio.
//  5. ROTEIRO CORRIGIDO: produto -> arte -> quantidade -> MODALIDADE -> [envio: CEP ->
//     frete] -> orcamento -> pagamento. Gerar cobranca NAO exige CEP.
// NADA de preco, Pix, cartao, compor_total, operation_id, CalcMe, arquivos, TTS, debounce,
// LOST, correlacao inbound/outbound ou egresso financeiro foi alterado.
//
// v4.35.0 (26/08/2026) P0 — FLUXO DE CEP CANONICO: CONFIRMAR, REUTILIZAR, PERSISTIR COM GUARDA.
// Rollback: redeploy do v4.34.0 (Edge 177, index.ts sha256 c8fd20f16f32c7bd851a6cddb88cfbf6
// 8d2386cac2285782a1654935b117ba70). Sem migracao: o estado novo sao chaves dentro do jsonb
// ja existente de agente_noturno_estado.
//
// A v4.34.0 resolveu MODALIDADE ANTES DE CEP e isso continua valendo sem um caractere de
// diferenca: a modalidade e resolvida primeiro, e todo este fluxo de CEP so existe DEPOIS,
// e SOMENTE quando a modalidade admite frete. Sob retirada/motoboy/produto digital o cadastro
// nem chega a ser lido.
//
// O QUE FALTAVA: o Joao pedia CEP a quem ja tinha CEP no cadastro, e nao tinha nenhum contrato
// para (a) confirmar antes de reutilizar, (b) distinguir "CEP so deste pedido" de "novo CEP
// padrao", (c) persistir sem estragar cadastro.
//
// FONTES DO CEP, EM ORDEM (so vale para ENVIO):
//   1 CEP informado explicitamente no pedido atual (turno + inbounds do pedido)
//   2 CEP ja confirmado no estado do pedido atual
//   3 pessoas.cep — cadastro canonico, que vive no ERP, NAO neste projeto
//   4 CEP confiavel de historico / frete ja calculado
//   5 nenhum -> pedir UMA vez
// CEP EXISTIR NAO DEFINE MODALIDADE. A modalidade vem antes, sempre.
//
// ONDE O CADASTRO CANONICO REALMENTE VIVE — MEDIDO, NAO PRESUMIDO:
//   public.pessoas DESTE projeto tem 1.754 linhas e ZERO com cep. Nao e o cadastro.
//   public.pessoas do ERP (ynjsflvdfftcopibzxyo) tem 144 linhas, 136 com cep. E o cadastro.
//   Casamento por telefone: 137 sufixos de 8 digitos, 137 distintos — ZERO ambiguidade hoje.
//   Cobertura real: dos 1.525 telefones que o Joao atendeu em 90 dias, 64 (4,2%) tem pessoa
//   no ERP. O caminho de confirmacao serve o cliente RECORRENTE, que e onde ele importa.
//
// RISCO DE SOBRESCRITA — POR QUE A ESCRITA E GUARDADA:
//   pessoas.cep e campo FISCAL: fn_montar_payload_spedy_nfe monta o destinatario da NF-e a
//   partir de pessoas (cep, logradouro, numero, bairro, cidade, estado, municipio_ibge).
//   Trocar SO o cep deixa logradouro/numero/bairro/cidade apontando para o endereco ANTIGO —
//   um endereco que parece completo e esta errado. Medido: das 144 pessoas, 136 tem cep COM
//   logradouro/cidade e apenas 8 estao sem cep.
//   Por isso a persistencia e ESCALONADA:
//     - pessoa sem cep, ou com cep e sem endereco  -> grava (preenche lacuna, risco zero);
//     - pessoa com cep E endereco                  -> NAO grava. Registra o motivo, marca a
//       divergencia e abre tarefa humana para atualizar o endereco COMPLETO no ERP.
//   PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO liga a sobrescrita literal, e vem FALSE de proposito:
//   ligar significa aceitar emitir NF-e com endereco incoerente.
//
// GARANTIAS DE ESCRITA (todas cumulativas, fail-closed em qualquer uma):
//   1 exatamente UMA pessoa ativa casa com o telefone (0 ou >=2 nao grava);
//   2 CEP com 8 digitos validos;
//   3 o cliente declarou EXPLICITAMENTE que e o novo padrao;
//   4 a guarda de coerencia de endereco acima permite.
//   Nunca cria pessoa. Nunca escreve outro campo alem de cep. Nunca grava sob retirada/motoboy.
//
// v4.36.0 (27/08/2026) P0 — "ENVIAR" COM O CLIENTE COMO REMETENTE NAO E MODALIDADE.
// Rollback: redeploy do v4.35.0 (Edge 178, index.ts sha256 33a4ec1287c97f20bd60b9565029f1a
// 7152b4e1a4180a273a249052a487b7311). Sem migracao, sem estado novo.
//
// DEFEITO ENCONTRADO PELO CANARIO ORGANICO DA PROPRIA v4.35.0 — e a telemetria nova foi o
// que o tornou visivel. Lead 5511994088967 (Vitor, DDD 11, Grande SP) escreveu as 12:04:
//     "posso enviar 300 agora ? e o restante daqui a 5 dias?"
// Isso e o cliente falando de DINHEIRO: pagar 300 agora e o resto em 5 dias. RX_LOG_ENVIO
// casou o verbo "enviar" e declarou modalidade_logistica=envio no nivel 2. Com isso o
// bloqueio de Grande SP da v4.34.0 caiu, e as 23:54 o Joao escreveu:
//     "Pagamento confirmado. Qual e o seu CEP para a gente calcular o frete dos 300 adesivos?"
// — pediu CEP a um cliente da Grande SP sem nunca ter perguntado retirada ou envio. E a MESMA
// familia de defeito do caso Carolina, entrando por outra porta.
//
// A CAUSA NASCEU NA v4.34.0, nao na v4.35.0: RX_LOG_ENVIO ja era assim. Rollback NAO corrige.
//
// CORRECAO: o verbo sozinho deixa de decidir.
//   SINAL FORTE (correios, sedex, pac, transportadora, frete, postagem) -> envio, sempre.
//   VERBO de envio -> envio SO SE o cliente nao for o remetente e o objeto nao for dinheiro,
//   arquivo, arte ou comprovante. "Pode enviar?" e "voces enviam?" continuam valendo;
//   "posso enviar 300", "vou enviar o arquivo", "ja mandei o comprovante" nao valem mais.
// Nada mais muda: modalidade continua vindo antes do CEP, o fluxo de CEP canonico da v4.35.0
// fica intacto, e nenhuma regra financeira e tocada.
//
// v4.37.0 (27/08/2026) P0 — SLOT CRITICO SO VIRA FATO COM PROVENIENCIA.
// Rollback: redeploy do v4.36.0 (Edge 179, index.ts sha256 132df0ca90d39dfd83bf8116f432
// babaef09b2dbe9134e8a336fa0d8c132be68). Sem migracao, sem estado novo, sem coluna nova.
//
// DEFEITO — o MESMO lead 5511994088967 (Vitor), o MESMO turno de 26/08 23:54, mas uma
// SEGUNDA porta, que a v4.36.0 nao fechou. A v4.36.0 corrigiu a modalidade logistica
// (o verbo "enviar" com o cliente como remetente). Nao tocou no que persistiu o resto:
//
//   agente_noturno_estado.slots  ANTES {}  ->  DEPOIS {
//     "produto": "adesivo_uv", "quantidade": 300, "arte": "pack_evangelicos", ... }
//
// O cliente negociava CAMISETAS desde julho (orcamentos 8630 e 9931, "DTF Textil",
// grade M4/G7/GG3/G3-1/Infantil-1). NUNCA escreveu a palavra "adesivo". O unico "300"
// que ele digitou foi "posso enviar 300 agora ? e o restante daqui a 5 dias?" — DINHEIRO.
// Nenhuma tool rodou nesse turno (tools=[]). O modelo devolveu esses slots e eles viraram
// estado porque o merge era um spread cego:
//
//     const slotsNovos = { ...slotsAnteriores, ...slotsRecebidos };
//
// Ou seja: a saida probabilistica do modelo virava FATO COMERCIAL sem provar de onde veio.
// O token "adesivo_uv" nem sequer e vocabulario de produto: ele so existe no prompt como
// valor do enum "tema". Vazou de tema para slots.produto e ninguem conferiu.
//
// CORRECAO — contrato estrutural, nao regra para "300" nem para "adesivo".
//   Todo slot CRITICO que NASCE ou MUDA num turno precisa de fonte verificavel:
//   a fala do cliente, uma ferramenta, a fonte canonica, ou o estado anterior.
//   Sem fonte, a proposta e DESCARTADA e o que ja era fato permanece.
//   modalidade_logistica/envio_retirada saem das maos do modelo de vez: quem escreve e
//   o resolvedor deterministico (estadoLog), porque resolverModalidadeLogistica le esse
//   slot do estado SALVO — um palpite do modelo viraria "fonte" no turno seguinte.
// Nada financeiro e tocado: Pix, CalcMe, autorizacoes, TTS, debounce, LOST e handoff
// seguem byte-identicos. A correcao logistica da v4.36.0 fica intacta e e REUSADA aqui.
//
// ESCOPO DESTA PUBLICACAO (FASE 1): SO a porta de ESCRITA. O modelo continua podendo
// FALAR fato errado no texto — isso e ESPERADO aqui e e tratado na frente seguinte
// (guarda de saida, v4.38.0). O que esta publicacao garante e que o texto errado NAO
// contamina agente_noturno_estado.
const V = 'agente-noturno-v4.37.3';
const MODEL = 'claude-haiku-4-5-20251001';
const ASSINATURA = '*Jo\u00e3o Barros:*\n';
const ASSINATURA_JULIA = '*Julia Bitencourt:*\n';
const SITE_LOJA = 'https://skillprintestamparia.com.br';
const INSTA = 'instagram.com/skillprintestamparia';
// v4.33.0 P0: CHAVE PIX MANUAL DESATIVADA POR FALTA DE PROVENIENCIA.
// O proprietario informou que este CNPJ NAO e a chave Pix operacional (a correta e uma
// chave aleatoria). Procurada fonte canonica em sistema_config, atendimento_config,
// julia_config, skillprint_base_conhecimento e vault.secrets: NAO EXISTE nenhuma.
// Sem prova, nao se inventa chave e nao se reaproveita UUID interno: o fallback manual
// sai de circulacao e a falha de cobranca passa a ser FECHADA. A constante permanece
// apenas para RECONHECER e BLOQUEAR o numero, nunca mais para emiti-lo.
const PIX_CHAVE_DESATIVADA = '30248650000111';
const PIX_CHAVE = PIX_CHAVE_DESATIVADA;
const PIX_DESCRICAO = 'chave CNPJ: 30248650000111 (Bradesco, Alessandro Luciano Alves)';
const BANCO_DADOS = 'Bradesco, Ag\u00eancia 2405, Conta 61795-4, em nome de Alessandro Luciano Alves';
const DEBOUNCE_MS = 8000;
const SWEEP_MAX_CLIENTES = 6;
const ESTADO_VALIDO_MS = 48 * 3600000;
const ANUNCIO_RECENTE_MS = 24 * 3600000;
const REGEX_AUTO_ATENDIMENTO = /(sistema n\u00e3o validou|sistema nao validou|transferindo (seu |o )?atendimento|nosso hor\u00e1rio de atendimento|nosso horario de atendimento|digite (o n\u00famero|o numero|uma op\u00e7\u00e3o|uma opcao)|agradecemos o seu contato|atendente virtual|mensagem autom\u00e1tica|mensagem automatica)/i;
const REGEX_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2700}-\u{27BF}]/gu;
const REGEX_FORMULARIO = /(preenchi (seu|o) formul|quero saber mais sobre o servi|gostaria de saber mais sobre)/i;
const REGEX_PEDIDO_HUMANO = /(?:\b(?:falar|conversar)\s+com\s+(?:um\s+|uma\s+)?(?:atendente|humano|pessoa|vendedor(?:a)?|equipe)\b|\b(?:atendimento|atendente)\s+human[oa]\b|\b(?:me\s+)?passa\s+(?:para|pra)\s+(?:um\s+|uma\s+)?(?:atendente|humano|pessoa|vendedor(?:a)?|algu[eé]m)\b|\bn[aã]o\s+quero\s+falar\s+com\s+(?:rob[oô]|bot)(?=\s|$|[.!?,])|\bquero\s+(?:um\s+|uma\s+)?(?:atendente|humano|pessoa)\b)/i;
const REGEX_DESISTENCIA_EXPLICITA = /\b(?:cancelar|cancela|cancelamento|desistir|desisti|desisto|n[aã]o\s+quero\s+mais|pode\s+cancelar|deixa\s+pra\s+l[aá])\b/i;
function ehDesistenciaInequivoca(texto: string): boolean {
  const m = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!m || /(nao desisti|nao desisto|nao quero cancelar|sem cancelar)/.test(m)) return false;
  if (/(^|\s)(se|caso)\s.*(cancel|desist)|vou desistir|vou cancelar|pensando em (cancelar|desistir)/.test(m)) return false;
  if (/(numero|n[ºo.]|item|arte|arquivo|imagem|estampa|cor|tamanho|frete|link).{0,30}(cancel|desist)|(cancel|desist).{0,30}(numero|n[ºo.]|item|arte|arquivo|imagem|estampa|cor|tamanho|frete|link)/.test(m)) return false;
  return /(^|[.!?]\s*)(desisto|desisti|quero desistir|nao quero mais)([.!?]|$)/.test(m)
    || /(^|[.!?]\s*)(pode cancelar|cancela|cancelar)( (a|o|meu|minha) )?(solicitacao|orcamento|pedido|compra)?([.!?]|$)/.test(m);
}
const REGEX_PEDIDO_INFO = /((quero|queria|gostaria de|pode me dar|me passa|preciso de)\s+(mais\s+)?informa|mais informa\u00e7\u00f5es|mais informacoes|(quero|queria|gostaria de) saber|como funciona|me explica|pode (me )?(falar|explicar)|qual (o |e o |\u00e9 o )?(pre\u00e7o|preco|valor)|quanto (custa|fica|sai)|\bq\s+valor|\bqual\s+valor|\bqto\b|\bquanto\b|\bpre[c\u00e7]o\b|\bvalor(es)?\b|\bcidade\b|endere[c\u00e7]o|localiza|onde (fica|voc[e\u00ea]s|\u00e9)|de onde)/i;
const REGEX_PEDIU_PRECO = /(\bvalor(es)?\b|\bpre[c\u00e7]o?s?\b|quanto (custa|fica|sai|\u00e9|e)|\bqto\b|tabela|or[c\u00e7]amento|quanto voc[e\u00ea]s cobram)/i;
const REGEX_PEDIU_MUDANCA = /(mudar|muda|trocar|troca|alterar|altera|acrescentar|acrescenta|adicionar|adiciona|incluir|inclui|tirar|tira|remover|remove|diminuir|diminui|aumentar|aumenta|mais \d+|menos \d+|outro (tamanho|frete|valor|endere[c\u00e7]o)|na verdade|me enganei|errado|corrig|refazer|refaz|novo (pix|valor|or[c\u00e7]amento)|outro pix|pedido novo|fazer (um )?pedido novo|mudei|mudou|s[o\u00f3] \\d+ c[o\u00f3]pias?|cancela)/i;
// v4.20: cliente achando caro / comparando com concorrente
const REGEX_OBJECAO_PRECO = /(caro|salgado|mais em conta|mais barato|outros? lugar|outro fornecedor|concorr|pesquisando|olhando em outro|achei muito|t[a\u00e1] alto|desconto|melhor pre[c\u00e7]o)/i;
const REGEX_INVENCAO = /(serigrafia a gente faz|fazemos serigrafia|fazemos silk|silk a gente faz|fazemos silkscreen|fazemos sublima|sublima\u00e7\u00e3o a gente faz|fazemos bordado|bordado a gente faz|n[a\u00e3]o (temos|trabalhamos com) estampas? pronta)/i;
const REGEX_NEGA_VISAO = /(n[a\u00e3]o (consigo|consegui|posso|pude) (visualizar|ver|abrir|acessar)|n[a\u00e3]o (visualizo|vejo) (a |o )?(imagem|foto|arquivo|anexo)|imagem n[a\u00e3]o (carregou|abriu|chegou))/i;
const REGEX_CORTESIA = /^(ok(ay)?|blz|beleza|obrigad[oa]|valeu|vlw|boa noite|bom descanso|amem|amen|tmj|de nada|disponha|at\u00e9 mais|ate mais|tchau|gracias)[!,. ]*$/i;
const RX_CONFIRMACAO_CURTA = /^(t[a\u00e1] bom|t[a\u00e1] certo|certo|combinado|fechado|ok(?:ay)?|beleza|blz)[!,. ]*$/i;
const RX_ENCERRAMENTO_JOAO = /(fico no aguardo|aguardo (?:do )?comprovante|qualquer coisa (?:e|\u00e9) s[o\u00f3] chamar|pedido est[a\u00e1] reservado|pix .{0,30}continua valendo|at[e\u00e9] amanh[a\u00e3]|bom descanso)/i;
// v4.21.3 ETAPA A: despedida so no FIM da mensagem. "Boa noite" de ABERTURA nao e despedida.
const RX_DESPEDIDA_FIM = /boa noite[\s!,.]*$/i;
// v4.21.4 ETAPA A2: frases-ancora das respostas seguras de cortesia. Se um outbound recente
// ja contem uma delas, a proxima cortesia vira silencio deliberado (nao repete o ack).
const RX_ACK_CORTESIA = /(qualquer coisa é só chamar por aqui|pedido está reservado|continua valendo|cualquier cosa me escribes)/i;
const RX_PROD_UV = /\b(dtf ?uv|adesivo|etiqueta|r[o\u00f3]tulo|copo|caneca|garrafa|vidro|metal|madeira|mdf|acr[i\u00ed]lico)\b/i;
const RX_PROD_TEXTIL = /\b(dtf ?t[e\u00ea]xtil|dtf|pel[i\u00ed]cula|filme|tecido|malha|prensa)\b/i;
const RX_PROD_CAMISETA = /\b(camiseta|moletom|baby ?look|regata|polo|uniforme|oversized)\b/i;
// v105: os NOMES DOS TEMAS eram invisiveis. O cliente recebia a lista de packs, respondia
// "Streetwear", e o detector nao reconhecia: virava palavra solta e o agente voltava ao produto
// anterior. Caso Os Incansaveis 01/08 19:03 — escolheu o pack e recebeu pergunta sobre
// impressao de camiseta. MEDIDO em 30 dias: 12 clientes escolheram tema, 10 nao fecharam.
const RX_PROD_PACK = /\b(pack|packs|cat[a\u00e1]logo de estampas|comprar estampas?|quero estampas? prontas?|procuro artes? prontas?|anime|animes|streetwear|street ?wear|nba|rock|futebol|hip ?hop|cat[o\u00f3]lic[oa]s?|caveiras?)\b/i;
// FIX 2 (v87): "ja tenho a arte pronta" e POSSE da arte, nao interesse em comprar pack.
const RX_ARTE_PROPRIA_PRONTA = /\b(j[a\u00e1]\s+tenho|eu\s+tenho|tenho|minha|meu|minhas|meus|j[a\u00e1]\s+possuo)\b.{0,30}\b(arte|artes|estampa|estampas)\s+pront[ao]s?\b/i;
const RX_PROD_COPO = /\b(copo|caneca|garrafa|cuia|t[e\u00e9]rmic|vaso)\b/i;
// v4.20: cliente que JA TEM a peca quer o ADESIVO, nao o produto
const RX_PECA_PROPRIA = /\b(meu|minha|meus|minhas|que eu tenho|que tenho|pr[o\u00f3]prio|pr[o\u00f3]pria|j[a\u00e1] tenho|de vidro|colar? (no|na|em))\b/i;
// v106: PRECOS DE TABELA FIXA QUE O PROMPT JA ENTREGA AO AGENTE.
// O guardrail 'preco_sem_tool' exigia chamada de ferramenta para QUALQUER valor em R$. Mas a
// FICHA TECNICA do system prompt entrega precos fixos ao agente ("A4 R$29,90, A3 R$39,90",
// "copo R$35,90 abaixo de 10 e R$29,90 a partir de 10", "packs a partir de R$6,90", a tabela
// de DTF textil). O agente obedecia o prompt, falava o valor CERTO, e era derrubado por isso.
// MEDIDO em 14 dias: 59 bloqueios, e 31 deles eram o preco EXATO da tabela oficial.
// Caso 02/08 09:23 (14 99122-2117): cliente pediu folha A4, o modelo respondeu
// "Folha A4 sai por R$29,90" — correto — e o cliente recebeu frase de espera.
// Estes valores sao FATO FIXO, nao calculo. Qualquer outro valor continua exigindo ferramenta.
// v4.21.1: precos confirmados pelo Alessandro em 03/08/2026.
const PRECOS_DE_FICHA = new Set<number>([
  2990, 3990,              // folha A4 e folha A3 de DTF UV
  3590,                    // copo termico avulso
  690, 990, 1990,          // packs de estampas
  5990, 5490, 4990, 4490, 3990, // tabela de DTF textil por faixa
]);
// v4.21.2: subconjunto da ficha que e preco FECHADO DE UNIDADE — o unico que pode virar
// autorizacao de produto sozinho. A tabela por METRO fica de fora de proposito: la o numero
// e preco unitario e o total depende da metragem, entao emitir autorizacao com ele cobraria
// 1 metro num pedido de 10.
const PRECOS_FICHA_FECHADOS = new Set<number>([
  2990, 3990,        // folha A4 e folha A3 de DTF UV
  3590,              // copo termico avulso
  690, 990, 1990,    // packs de estampas
]);
const ABERTURAS = ['Combinado!', 'Perfeito!', 'Maravilha!', 'Show!'];

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const L = (s: string, d: any = {}) => console.log(JSON.stringify({ v: V, s, ...d }));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function agoraSP(): Date { return new Date(Date.now() - 3 * 3600000); }
function periodoDia(): 'madrugada' | 'manha' | 'tarde' | 'noite' { const h = agoraSP().getUTCHours(); if (h < 5) return 'madrugada'; if (h < 12) return 'manha'; if (h < 18) return 'tarde'; return 'noite'; }
function despedidaPeriodo(idioma: string): string {
  const p = periodoDia();
  if (idioma === 'es') {
    const s = p === 'manha' ? '\u00a1Buenos d\u00edas!' : p === 'tarde' ? '\u00a1Buenas tardes!' : '\u00a1Buenas noches!';
    return `\u00a1Listo! Cualquier cosa me escribes por aqu\u00ed. ${s}`;
  }
  const s = p === 'manha' ? 'Bom dia' : p === 'tarde' ? 'Boa tarde' : 'Boa noite';
  const desc = (p === 'noite' || p === 'madrugada') ? ', bom descanso' : '';
  return `Combinado! Qualquer coisa \u00e9 s\u00f3 chamar por aqui. ${s}${desc}!`;
}
function ajustarSaudacao(m: string): string {
  const p = periodoDia();
  if (p === 'noite' || p === 'madrugada') return m;
  const s = p === 'manha' ? 'bom dia' : 'boa tarde';
  return m.replace(/boa noite/gi, s).replace(/,?\s*bom descanso/gi, '').replace(/\u00f3tima noite/gi, s);
}
function blocoRelogio(): string {
  const d = agoraSP();
  const dias = ['domingo', 'segunda-feira', 'ter\u00e7a-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 's\u00e1bado'];
  const rot = { madrugada: 'MADRUGADA', manha: 'MANH\u00c3', tarde: 'TARDE', noite: 'NOITE' }[periodoDia()];
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `\n\n[AGORA: ${dias[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}, ${hh}h${mm} (${rot}).]`;
}
async function adquirirLock(phone: string): Promise<boolean> {
  try { const { data, error } = await sb.rpc('fn_joao_adquirir_lock', { p_phone: phone }); if (error) return true; return data === true; } catch { return true; }
}
async function liberarLock(phone: string) { try { await sb.from('agente_noturno_lock').delete().eq('phone', phone); } catch {} }
function saudacaoPeriodo(): string { const p = periodoDia(); return p === 'manha' ? 'Bom dia' : p === 'tarde' ? 'Boa tarde' : 'Boa noite'; }
function saudacaoPeriodoEs(): string { const p = periodoDia(); return p === 'manha' ? '\u00a1Buenos d\u00edas!' : p === 'tarde' ? '\u00a1Buenas tardes!' : '\u00a1Buenas noches!'; }
function aberturaCorreta(m: string, primeiraDoDia: boolean, es: boolean = false): string {
  let t = String(m || '').replace(/^(opa|oi|ol\u00e1|hola)[,!.]?\s*(tudo bem[!?.]?\s*)?/i, '').trim();
  t = t.replace(/^\u00a1?(hola|buenos d\u00edas|buenas tardes|buenas noches)[!,.]?\s*/i, '').trim();
  t = t.replace(/^(bom dia|boa tarde|boa noite)[,!.]?\s*/i, '').trim();
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (primeiraDoDia && t.length > 0) t = (es ? saudacaoPeriodoEs() : saudacaoPeriodo() + '!') + ' ' + t;
  return t;
}
function checkoutMercadoPago(raw: unknown): string | null {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !(host === 'mercadopago.com.br' || host.endsWith('.mercadopago.com.br'))) return null;
    return u.toString();
  } catch { return null; }
}
function nomeCategoria(cat: string): string {
  const c = String(cat || '').toLowerCase();
  if (c.includes('textil') || c.includes('t\u00eaxtil')) return 'DTF t\u00eaxtil';
  if (c.includes('uv')) return 'DTF UV';
  if (c.includes('uniforme')) return 'uniformes';
  if (c.includes('terceirao')) return 'camisetas da turma';
  if (c.includes('evangel')) return 'camisetas para a igreja';
  if (c.includes('camiseta')) return 'camisetas personalizadas';
  if (c.includes('copo')) return 'copos personalizados';
  if (c.includes('pack')) return 'packs de estampas';
  return '';
}
function produtoNaMensagem(msg: string): string | null {
  const m = String(msg || '');
  const falaDeArtePropria = RX_ARTE_PROPRIA_PRONTA.test(m);
  if (!falaDeArtePropria && RX_PROD_PACK.test(m)) return 'pack';
  if (RX_PROD_CAMISETA.test(m)) return 'camiseta';
  // v4.20: copo + peca propria = quer ADESIVO, nao o copo
  if (RX_PROD_COPO.test(m) && (RX_PECA_PROPRIA.test(m) || /adesivo|dtf|uv|estampa/i.test(m))) return 'dtf_uv';
  if (RX_PROD_COPO.test(m)) return 'copo';
  if (RX_PROD_UV.test(m)) return 'dtf_uv';
  if (RX_PROD_TEXTIL.test(m)) return 'dtf_textil';
  return null;
}
function categoriaParaProduto(cat: string): string | null {
  const c = String(cat || '').toLowerCase();
  if (!c) return null;
  if (c.includes('pack') || c.includes('anime') || c.includes('estampa')) return 'pack';
  if (c.includes('uv')) return 'dtf_uv';
  if (c.includes('textil') || c.includes('t\u00eaxtil')) return 'dtf_textil';
  if (c.includes('camiseta') || c.includes('uniforme') || c.includes('terceirao') || c.includes('evangel')) return 'camiseta';
  if (c.includes('copo')) return 'copo';
  return null;
}
const NOME_PRODUTO: Record<string, string> = { pack: 'pack de estampas', camiseta: 'camiseta personalizada', copo: 'copo t\u00e9rmico', dtf_uv: 'DTF UV', dtf_textil: 'DTF t\u00eaxtil' };

async function sha256Texto(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function registrarManifestoJoao(d: {
  systemFinal: string; aprendizados: string; dinamicosChars: number; historico: any[];
  temImagem: boolean; temAudio: boolean; temObjecao: boolean; primeiroContato: boolean; phone: string;
  aprendizadosOk: boolean; manifestoAprendizados: any;
}) {
  try {
    const historicoTexto = JSON.stringify(d.historico || []);
    const row = {
      agent_version: V, modelo: MODEL, max_tokens_saida: 1100,
      chars_system: SYSTEM.length, chars_regras_extra: REGRAS_EXTRA.length,
      chars_aprendizados: Array.from(d.aprendizados).length, chars_dinamicos: d.dinamicosChars,
      chars_system_final: d.systemFinal.length, chars_historico: historicoTexto.length,
      quantidade_turnos_historico: (d.historico || []).length,
      tokens_estimados_system: Math.ceil(d.systemFinal.length / 4),
      tokens_estimados_historico: Math.ceil(historicoTexto.length / 4),
      tem_imagem: d.temImagem, tem_audio: d.temAudio, tem_objecao_regex: d.temObjecao,
      primeiro_contato: d.primeiroContato,
      hash_system_sha256: await sha256Texto(SYSTEM),
      hash_regras_extra_sha256: await sha256Texto(REGRAS_EXTRA),
      hash_system_final_sha256: await sha256Texto(d.systemFinal),
      phone_hash: await sha256Texto(d.phone),
      aprendizados_ok: d.aprendizadosOk,
      manifesto_aprendizados: d.manifestoAprendizados
    };
    const { error } = await sb.schema('auditoria').from('prompt_manifesto_joao').insert(row);
    if (error) await logErro('prompt_manifesto_joao_falhou', { erro: error.message });
  } catch (e: any) { await logErro('prompt_manifesto_joao_excecao', { erro: String(e?.message ?? e).slice(0,150) }); }
}
async function logTokens(d: any, contexto: string, leadId: string | null) {
  try {
    const u = d?.usage; if (!u) return;
    const inp = Number(u.input_tokens) || 0, out = Number(u.output_tokens) || 0;
    if (inp + out === 0) return;
    await sb.from('anthropic_token_usage').insert({ model: MODEL, context: contexto, lead_id: leadId, function_name: 'agente-noturno', input_tokens: inp, output_tokens: out });
  } catch {}
}

async function lerExecucoes(leadId: string | null, permitirMudanca: boolean = false): Promise<{ bloco: string; cobrancaPendente: any | null; freteJa: any | null; valores: number[] }> {
  const vazio = { bloco: '', cobrancaPendente: null, freteJa: null, valores: [] as number[] };
  if (!leadId) return vazio;
  try {
    const [cobR, orcR, autR] = await Promise.all([
      sb.from('mp_pix_cobrancas').select('payment_id, valor, status, created_at, qr_code, checkout_url').eq('lead_id', leadId).gte('created_at', new Date(Date.now() - 72 * 3600000).toISOString()).order('created_at', { ascending: false }).limit(5),
      sb.from('orcamentos').select('produto, valor_total, valor_frete, servico_frete, cep_destino, created_at').eq('lead_id', leadId).gte('created_at', new Date(Date.now() - 72 * 3600000).toISOString()).order('created_at', { ascending: false }).limit(5),
      // v4.21.1: as autorizacoes ATIVAS do lead. Ver bloco de autorizacoes mais abaixo.
      sb.from('operacoes_financeiras').select('id, kind, amount, source_tool, expires_at')
        .eq('lead_id', leadId).eq('status', 'ativa').gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(6),
    ]);
    const cobs = cobR.data || []; const orcs = orcR.data || []; const auts = autR.data || [];
    const valores: number[] = [];
    for (const c of cobs) { const n = Number(c.valor); if (!isNaN(n) && n > 0) valores.push(Math.round(n * 100) / 100); }
    for (const o of orcs) { const n = Number(o.valor_total); if (!isNaN(n) && n > 0) valores.push(Math.round(n * 100) / 100); const f = Number(o.valor_frete); if (!isNaN(f) && f > 0) valores.push(Math.round(f * 100) / 100); }
    const pagas = cobs.filter((c: any) => String(c.status) === 'approved' || String(c.status) === 'paid');
    const pendentes = cobs.filter((c: any) => String(c.status) === 'pending');
    const comFrete = orcs.find((o: any) => o.valor_frete !== null && o.valor_frete !== undefined);
    const linhas: string[] = [];
    if (pagas.length > 0) linhas.push(`PAGAMENTO J\u00c1 CONFIRMADO de R$${Number(pagas[0].valor).toFixed(2).replace('.', ',')}. N\u00c3O gere cobran\u00e7a nova nem pe\u00e7a pagamento.`);
    else if (pendentes.length > 0) {
      const c = pendentes[0];
      const quando = new Date(c.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      linhas.push(permitirMudanca
        ? `PIX PENDENTE, NAO PAGO: R$${Number(c.valor).toFixed(2).replace('.', ',')} enviado em ${quando}. O cliente pediu ALTERACAO. Nao trate como pago nem some o pedido antigo ao novo. Recalcule o pedido completo com a ferramenta correta. Se o total continuar igual por causa do minimo, explique o minimo, incentive manter a quantidade anterior e diga que este Pix continua valido. NAO gere outro Pix nesse caso.`
        : `COBRAN\u00c7A J\u00c1 ENVIADA: R$${Number(c.valor).toFixed(2).replace('.', ',')} em ${quando}. O cliente J\u00c1 TEM o Pix. N\u00c3O gere outro nem mude o valor.`);
    }
    if (comFrete) linhas.push(`Frete J\u00c1 CALCULADO para o CEP ${comFrete.cep_destino || 'informado'}: ${comFrete.servico_frete || ''} R$${Number(comFrete.valor_frete).toFixed(2).replace('.', ',')}. N\u00c3O recalcule.`);

    // ── v4.21.1: O AGENTE PASSA A VER OS operation_id DOS TURNOS ANTERIORES ──
    // MEDIDO em 14 dias: 10 falhas de gerar_pix, TODAS com operationId que nao e UUID.
    // Nenhuma foi autorizacao expirada: em 10 de 10 ele INVENTOU um identificador
    // descritivo — "dtf_uv_a4_sedex_josiene_14077380", "camisetas-13-482.86",
    // "OPERACAO_PENDENTE", "piloto-letra-logo". Casos: Erica 01/08 11:02,
    // Josiene 03/08 17:28, Gabriela 03/08 18:46.
    // A CAUSA E ESTRUTURAL, nao e desatencao do modelo: o operation_id chega em
    // financial_authorizations, que so existe no resultado da tool DAQUELE TURNO. O historico
    // e montado de fact_conversations, que guarda somente o TEXTO das mensagens. Entao no
    // turno seguinte o id evaporou — e o cliente sempre diz "pix" no turno SEGUINTE ao
    // calculo. Ele sabe o valor, porque esta escrito na conversa, e nao tem como saber o id.
    // A tabela ja guarda tudo; faltava mostrar. Sem isso, qualquer guarda so troca uma
    // falha silenciosa por outra.
    if (auts.length > 0) {
      const desc = auts.map((a: any) => {
        const rotulo = a.kind === 'frete' ? 'frete' : a.kind === 'total' ? 'TOTAL ja composto' : 'produto';
        return `${rotulo} R$${Number(a.amount).toFixed(2).replace('.', ',')} \u2192 operation_id: ${a.id}`;
      });
      const temTotal = auts.some((a: any) => a.kind === 'total');
      const temProduto = auts.some((a: any) => a.kind === 'produto');
      const temFrete = auts.some((a: any) => a.kind === 'frete');
      let comoUsar = '';
      if (temTotal) comoUsar = 'Para cobrar, chame gerar_pix com o operation_id do TOTAL ja composto.';
      else if (temProduto && temFrete) comoUsar = 'Para cobrar produto + frete, chame compor_total com os DOIS operation_id acima e depois gerar_pix com o id que ele devolver.';
      else comoUsar = 'Para cobrar, chame gerar_pix com o operation_id acima.';
      linhas.push(`AUTORIZA\u00c7\u00d5ES ATIVAS deste cliente:\n  - ${desc.join('\n  - ')}\n  ${comoUsar} Copie o operation_id EXATAMENTE como esta escrito. \u00c9 PROIBIDO inventar, encurtar ou montar um identificador a partir do produto, do valor ou do nome do cliente.`);
    }

    if (linhas.length === 0) return { ...vazio, valores };
    return { bloco: `\n\n[J\u00c1 EXECUTADO:\n- ${linhas.join('\n- ')}\nRetome do ponto em que parou.]`, cobrancaPendente: pendentes[0] || null, freteJa: comFrete || null, valores };
  } catch { return vazio; }
}

const DDD_UF: Record<string, string> = { '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP','21':'RJ','22':'RJ','24':'RJ','27':'ES','28':'ES','31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG','41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR','47':'SC','48':'SC','49':'SC','51':'RS','53':'RS','54':'RS','55':'RS','61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO','71':'BA','73':'BA','74':'BA','75':'BA','77':'BA','79':'SE','81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI','91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA' };
const UF_NOME: Record<string, string> = { SP:'S\u00e3o Paulo', RJ:'Rio de Janeiro', ES:'Esp\u00edrito Santo', MG:'Minas Gerais', PR:'Paran\u00e1', SC:'Santa Catarina', RS:'Rio Grande do Sul', DF:'Distrito Federal', GO:'Goi\u00e1s', TO:'Tocantins', MT:'Mato Grosso', MS:'Mato Grosso do Sul', AC:'Acre', RO:'Rond\u00f4nia', BA:'Bahia', SE:'Sergipe', PE:'Pernambuco', AL:'Alagoas', PB:'Para\u00edba', RN:'Rio Grande do Norte', CE:'Cear\u00e1', PI:'Piau\u00ed', PA:'Par\u00e1', AM:'Amazonas', RR:'Roraima', AP:'Amap\u00e1', MA:'Maranh\u00e3o' };
function blocoLocalizacao(phone: string): string {
  const ddd = phone.length >= 4 ? phone.slice(2, 4) : '';
  const uf = DDD_UF[ddd] || '';
  if (!uf) return '';
  if (ddd === '11') return '\n\n[LOCALIZA\u00c7\u00c3O: DDD 11 (Grande SP). Retirada presencial e possivel para este cliente.]';
  // v4.34.0 P0: o texto anterior era "ASSUMA ENVIO: peca o CEP completo, 8 digitos". Ele
  // transformava um DDD — que nao e endereco e nao e escolha do cliente — em ordem de pedir
  // CEP, e por ai o CEP virava requisito de fechamento. DDD e PISTA, nunca decisao.
  return `\n\n[LOCALIZA\u00c7\u00c3O: DDD ${ddd} = ${UF_NOME[uf] || uf}. Isso e PISTA REGIONAL, N\u00c3O \u00e9 decis\u00e3o de log\u00edstica: envio \u00e9 prov\u00e1vel, mas n\u00e3o afirme como fato e n\u00e3o pe\u00e7a CEP antes de a modalidade estar resolvida. Retirada presencial s\u00f3 na Grande SP.]`;
}

// ══ v4.34.0 P0: MODALIDADE LOGISTICA — ESTADO CANONICO RESOLVIDO ANTES DO CEP ══
// Conceito NOVO e separado de slots.produto e da modalidade metro/peca da v4.28.0 (P14).
// Reaproveitar qualquer um dos dois destruiria distincao que ja tem consumidor.
type ModalidadeLogistica = 'retirada' | 'motoboy' | 'envio' | 'desconhecida';

// Motoboy e retirada POR PROCURACAO: o cliente manda alguem buscar. Nao gera frete Correios.
const RX_LOG_MOTOBOY = /\b(motoboy|moto\s?boy|motoqueiro|lalamove|uber\s?flash|99\s?(?:entregas?|flash)|mensageiro|portador)\b/i;
const RX_LOG_RETIRADA = /\b(retirad[ao]s?|retirar|retiro|retiramos|retirei|presencial(?:mente)?)\b|\bem\s+m[a\u00e3]os\b|\b(?:busc(?:ar|o|amos)|peg(?:ar|o|amos)|pass(?:ar|o|amos))\s+(?:a[i\u00ed]|l[a\u00e1]|no\s+local|na\s+loja|pessoalmente|o\s+pedido|o\s+material)\b|\bvou\s+a[i\u00ed]\b|\bno\s+local\b|\bna\s+loja\b/i;
// v4.36.0: o sinal de envio passa a ter DOIS niveis, porque o verbo sozinho mentia.
// FORTE nomeia o meio de transporte — nao importa quem e o sujeito da frase.
const RX_LOG_ENVIO_FORTE = /\b(correios?|sedex|pac|transportadora|postagem|postar|frete)\b/i;
// VERBO e apenas candidato. Precisa passar pelos dois filtros abaixo.
const RX_LOG_ENVIO_VERBO = /\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?))\b|\bmandar?\s+(?:pelo|por|via|pra|para)\b|\bentreg(?:ar|a|ue)\s+(?:em\s+casa|no\s+meu|no\s+endere[c\u00e7]o)\b|\breceber\s+em\s+casa\b/i;
// O CLIENTE como REMETENTE. "posso enviar 300 agora", "vou mandar o comprovante", "ja enviei
// a arte" — nada disso e forma de entrega. Foi por aqui que o caso 5511994088967 entrou.
const RX_ENVIO_REMETENTE_CLIENTE = /\b(posso|poderia|vou|irei|consigo|acabei\s+de|estou|t[o\u00f4]|j[a\u00e1]|eu)\s+(?:te\s+|lhe\s+|j[a\u00e1]\s+)?(?:envi|mand)/i;
// Objeto que nao e mercadoria: dinheiro, arquivo, arte, comprovante, numero solto.
const RX_ENVIO_OBJETO_NAO_LOGISTICO = /(?:envi|mand)\w*\s+(?:o\s+|a\s+|os\s+|as\s+|um\s+|uma\s+|meu\s+|minha\s+|mais\s+)?(?:arquivo|arte|foto|imagem|print|comprovante|pix|pagamento|dinheiro|valor|dep[o\u00f3]sito|r?\$?\s*\d)/i;
// Mantido para compatibilidade de leitura: a uniao dos dois niveis, sem os filtros.
const RX_LOG_ENVIO = new RegExp(RX_LOG_ENVIO_FORTE.source + '|' + RX_LOG_ENVIO_VERBO.source, 'i');
// Decide envio numa sentenca. Negacao continua sendo tratada por termoPositivo.
function envioPositivoNaSentenca(s: string): boolean {
  if (termoPositivo(s, RX_LOG_ENVIO_FORTE)) return true;
  if (!termoPositivo(s, RX_LOG_ENVIO_VERBO)) return false;
  if (RX_ENVIO_REMETENTE_CLIENTE.test(s)) return false;
  if (RX_ENVIO_OBJETO_NAO_LOGISTICO.test(s)) return false;
  return true;
}
// Negacao curta ANTES do termo, dentro da mesma sentenca: "nao vou retirar", "sem frete".
const RX_LOG_NEGACAO = /\b(n[a\u00e3]o|sem|nem|nada\s+de)\b/i;
// "Forma de retirada: envio pelos Correios" — o ROTULO nao pode contar como declaracao.
const RX_ROTULO_LOGISTICA = /\bforma\s+de\s+(?:retirada|entrega|envio|recebimento)\s*:?/gi;
const RX_CEP_TEXTO = /\b(\d{5})-?(\d{3})\b/;

function cepDoTexto(t: string): string | null {
  const m = String(t || '').match(RX_CEP_TEXTO);
  return m ? (m[1] + m[2]) : null;
}
function sentencasLogisticas(txt: string): string[] {
  return String(txt || '').replace(RX_ROTULO_LOGISTICA, ' ')
    .split(/[.!?;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function termoPositivo(sent: string, rx: RegExp): boolean {
  const r = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(sent)) !== null) {
    // A negacao vale dentro da MESMA ORACAO. "Nao vou retirar, prefiro envio" nega
    // retirar e NAO nega envio; sem este corte a virgula seria ignorada e o cliente
    // que corrige a propria fala seria lido ao contrario.
    const antes = sent.slice(0, m.index);
    const b = antes.toLowerCase();
    const corte = Math.max(antes.lastIndexOf(','), antes.lastIndexOf(';'),
      b.lastIndexOf(' mas '), b.lastIndexOf(' porem '), b.lastIndexOf(' porém '));
    const oracao = corte >= 0 ? antes.slice(corte + 1) : antes;
    if (!RX_LOG_NEGACAO.test(oracao.slice(-28))) return true;
  }
  return false;
}
// Classifica UMA fala do CLIENTE. Nunca recebe texto do Joao: o que ele escreve nao
// declara nada pelo cliente. Sinais conflitantes na mesma fala devolvem null de proposito.
function classificarDeclaracaoLogistica(texto: string): { modalidade: ModalidadeLogistica | null; trecho: string | null } {
  let motoboy: string | null = null, retirada: string | null = null, envio: string | null = null;
  for (const s of sentencasLogisticas(texto)) {
    if (motoboy === null && termoPositivo(s, RX_LOG_MOTOBOY)) motoboy = s;
    if (retirada === null && termoPositivo(s, RX_LOG_RETIRADA)) retirada = s;
    if (envio === null && envioPositivoNaSentenca(s)) envio = s;
  }
  if (motoboy !== null) return { modalidade: 'motoboy', trecho: motoboy.slice(0, 120) };
  if (retirada !== null && envio === null) return { modalidade: 'retirada', trecho: retirada.slice(0, 120) };
  if (envio !== null && retirada === null) return { modalidade: 'envio', trecho: envio.slice(0, 120) };
  return { modalidade: null, trecho: null };
}
function normalizarModalidadeSlot(v: any): ModalidadeLogistica | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s || s === 'null') return null;
  if (/motoboy|moto boy|lalamove|entregador/.test(s)) return 'motoboy';
  if (/retirad|retirar|presencial|no local|na loja/.test(s)) return 'retirada';
  if (/envio|enviar|correio|sedex|pac|frete|entrega/.test(s)) return 'envio';
  return null;
}

type EstadoLogistico = {
  modalidade: ModalidadeLogistica;
  proveniencia: string;
  fonte_nivel: number;
  evidencia: string | null;
  confirmar_com_cliente: boolean;
  bloqueia_frete: boolean;
  motivo_bloqueio: string;
  pedir_cep: boolean;
  cep_conhecido: string | null;
  cep_fonte: string | null;
  retirada_plausivel: boolean;
  produto_digital: boolean;
  ddd: string;
  // ── v4.35.0: contrato de CEP. Preenchido por refinarCepComCadastro, que so roda
  // quando a modalidade admite frete. Sob retirada/motoboy ficam nos valores neutros.
  cep_cadastro: string | null;
  pessoa_id: string | null;
  cadastro_ambiguo: boolean;
  cadastro_tem_endereco: boolean;
  cep_confirmado: boolean;
  pedir_confirmacao_cep: boolean;
  cep_divergente_do_cadastro: boolean;
  intencao_cep_padrao: 'novo_padrao' | 'so_este_pedido' | 'indefinida' | null;
};

// PRECEDENCIA DAS FONTES (a ordem e a regra, nao um detalhe):
//  1 declaracao explicita do cliente NESTE turno
//  2 declaracao explicita mais recente do cliente na conversa do pedido; depois o estado
//    ja confirmado no pedido (slots)
//  3 historico confiavel do proprio cliente
//  4 localizacao/DDD: PISTA, jamais fato
//  5 desconhecida
function resolverModalidadeLogistica(a: {
  mensagemAtual: string; inboundsPedido: any[]; historicoInbound: any[];
  slots: any; phone: string; freteJa: any | null; produtoContexto: string;
}): EstadoLogistico {
  // v4.35.0: a.mensagemAtual ja era usada para a MODALIDADE (nivel 1) e agora tambem entra
  // como nivel 1 do CEP. Nada da resolucao de modalidade mudou.
  const ddd = String(a.phone || '').length >= 4 ? String(a.phone).slice(2, 4) : '';
  const grandeSP = ddd === '11';
  // v4.37.2: 'pack' colado por separador ('pack_adesivos') nao casava \bpacks?\b, e sem isso
  // o pedido DIGITAL seguia o fluxo fisico: pedia medida, retirada e CEP. Mesmo defeito de
  // fronteira que a v4.37.1 corrigiu no 'uv'. A segunda condicao delega ao vocabulario
  // canonico em vez de repetir regra: pedido MISTO ('dtf_textil_3m + pack_catolicos') resolve
  // como dtf_textil, continua fisico e continua tendo frete.
  const ctxProduto = String(a.produtoContexto || '');
  const packColado = /(?:^|[^a-z0-9])packs?(?![a-z0-9])/i.test(ctxProduto)
    && normalizarProdutoMacro(ctxProduto) === 'pack';
  const produtoDigital = /\bpacks?\b|estampas?\s+pronta|arquivo\s+digital/i.test(ctxProduto) || packColado;

  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.
  // v4.35.0: ordem das fontes conforme o contrato. O que o cliente ACABOU de escrever vence
  // o estado salvo — antes o slot vinha primeiro e um CEP novo digitado perdia para um slot
  // velho. pessoas.cep (nivel 3) entra depois, em refinarCepComCadastro.
  let cep: string | null = null; let cepFonte: string | null = null;
  const cepDoTurno = cepDoTexto(String(a.mensagemAtual || ''));
  if (cepDoTurno) { cep = cepDoTurno; cepFonte = 'pedido'; }
  if (!cep) for (const i of (a.inboundsPedido || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'pedido'; break; } }
  if (!cep) { const cepSlot = a.slots?.cep ? String(a.slots.cep).replace(/\D/g, '') : ''; if (cepSlot.length === 8) { cep = cepSlot; cepFonte = 'estado_confirmado'; } }
  if (!cep && a.freteJa?.cep_destino) { const c = String(a.freteJa.cep_destino).replace(/\D/g, ''); if (c.length === 8) { cep = c; cepFonte = 'frete_anterior'; } }
  if (!cep) for (const i of (a.historicoInbound || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'historico'; break; } }

  const montar = (m: ModalidadeLogistica, prov: string, nivel: number, ev: string | null, confirmar: boolean): EstadoLogistico => {
    const semFretePorModalidade = m === 'retirada' || m === 'motoboy';
    const indefinidaComRetiradaPlausivel = m === 'desconhecida' && grandeSP;
    const bloqueia = semFretePorModalidade || produtoDigital || indefinidaComRetiradaPlausivel;
    const motivo = produtoDigital ? 'produto_digital_sem_frete'
      : semFretePorModalidade ? ('modalidade_' + m + '_nao_tem_frete')
      : indefinidaComRetiradaPlausivel ? 'modalidade_indefinida_com_retirada_plausivel'
      : 'sem_bloqueio';
    return {
      modalidade: m, proveniencia: prov, fonte_nivel: nivel, evidencia: ev,
      confirmar_com_cliente: confirmar,
      bloqueia_frete: bloqueia, motivo_bloqueio: motivo,
      // So se PEDE CEP quando ele e necessario E ainda nao existe.
      pedir_cep: !bloqueia && !cep,
      cep_conhecido: cep, cep_fonte: cepFonte,
      retirada_plausivel: semFretePorModalidade || grandeSP,
      produto_digital: produtoDigital, ddd,
      // v4.35.0: neutros aqui. Sob retirada/motoboy/digital continuam neutros para SEMPRE,
      // porque refinarCepComCadastro nem chega a ser chamado — o cadastro nao e nem lido.
      cep_cadastro: null, pessoa_id: null, cadastro_ambiguo: false,
      cadastro_tem_endereco: false, cep_confirmado: false,
      pedir_confirmacao_cep: false, cep_divergente_do_cadastro: false,
      intencao_cep_padrao: null,
    };
  };

  const n1 = classificarDeclaracaoLogistica(a.mensagemAtual);
  if (n1.modalidade) return montar(n1.modalidade, 'declaracao_explicita_no_turno', 1, n1.trecho, false);

  for (const i of (a.inboundsPedido || [])) {
    const c = classificarDeclaracaoLogistica(String(i?.message_text || ''));
    if (c.modalidade) return montar(c.modalidade, 'declaracao_recente_do_cliente', 2, c.trecho, false);
  }
  const slotMod = normalizarModalidadeSlot(a.slots?.modalidade_logistica) ?? normalizarModalidadeSlot(a.slots?.envio_retirada);
  if (slotMod) return montar(slotMod, 'estado_confirmado_no_pedido', 2, null, false);

  for (const i of (a.historicoInbound || [])) {
    const c = classificarDeclaracaoLogistica(String(i?.message_text || ''));
    // Historico REDUZ ATRITO, nao decide: entra com confirmar_com_cliente=true, e qualquer
    // fala nova do cliente (nivel 1 ou 2) o atropela.
    if (c.modalidade) return montar(c.modalidade, 'historico_do_cliente', 3, c.trecho, true);
  }

  return montar('desconhecida',
    grandeSP ? 'pista_regional_grande_sp' : (ddd ? 'pista_regional_fora_da_grande_sp' : 'sem_sinal'),
    ddd ? 4 : 5, null, false);
}

function blocoModalidadeLogistica(e: EstadoLogistico): string {
  const evid = e.evidencia ? ` O cliente escreveu: "${e.evidencia}".` : '';
  if (e.produto_digital && e.modalidade !== 'envio') {
    return '\n\n[LOG\u00cdSTICA: PRODUTO DIGITAL. A entrega \u00e9 por LINK no WhatsApp. N\u00c3O existe CEP, N\u00c3O existe frete e N\u00c3O existe endere\u00e7o neste pedido.]';
  }
  if (e.modalidade === 'retirada' || e.modalidade === 'motoboy') {
    const nome = e.modalidade === 'motoboy' ? 'MOTOBOY (o cliente manda buscar)' : 'RETIRADA PRESENCIAL';
    const conf = e.confirmar_com_cliente
      ? ` Isso vem do HIST\u00d3RICO deste cliente, n\u00e3o do pedido de hoje: confirme em UMA pergunta curta ("${e.modalidade === 'motoboy' ? 'Vai mandar o motoboy como das outras vezes?' : 'Vai retirar aqui como das outras vezes?'}") e siga. Se ele disser que agora quer envio, a fala NOVA dele vale mais que o hist\u00f3rico.`
      : '';
    const cepNota = e.cep_conhecido ? ' Existe CEP conhecido deste cliente e ele N\u00c3O muda nada aqui: nesta modalidade o CEP n\u00e3o \u00e9 usado para nada.' : '';
    return `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ${nome}.${evid}${conf}`
      + '\nPROIBIDO pedir CEP. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.'
      + '\nGERAR COBRAN\u00c7A N\u00c3O EXIGE CEP: sem frete, o TOTAL \u00e9 o valor do produto. \u00c9 PROIBIDO escrever que precisa do CEP para gerar a cobran\u00e7a, inclusive com a ressalva "mesmo sendo retirada".'
      + `${cepNota}]`;
  }
  if (e.modalidade === 'envio') {
    return e.cep_conhecido
      ? `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ${e.cep_conhecido} J\u00c1 \u00c9 CONHECIDO (fonte: ${e.cep_fonte}). N\u00c3O pe\u00e7a de novo: use esse CEP em calcular_frete e feche com produto + frete.]`
      : `\n\n[MODALIDADE LOG\u00cdSTICA J\u00c1 RESOLVIDA: ENVIO.${evid} O CEP ainda falta: pe\u00e7a UMA vez, 8 d\u00edgitos, e chame calcular_frete em seguida.]`;
  }
  if (e.retirada_plausivel) {
    return '\n\n[MODALIDADE LOG\u00cdSTICA N\u00c3O RESOLVIDA e RETIRADA \u00c9 PLAUS\u00cdVEL (Grande SP). Fa\u00e7a UMA pergunta: retirada aqui em Embu ou envio pelos Correios?'
      + '\nPROIBIDO pedir CEP antes da resposta. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.]';
  }
  return '\n\n[MODALIDADE LOG\u00cdSTICA N\u00c3O RESOLVIDA. O cliente est\u00e1 fora da Grande SP, ent\u00e3o ENVIO \u00e9 o caminho prov\u00e1vel — mas isso \u00e9 pista, n\u00e3o fato: havendo qualquer sinal de retirada, pergunte antes.'
    + (e.cep_conhecido ? ` O CEP ${e.cep_conhecido} j\u00e1 \u00e9 conhecido (fonte: ${e.cep_fonte}): N\u00c3O pe\u00e7a de novo.]` : ' S\u00f3 pe\u00e7a o CEP quando ele realmente faltar para o frete.]');
}

// Fallback terminal do fechamento. A v4.33.0 usava uma lista FIXA ("quantidade, medida, CEP
// ou forma de retirada?") que reaparecia mesmo com tudo respondido — foi ela que fechou o
// loop no caso Carolina. Agora pergunta SO o que falta, e nunca cita CEP fora de envio.
function perguntaDoQueFaltaFechamento(e: EstadoLogistico, slots: any): string {
  const tem = (k: string) => {
    const v = slots?.[k];
    return v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null';
  };
  const faltas: string[] = [];
  // v4.37.2: produto DIGITAL nao tem medida fisica, e no catalogo vivo todo pack cobra o
  // mesmo preco_1un e preco_10un — quantidade nao muda o valor. Pedir os dois foi o que
  // produziu "me confirma a quantidade, a medida e se e retirada ou envio" num pedido de
  // Pack Futebol. A linha de retirada/envio ja era suprimida aqui desde a v4.34.0; faltava
  // suprimir as outras duas. Sem faltas, a pergunta vira so a forma de pagamento.
  if (!e.produto_digital) {
    if (!tem('quantidade')) faltas.push('a quantidade');
    if (!tem('arte') && !tem('quantidade')) faltas.push('a medida');
  }
  if (e.modalidade === 'desconhecida' && !e.produto_digital) faltas.push('se \u00e9 retirada ou envio');
  if (e.modalidade === 'envio' && !e.cep_conhecido) faltas.push('o CEP');
  if (faltas.length === 0) {
    return 'Para gerar a cobran\u00e7a correta, me confirma s\u00f3 a forma de pagamento: Pix ou cart\u00e3o?';
  }
  const lista = faltas.length === 1 ? faltas[0] : faltas.slice(0, -1).join(', ') + ' e ' + faltas[faltas.length - 1];
  return `Para gerar a cobran\u00e7a correta, preciso concluir o valor do pedido. Me confirma ${lista}?`;
}

// ══ v4.35.0 P0: CEP CANONICO — LER O CADASTRO, CONFIRMAR, REUTILIZAR, PERSISTIR ══
// KILL SWITCH. FALSE = nunca troca um cep que ja convive com endereco preenchido.
// Ligar significa aceitar que a NF-e saia com cep novo e logradouro/cidade antigos.
const PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO = false;

type PessoaCadastro = {
  pessoa_id: string | null; nome: string | null; cep: string | null;
  tem_endereco: boolean; ambiguo: boolean;
};

const CADASTRO_VAZIO: PessoaCadastro = { pessoa_id: null, nome: null, cep: null, tem_endereco: false, ambiguo: false };

function soDigitos(v: any): string { return String(v ?? '').replace(/\D/g, ''); }

// Le o cadastro canonico do ERP por TELEFONE. Fail-closed: 0 ou 2+ casamentos exatos de
// sufixo devolvem cadastro vazio com ambiguo=true. Nunca cria pessoa, nunca adivinha.
// O filtro vai pelos 4 ultimos digitos (sempre contiguos no formato "(11) 91857-0605") so
// para limitar a linha trafegada; o casamento real e por sufixo de 8 digitos, aqui.
async function lerPessoaCanonicaPorTelefone(phone: string): Promise<PessoaCadastro> {
  const digits = soDigitos(phone);
  if (digits.length < 10) return CADASTRO_VAZIO;
  if (!ERP_URL || !ERP_SERVICE_KEY) { await logErro('cep_cadastro_sem_credencial', { phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
  const ult4 = digits.slice(-4);
  const suf8 = digits.slice(-8);
  try {
    const COLUNAS = 'id,nome,cep,logradouro,numero,bairro,cidade,estado,telefone,whatsapp,ativo';
    const cab = { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}` };
    // Filtro pelos 4 ultimos digitos so para nao trafegar a tabela inteira. Medido no ERP:
    // pior grupo de ult4 tem 7 linhas, contra o limite de 20.
    let r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}`
      + `&or=(telefone.ilike.*${ult4}*,whatsapp.ilike.*${ult4}*)&limit=20`,
      { headers: cab, signal: AbortSignal.timeout(10000) });
    // FALLBACK DELIBERADO: se o filtro for recusado (grafia de PostgREST, coluna renomeada),
    // a feature NAO some em silencio — relemos sem filtro. O cadastro tem 144 linhas hoje;
    // o casamento exato continua sendo feito aqui, por sufixo de 8 digitos.
    if (!r.ok) {
      await logErro('cep_cadastro_filtro_recusado', { status: r.status, phone: phone.slice(-4) });
      r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}&limit=500`,
        { headers: cab, signal: AbortSignal.timeout(10000) });
    }
    if (!r.ok) { await logErro('cep_cadastro_http_erro', { status: r.status, phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
    const linhas = await r.json();
    const casam = (Array.isArray(linhas) ? linhas : []).filter((p: any) => {
      if (p?.ativo === false) return false;
      const t1 = soDigitos(p?.telefone), t2 = soDigitos(p?.whatsapp);
      return (t1.length >= 10 && t1.slice(-8) === suf8) || (t2.length >= 10 && t2.slice(-8) === suf8);
    });
    if (casam.length !== 1) {
      if (casam.length > 1) await logErro('cep_cadastro_ambiguo', { phone: phone.slice(-4), encontrados: casam.length });
      return { ...CADASTRO_VAZIO, ambiguo: casam.length > 1 };
    }
    const p = casam[0];
    const cepCad = soDigitos(p?.cep);
    return {
      pessoa_id: String(p.id), nome: p?.nome ? String(p.nome) : null,
      cep: cepCad.length === 8 ? cepCad : null,
      tem_endereco: !!(String(p?.logradouro || '').trim() || String(p?.cidade || '').trim() || String(p?.bairro || '').trim()),
      ambiguo: false,
    };
  } catch (e: any) {
    await logErro('cep_cadastro_excecao', { phone: phone.slice(-4), e: String(e?.message ?? e).slice(0, 120) });
    return CADASTRO_VAZIO;
  }
}

// Respostas do cliente a pergunta de confirmacao de CEP. Deterministicas: o modelo nao opina.
const RX_CEP_CONFIRMA = /\b(isso|isso mesmo|esse mesmo|o mesmo|mesmo cep|mesmo endere[c\u00e7]o|sim|pode ser|pode mandar|confirmo|confirmado|exato|correto|isso a[i\u00ed]|[e\u00e9] esse|[e\u00e9] esse mesmo|continua|igual)\b/i;
const RX_CEP_OUTRO = /\b(outro|outra|novo|nova|mudei|mudou|mudamos|mudan[c\u00e7]a|troquei|trocamos|diferente|n[a\u00e3]o [e\u00e9] esse|nao e esse|agora [e\u00e9]|me mudei)\b/i;
const RX_CEP_PADRAO_NOVO = /\b(novo (cep )?padr[a\u00e3]o|mudei de endere[c\u00e7]o|me mudei|nos mudamos|mudamos de endere[c\u00e7]o|endere[c\u00e7]o novo|atualiza(r)? (o )?cadastro|pode atualizar|passa a ser|de agora em diante|daqui (pra|para) frente|sempre (vai ser|ser[a\u00e1]))\b/i;
const RX_CEP_SO_ESTE_PEDIDO = /\b(s[o\u00f3] (para|pra) (este|esse) pedido|s[o\u00f3] (deste|desse) pedido|s[o\u00f3] (desta|dessa) vez|apenas (este|esse) pedido|s[o\u00f3] agora|exce[c\u00e7][a\u00e3]o|dessa vez|s[o\u00f3] dessa)\b/i;
// A pergunta que o PROPRIO Joao faz. Serve para saber se "isso mesmo" responde ao CEP.
const RX_JOAO_PERGUNTOU_CEP = /(mesmo cep|cep final|mesmo endere[c\u00e7]o|novo (cep )?padr[a\u00e3]o|s[o\u00f3] (para|pra) este pedido)/i;

function mascararCep(cep: string | null): string {
  const d = soDigitos(cep);
  return d.length === 8 ? d.slice(-4) : '';
}

// NIVEL 3 do contrato + estado de confirmacao. So roda quando a modalidade admite frete:
// sob retirada/motoboy/produto digital o cadastro nem e lido, e por construcao o CEP salvo
// NAO interfere.
function refinarCepComCadastro(
  e: EstadoLogistico, cadastro: PessoaCadastro, slots: any, mensagem: string, ultimaMsgJoao: string,
): EstadoLogistico {
  const r: EstadoLogistico = { ...e };
  r.cep_cadastro = cadastro.cep;
  r.pessoa_id = cadastro.pessoa_id;
  r.cadastro_ambiguo = cadastro.ambiguo === true;
  r.cadastro_tem_endereco = cadastro.tem_endereco === true;

  const joaoPerguntouCep = RX_JOAO_PERGUNTOU_CEP.test(String(ultimaMsgJoao || ''));
  const confirmouAntes = slots?.cep_confirmado_para_envio === true;
  const cepDoTurnoAgora = cepDoTexto(String(mensagem || ''));

  // Intencao sobre cadastro: so vale se o cliente falou, nunca inferida do silencio.
  r.intencao_cep_padrao = RX_CEP_PADRAO_NOVO.test(mensagem) ? 'novo_padrao'
    : RX_CEP_SO_ESTE_PEDIDO.test(mensagem) ? 'so_este_pedido'
    : null;

  // NIVEL 3: sem CEP de nivel 1/2/4, o cadastro entra como fonte.
  if (!r.cep_conhecido && cadastro.cep) { r.cep_conhecido = cadastro.cep; r.cep_fonte = 'pessoas'; }

  r.cep_divergente_do_cadastro = !!(cadastro.cep && r.cep_conhecido && r.cep_conhecido !== cadastro.cep);

  // CONFIRMACAO. O cliente respondendo "isso mesmo" a uma pergunta de CEP confirma; dizendo
  // "outro"/"mudei" desconfirma e o CEP do cadastro deixa de servir.
  if (joaoPerguntouCep && RX_CEP_OUTRO.test(mensagem) && !cepDoTurnoAgora) {
    r.cep_confirmado = false;
    if (r.cep_fonte === 'pessoas') { r.cep_conhecido = null; r.cep_fonte = null; }
  } else if (cepDoTurnoAgora) {
    // CEP escrito agora e confirmacao por si: e o proprio cliente declarando o destino.
    r.cep_confirmado = true;
  } else if (confirmouAntes && !r.cep_divergente_do_cadastro) {
    r.cep_confirmado = true;
  } else if (joaoPerguntouCep && RX_CEP_CONFIRMA.test(mensagem)) {
    r.cep_confirmado = true;
  } else {
    r.cep_confirmado = false;
  }

  // Reutilizar CEP do cadastro sem avisar e o defeito que esta rodada corrige: confirma
  // primeiro, em UMA pergunta, sem expor o endereco inteiro.
  r.pedir_confirmacao_cep = r.cep_fonte === 'pessoas' && !r.cep_confirmado;
  // Pedir CEP so quando nao existe NENHUM. Ter de confirmar nao e ter de pedir.
  r.pedir_cep = !r.bloqueia_frete && !r.cep_conhecido;
  return r;
}

// O CEP so vale para calcular frete quando esta confirmado como destino deste pedido.
function cepLiberadoParaFrete(e: EstadoLogistico): boolean {
  if (e.bloqueia_frete) return false;
  if (!e.cep_conhecido) return false;
  return e.cep_confirmado === true || e.cep_fonte !== 'pessoas';
}

function blocoCepCanonico(e: EstadoLogistico): string {
  if (e.bloqueia_frete) return '';
  if (e.pedir_confirmacao_cep && e.cep_cadastro) {
    return `\n\n[CEP DO CADASTRO: este cliente j\u00e1 tem CEP no cadastro, final ${mascararCep(e.cep_cadastro)}.`
      + ' N\u00c3O pe\u00e7a o CEP inteiro de novo e N\u00c3O use o do cadastro calado.'
      + ` CONFIRME em UMA frase curta e natural: "Vai ser enviado para o mesmo CEP final ${mascararCep(e.cep_cadastro)}?".`
      + ' N\u00e3o exponha o endere\u00e7o completo. Se ele confirmar, calcule o frete com esse CEP. Se disser que \u00e9 outro, a\u00ed sim pe\u00e7a o CEP novo.]';
  }
  if (e.cep_conhecido && e.cep_confirmado) {
    return `\n\n[CEP CONFIRMADO para este pedido: ${e.cep_conhecido} (fonte: ${e.cep_fonte}). N\u00c3O pergunte de novo, nem o CEP nem a confirma\u00e7\u00e3o: chame calcular_frete com ele.`
      + (e.cep_divergente_do_cadastro && e.intencao_cep_padrao === null
        ? ' Este CEP \u00e9 DIFERENTE do que est\u00e1 no cadastro dele. Antes de encerrar o assunto de entrega, pergunte UMA vez, curto: "Esse \u00e9 seu novo CEP padr\u00e3o ou \u00e9 s\u00f3 para este pedido?" — e N\u00c3O trate como novo padr\u00e3o enquanto ele n\u00e3o responder.'
        : '')
      + ']';
  }
  if (e.pedir_cep) {
    return '\n\n[CEP AUSENTE: pe\u00e7a o CEP UMA vez, 8 d\u00edgitos, e chame calcular_frete em seguida. N\u00c3O pe\u00e7a duas vezes.]';
  }
  return '';
}

// PERSISTENCIA GUARDADA. Devolve o que aconteceu e POR QUE. Nunca cria pessoa, nunca escreve
// campo que nao seja cep, nunca roda sob retirada/motoboy.
async function persistirCepCanonico(
  e: EstadoLogistico, phone: string,
): Promise<{ persistido: boolean; motivo: string }> {
  if (e.bloqueia_frete) return { persistido: false, motivo: 'modalidade_sem_frete' };
  const cep = soDigitos(e.cep_conhecido);
  if (cep.length !== 8) return { persistido: false, motivo: 'cep_invalido' };
  if (!e.pessoa_id) return { persistido: false, motivo: e.cadastro_ambiguo ? 'cadastro_ambiguo' : 'sem_pessoa_vinculada' };
  if (!e.cep_confirmado) return { persistido: false, motivo: 'cep_nao_confirmado' };
  if (e.cep_cadastro === cep) return { persistido: false, motivo: 'cep_ja_igual_ao_cadastro' };
  // Lacuna: pessoa sem cep. Preencher e aditivo e nao contradiz endereco nenhum.
  const preencheLacuna = !e.cep_cadastro;
  if (!preencheLacuna) {
    if (e.intencao_cep_padrao !== 'novo_padrao') {
      return { persistido: false, motivo: e.intencao_cep_padrao === 'so_este_pedido' ? 'apenas_este_pedido' : 'intencao_de_padrao_indefinida' };
    }
    if (e.cadastro_tem_endereco && !PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO) {
      return { persistido: false, motivo: 'endereco_fiscal_coerente_exige_atualizacao_completa' };
    }
  } else if (e.intencao_cep_padrao === 'so_este_pedido') {
    return { persistido: false, motivo: 'apenas_este_pedido' };
  }
  if (!ERP_URL || !ERP_SERVICE_KEY) return { persistido: false, motivo: 'erp_sem_credencial' };
  try {
    const r = await fetch(`${ERP_URL}/rest/v1/pessoas?id=eq.${e.pessoa_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ cep: cep.slice(0, 5) + '-' + cep.slice(5) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { await logErro('cep_persistencia_http_erro', { status: r.status, pessoa_id: e.pessoa_id }); return { persistido: false, motivo: 'http_' + r.status }; }
    return { persistido: true, motivo: preencheLacuna ? 'lacuna_preenchida' : 'novo_padrao_declarado' };
  } catch (err: any) {
    await logErro('cep_persistencia_excecao', { pessoa_id: e.pessoa_id, e: String(err?.message ?? err).slice(0, 120) });
    return { persistido: false, motivo: 'excecao' };
  }
}

// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy
// confirmados, nenhuma destas palavras pode atravessar.
const RX_SAIDA_TERMO_FRETE = /\b(cep|pac|sedex|correios?)\b/i;
// Remove do texto APENAS as sentencas que carregam o termo proibido. Nao reescreve, nao
// resume, nao recalcula — mesma disciplina de removerPerguntaRepetida (v4.21.6).
function removerSentencasComTermo(texto: string, rx: RegExp): string {
  const partes = String(texto || '').split(/(?<=[.!?])\s+|\n+/);
  const testar = new RegExp(rx.source, rx.flags.replace('g', ''));
  return partes.filter((p) => !testar.test(p)).join(' ')
    .replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function extrairJson(raw: string): any {
  const limpo = String(raw || '').replace(/```json|```/g, '');
  const ini = limpo.indexOf('{'); const fim = limpo.lastIndexOf('}');
  const recuperar = () => {
    const mm = limpo.match(/"mensagem"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mm && mm[1] && mm[1].length > 5) {
      const texto = mm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const tm = limpo.match(/"tema"\s*:\s*"([a-z_]+)"/);
      return { responde: true, mensagem: texto, tema: tm ? tm[1] : 'complexo', encaminhou_venda: false, etapa: null, slots: {}, _recuperado: true };
    }
    return null;
  };
  if (ini === -1 || fim <= ini) { const r = recuperar(); if (r) return r; throw new Error('sem_json_no_texto'); }
  try { return JSON.parse(limpo.slice(ini, fim + 1)); }
  catch (e) { const r = recuperar(); if (r) return r; throw e; }
}
function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length >= 2 || /^\d$/.test(t); }
async function logErro(msg: string, payload: any) { try { await sb.from('error_log').insert({ function_name: 'agente-noturno', error_message: msg, payload }); } catch {} }

async function agentePausado(phone: string): Promise<boolean> {
  try { const { data } = await sb.rpc('fn_agente_pausado', { p_phone: phone }); return data === true; } catch { return false; }
}
async function lerEstado(phone: string): Promise<any> {
  try { const { data } = await sb.from('agente_noturno_estado').select('etapa, slots, updated_at').eq('phone', phone).maybeSingle(); return data || null; } catch { return null; }
}
async function salvarEstado(phone: string, leadId: string | null, etapa: string, slots: any) {
  try { await sb.from('agente_noturno_estado').upsert({ phone, lead_id: leadId, etapa: etapa || 'sondagem', slots: slots || {}, updated_at: new Date().toISOString() }, { onConflict: 'phone' }); } catch {}
}

async function resolverLeadPorTelefone(phone: string): Promise<{ lead_id: string | null; content_category: string }> {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { lead_id: null, content_category: '' };
  try {
    const { data: exato } = await sb.from('leads_marketing').select('lead_id, content_category').eq('ph', digits).maybeSingle();
    if (exato?.lead_id) return { lead_id: exato.lead_id, content_category: String(exato.content_category || '') };
    // A Z-API pode entregar o telefone sem o nono digito, mas o LID continua sendo da mesma pessoa.
    // O sufixo de 8 digitos resolve o caso sem fabricar um lead duplicado; ambiguidade falha fechada.
    const sufixo = digits.slice(-8);
    if (sufixo.length === 8) {
      const { data: candidatos } = await sb.from('leads_marketing').select('lead_id, content_category').like('ph', `%${sufixo}`).limit(2);
      if (candidatos?.length === 1) return { lead_id: candidatos[0].lead_id, content_category: String(candidatos[0].content_category || '') };
    }
  } catch {}
  return { lead_id: null, content_category: '' };
}

function nomeArquivoUpload(u: any): string {
  const pelaDescricao = String(u?.descricao || '').replace(/^Arquivo enviado via WhatsApp:\s*/i, '').trim();
  if (pelaDescricao) return pelaDescricao;
  const a = Array.isArray(u?.arquivos) ? u.arquivos[0] : null;
  return String(a?.nome || 'arquivo enviado').replace(/^ff-[a-f0-9]+-ff-/i, '');
}

async function blocoArquivosDoLead(leadId: string | null): Promise<string> {
  if (!leadId) return '';
  try {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await sb.from('arte_uploads')
      .select('id, descricao, arquivos, total_arquivos, created_at, dimensoes, arquivo_tamanho_bytes, arquivo_mime_type, storage_sync_status')
      .eq('lead_id', leadId).gte('created_at', desde).order('created_at', { ascending: false }).limit(40);
    if (!data?.length) return '';
    const vistos = new Set<string>(); const itens: string[] = [];
    for (const u of data) {
      const nome = nomeArquivoUpload(u);
      const dim: any = u.dimensoes || {};
      const largura = Number(dim.largura_cm || 0), altura = Number(dim.altura_cm || 0);
      const chave = `${nome.toLowerCase()}|${largura}|${altura}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const mb = Number(u.arquivo_tamanho_bytes || 0) / 1048576;
      const origem = /^Arquivo enviado via WhatsApp:/i.test(String(u.descricao || '')) ? 'WhatsApp' : 'site';
      itens.push(`${itens.length + 1}. ${nome}; origem=${origem}; tamanho_arquivo=${mb > 0 ? mb.toFixed(1) + ' MB' : 'nao medido'}; dimensao=${largura > 0 && altura > 0 ? largura + ' x ' + altura + ' cm' : 'nao medida'}; armazenado=${u.storage_sync_status === 'done' ? 'sim' : 'processando'}`);
      if (itens.length >= 20) break;
    }
    if (!itens.length) return '';
    return `\n\n[ARQUIVOS REAIS DESTE LEAD, RECEBIDOS POR WHATSAPP OU SITE — ${itens.length} arquivo(s) distinto(s):\n${itens.join('\n')}\n`+
      `Use estes dados. Nao suponha que a arte esta solta nem montada apenas pelo nome. Dimensao pequena pode ser a arte individual; largura proxima da bobina indica arquivo montado. Diga quantos arquivos recebeu e converse sobre eles. Se forem artes soltas, pergunte UMA VEZ quantas copias deseja de cada arte ou se a mesma quantidade vale para todas. Se o arquivo estiver montado, use a metragem real. Nao mande o cliente calcular metragem. Conduza ao orcamento e fechamento.]`;
  } catch { return ''; }
}

function respostaDeterministicaArquivos(bloco: string): string {
  const qtd = Number(bloco.match(/— (\d+) arquivo\(s\) distinto/)?.[1] || 0);
  const contagem = new Map<string, number>();
  for (const m of bloco.matchAll(/dimensao=([\d.]+) x ([\d.]+) cm/g)) {
    const d = `${Number(m[1]).toLocaleString('pt-BR')} x ${Number(m[2]).toLocaleString('pt-BR')} cm`;
    contagem.set(d, (contagem.get(d) || 0) + 1);
  }
  const medidas = [...contagem.entries()].map(([d, n]) => `${n} em ${d}`).join(' e ');
  return `Recebi e identifiquei ${qtd} arquivo${qtd === 1 ? '' : 's'}${medidas ? `: ${medidas}` : ''}; todos estão armazenados. `
    + `Você quer quantas cópias de cada arte ou a mesma quantidade para todas?`;
}
async function baixarImagemB64(url: string): Promise<{ data: string; media: string } | null> {
  try {
    const r = await fetch(url, { headers: ZAPI_CLIENT_TOKEN ? { 'Client-Token': ZAPI_CLIENT_TOKEN } : {}, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!ct.startsWith('image/')) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 500 || buf.byteLength > 4500000) return null;
    let bin = ''; const ch = 8192;
    for (let i = 0; i < buf.length; i += ch) bin += String.fromCharCode(...buf.subarray(i, i + ch));
    return { data: btoa(bin), media: ct };
  } catch { return null; }
}

const TOOLS = [
  { name: 'consultar_catalogo', description: 'Busca produto no catalogo oficial. SEMPRE antes de falar de preco.', input_schema: { type: 'object', properties: { termo: { type: 'string' } }, required: ['termo'] } },
  { name: 'calcular_copo', description: 'Preco de copos termicos inox 473ml que a Skillprint VENDE. NAO use quando o cliente ja tem o copo e quer so o adesivo.', input_schema: { type: 'object', properties: { quantidade: { type: 'integer' }, liso: { type: 'boolean' } }, required: ['quantidade'] } },
  { name: 'consultar_tabela_dtf', description: 'Tabela oficial por metro E por folha. OBRIGATORIO o produto: dtf_textil ou dtf_uv.', input_schema: { type: 'object', properties: { produto: { type: 'string', enum: ['dtf_textil', 'dtf_uv'] } }, required: ['produto'] } },
  { name: 'calcular_dtf_por_arte', description: 'DTF TEXTIL: metros e valor a partir da ARTE (largura, altura, copias). Copias NAO sao metros.', input_schema: { type: 'object', properties: { largura_cm: { type: 'number' }, altura_cm: { type: 'number' }, copias: { type: 'integer' } }, required: ['largura_cm', 'altura_cm', 'copias'] } },
  { name: 'calcular_dtf_metro', description: 'Preco de DTF textil por METRAGEM informada diretamente pelo cliente. PROIBIDO usar quando existem largura, altura e copias, inclusive alteracao de quantidade: nesse caso use calcular_dtf_por_arte.', input_schema: { type: 'object', properties: { metros: { type: 'number' } }, required: ['metros'] } },
  { name: 'calcular_dtf_uv_metro', description: 'Preco de DTF UV por METRAGEM. Aceita fracao de metro. A cobranca usa os degraus oficiais: ate 0,25m folha A4; acima de 0,25m ate 0,50m folha A3; acima de 0,50m ate 1,00m A3 mais excedente; acima de 1,00m tabela por metro.', input_schema: { type: 'object', properties: { metros: { type: 'number' } }, required: ['metros'] } },
  { name: 'calcular_rendimento_uv', description: 'DTF UV: quantos adesivos cabem por metro (largura util 28cm) e o VALOR pela AREA usada. SEM quantidade_desejada ela responde SO a capacidade: quantos cabem em 1 metro. COM quantidade_desejada devolve os metros reais (pode ser fracao, ex: 0.46m) e o total. Se o cliente so perguntou quantos cabem, chame SEM quantidade_desejada e NAO peca quantidade antes de responder. SEMPRE use esta tool para cotar adesivo: NUNCA calcule de cabeca.', input_schema: { type: 'object', properties: { largura_cm: { type: 'number' }, altura_cm: { type: 'number' }, quantidade_desejada: { type: 'integer' } }, required: ['largura_cm', 'altura_cm'] } },
  { name: 'consultar_modelos', description: 'Lista os modelos de peca que a Skillprint produz, ou confirma se um modelo especifico existe. Use SEMPRE antes de dizer que fazemos ou nao fazemos um modelo. Nao exige grade nem quantidade.', input_schema: { type: 'object', properties: { termo: { type: 'string', description: 'modelo citado pelo cliente, opcional' } } } },
  { name: 'orcar_camisetas', description: 'Orcamento oficial de camiseta, polo e moletom personalizados. Use o modelo que o CLIENTE falar: o banco resolve o apelido e recusa o que nao existe. Cada item precisa de quantidade e de um estampa_grupo_id. A GRADE POR TAMANHO E OPCIONAL e NAO altera o preco: orce sem ela quando o cliente ainda nao tiver os tamanhos, e diga que e previa. Mande a grade so quando o cliente informar. Cada estampa precisa de posicao e CLASSE de area. Classes: quadrado_pequeno, nomes_gola, a4, quadrado_grande, a3, extra_grande. Posicoes: frente, costas, gola_nuca, lateral, manga. O minimo de 10 pecas vale por GRUPO DE ESTAMPA, somando modelos diferentes. NUNCA calcule preco de camiseta de cabeca: use esta ferramenta.', input_schema: { type: 'object', properties: { itens: { type: 'array', items: { type: 'object', properties: { modelo: { type: 'string', description: 'Modelo conforme o cliente falar. O banco resolve por apelido. Exemplos: basica, baby look, infantil, plus size, baby look plus, oversized, polo, moletom, canguru. Se o modelo nao existir a ferramenta recusa e devolve a lista valida.' }, quantidade: { type: 'integer', minimum: 1 }, cor: { type: 'string' }, grade: { type: 'object', description: 'OPCIONAL. Quantidade por tamanho. NAO altera o preco — so serve para a producao. Omita quando o cliente ainda nao tiver os tamanhos.', additionalProperties: { type: 'integer' } }, estampa_grupo_id: { type: 'string' } }, required: ['modelo', 'quantidade', 'estampa_grupo_id'] } }, estampas: { type: 'array', items: { type: 'object', properties: { estampa_grupo_id: { type: 'string' }, posicao: { type: 'string', enum: ['frente', 'costas', 'gola_nuca', 'lateral', 'manga'] }, classe: { type: 'string', enum: ['quadrado_pequeno', 'nomes_gola', 'a4', 'quadrado_grande', 'a3', 'extra_grande'] } }, required: ['estampa_grupo_id', 'posicao', 'classe'] } } }, required: ['itens', 'estampas'] } },
  { name: 'calcular_frete', description: 'Frete Correios por CEP de 8 digitos. CHAME de verdade, nunca prometa calcular depois.', input_schema: { type: 'object', properties: { cep_destino: { type: 'string' } }, required: ['cep_destino'] } },
  { name: 'gerar_pix', description: 'Cobranca oficial. Use o operation_id devolvido em financial_authorizations pela ferramenta de calculo. NAO existe parametro de valor.', input_schema: { type: 'object', properties: { operation_id: { type: 'string' }, produto: { type: 'string' }, quantidade: { type: 'integer' } }, required: ['operation_id'] } },
  { name: 'compor_total', description: 'Soma oficial de duas ou mais autorizacoes (ex: produto + frete). Devolve um operation_id novo do total.', input_schema: { type: 'object', properties: { operation_ids: { type: 'array', items: { type: 'string' } } }, required: ['operation_ids'] } },
];

// ── v84: autorizacao financeira tipada ──────────────────────────────────────
// Unica fonte de valor de cobranca. Substitui a varredura numerica antiga.
async function emitirAutorizacao(
  leadId: string | null, kind: string, amount: number, sourceTool: string, components: any
): Promise<any | null> {
  if (!leadId || !(amount > 0)) return null;
  try {
    const { data, error } = await sb.rpc('fn_emitir_operacao_financeira', {
      p_lead_id: leadId, p_kind: kind, p_amount: amount, p_source_tool: sourceTool,
      p_components: components ?? {}, p_ttl_minutos: 30, p_retry_de: null,
    });
    if (error) { await logErro('autorizacao_nao_emitida', { sourceTool, erro: String(error.message).slice(0, 150) }); return null; }
    return data;
  } catch (e) { await logErro('autorizacao_excecao', { sourceTool, e: String(e).slice(0, 120) }); return null; }
}

function envelope(autorizacoes: any[], display: any, rendimentos?: any[]) {
  const pv = (display && Array.isArray(display.precos_verbalizaveis)) ? display.precos_verbalizaveis : [];
  return JSON.stringify({
    ok: true,
    precos_verbalizaveis: pv,
    // v4.32.0 P1: proveniencia de RENDIMENTO. Numero de capacidade so pode ser verbalizado se
    // veio da fonte canonica fn_dtf_uv_capacidade_folha. Chamar a tool NAO autoriza numero.
    rendimentos_autorizados: Array.isArray(rendimentos) ? rendimentos.filter(Boolean) : [],
    financial_authorizations: (autorizacoes || []).filter(Boolean).map((o: any) => ({
      operation_id: o.id, kind: o.kind, amount: Number(o.amount),
      currency: o.currency, expires_at: o.expires_at, components: o.components,
    })),
    display_data: display ?? {},
  });
}

// ── v92: guardrail de preco falado ──────────────────────────────────────────
// Cada ferramenta declara os valores que PODEM ser verbalizados. Qualquer valor
// monetario na resposta que nao esteja na lista derruba a mensagem e vai para retry.
function reaisParaCentavos(txt: string): number {
  const n = txt.replace(/\./g, '').replace(',', '.');
  return Math.round(Number(n) * 100);
}
const RX_MOEDA = /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})|(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s?reais/gi;
function valoresDaMensagem(msg: string): number[] {
  const out: number[] = []; let m: RegExpExecArray | null;
  const rx = new RegExp(RX_MOEDA.source, 'gi');
  while ((m = rx.exec(msg)) !== null) { const bruto = m[1] || m[2]; if (bruto) out.push(reaisParaCentavos(bruto)); }
  return out;
}
// v4.37.3: VOCABULARIO DE PRECO UNITARIO.
// Invariante do proprietario (30/08): preco unitario PODE ser informado ao cliente;
// sozinho, NUNCA e autorizacao financeira do total do pedido.
const RX_PRECO_UNITARIO = /\bcada\b|\ba\s+partir\s+de\b|\b(?:a|por|o)\s+(?:unidade|pe[cç]a|folha|metro)\b|\/\s*un(?:idade)?\b|\bpor\s+un\b/i;
// Frase que CARREGA o valor. Reusa valoresDaMensagem em vez de criar um segundo extrator
// monetario: uma sentenca so conta se ela propria contem aquele centavos. Escopo por frase
// evita que "a partir de" numa frase vizinha contamine um preco fechado legitimo.
// O split exige espaco depois do delimitador, entao "R$ 1.234,56" nao e quebrado no milhar.
function frasesComValor(msg: string, centavos: number): string[] {
  return String(msg || '').split(/\n+|[.!?]+\s+/)
    .filter((f) => valoresDaMensagem(f).includes(centavos));
}

function falhaAutorizacao(display: any) {
  return JSON.stringify({ ok: false, erro: 'autorizacao_nao_emitida', acao: 'Nao consegui registrar o valor. Refaca o calculo.', display_data: display ?? {} });
}

// ══ v4.28.0 P14: OBSERVABILIDADE DE SLOTS + GUARDA DE FERRAMENTA EM SHADOW ══
// Ambas as camadas sao OBSERVACIONAIS. Nenhuma bloqueia, nenhuma altera slots,
// nenhuma muda resposta. Elas so registram o que TERIA acontecido.
//
// MODALIDADE E CONCEITO NOVO E SEPARADO DE PRODUTO, de proposito. O caso sentinela
// (5521979657404, 16/08) provou que o produto macro fica estavel — DTF UV o tempo
// todo — enquanto a modalidade migra de peca para metro. Reaproveitar slots.produto
// para carregar modalidade destruiria essa distincao e ainda mexeria no campo que a
// guarda de preco do Patch A consome. slots.produto NAO e lido para modalidade nem
// escrito por esta camada.
const RX_MODAL_METRO = /\b(por\s+metro|metragem|metros?\b|bobina|folha\s+(com|de)\s+v[áa]rios)/i;
const RX_MODAL_PECA  = /\b(por\s+(pe[çc]a|unidade)|cada\s+(caneca|copo|pe[çc]a)|unidades?\b)/i;
function detectarModalidade(msg: string): { modalidade: string | null; proveniencia: string } {
  const t = String(msg || '');
  const metro = RX_MODAL_METRO.test(t);
  const peca = RX_MODAL_PECA.test(t);
  if (metro && !peca) return { modalidade: 'metro', proveniencia: 'texto_do_cliente_metro' };
  if (peca && !metro) return { modalidade: 'peca', proveniencia: 'texto_do_cliente_peca' };
  if (metro && peca) return { modalidade: null, proveniencia: 'sinais_conflitantes' };
  return { modalidade: null, proveniencia: 'sem_sinal' };
}

// Correcao explicita do cliente. Deterministica: o modelo nao opina.
const CORRECOES: Array<{ tipo: string; rx: RegExp }> = [
  { tipo: 'contraste_adversativo', rx: /\b(mas\s+eu|mas\s+gostaria|na\s+verdade|na\s+real)\b/i },
  { tipo: 'midia_e_apenas_exemplo', rx: /\b(s[óo]\s+(um\s+)?exemplo|apenas\s+um\s+exemplo|para\s+ilustrar|pra\s+ilustrar|peguei\s+na\s+internet)\b/i },
  { tipo: 'negacao_do_entendido',   rx: /\b(n[ãa]o\s+[ée]\s+(isso|bem\s+assim)|nao\s+quero\s+isso)\b/i },
  { tipo: 'preferencia_explicita',  rx: /\b(prefiro|eu\s+queria|gostaria\s+de\s+saber)\b/i },
];
function detectarCorrecoes(msg: string): Array<{ tipo: string }> {
  const t = String(msg || '');
  return CORRECOES.filter((c) => c.rx.test(t)).map((c) => ({ tipo: c.tipo }));
}

function normalizarProdutoMacro(v: any): string | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (!s || s === 'null') return null;
  if (/t[êe]xtil/.test(s) || s === 'dtf_textil') return 'dtf_textil';
  if (/\buv\b/.test(s) || s === 'dtf_uv') return 'dtf_uv';
  if (/copo/.test(s)) return 'copo';
  if (/camiseta|moletom|regata|baby\s?look/.test(s)) return 'camiseta';
  // v4.37.1: 'uv' colado por separador ('adesivo_dtf_uv', 'adesivo_uv', 'dtf_uv_folha_a4')
  // NAO casa \buv\b porque '_' e caractere de palavra. O macro saia null e o produto
  // desaparecia das guardas. Regra ADITIVA e POR ULTIMO de proposito: so alcanca string
  // que a funcao ja resolvia como null, entao nenhum valor hoje classificado troca de
  // familia. O segundo teste preserva o comportamento atual de string multi-produto
  // ('camiseta + adesivo_uv', 'copo_ou_adesivo_uv'): quem decide continua sendo a
  // regra da familia citada, nunca o token 'uv' solto.
  if (/(?:^|[^a-z0-9])uv(?![a-z0-9])/.test(s)
      && !/t[êe]xtil|copo|caneca|garrafa|camiseta|moletom|regata|baby\s?look|polo|jaleco|uniforme|bon[ée]|pack|pano/.test(s)) return 'dtf_uv';
  // v4.37.2: familia DIGITAL 'pack'. Colada por separador ('pack_adesivos', 'pack_animes',
  // 'packs_digitais') ela nao casa \bpacks?\b pelo mesmo motivo do 'uv' na v4.37.1: '_' e
  // caractere de palavra. Sem macro o pack ficava indeterminado e a matriz de ferramenta
  // caia em produto_indeterminado_fail_open. Regra ADITIVA e POR ULTIMO: so alcanca string
  // que a funcao ja resolvia como null, entao nenhum valor hoje classificado troca de
  // familia — pedido misto ('dtf_textil_3m + pack_catolicos_troca_anjos') ja resolveu como
  // dtf_textil nas regras acima e nunca chega aqui.
  if (/(?:^|[^a-z0-9])packs?(?![a-z0-9])/.test(s)) return 'pack';
  return null;
}

// ══ v4.37.0 P0: PROVENIENCIA OBRIGATORIA PARA FATO COMERCIAL ═══════════════
// O modelo PROPOE. So vira FATO com fonte verificavel. Slot critico = o que
// vira pedido, cobranca ou logistica.
// 'arte' NAO entra. MEDIDO em 1.273 turnos: 66 recusas, praticamente todas legitimas.
// Arte nasce de IMAGEM ou AUDIO do cliente ("[imagem]", "[audio]") ou de descricao em
// conversa — coisa que uma checagem de TEXTO nunca consegue lastrear. Gatear arte so
// gera falso positivo, e arte sozinha nao cria pedido errado: quem cria e produto,
// quantidade e modalidade, e esses estao gateados.
const SLOTS_CRITICOS = ['produto', 'quantidade', 'cep', 'pagamento', 'grade'];
// Escritos SO pelo resolvedor deterministico. O modelo nunca escreve modalidade.
const SLOTS_SO_DETERMINISTICOS = ['modalidade_logistica', 'envio_retirada'];

function semAcento(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// O cliente falou ESTE valor? Compara os tokens do valor com o texto do cliente.
// Generico: nao conhece "adesivo" nem "300", so compara palavras.
function valorEcoaNoTexto(valor: any, texto: string): boolean {
  const alvo = semAcento(texto);
  const toks = semAcento(String(valor ?? '')).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!toks.length) return false;
  if (toks.some((t) => t.length >= 4 && alvo.includes(t))) return true;
  return toks.every((t) => alvo.includes(t));
}

// VOCABULARIO UNICO de unidade de mercadoria. Serve as DUAS pontas do contrato:
// a porta de escrita (o que pode virar quantidade) e a guarda de saida (o que pode
// ser afirmado ao cliente). Uma lista so, para as duas nao divergirem.
const NOMES_MERCADORIA = 'un\\b|und\\b|unid\\w*|pe[c\u00e7]as?|camisetas?|baby\\s?looks?|regatas?|moletons?|polos?|jalecos?|uniformes?|adesivos?|copos?|canecas?|garrafas?|itens?|p[c\u00e7]s?|pcs?|folhas?|metros?';
// Numero COM marcador de unidade ao lado. O numero entra por parametro: nao ha
// literal numerico nesta regra.
const RX_EVID_UNIDADE_SUF = '\\s*(?:x\\s*)?(?:' + NOMES_MERCADORIA + ')';
// Verbo de PEDIDO explicito. "mandar"/"enviar" NAO entram: sao verbos de remessa.
// "sao"/"total de" tambem nao entram: "sao 300" costuma ser preco, nao peca.
const RX_EVID_PEDIDO = /\b(?:quero|queria|preciso|vou\s+querer|fech\w+|or[c\u00e7]a\w*|pedido\s+(?:[e\u00e9]|de))\b/i;
// A frase fala de DINHEIRO. Se o numero so aparece aqui, nao e quantidade.
const RX_EVID_DINHEIRO = /(?:r\$|reais|conto|entrada|sinal|adiantamento|dep[o\u00f3]sito|pagar|paguei|pago|pagamento|transfer\w+|\bpix\b|restante|resto|parcel\w+|metade)/i;
// Cliente falou de TAMANHO na janela do pedido.
// v4.37.1: a pergunta de quantidade que o PROPRIO Joao acabou de fazer carrega a
// unidade ('Quantos adesivos de 50x75cm voce precisa?'). O numero puro que responde
// a ela tem proveniencia: unidade na pergunta, valor na resposta do cliente.
const RX_PERGUNTA_QUANTIDADE = /\bquant[oa]s\b[^?]{0,160}\?/i;
const RX_EVID_GRADE = /\b(?:pp|p|m|g|gg|g1|g2|g3|xg|xgg|infantil|tamanh\w+)\b/i;

// O numero proposto como quantidade tem evidencia de UNIDADE na fala do cliente?
// Rejeita quando a unica ocorrencia esta em frase de dinheiro ou de remessa do
// proprio cliente — REUSANDO RX_ENVIO_REMETENTE_CLIENTE da v4.36.0.
function evidenciaDeQuantidade(valor: any, textos: string[]): { ok: boolean; evidencia: string | null } {
  const n = String(valor ?? '').replace(/\D/g, '');
  if (!n) return { ok: false, evidencia: null };
  const rxNum = new RegExp('(?:^|[^\\d])' + n + '(?![\\d])');
  const rxUnidade = new RegExp(n + RX_EVID_UNIDADE_SUF, 'i');
  for (const t of (textos || [])) {
    for (const frase of String(t || '').split(/[.!?\n]+/)) {
      const s = frase.trim();
      if (!s || !rxNum.test(s)) continue;
      // Unidade explicita ao lado do numero DECIDE: "quero 300 camisetas, pago no pix"
      // continua sendo quantidade mesmo falando de pagamento na mesma frase.
      if (rxUnidade.test(s)) return { ok: true, evidencia: s.slice(0, 120) };
      if (RX_ENVIO_REMETENTE_CLIENTE.test(s)) continue;   // "posso enviar 300 agora"
      if (RX_EVID_DINHEIRO.test(s)) continue;             // "entrada de 300", "paguei 300"
      if (RX_EVID_PEDIDO.test(s)) return { ok: true, evidencia: s.slice(0, 120) };
    }
  }
  return { ok: false, evidencia: null };
}

// Familias que a FALA DO CLIENTE admite. Existe para ACEITAR, nunca para recusar:
// so acrescenta caminho de aceitacao, entao nao enfraquece nenhuma guarda.
// MEDIDO: produtoNaMensagem perde sinal legitimo do cliente por vocabulario —
// "camisas" (so conhece "camiseta") e "Eu tenho uma de caneca" (a regra de peca
// propria exige "que tenho"/"ja tenho"). Copo/caneca emitem copo E dtf_uv porque a
// fala e compativel com os dois e quem escolhe entre eles e o modelo.
// normalizarProdutoMacro e produtoNaMensagem seguem INTOCADOS: gating de tool igual.
const FAMILIAS_FALA: Array<[RegExp, string[]]> = [
  [/t[eê]xtil|tecido|malha|pel[ií]cula|filme|prensa/i, ['dtf_textil']],
  [/uv|adesivo|r[oó]tulo|etiqueta|vidro|metal|madeira|mdf|acr[ií]lico/i, ['dtf_uv']],
  [/copo|caneca|garrafa|cuia|t[eé]rmic/i, ['copo', 'dtf_uv']],
  [/camiseta|camisa|blusa|moletom|regata|baby\s?look|polo|jaleco|uniforme|colete|bon[eé]/i, ['camiseta']],
  [/pack|estampas?\s+pronta|anime|streetwear/i, ['pack']],
];
function familiasFaladasPeloCliente(texto: string): string[] {
  const t = semAcento(texto);
  const out: string[] = [];
  for (const [rx, fams] of FAMILIAS_FALA) if (rx.test(t)) out.push(...fams);
  return out;
}

// De onde veio este produto? null = de lugar nenhum verificavel.
function evidenciaDeProduto(valor: any, textos: string[], macroCanonico: string | null, macroAnterior: string | null): { fonte: string | null; macro: string | null } {
  const macro = normalizarProdutoMacro(valor);
  const texto = (textos || []).join(' \n ');
  if (valorEcoaNoTexto(valor, texto)) return { fonte: 'mensagem_cliente', macro };
  // Por FRAGMENTO, nao so pelo texto inteiro: em "nao quero mais camiseta, quero
  // adesivo UV" o texto inteiro resolve para camiseta (a primeira regra que casa) e
  // esconderia a troca que o cliente acabou de declarar.
  if (macro) {
    for (const f of [texto, ...texto.split(/[,;.!?\n]+/)]) {
      const t = f.trim();
      if (t && produtoNaMensagem(t) === macro) return { fonte: 'mensagem_cliente', macro };
    }
  }
  if (macro && familiasFaladasPeloCliente(texto).includes(macro)) return { fonte: 'mensagem_cliente', macro };
  if (macro && macroCanonico && macro === macroCanonico) return { fonte: 'canonico', macro };
  if (macro && macroAnterior && macro === macroAnterior) return { fonte: 'estado_anterior', macro };
  return { fonte: null, macro };
}

// Soma da grade = quantidade derivada de FATO ja aceito. "M 4 / G 7 / GG 3" = 14.
// Sem isto a porta recusaria a quantidade legitima do fluxo de camiseta, em que o
// cliente manda a grade e nunca digita o total.
function somaGrade(grade: any): number | null {
  if (!Array.isArray(grade) || !grade.length) return null;
  let t = 0;
  for (const item of grade) {
    const tam = item?.tamanhos || {};
    for (const k of Object.keys(tam)) { const n = Number(tam[k]); if (Number.isFinite(n) && n > 0) t += n; }
  }
  return t > 0 ? t : null;
}

// A PORTA. Devolve os slots que podem virar fato + a lista do que foi recusado.
function filtrarSlotsPorProveniencia(a: {
  anteriores: any; recebidos: any; textosCliente: string[];
  macroCanonico: string | null; toolsUsadas: string[];
  midiaNoTurno?: boolean; numerosDeFerramenta?: number[];
  perguntaQuantidadePendente?: boolean;
}): { slots: any; rejeitados: Array<{ slot: string; valor: any; motivo: string }> } {
  const rejeitados: Array<{ slot: string; valor: any; motivo: string }> = [];
  const out: any = { ...(a.recebidos || {}) };
  const ant: any = a.anteriores || {};
  const texto = (a.textosCliente || []).join(' \n ');
  const macroAnterior = normalizarProdutoMacro(ant.produto);

  // Modalidade nunca vem do modelo: quem escreve e estadoLog, logo abaixo.
  for (const s of SLOTS_SO_DETERMINISTICOS) {
    if (out[s] !== undefined && String(out[s] ?? '') !== String(ant[s] ?? '')) {
      rejeitados.push({ slot: s, valor: out[s], motivo: 'so_resolvedor_deterministico' });
    }
    delete out[s];
  }

  for (const s of SLOTS_CRITICOS) {
    const v = out[s];
    if (v === undefined || v === null || v === '' || v === 'null') continue;
    // Identico ao que ja era fato: nao e criacao nem mudanca.
    if (ant[s] !== undefined && JSON.stringify(ant[s]) === JSON.stringify(v)) continue;

    let ok = false; let motivo = '';
    if (s === 'produto') {
      // CONTRADICAO, nao ausencia. MEDIDO em 1.273 turnos organicos: exigir evidencia
      // textual para TODO produto recusava 216 deles — quase todos DESCOBERTA legitima
      // no primeiro turno, em que o cliente so escreve "Ola! Posso ter mais informacoes
      // sobre isso?" (clique de anuncio) e o produto vem do ANUNCIO, nao da mensagem.
      // Sem referencia anterior nem canonica nao ha o que contradizer: aceita.
      // Com referencia, ela manda — foi exatamente o caso do Vitor (canonico=camiseta).
      const temReferencia = !!macroAnterior || !!a.macroCanonico;
      ok = !temReferencia || !!evidenciaDeProduto(v, a.textosCliente, a.macroCanonico, macroAnterior).fonte;
      motivo = 'produto_contradiz_referencia';
    } else if (s === 'quantidade') {
      // So numero puro entra na regra. MEDIDO: quantidade tambem chega como TEXTO
      // ("40 coletes (20 amarelo + 20 azul)", "37.86m + 4.56m", "100-200") e ai
      // replace(/\D/g,'') fabricava um numero que nunca existiu. Descricao livre nao
      // e o defeito do Vitor — o dele era um numero puro (300) nascido de dinheiro.
      // A soma da grade ja aceita e fonte legitima: no fluxo de camiseta o cliente
      // manda "M 4 / G 7 / GG 3" e nunca digita o total.
      const ehNumeroPuro = typeof v === 'number' || /^\s*\d{1,6}(?:[.,]\d+)?\s*$/.test(String(v));
      const sg = somaGrade(out.grade ?? ant.grade);
      const nQ = Number(String(v).replace(',', '.'));
      // Numero devolvido por FERRAMENTA neste turno e fonte legitima: no fluxo por
      // metro a metragem sai de calcular_dtf_metro, nunca da fala do cliente.
      const deTool = (a.numerosDeFerramenta || []).some((x) => Number(x) === nQ);
      // v4.37.1: numero puro que RESPONDE a pergunta de quantidade do proprio Joao tem
      // proveniencia — a unidade esta na pergunta e o cliente devolveu so o numero.
      // Exige as duas pontas: pergunta 'quantos/quantas ...?' no turno anterior do Joao
      // E uma mensagem do cliente que e SO esse numero. Nao reabre o caso Vitor, em que
      // o 300 nasceu dentro de frase de dinheiro, nunca como mensagem isolada.
      const respondeuPerguntaDeQuantidade = a.perguntaQuantidadePendente === true
        && (a.textosCliente || []).some((t) => {
          const so = String(t ?? '').trim();
          return /^\d{1,6}$/.test(so) && Number(so) === nQ;
        });
      ok = !ehNumeroPuro
        || evidenciaDeQuantidade(v, a.textosCliente).ok
        || (sg !== null && nQ === sg)
        || deTool
        || respondeuPerguntaDeQuantidade;
      motivo = 'quantidade_sem_evidencia_de_unidade';
    } else if (s === 'cep') {
      const d = String(v).replace(/\D/g, '');
      ok = d.length === 8 && texto.replace(/\D/g, '').includes(d);
      motivo = 'cep_nao_dito_pelo_cliente';
    } else if (s === 'arte') {
      // Arte quase sempre nasce de IMAGEM ou AUDIO que o cliente mandou — coisa que
      // uma checagem textual nunca ve. MEDIDO: exigir eco recusava refinamento
      // legitimo ("dois designs - frente e costas" -> o mesmo + nome da igreja).
      // Aceita eco, refinamento do valor anterior, ou midia no turno.
      const antAr = String(ant.arte ?? '');
      const novoAr = String(v ?? '');
      const refino = !!antAr && (semAcento(novoAr).includes(semAcento(antAr)) || semAcento(antAr).includes(semAcento(novoAr)));
      ok = valorEcoaNoTexto(v, texto) || refino || a.midiaNoTurno === true;
      motivo = 'arte_sem_evidencia';
    } else if (s === 'pagamento') {
      ok = valorEcoaNoTexto(v, texto) || a.midiaNoTurno === true
        || (a.toolsUsadas || []).some((t) => /pix|cobranca|pagamento|cartao/i.test(String(t)));
      motivo = 'pagamento_sem_evidencia';
    } else if (s === 'grade') {
      // So bloqueia o caso destrutivo: trocar grade JA CONHECIDA sem o cliente
      // ter falado de tamanho nenhum na janela do pedido.
      const jaTinha = Array.isArray(ant.grade) && ant.grade.length > 0;
      ok = !jaTinha || RX_EVID_GRADE.test(texto);
      motivo = 'grade_trocada_sem_o_cliente_falar_de_tamanho';
    }
    if (!ok) { rejeitados.push({ slot: s, valor: v, motivo }); delete out[s]; }
  }
  return { slots: out, rejeitados };
}

// MATRIZ produto x modalidade x ferramenta. produtos/modalidades = null significa transversal.
const MATRIZ_TOOL: Record<string, { produtos: string[] | null; modalidades: string[] | null }> = {
  calcular_rendimento_uv: { produtos: ['dtf_uv'], modalidades: null },
  calcular_dtf_uv_metro:  { produtos: ['dtf_uv'], modalidades: ['metro'] },
  calcular_dtf_por_arte:  { produtos: ['dtf_textil'], modalidades: null },
  calcular_dtf_metro:     { produtos: ['dtf_textil'], modalidades: ['metro'] },
  calcular_copo:          { produtos: ['copo'], modalidades: null },
  orcar_camisetas:        { produtos: ['camiseta'], modalidades: null },
  consultar_modelos:      { produtos: ['camiseta'], modalidades: null },
  consultar_tabela_dtf:   { produtos: null, modalidades: null },
  consultar_catalogo:     { produtos: null, modalidades: null },
  calcular_frete:         { produtos: null, modalidades: null },
  compor_total:           { produtos: null, modalidades: null },
  gerar_pix:              { produtos: null, modalidades: null },
};
// FAIL-OPEN DELIBERADO NESTA FASE: sem produto conhecido a guarda NAO acusa incompatibilidade.
// Em shadow um falso positivo poluiria a medicao; e o objetivo agora e justamente medir.
function avaliarCompatibilidadeTool(tool: string, produto: string | null, modalidade: string | null): { permitida: boolean; motivo: string } {
  const regra = MATRIZ_TOOL[tool];
  if (!regra) return { permitida: true, motivo: 'ferramenta_nao_mapeada' };
  if (regra.produtos === null) return { permitida: true, motivo: 'ferramenta_transversal' };
  if (!produto) return { permitida: true, motivo: 'produto_indeterminado_fail_open' };
  if (!regra.produtos.includes(produto)) {
    return { permitida: false, motivo: `produto_${produto}_incompativel_com_${tool}` };
  }
  if (regra.modalidades && modalidade && !regra.modalidades.includes(modalidade)) {
    return { permitida: false, motivo: `modalidade_${modalidade}_incompativel_com_${tool}` };
  }
  return { permitida: true, motivo: 'compativel' };
}

// ── v4.29.0 P15: SINAIS DE FRETE/CEP POR TURNO (observacional) ────────────
// Vive na CAMADA 1 de proposito: ela grava por TURNO, inclusive com tools:[].
// A camada 2 (guarda de ferramenta) roda DENTRO do laco de tools e por isso e
// cega para "a ferramenta deveria ter sido chamada e nao foi" — medido: 19 turnos
// observados, apenas 3 com linha de guarda.
// Objetivo: separar organicamente quatro situacoes, sem agir sobre nenhuma delas.
const RX_FRETE_PALAVRA = /\b(frete|sedex|pac)\b/i;
// Valor monetario ADJACENTE a palavra de frete (ate 40 chars, nos dois sentidos).
// Medido em 30 dias: o criterio amplo ("envio|entrega|correios") casou 604 turnos e
// este casou 197 — 3x mais preciso, sem perder os 93 casos saudaveis conhecidos.
const RX_VALOR_FRETE = /R\$\s?\d[\s\S]{0,40}?\b(frete|sedex|pac)\b|\b(frete|sedex|pac)\b[\s\S]{0,40}?R\$\s?\d/i;
const RX_CEP = /\b\d{5}-?\d{3}\b/;
const RX_PEDE_CEP = /(qual|me\s+passa|me\s+manda|informe)[\s\S]{0,20}cep/i;

function sinaisFreteDoTurno(
  resposta: string, inbounds: any[], slots: any, tools: string[], autorizacoes: any[]
): {
  mencionou_frete: boolean; afirma_valor_frete: boolean; cep_disponivel: boolean;
  cep_detectado: string | null; chamou_calcular_frete: boolean;
  frete_operation_id: string | null; pediu_cep: boolean; situacao_frete: string;
} {
  const t = String(resposta || '');
  const mencionou = RX_FRETE_PALAVRA.test(t);
  const afirmaValor = RX_VALOR_FRETE.test(t);
  const pediuCep = RX_PEDE_CEP.test(t);
  // CEP "disponivel" = o que o Joao REALMENTE tinha: as inbound carregadas + slot.
  let cep: string | null = slots?.cep ? String(slots.cep) : null;
  if (!cep) {
    for (const i of (inbounds || [])) {
      const m = String(i?.message_text || '').match(RX_CEP);
      if (m) { cep = m[0]; break; }
    }
  }
  const chamou = (tools || []).includes('calcular_frete');
  const opFrete = (autorizacoes || []).find((a: any) => a?.kind === 'frete');
  const situacao =
      (afirmaValor && !!cep && chamou)   ? 'saudavel'
    : (afirmaValor && !!cep && !chamou)  ? 'oportunidade_perdida'
    : (afirmaValor && !cep && !chamou)   ? 'risco_inventado'
    : (pediuCep && !!cep)                ? 'contexto_ignorado'
    :                                      'nao_aplicavel';
  return {
    mencionou_frete: mencionou, afirma_valor_frete: afirmaValor,
    cep_disponivel: !!cep, cep_detectado: cep,
    chamou_calcular_frete: chamou,
    frete_operation_id: opFrete?.operation_id ? String(opFrete.operation_id) : null,
    pediu_cep: pediuCep, situacao_frete: situacao,
  };
}

// Escritores observacionais. NUNCA lancam: falha aqui nao pode derrubar atendimento.
async function registrarGuardaToolShadow(row: any) {
  try { await sb.from('joao_tool_guard_shadow').insert(row); }
  catch (e: any) { L('shadow_tool_guard_falhou', { erro: String(e?.message ?? e).slice(0, 120) }); }
}
async function registrarObservacaoSlots(row: any) {
  try { await sb.from('joao_slots_observacao').insert(row); }
  catch (e: any) { L('shadow_slots_obs_falhou', { erro: String(e?.message ?? e).slice(0, 120) }); }
}

async function executarTool(name: string, input: any, ctx: { leadId: string | null; autorizacoes: any[]; cobrancaPendente: any | null; permiteMudanca: boolean; freteJa: any | null; arteParaCalculo?: { largura_cm: number; altura_cm: number; copias: number } | null; phone?: string; pixGerado?: any; holdArte?: boolean; modalidadeLogistica?: ModalidadeLogistica; produtoDigital?: boolean }): Promise<string> {
  try {
    if (name === 'consultar_catalogo') {
      const termo = String(input?.termo || '').toLowerCase().trim();
      if (!termo) return JSON.stringify({ encontrado: false });
      const { data } = await sb.from('catalogo_produtos').select('nome, preco_1un, preco_10un, orcamento_por_agente, instrucao_agente, frases_interesse').eq('status', 'ativo');
      const matches = (data || []).filter((p: any) => { const fr: string[] = p.frases_interesse || []; return p.nome.toLowerCase().includes(termo) || fr.some((f) => termo.includes(f.toLowerCase()) || f.toLowerCase().includes(termo)); }).map((p: any) => ({ produto: p.nome, pode_orcar: p.orcamento_por_agente === true, preco_1un: p.preco_1un, preco_10un: p.preco_10un, instrucao: p.instrucao_agente }));
      if (matches.length === 0) return JSON.stringify({ encontrado: false, acao: 'NAO ORCE. Colete detalhes e diga que a equipe monta o orcamento no proximo dia util.' });
      return JSON.stringify({ encontrado: true, produtos: matches });
    }
    if (name === 'calcular_copo') {
      const q = Math.max(1, parseInt(String(input?.quantidade)) || 1);
      const ehLiso = input?.liso === true;
      const pu = ehLiso ? (q >= 10 ? 14.90 : 19.90) : (q >= 10 ? 29.90 : 35.90);
      const total = Math.round(q * pu * 100) / 100;
      const dsp = {
        tipo: ehLiso ? 'copo_liso' : 'copo_personalizado',
        quantidade: q,
        preco_unitario: pu,
        aviso: 'Este e o preco do COPO que a Skillprint vende. Se o cliente ja tem o copo e quer so o adesivo, use calcular_rendimento_uv.',
      };
      const op = await emitirAutorizacao(ctx.leadId, 'produto', total, 'calcular_copo', { quantidade: q, preco_unitario: pu, liso: ehLiso });
      if (!op) return falhaAutorizacao(dsp);
      return envelope([op], dsp);
    }
    if (name === 'consultar_tabela_dtf') {
      // v89 DELTA B+C: handler restaurado (sumiu na v84) e alinhado a escada oficial.
      // Nao reimplementa preco: le degraus e faixas das tabelas. Nenhum numero fixo aqui.
      const prod = String(input?.produto || '').trim() === 'dtf_uv' ? 'dtf_uv' : 'dtf_textil';
      const { data: fx } = await sb.from('dtf_precos_faixa').select('metros_min, metros_max, preco_por_metro').eq('produto', prod).order('metros_min');
      if (!fx || fx.length === 0) return JSON.stringify({ ok: false, erro: 'tabela_indisponivel' });

      if (prod === 'dtf_textil') {
        return JSON.stringify({ ok: true, financial_authorizations: [], display_data: {
          produto: 'dtf_textil',
          faixas: fx.map((f: any) => ({ faixa: f.metros_max !== null ? `${Number(f.metros_min)} a ${Number(f.metros_max)} metros` : `acima de ${Number(f.metros_min)} metros`, preco_por_metro: Number(f.preco_por_metro).toFixed(2) })),
          referencia: '1 metro rende em media 6 estampas A4 ou 3 A3',
          instrucao: 'MANDE A TABELA AGORA, uma faixa por linha.' } });
      }

      const { data: dg } = await sb.from('dtf_uv_degraus').select('codigo, ordem, consumo_max_m, modalidade, preco_fixo, base_excedente_codigo').eq('ativo', true).order('ordem');
      if (!dg || dg.length === 0) return JSON.stringify({ ok: false, erro: 'degraus_indisponiveis' });
      const folhas = dg.filter((d: any) => d.modalidade === 'folha').map((d: any) => ({ codigo: d.codigo, consumo_max_m: Number(d.consumo_max_m), preco: Number(d.preco_fixo) }));
      const exc = dg.find((d: any) => d.modalidade === 'excedente');
      const base = exc ? dg.find((d: any) => d.codigo === exc.base_excedente_codigo) : null;
      // ── v4.21.7 (09/08/2026): TAXA MARGINAL REAL NO EXCEDENTE ──────────────────
      // DEFEITO CORRIGIDO AQUI: preco_excedente_por_m anunciava o preco da PRIMEIRA FAIXA
      // POR METRO (R$99), que e o preco do METRO CHEIO, nao a taxa do trecho excedente.
      // O sistema COBRA pela taxa MARGINAL: 0,8m = R$39 + 0,3 x R$120 = R$75. O Joao dizia
      // "excedente a R$99/m" e o Pix vinha diferente. MEDIDO no corpus: 5 clientes ouviram
      // o numero errado entre 02/08 e 09/08 (o ultimo no proprio dia da correcao).
      // A formula abaixo NAO e nova: e a MESMA de fn_precos_verbalizaveis_uv, a fonte
      // canonica corrigida no mesmo pacote, replicada campo a campo:
      //   taxa = (preco_por_metro da faixa que contem 1m - preco_fixo da base) / (1 - consumo_max da base)
      // Config vigente: (99 - 39) / (1 - 0,5) = 120.
      // FAIL-CLOSED: sem faixa unica em 1m, sem divisor positivo ou com taxa nao positiva,
      // o bloco excedente sai null e o agente nao anuncia excedente nenhum. Omitir e melhor
      // que anunciar preco que a cobranca nao vai honrar.
      // NADA MAIS FOI TOCADO: Pix, cobranca, guardrails, autorizacoes e fluxo de venda
      // intactos. Rollback: version 119.
      const faixasEm1m = fx.filter((f: any) =>
        1 >= Number(f.metros_min) && (f.metros_max === null || 1 <= Number(f.metros_max)));
      let excedente: any = null;
      if (exc && base && faixasEm1m.length === 1) {
        const baseConsumo = Number(base.consumo_max_m);
        const basePreco = Number(base.preco_fixo);
        const divisor = 1 - baseConsumo;
        if (divisor > 0 && basePreco > 0) {
          const taxaMarginal = (Number(faixasEm1m[0].preco_por_metro) - basePreco) / divisor;
          if (taxaMarginal > 0 && isFinite(taxaMarginal)) {
            excedente = {
              consumo_de_m: baseConsumo, consumo_ate_m: Number(exc.consumo_max_m),
              preco_base: basePreco, preco_excedente_por_m: Math.round(taxaMarginal * 100) / 100 };
          }
        }
      }
      // Acima de 1 metro a faixa e escolhida pelo INTEIRO dos metros, retroativa.
      const faixasMetro = fx.map((f: any, i: number) => ({
        de_m: Number(f.metros_min) < 1 ? 1 : Math.ceil(Number(f.metros_min)),
        ate_m: f.metros_max === null ? null : Math.floor(Number(f.metros_max)) + 0.99,
        preco_por_m: Number(f.preco_por_metro) }));
      return JSON.stringify({ ok: true, financial_authorizations: [], display_data: {
        produto: 'dtf_uv', folhas, excedente, faixas_metro: faixasMetro,
        regra_faixa: 'acima de 1 metro a faixa e escolhida pelo numero INTEIRO de metros e vale para todo o consumo',
        instrucao: 'MANDE AGORA: folha A4, folha A3, a regra acima do A3 e a tabela por metro. Uma linha para cada.' } });
    }
    if (name === 'calcular_dtf_por_arte') {
      const larg = Number(input?.largura_cm) || 0, alt = Number(input?.altura_cm) || 0, cop = Math.max(1, parseInt(String(input?.copias)) || 1);
      if (larg <= 0 || alt <= 0 || larg > 100 || alt > 200) return JSON.stringify({ ok: false, erro: 'medidas_invalidas' });
      const { data: cfgs } = await sb.from('dtf_produto_config').select('*').eq('produto', 'dtf_textil');
      const cfg = cfgs?.[0];
      if (!cfg) return JSON.stringify({ ok: false, erro: 'config_ausente' });
      const util = Number(cfg.largura_max_cm) || 57; const mg = Number(cfg.margem_seguranca) || 0.05;
      if (larg > util) return JSON.stringify({ ok: false, erro: 'arte_mais_larga_que_o_filme', display_data: { largura_maxima_cm: util } });
      const porLinha = Math.max(1, Math.floor((util + mg) / (larg + mg)));
      const linhas = Math.ceil(cop / porLinha);
      const arred = Number(cfg.arredondamento_m) || 0.1; const minM = Number(cfg.minimo_metros) || 1;
      const metrosNecessarios = (linhas * (alt + mg)) / 100;
      let metros = Math.max(minM, Math.ceil(metrosNecessarios / arred) * arred);
      metros = Math.round(metros * 100) / 100;
      const { data: fx } = await sb.from('dtf_precos_faixa').select('*').eq('produto', 'dtf_textil').order('metros_min');
      let f = (fx || []).find((x: any) => metros >= Number(x.metros_min) && (x.metros_max === null || metros <= Number(x.metros_max)));
      if (!f) f = (fx || []).find((x: any) => Number(x.metros_min) > metros) || (fx || [])[(fx || []).length - 1];
      if (!f) return JSON.stringify({ ok: false, erro: 'faixa_nao_encontrada' });
      const pm = Number(f.preco_por_metro); const total = Math.round(metros * pm * 100) / 100;
      const cobradoMinimo = metrosNecessarios < minM;
      const copiasSemAumentar = porLinha * Math.max(1, Math.floor(((metros * 100) + mg) / (alt + mg)));
      const dsp = {
        produto: 'dtf_textil', arte: `${larg}x${alt}cm`, copias: cop, cabem_por_linha: porLinha,
        metros_necessarios: Math.round(metrosNecessarios * 100) / 100, metros, minimo_metros: minM,
        cobrado_minimo: cobradoMinimo, copias_sem_aumentar_valor: copiasSemAumentar,
        preco_por_metro: pm, valor_total: total, valor_por_copia: Math.round((total / cop) * 100) / 100,
        instrucao: cobradoMinimo
          ? `A quantidade ocupa menos de ${minM} metro, mas o pedido minimo e ${minM} metro. Explique isso claramente. Incentive o cliente a manter ou levar ate ${copiasSemAumentar} copias, porque o valor do DTF nao aumenta. NAO cobre fracao abaixo do minimo.`
          : 'Apresente a metragem e o valor calculados.'
      };
      const op = await emitirAutorizacao(ctx.leadId, 'produto', total, 'calcular_dtf_por_arte', { metros, preco_por_metro: pm, copias: cop, arte_cm: `${larg}x${alt}` });
      if (!op) return falhaAutorizacao(dsp);
      return envelope([op], dsp);
    }
    if (name === 'calcular_dtf_metro') {
      if (ctx.arteParaCalculo) {
        await logErro('guardrail_dtf_metro_com_arte', {
          phone: ctx.phone || null, input,
          largura_cm: ctx.arteParaCalculo.largura_cm,
          altura_cm: ctx.arteParaCalculo.altura_cm,
          copias: ctx.arteParaCalculo.copias
        });
        return JSON.stringify({
          ok: false, erro: 'ferramenta_incorreta_para_arte',
          ferramenta_obrigatoria: 'calcular_dtf_por_arte',
          argumentos_obrigatorios: ctx.arteParaCalculo,
          acao: 'Chame calcular_dtf_por_arte agora. Nao calcule nem cobre fracao de metro.'
        });
      }
      const m = Math.max(0.1, Number(input?.metros) || 1);
      const { data } = await sb.from('dtf_precos_faixa').select('*').eq('produto', 'dtf_textil').order('metros_min');
      let f = (data || []).find((x: any) => m >= Number(x.metros_min) && (x.metros_max === null || m <= Number(x.metros_max)));
      if (!f) f = (data || []).find((x: any) => Number(x.metros_min) > m) || (data || [])[(data || []).length - 1];
      if (!f) return JSON.stringify({ ok: false, erro: 'faixa_nao_encontrada' });
      const pm = Number(f.preco_por_metro);
      const total = Math.round(m * pm * 100) / 100;
      const dsp = { produto: 'dtf_textil', metros: m, preco_por_metro: pm };
      const op = await emitirAutorizacao(ctx.leadId, 'produto', total, 'calcular_dtf_metro', { metros: m, preco_por_metro: pm });
      if (!op) return falhaAutorizacao(dsp);
      return envelope([op], dsp);
    }
    if (name === 'calcular_dtf_uv_metro') {
      // v89: preco do UV vem da RPC oficial fn_precificar_dtf_uv. Nenhuma regra aqui.
      const m = Number(input?.metros);
      const { data: d, error: e } = await sb.rpc('fn_precificar_dtf_uv_v2', { p_payload: { origem: 'metros_diretos', consumo_m: m } });
      if (e || !d) { await logErro('rpc_uv_falhou', { tool: name, erro: String(e?.message || 'sem retorno').slice(0, 150) }); return JSON.stringify({ ok: false, erro: 'preco_indisponivel', acao: 'Nao consegui calcular. Colete os dados e escale.' }); }
      if (d.ok !== true) return JSON.stringify({ ok: false, erro: d.erro, acao: 'Explique so o que falta. NAO invente preco.' });
      const dsp = { produto: 'dtf_uv', consumo_m: d.consumo_m, unidade_cobranca: d.unidade_cobranca, degrau: d.degrau, precos_verbalizaveis: d.precos_verbalizaveis };
      const op = await emitirAutorizacao(ctx.leadId, 'produto', Number(d.preco_total), 'calcular_dtf_uv_metro', { consumo_m: d.consumo_m, degrau: d.degrau, faixa_id: d.faixa_id });
      if (!op) return falhaAutorizacao(dsp);
      return envelope([op], dsp);
    }
    if (name === 'calcular_rendimento_uv') {
      // v89: rendimento e preco vem da RPC oficial. A RPC escolhe a orientacao de menor consumo.
      // v4.32.0 P1: a RPC de PRECO escolhe a orientacao que minimiza o consumo DA QUANTIDADE PEDIDA,
      // nao a que maximiza a capacidade de um metro inteiro (5x6: qtd=1 -> 72, qtd=10 -> 75;
      // 6x8: qtd=1 -> 45, qtd=10 -> 48). Ela NAO e fonte de "quantos cabem em um metro".
      // Capacidade por metro vem SEMPRE de fn_dtf_uv_capacidade_folha, deterministica e independente
      // da quantidade. Proibido inventar quantidade sintetica para arrancar capacidade da RPC de preco.
      const larg = Number(input?.largura_cm), alt = Number(input?.altura_cm);
      const qtd = parseInt(String(input?.quantidade_desejada || 0)) || 0;
      const capacidadeCanonicaUV = async (): Promise<{ cabem_por_metro: number; orientacao: string | null; formato: string | null } | null> => {
        const { data: dc, error: ec } = await sb.rpc('fn_dtf_uv_capacidade_folha', { p_largura_cm: larg, p_altura_cm: alt, p_quantidade: qtd > 0 ? qtd : 1 });
        if (ec || !dc || dc.ok !== true) { await logErro('rpc_capacidade_uv_falhou', { tool: name, erro: String(ec?.message || dc?.erro || 'sem retorno').slice(0, 150) }); return null; }
        const cpm = Number(dc?.metro?.cabem_por_metro);
        if (!Number.isInteger(cpm) || cpm <= 0) return null;
        return { cabem_por_metro: cpm, orientacao: dc?.metro?.orientacao ?? null, formato: dc?.metro?.formato ?? null };
      };
      // MODO 1: pergunta de CAPACIDADE pura. Responde o rendimento e nao toca em dinheiro.
      if (qtd <= 0) {
        const cap = await capacidadeCanonicaUV();
        if (!cap) return JSON.stringify({ ok: false, erro: 'capacidade_indisponivel', acao: 'Nao consegui calcular o rendimento. NAO invente numero: colete os dados e escale.' });
        const dspCap = {
          produto: 'dtf_uv', modo: 'capacidade_por_metro',
          adesivo_cm: `${larg}x${alt}`, largura_cm: larg, altura_cm: alt,
          formato_metro: cap.formato, cabem_por_metro: cap.cabem_por_metro, orientacao: cap.orientacao,
          fonte: 'fn_dtf_uv_capacidade_folha',
          instrucao: `Em 1 metro de DTF UV (largura util 28cm) cabem EXATAMENTE ${cap.cabem_por_metro} adesivos de ${larg}x${alt}cm. Verbalize ESTE numero exato, sem arredondar, sem estimar e sem faixa do tipo "9 a 10". NAO fale de preco aqui e NAO exija quantidade para responder a capacidade.`
        };
        return envelope([], dspCap, [{ tool: 'calcular_rendimento_uv', largura_cm: larg, altura_cm: alt, cabem_por_metro: cap.cabem_por_metro, fonte: 'fn_dtf_uv_capacidade_folha' }]);
      }
      const { data: d, error: e } = await sb.rpc('fn_precificar_dtf_uv_v2', { p_payload: { origem: 'rendimento_adesivos', quantidade: qtd, largura_cm: larg, altura_cm: alt } });
      if (e || !d) { await logErro('rpc_uv_falhou', { tool: name, erro: String(e?.message || 'sem retorno').slice(0, 150) }); return JSON.stringify({ ok: false, erro: 'preco_indisponivel', acao: 'Nao consegui calcular. Colete os dados e escale.' }); }
      if (d.ok !== true) return JSON.stringify({ ok: false, erro: d.erro, display_data: d, acao: 'Explique so o que falta. NAO invente preco.' });
      const total = Number(d.preco_total);
      const porUnidade = Math.round((total / qtd) * 100) / 100;
      const sobra = Number(d.display?.cabem_ainda_no_material ?? 0);
      // v4.32.0 P1: preco, consumo, degrau e unidade continuam vindo de fn_precificar_dtf_uv_v2,
      // intocada. SO a propriedade semantica "quantos cabem por metro" passa a vir da fonte
      // canonica, para deixar de variar por causa da quantidade pedida.
      const capM2 = await capacidadeCanonicaUV();
      const cabemPorMetro = capM2 ? capM2.cabem_por_metro : d.display?.cabem_por_metro;
      const dsp: any = {
        produto: 'dtf_uv', adesivo_cm: `${larg}x${alt}`, quantidade_desejada: qtd,
        consumo_m: d.consumo_m, degrau: d.degrau, unidade_cobranca: d.unidade_cobranca,
        valor_por_adesivo: porUnidade, cabem_por_metro: cabemPorMetro,
        cabem_ainda_no_material: sobra,
        instrucao: `FECHE AGORA: ${qtd} adesivos de ${larg}x${alt}cm ocupam ${d.consumo_m} metro(s) do filme e saem por R$${total.toFixed(2).replace('.', ',')}, dando R$${porUnidade.toFixed(2).replace('.', ',')} por adesivo.${sobra > 0 ? ` Ainda cabem ${sobra} adesivos no mesmo material: ele pode levar mais sem pagar filme extra.` : ''}`
      };
      dsp.precos_verbalizaveis = (d.precos_verbalizaveis || []).concat([{ tipo: 'valor_por_adesivo', centavos: Math.round(porUnidade*100) }]);
      const op = await emitirAutorizacao(ctx.leadId, 'produto', total, 'calcular_rendimento_uv', { consumo_m: d.consumo_m, degrau: d.degrau, quantidade: qtd, adesivo_cm: `${larg}x${alt}` });
      if (!op) return falhaAutorizacao(dsp);
      return envelope([op], dsp, capM2 ? [{ tool: 'calcular_rendimento_uv', largura_cm: larg, altura_cm: alt, cabem_por_metro: capM2.cabem_por_metro, fonte: 'fn_dtf_uv_capacidade_folha' }] : []);
    }
    if (name === 'consultar_modelos') {
      if (!ERP_URL || !ERP_SERVICE_KEY) { await logErro('erp_sem_credencial', { tool: name }); return JSON.stringify({ ok: false, erro: 'catalogo_indisponivel' }); }
      try {
        const r = await fetch(`${ERP_URL}/rest/v1/rpc/fn_listar_modelos_disponiveis`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}` },
          body: JSON.stringify({ p_termo: input?.termo ?? null }), signal: AbortSignal.timeout(12000) });
        if (!r.ok) { await logErro('erp_http_erro', { tool: name, status: r.status }); return JSON.stringify({ ok: false, erro: 'catalogo_indisponivel' }); }
        const d = await r.json();
        return JSON.stringify({ ok: true, financial_authorizations: [], display_data: { ...d, instrucao: 'Esta e a lista OFICIAL. Nao acrescente modelo que nao esteja aqui.' } });
      } catch (e: any) { await logErro('erp_excecao', { tool: name, e: String(e).slice(0, 120) }); return JSON.stringify({ ok: false, erro: 'catalogo_indisponivel' }); }
    }
    if (name === 'orcar_camisetas') {
      if (!ERP_URL || !ERP_SERVICE_KEY) {
        await logErro('erp_sem_credencial', {});
        return JSON.stringify({ erro: 'orcamento_indisponivel', acao: 'Colete os dados e diga que a equipe confirma o valor.' });
      }
      const itens = Array.isArray(input?.itens) ? input.itens : [];
      const estampas = Array.isArray(input?.estampas) ? input.estampas : [];
      if (itens.length === 0 || estampas.length === 0) return JSON.stringify({ erro: 'payload_incompleto', acao: 'Preciso dos itens com grade e de pelo menos uma estampa com posicao e classe.' });
      try {
        const r = await fetch(`${ERP_URL}/rest/v1/rpc/fn_orcar_camisetas_agente`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}` },
          body: JSON.stringify({ p_payload: { itens, estampas } }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          await logErro('erp_http_erro', { status: r.status, corpo: (await r.text()).slice(0, 200) });
          return JSON.stringify({ erro: 'orcamento_indisponivel', acao: 'Colete os dados e diga que a equipe confirma o valor.' });
        }
        const d = await r.json();
        if (d?.ok !== true) return JSON.stringify({ erro: 'orcamento_bloqueado', bloqueios: d?.bloqueios || [], acao: 'Explique ao cliente APENAS o dado que falta ou a regra comercial. Nao invente preco.' });
        const total = Math.round(Number(d.total_oficial) * 100) / 100;
        const dsp = {
          total,
          quantidade_total: d.quantidade_total,
          linhas: (d.linhas || []).map((l: any) => ({ produto: l.produto, quantidade: l.quantidade, preco_unitario: Number(l.preco_unitario), subtotal: Number(l.subtotal) })),
          instrucao: 'Apresente o valor por peca e o total. NAO fale de margem, classe de estampa nem centimetros com o cliente.'
        };
        const op = await emitirAutorizacao(ctx.leadId, 'produto', total, 'orcar_camisetas', { quantidade_total: d.quantidade_total, itens, estampas });
        if (!op) return falhaAutorizacao(dsp);
        return envelope([op], dsp);
      } catch (e: any) {
        await logErro('erp_excecao', { e: String(e).slice(0, 150) });
        return JSON.stringify({ erro: 'orcamento_indisponivel', acao: 'Colete os dados e diga que a equipe confirma o valor.' });
      }
    }
    if (name === 'calcular_frete') {
      if (ctx.freteJa && !ctx.permiteMudanca) return JSON.stringify({ ok: true, financial_authorizations: [], display_data: { ja_calculado: true, servico: ctx.freteJa.servico_frete, preco: `R$${Number(ctx.freteJa.valor_frete).toFixed(2)}`, cep: ctx.freteJa.cep_destino, acao: 'Frete ja calculado. NAO recalcule.' } });
      const cep = String(input?.cep_destino || '').replace(/\D/g, '');
      if (cep.length !== 8) return JSON.stringify({ ok: false, erro: 'cep_invalido', acao: 'O CEP precisa ter 8 digitos. Peca o CEP completo.' });
      const r = await fetch(`${SUPABASE_URL}/functions/v1/calcular-frete`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, body: JSON.stringify({ cep_destino: cep, metros: 1, valor_declarado: 60 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (!(d?.ok && Array.isArray(d.opcoes) && d.opcoes.length > 0)) return JSON.stringify({ ok: false, erro: 'sem_opcoes' });
      const opcoes = d.opcoes.map((o: any) => ({ servico: o.servico, preco: o.preco_formatado, prazo: o.prazo_formatado }));
      const sedex = d.opcoes.find((o: any) => String(o.servico || '').toLowerCase().includes('sedex'));
      const melhor = sedex || [...d.opcoes].sort((a: any, b: any) => Number(a.preco) - Number(b.preco))[0];
      const dsp = { opcoes, servico_recomendado: melhor.servico, cep, instrucao: 'MANDE AS OPCOES AGORA com preco, prazo e TOTAL. Se o Sedex for mais barato que o PAC, recomende o Sedex.' };
      const opF = await emitirAutorizacao(ctx.leadId, 'frete', Math.round(Number(melhor.preco) * 100) / 100, 'calcular_frete', { servico: melhor.servico, cep });
      if (!opF) return falhaAutorizacao(dsp);
      return envelope([opF], dsp);
    }
    if (name === 'compor_total') {
      const ids: string[] = Array.isArray(input?.operation_ids) ? input.operation_ids : [];
      if (!ctx.leadId || ids.length < 2) return JSON.stringify({ ok: false, erro: 'composicao_invalida', acao: 'Informe pelo menos dois operation_id.' });
      const { data, error } = await sb.rpc('fn_compor_total', { p_lead_id: ctx.leadId, p_operation_ids: ids, p_ttl_minutos: 30 });
      if (error || !data) { await logErro('composicao_recusada', { ids, erro: String(error?.message || '').slice(0, 150) }); return JSON.stringify({ ok: false, erro: 'composicao_recusada', acao: 'Recalcule produto e frete e componha de novo.' }); }
      return envelope([data], { total: Number(data.amount) });
    }
    if (name === 'gerar_pix') {
      const operationId = String(input?.operation_id || '').trim();
      if (!operationId) return JSON.stringify({ ok: false, erro: 'operation_id_ausente', acao: 'Chame a ferramenta de calculo e use o operation_id que ela devolver.' });
      // v4.33.0 P0: o cliente condicionou o pagamento a aprovar a arte NESTE turno.
      if (ctx.holdArte === true) {
        await logErro('gerar_pix_suspenso_hold_arte', { lead: ctx.leadId });
        return JSON.stringify({ ok: false, erro: 'aguardando_aprovacao_da_arte', acao: 'O cliente disse que so finaliza o pagamento depois de ver a arte. NAO gere cobranca agora e NAO escreva Pix, chave, codigo nem link. Confirme que a arte vem primeiro para aprovacao e que a cobranca sai logo apos o aceite dele.' });
      }
      // v4.21.1: id INVENTADO tem tratamento proprio. Antes caia no erro generico
      // 'autorizacao_invalida' com a instrucao "recalcule", que nao ajuda: ele recalculava,
      // recebia um id novo, e inventava outro. 10 de 10 falhas em 14 dias eram isto.
      const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!EH_UUID.test(operationId)) {
        await logErro('operation_id_inventado', { operationId: operationId.slice(0, 80), lead: ctx.leadId });
        return JSON.stringify({ ok: false, erro: 'operation_id_inventado',
          acao: 'Esse identificador nao existe: voce montou um texto em vez de usar o codigo real. O operation_id e um UUID com 36 caracteres, no formato 8-4-4-4-12. Ele esta no bloco AUTORIZACOES ATIVAS do seu contexto, ou no financial_authorizations que a ferramenta de calculo devolveu. Copie EXATAMENTE. Se nao houver nenhum, chame a ferramenta de calculo primeiro.' });
      }
      if (input?.valor_total !== undefined || input?.valor !== undefined || input?.amount !== undefined) {
        return JSON.stringify({ ok: false, erro: 'valor_livre_recusado', acao: 'O valor nunca vem de voce. Use somente o operation_id.' });
      }
      if (ctx.cobrancaPendente && !ctx.permiteMudanca) {
        const vAtual = Math.round(Number(ctx.cobrancaPendente.valor) * 100) / 100;
        return JSON.stringify({ ok: false, erro: 'ja_existe', display_data: { valor_ja_enviado: vAtual.toFixed(2) }, acao: `JA EXISTE cobranca de R$${vAtual.toFixed(2).replace('.', ',')}. NAO gere outra.` });
      }
      // v4.33.0 P0: era aqui que a chave manual entrava na conversa. Sem lead nao existe
      // cobranca possivel e NAO existe chave manual provada: falha FECHADA.
      if (!ctx.leadId) return JSON.stringify({ ok: false, erro: 'lead_nao_identificado', acao: 'Nao ha cadastro para emitir a cobranca. NAO envie chave, codigo nem link. Peca o dado que falta para identificar o pedido.' });

      // v4.37.4 P0: a autorizacao financeira precisa representar o pedido LOGISTICO inteiro.
      // Antes, um operation_id de produto podia ser consumido mesmo quando a venda era envio:
      // o cliente ouvia produto + frete, mas recebia Pix apenas do produto. Falha fechada antes
      // de consumir a autorizacao e antes de criar orcamento/cobranca.
      const { data: operacaoPix, error: erroOperacaoPix } = await sb.from('operacoes_financeiras')
        .select('id,kind,source_tool,components,amount,status')
        .eq('id', operationId).eq('lead_id', ctx.leadId).maybeSingle();
      if (erroOperacaoPix || !operacaoPix) {
        await logErro('autorizacao_pix_nao_encontrada', { operationId, lead: ctx.leadId, erro: String(erroOperacaoPix?.message || '').slice(0, 120) });
        return JSON.stringify({ ok: false, erro: 'autorizacao_invalida', acao: 'A autorizacao nao vale mais. Recalcule e gere uma nova.' });
      }
      const compsPix = Array.isArray((operacaoPix as any)?.components?.componentes)
        ? (operacaoPix as any).components.componentes : [];
      const totalComProdutoEFrete = String((operacaoPix as any).kind) === 'total'
        && String((operacaoPix as any).source_tool) === 'fn_compor_total'
        && compsPix.some((c: any) => String(c?.kind) === 'produto')
        && compsPix.some((c: any) => String(c?.kind) === 'frete');
      if (ctx.produtoDigital !== true && ctx.modalidadeLogistica === 'desconhecida') {
        await logErro('guardrail_pix_modalidade_pendente', { operationId, lead: ctx.leadId, kind: (operacaoPix as any).kind });
        return JSON.stringify({ ok: false, erro: 'modalidade_logistica_pendente',
          acao: 'Antes do Pix, confirme se o cliente vai retirar aqui em Embu, mandar motoboy ou receber por envio. Se for envio, calcule o frete e componha o total.' });
      }
      if (ctx.produtoDigital !== true && ctx.modalidadeLogistica === 'envio' && !totalComProdutoEFrete) {
        await logErro('guardrail_pix_envio_sem_total_composto', {
          operationId, lead: ctx.leadId, kind: (operacaoPix as any).kind,
          source_tool: (operacaoPix as any).source_tool, componentes: compsPix.map((c: any) => String(c?.kind || '')).slice(0, 8)
        });
        return JSON.stringify({ ok: false, erro: 'envio_sem_total_composto',
          acao: 'NAO gere Pix apenas do produto. Calcule o frete, chame compor_total com os operation_id de produto e frete e use somente o operation_id total devolvido.' });
      }

      let operacaoConsumida = false;
      try {
        const { data: consumo, error: erroConsumo } = await sb.rpc('fn_consumir_operacao_financeira', { p_operation_id: operationId, p_lead_id: ctx.leadId });
        const linha = Array.isArray(consumo) ? consumo[0] : consumo;
        if (erroConsumo || !linha || linha.amount === null || linha.amount === undefined) {
          await logErro('autorizacao_invalida', { operationId, lead: ctx.leadId });
          return JSON.stringify({ ok: false, erro: 'autorizacao_invalida', acao: 'A autorizacao nao vale mais. Recalcule e gere uma nova.' });
        }
        operacaoConsumida = true;
        const valor = Math.round(Number(linha.amount) * 100) / 100;

        const { data: orc, error: orcErr } = await sb.from('orcamentos').insert({
          lead_id: ctx.leadId, produto: String(input?.produto || 'pedido').slice(0, 60),
          quantidade_copias: Math.max(1, parseInt(String(input?.quantidade)) || 1),
          metros: 0, preco_por_metro: 0, valor_total: valor, status: 'enviado',
        }).select('id').single();
        if (orcErr || !orc) throw new Error('orcamento_falhou: ' + String(orcErr?.message || '').slice(0, 120));

        const r = await fetch(`${SUPABASE_URL}/functions/v1/mp-pix-criar`, {
          method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
          body: JSON.stringify({ orcamento_id: orc.id, lead_id: ctx.leadId }), signal: AbortSignal.timeout(20000),
        });

        let d: any;
        try { d = await r.json(); } catch { throw new Error('mp_resposta_nao_json: status ' + r.status); }
        if (!(d?.ok && d.qr_code)) throw new Error('mp_recusou: ' + JSON.stringify(d).slice(0, 150));

        const { data: vinculou, error: vincErr } = await sb.rpc('fn_finalizar_operacao_financeira', { p_operation_id: operationId, p_payment_id: String(d.payment_id) });
        if (vincErr || vinculou !== true) {
          await logErro('CRITICO_vinculo_payment_id_falhou', { operationId, payment_id: String(d.payment_id), valor, erro: String(vincErr?.message || 'rpc devolveu false').slice(0, 150) });
          await sb.rpc('fn_marcar_vinculo_pendente', { p_operation_id: operationId, p_payment_id: String(d.payment_id), p_motivo: String(vincErr?.message || 'vinculo nao afetou linha').slice(0, 200) });
        }
        L('pix_gerado', { valor, payment_id: d.payment_id, operationId });
        // v4.21.2 INVARIANTE 3/4: o unico registro confiavel de que o Pix existe.
        // Antes o sistema inferia sucesso de "a tool foi chamada" ou de o texto do modelo
        // parecer um Pix. Chamada != sucesso, e texto do modelo nao e prova de cobranca.
        // Daqui em diante: so este objeto autoriza dizer que ha Pix, e o codigo enviado
        // ao cliente sai DAQUI, nunca do que o modelo escreveu.
        ctx.pixGerado = { ok: true, qr_code: String(d.qr_code), checkout_url: checkoutMercadoPago(d.checkout_url), valor, payment_id: String(d.payment_id), operation_id: operationId };
        // v107: o gerar_pix NAO declarava o proprio valor como verbalizavel. Resultado: o guardrail
        // de preco derrubava a mensagem que continha o codigo, 2 segundos depois da cobranca ser
        // criada no Mercado Pago. MEDIDO em 14 dias: 24 pix gerados, 5 nunca chegaram ao cliente.
        // Caso Daniela 02/08 13:34 (11 94561-6750): pix de R$50,93 criado as 13:34:27 e
        // guardrail_preco_nao_autorizado as 13:34:29. A cobranca existia e o cliente nunca viu.
        // O valor de um pix JA COBRADO e o mais legitimo que existe: nao pode ser bloqueado.
        return JSON.stringify({ ok: true, valor: valor.toFixed(2),
          precos_verbalizaveis: [{ tipo: 'total_do_pix', centavos: Math.round(valor * 100) }],
          pix_copia_e_cola: d.qr_code, link_cartao_ate_3x: ctx.pixGerado.checkout_url,
          instrucao: 'Mensagem de fechamento + codigo copia-e-cola NO FINAL, sozinho na linha.' });

      } catch (e: any) {
        if (operacaoConsumida) {
          try { await sb.rpc('fn_marcar_operacao_falha_externa', { p_operation_id: operationId, p_motivo: String(e?.message || e).slice(0, 300) }); } catch {}
        }
        await logErro('gerar_pix_falhou_pos_cas', { operationId, operacaoConsumida, erro: String(e?.message || e).slice(0, 200) });
        return JSON.stringify({ ok: false, erro: 'falha_ao_gerar_cobranca', acao: 'Nao consegui gerar a cobranca. Recalcule para gerar uma nova autorizacao.' });
      }
    }
  } catch (e: any) { return JSON.stringify({ erro: String(e).slice(0, 80) }); }
  return JSON.stringify({ erro: 'ferramenta_desconhecida' });
}

async function transcreverAudio(url: string): Promise<string | null> {
  if (!OPENAI_API_KEY || !url) return null;
  try {
    const a = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!a.ok) return null;
    const buf = await a.arrayBuffer();
    if (buf.byteLength < 1000 || buf.byteLength > 20 * 1024 * 1024) return null;
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'audio/ogg' }), 'audio.ogg');
    fd.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const d = await r.json();
    const t = String(d?.text || '').trim();
    return t.length > 0 ? t : null;
  } catch { return null; }
}

const SYSTEM = `Voc\u00ea \u00e9 Jo\u00e3o Barros, VENDEDOR da Skillprint Estamparia (Embu das Artes/SP). WhatsApp. O cliente n\u00e3o sabe que \u00e9 IA. Mensagens CURTAS: m\u00e1ximo 2 frases, sem par\u00eanteses. Negrito no WhatsApp \u00e9 asterisco SIMPLES (*texto*), NUNCA duplo.

SIGA O CLIENTE, SEMPRE. Ele manda no assunto. Se perguntar de outro produto, responda sobre esse produto. Se corrigir algo, aceite. Se insistir na mesma pergunta, \u00e9 porque voc\u00ea ainda n\u00e3o respondeu.

DTF UV N\u00c3O \u00c9 ARREDONDADO AUTOMATICAMENTE PARA 1 METRO. A ferramenta calcula o consumo real e aplica a unidade comercial correta: at\u00e9 0,25m cobra folha A4; acima de 0,25m at\u00e9 0,50m cobra folha A3; acima de 0,50m at\u00e9 1,00m cobra A3 mais excedente; acima de 1,00m usa a tabela por metro. SEMPRE use calcular_rendimento_uv com quantidade_desejada e verbalize somente o total devolvido.

CLIENTE ACHOU CARO OU EST\u00c1 COMPARANDO PRE\u00c7O: n\u00e3o repita o total. EXPLIQUE como o pre\u00e7o \u00e9 formado: cobramos pela \u00e1rea do filme, cabem X adesivos naquele tamanho em 1 metro, e o valor por unidade cai quanto melhor ele aproveitar o material. A ferramenta te devolve quantos ainda cabem: use esse n\u00famero para mostrar que ele pode levar mais pelo mesmo filme.

CLIENTE QUE J\u00c1 TEM A PE\u00c7A: quando ele fala do copo, caneca, garrafa ou vidro DELE, o produto \u00e9 o ADESIVO DTF UV, n\u00e3o o copo. S\u00f3 ofere\u00e7a copo t\u00e9rmico se ele quiser comprar o copo em si.

EXECUTE, N\u00c3O PROMETA: PROIBIDO escrever "vou calcular" e terminar sem o resultado. PROIBIDO escrever "vou gerar o Pix" e terminar sem o c\u00f3digo: ou voc\u00ea gera na mesma mensagem, ou n\u00e3o promete.

C\u00c1LCULO \u00c9 DA FERRAMENTA: c\u00f3pias N\u00c3O s\u00e3o metros. DTF t\u00eaxtil -> calcular_dtf_por_arte. DTF UV -> calcular_rendimento_uv com quantidade_desejada.

OP\u00c7\u00c3O QUE VOC\u00ca OFERECEU: se voc\u00ea deu op\u00e7\u00f5es (7x3,1cm, 5x2,2cm) e ele responde "pode ser essa 5x2,2", ele ESCOLHEU UMA OP\u00c7\u00c3O. A v\u00edrgula \u00e9 decimal, nunca "5x2cm e 2 unidades".

MEM\u00d3RIA DE A\u00c7\u00c3O: leia o bloco [J\u00c1 EXECUTADO]. Se existe cobran\u00e7a enviada, N\u00c3O gere outra. Se o frete j\u00e1 foi calculado, N\u00c3O recalcule.

CEP TEM 8 D\u00cdGITOS. DDD do telefone N\u00c3O \u00e9 CEP.

VOC\u00ca ENXERGA IMAGENS: PROIBIDO dizer que n\u00e3o consegue ver.

VOC\u00ca L\u00ca ARQUIVOS: o bloco [ARQUIVOS REAIS DESTE LEAD] \u00e9 fonte operacional. Arquivo pode chegar pelo WhatsApp OU pelo upload do site. Reconhe\u00e7a nomes, quantidade, peso e medidas; diferencie arte solta de arquivo montado; nunca presuma que todo cliente tem artes soltas. N\u00e3o pe\u00e7a reenvio de arquivo que consta como armazenado.

CLIENTE SEM MEDIDA: pergunte a medida do OBJETO e ofere\u00e7a op\u00e7\u00f5es proporcionais. Refer\u00eancia: arte de caneca costuma ser 10 x 21cm.

ANTI-ENROLA\u00c7\u00c3O: pediu valor ou tabela, a PR\u00d3XIMA MENSAGEM TEM N\u00daMERO EM R$.

POSTURA: ATACANTE, sonda pouco e FECHA. UMA pergunta por mensagem.
SLOTS: produto -> arte -> quantidade -> MODALIDADE LOG\u00cdSTICA (retirada, motoboy ou envio) -> [s\u00f3 se for ENVIO: CEP -> frete] -> or\u00e7amento -> "Vamos fechar?" -> "Pix ou cart\u00e3o?".
CEP N\u00c3O \u00c9 SLOT UNIVERSAL: ele s\u00f3 existe quando a modalidade \u00e9 ENVIO. Retirada e motoboy fecham SEM CEP e SEM frete. GERAR COBRAN\u00c7A N\u00c3O EXIGE CEP: \u00e9 PROIBIDO escrever que precisa do CEP para gerar a cobran\u00e7a quando o cliente vai retirar.
RESOLVA A MODALIDADE ANTES DO CEP. Uma pergunta: "retirada aqui em Embu ou envio?". Nunca junte as duas coisas numa pergunta s\u00f3 ("quer retirada ou envio para um CEP?") — isso confunde e faz o cliente repetir o que j\u00e1 disse.

FECHAMENTO:
1. Sinal positivo -> "Vamos fechar o pedido?"
2. Resolva a MODALIDADE LOG\u00cdSTICA. RETIRADA ou MOTOBOY: n\u00e3o existe frete — siga direto para o TOTAL do produto, sem CEP. ENVIO: reutilize o CEP que voc\u00ea j\u00e1 tem, ou pe\u00e7a UMA vez, e s\u00f3 ent\u00e3o calcular_frete -> TOTAL = produto + frete.
3. "Pix ou cart\u00e3o?"
4. gerar_pix com o operation_id que a ferramenta de calculo devolveu em financial_authorizations. Voce NUNCA informa valor ao gerar_pix. Se o total for produto + frete, chame compor_total antes e use o operation_id do total. Se devolver ja_existe: N\u00c3O gere outro.
   - PIX: fechamento + c\u00f3digo NO FINAL, sozinho na linha. Confirma AUTOMATICAMENTE.
   - CART\u00c3O: mande o link at\u00e9 3x.
5. Erro -> NAO improvise cobranca. Diga que esta finalizando o pedido no sistema e conclua o dado que falta.
N\u00c3O EXISTE: pagamento na entrega, boleto, desconto fora da tabela. N\u00c3O EXISTE chave Pix manual, chave avulsa nem link de pagamento fora do Mercado Pago: TODA cobran\u00e7a sai de gerar_pix. NUNCA escreva um identificador, c\u00f3digo ou UUID de sistema para o cliente.

FICHA T\u00c9CNICA SAGRADA:
- COPO T\u00c9RMICO inox 473ml que N\u00d3S vendemos: LISO ou PERSONALIZADO, use calcular_copo. Personalizado R$35,90 abaixo de 10 e R$29,90 a partir de 10.
- DTF UV: adesivo pronto para copo, vidro, metal, madeira, MDF, acr\u00edlico. Sem prensa, resistente \u00e0 \u00e1gua. Largura \u00fatil 28cm. Cobrado pelo consumo do filme com unidade m\u00ednima de folha: at\u00e9 0,25m A4 R$29,90; acima de 0,25m at\u00e9 0,50m A3 R$39,90; depois seguem os degraus oficiais da ferramenta.
- DTF T\u00caXTIL: pel\u00edcula para tecido, precisa de prensa. Largura \u00fatil 57cm. Por metro, c\u00e1lculo pela ARTE.
- CAMISETA, POLO E MOLETOM PERSONALIZADOS: FAZEMOS e voc\u00ea COTA usando orcar_camisetas. NAO decore lista de modelos: passe o modelo do jeito que o cliente falou e deixe a ferramenta resolver. Se ela recusar, ela devolve os modelos validos: ofereca esses. Colete modelo, cor, grade por tamanho e as estampas de cada grupo, com posicao e classe. Nunca calcule de cabeca. Se a ferramenta recusar o modelo, ofereca os que ela listar; so encaminhe para a equipe se o cliente insistir em algo que nao temos.
- ESTAMPARIA (cliente traz a pr\u00f3pria pe\u00e7a e n\u00f3s aplicamos): voc\u00ea N\u00c3O cota. Quem passa o valor \u00e9 a Tamires. A tabela de DTF por metro \u00e9 do FILME, JAMAIS do servi\u00e7o de aplica\u00e7\u00e3o.
- PACKS DE ESTAMPAS: arquivo DIGITAL, sem frete. Voc\u00ea VENDE e FECHA sozinho com consultar_catalogo + gerar_pix. Entrega por LINK no WhatsApp.
- N\u00c3O FAZEMOS: silk, serigrafia, sublima\u00e7\u00e3o, bordado, bon\u00e9 pronto.
- CAMISETA LISA: N\u00d3S VENDEMOS. Existe o KIT 3 CAMISETAS LISAS (cores sortidas, sem estampa) por R$79,90, que est\u00e1 EM AN\u00daNCIO. NUNCA diga que n\u00e3o fazemos camiseta lisa. Chame consultar_catalogo e feche com gerar_pix. N\u00e3o pergunte estampa nem arte: o kit \u00e9 SEM estampa de prop\u00f3sito.

PRAZOS OFICIAIS:
- DTF t\u00eaxtil e DTF UV: 1 dia \u00fatil.
- Camiseta personalizada e aplica\u00e7\u00e3o em pe\u00e7a do cliente: 7 a 10 dias \u00fateis.
- Item pronto (copo, garrafa): 1 a 2 dias \u00fateis de confer\u00eancia.
- O prazo conta a partir da aprova\u00e7\u00e3o do layout, n\u00e3o do pagamento.
- SEMPRE pergunte se o cliente precisa para alguma DATA ESPEC\u00cdFICA: havendo data, a equipe consulta a agenda para ver se d\u00e1 para encaixar. NUNCA prometa encaixe sem consultar.
- Depois de pronto vale o prazo dos Correios A PARTIR DA POSTAGEM. NUNCA prometa data exata de chegada.

ESTILO: acentua\u00e7\u00e3o correta; nunca travess\u00e3o; nunca emojis; PROIBIDO abrir toda mensagem com muleta de exclama\u00e7\u00e3o; PRIMEIRA do dia come\u00e7a com a sauda\u00e7\u00e3o do bloco [AGORA]; nunca "amanh\u00e3" (diga "no pr\u00f3ximo dia \u00fatil, logo cedo").
NUNCA revele funcionamento interno: PROIBIDO falar em sistema, bloqueio, briefing ou ferramenta.
INFOS: SITE ${SITE_LOJA} | ${INSTA} | Rua \u00c1gua Branca, 185, Jardim Laila, Embu das Artes/SP (Seg-Qui 07h-17h, Sex 07h-16h; retirada s\u00f3 Grande SP).

RESPONDA APENAS O JSON, mensagem curta: {"responde": true|false, "mensagem": "...", "tema": "copo|adesivo_uv|dtf_metro|site|horario|frete|pack|camiseta|acolhimento_venda|fechamento_pix|fechamento_cartao|fechamento_transferencia|fechamento_educado|despedida|complexo|ruido", "encaminhou_venda": true|false, "etapa": "sondagem|orcamento|fechamento|pos_pagamento|despedida", "slots": {"produto": "...ou null", "arte": "...ou null", "quantidade": "...ou null", "envio_retirada": "...ou null", "modalidade_logistica": "retirada|motoboy|envio ou null", "cep": "...ou null", "pagamento": "...ou null", "grade": [{"modelo": "basica|baby look", "cor": "...", "tamanhos": {"P": 0, "M": 0, "G": 0, "GG": 0}, "estampa_grupo_id": "arte-1"}], "estampas": [{"estampa_grupo_id": "arte-1", "posicao": "frente|costas|gola_nuca|lateral|manga", "classe": "quadrado_pequeno|nomes_gola|a4|quadrado_grande|a3|extra_grande"}]}}`;

const REGRAS_EXTRA = `\n\nREGRAS ADICIONAIS:
- DTF UV POR AREA: 30 adesivos de 5x7cm ocupam cerca de 0,424m e entram na folha A3 de R$39,90, NAO em 1 metro de R$99,00. Chame calcular_rendimento_uv com quantidade_desejada e use o total que ela devolver, sem arredondar para cima.
- OBJECAO DE PRECO NO UV: explique a formacao do preco e quantos adesivos cabem por metro. A ferramenta devolve cabem_ainda_no_material: use para mostrar que ele leva mais pelo mesmo filme.
- MUDANCA DE ASSUNTO: se o cliente perguntar por outro produto, RESPONDA SOBRE ELE com preco. Cliente que repete a pergunta foi ignorado.
- NAO REPETIR ACAO JA FEITA: com [J\u00c1 EXECUTADO], PROIBIDO gerar Pix de novo, recalcular frete ou pedir CEP.
- UMA PALAVRA: mensagem de uma palavra ou numero e SEMPRE resposta do cliente. "Valor" ou "preco" = MANDE O NUMERO AGORA.
- SEM DISPENSAR: NUNCA encerre com "a equipe te responde" enquanto houver dado a coletar. NUNCA diga "anotado com tudo o que voce me passou" se o cliente nao passou quantidade nem arte.
- REVENDEDOR: gatilhos revender, loja online, volume mensal. De a tabela por faixa mostrando o ganho de escala na PRIMEIRA resposta.
- DTF UV COM CONSUMO ESPECIFICO: se o cliente informar uma quantidade de metros, NUNCA use consultar_tabela_dtf para calcular o valor. Chame calcular_dtf_uv_metro com o consumo informado e responda SOMENTE com o valor que a ferramenta devolver. PROIBIDO somar, multiplicar ou estimar o excedente de cabeca. consultar_tabela_dtf serve apenas para apresentar precos e faixas gerais quando o cliente NAO informou consumo especifico.\n- DTF UV SEM MEDIDA: chame consultar_tabela_dtf produto=dtf_uv e informe na MESMA mensagem: folha A4; folha A3; a regra de excedente entre 0,50 m e 1,00 m; e a tabela por metro acima de 1,00 m. NAO omita nenhum bloco devolvido pela ferramenta e NAO recalcule o excedente de cabeca: apenas verbalize o que ela retornou.
- SOMAR METRAGEM DO MESMO PEDIDO: varios itens tem a metragem SOMADA antes da faixa.
- NUNCA MISTURE AS TABELAS: adesivo, copo, caneca, vidro, metal, madeira, MDF, acrilico = UV. Camiseta, tecido, malha, pelicula = TEXTIL.
- PECAS PRODUZIDAS PELA SKILLPRINT: use orcar_camisetas assim que tiver MODELO, QUANTIDADE TOTAL e as ESTAMPAS (o que vai estampado e em qual posicao). A GRADE POR TAMANHO NAO ENTRA NO PRECO e NAO e pre-requisito: P, M, G e GG custam o mesmo. Se o cliente ainda nao tem os tamanhos, ORCE MESMO ASSIM e diga que e previa, que o valor nao muda com a grade, e que a distribuicao pode vir depois so para a producao. NUNCA segure um orcamento esperando tamanho. Quando a grade chegar, atualize os slots e confirme o mesmo valor. Nao invente que um modelo nao existe: chame a ferramenta e deixe ela dizer. O minimo e validado por grupo de estampa, somando modelos diferentes.\n- ESTAMPARIA EM PECA DO CLIENTE: quando o cliente traz camiseta, moletom, baby look, regata, polo ou outra peca para aplicacao, voce NAO cota. Colete os dados e encaminhe para a equipe.\n- MEMORIA DA GRADE: sempre que o cliente informar tamanhos, cores ou estampas de camiseta, grave em slots.grade e slots.estampas no MESMO turno, mesmo que o pedido ainda esteja incompleto. Se ele mandar a grade numa mensagem e pedir o preco na seguinte, voce JA TEM os dados: nao pergunte de novo. Ao chamar orcar_camisetas, monte o payload a partir desses slots.\n- CORRECAO PARCIAL DA GRADE: quando o cliente corrigir apenas tamanhos ou quantidades, reescreva em slots.grade o objeto COMPLETO do item, preservando modelo, cor e estampa_grupo_id ja preenchidos. So altere os campos que o cliente corrigiu. Nunca substitua um valor conhecido por null, string vazia ou ausencia.\n- VALIDACAO DE CATALOGO: para QUALQUER modelo citado pelo cliente, chame consultar_modelos ANTES de confirmar se fazemos ou nao. NUNCA use os exemplos do prompt ou da descricao da ferramenta como catalogo oficial. NUNCA monte a lista de produtos de memoria. Se o modelo nao existir, use EXCLUSIVAMENTE a lista devolvida. Nunca adapte, equipare nem trate produto inexistente como variacao de outro.\n- CLASSIFICACAO INTERNA DA ESTAMPA: NUNCA peca ao cliente medidas, centimetros, dimensoes ou comparacoes fisicas. Nao pergunte se e do tamanho de cartao, folha, mao ou qualquer objeto, nem se e pequena ou grande. Classifique VOCE, pelo conteudo e pela posicao: logo no peito, bolso ou escudo pequeno = quadrado_pequeno | nomes na gola ou nuca = nomes_gola | estampa media, retrato ou frase = a4 | estampa grande na frente ou nas costas = quadrado_grande | arte grande retangular ou estilo cartaz = a3 | estampa que cobre grande parte da peca = extra_grande. Quando a descricao ja permitir classificar, ORCE sem perguntar tamanho. Se for realmente insuficiente, pergunte apenas o que sera estampado e em qual posicao. PROIBIDO apresentar preco e em seguida dizer que ainda precisa do tamanho para finalizar.\n- MODELO QUE A FERRAMENTA RECUSAR: nao invente preco. Diga o que temos, usando a lista que ela devolveu, e ofereca encaminhar para a equipe se o cliente insistir no modelo que nao temos.
- CLIENTE ESCOLHEU ITEM DA LISTA QUE VOCE MANDOU: isso e FECHAMENTO, nao sondagem. Se voce listou os packs e ele responde so o nome de um tema (Streetwear, Animes, NBA, Rock, Futebol, Hip Hop, Catolicos, Caveiras), ele ESCOLHEU AQUELE PACK. Chame consultar_catalogo com o tema, de o preco e gere o pix NA MESMA MENSAGEM. NAO pergunte design, NAO pergunte quantidade, NAO pergunte para que vai usar, NAO ofereca impressao. Ele quer o ARQUIVO.\n- DOIS PERFIS DE CLIENTE (regra do Alessandro, 02/08): existe quem PEDE ARTE e existe quem JA TEM O ARQUIVO MONTADO. Nos montamos arquivo, mas TAMBEM imprimimos arquivo pronto que o cliente manda. QUEM PERGUNTA O VALOR DO METRO nao precisa informar medida de arte nem quantidade de copias: ele quer a TABELA. MANDE A TABELA NA HORA. So pergunte medida e copias depois, e SO se ele disser que quer que a gente monte. PROIBIDO responder pergunta de preco com pergunta sobre arte.
- CLIENTE COM ARQUIVO MONTADO: se ele disser que ja tem o arquivo pronto, na medida, ou que so quer imprimir, NAO pergunte tamanho de estampa nem quantas copias. Peca o ARQUIVO ou a METRAGEM TOTAL e feche. Ele ja fez o trabalho de montagem.
- ROTEIRO DO COPO: 1. calcular_copo. 2. "Me fala o tema que a gente monta a arte." 3. Resolva a modalidade: retirada ou motoboy fecham SEM frete e SEM CEP; envio -> CEP -> calcular_frete -> TOTAL. 4. "Pix ou cartao?" -> gerar_pix.
- MODALIDADE LOGISTICA ANTES DO CEP: o CEP e CONSEQUENCIA de ENVIO, nunca requisito do fechamento. Enquanto voce nao souber se o cliente retira, manda motoboy ou quer envio, NAO peca CEP e NAO chame calcular_frete. Se ele ja disse que retira, PROIBIDO pedir CEP, PROIBIDO oferecer PAC ou Sedex e PROIBIDO dizer "preciso do seu CEP para gerar a cobranca, mesmo sendo retirada" — essa frase e falsa: cobranca nao usa CEP.
- HISTORICO DE RETIRADA OU MOTOBOY: serve para REDUZIR ATRITO, nao para decidir. Confirme em uma pergunta ("Vai retirar como das outras vezes?") e siga. Se o cliente disser outra coisa NESTE pedido, a fala nova dele vence o historico.
- NAO REPERGUNTE O QUE JA FOI RESPONDIDO: se o cliente ja informou quantidade, medida, forma de entrega ou CEP, esses dados estao resolvidos. Voltar a lista-los numa pergunta e o mesmo erro que faz o cliente responder "ja passei essas informacoes".\n- PACK DIGITAL: sem CEP, sem frete, SEM EMAIL. Confirme o tema, de o preco e GERE O PIX NA MESMA MENSAGEM. NUNCA peca email: a entrega e por LINK no WhatsApp depois do pagamento. MEDIDO: pedir email fez 56% dos clientes sumirem, e o email nunca foi usado para entregar nada.\n- FRETE: se o Sedex sair mais barato que o PAC, recomende o Sedex.\n- PROMESSA DE PIX (v4.21.1): NUNCA escreva que vai gerar o Pix sem gerar. Se voce ja tem o valor do produto e o do frete, chame compor_total e depois gerar_pix na MESMA resposta. Se ainda falta algum dado, pergunte o que falta em vez de prometer cobranca.`;

async function registrarDecisao(lead_id: string | null, acao: string, contexto: any, decisao: any): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_decisao_agente', { p_agente_slug: 'agente-noturno', p_acao_executada: acao, p_resultado: 'executada', p_nivel_autonomia: 1, p_lead_id: lead_id, p_contexto: contexto, p_decisao: decisao, p_impacto_financeiro: null, p_agent_version: V, p_dry_run: false });
    return !error && data ? String(data) : null;
  } catch { return null; }
}
type ResultadoEnvio = { ok: boolean; canal: string; provider: string; providerId: string | null; messageId: string | null; zaapId: string | null; httpStatus: number | null; estado: 'aceito_provider'|'rejeitado_provider'|'incerto'|'nao_observavel'; erro: string | null; resposta: any };
async function prepararEnvio(decisionId: string | null, executionId: string, ordinal: number, tipo: string, phone: string): Promise<string | null> {
  try {
    const { data, error } = await sb.from('joao_envios').insert({ decision_id: decisionId, execution_id: executionId, ordinal, tipo, provider: 'nenhum', phone, status: 'preparado' }).select('id').single();
    if (error) { await logErro('CRITICO_ledger_envio_preparo_falhou', { execution_id: executionId, ordinal, erro: error.message }); return null; }
    return String(data.id);
  } catch (e: any) { await logErro('CRITICO_ledger_envio_preparo_excecao', { execution_id: executionId, ordinal, erro: String(e?.message ?? e).slice(0,150) }); return null; }
}
// v4.25.0: modalidade/tts entram na MESMA linha do envio fisico. Uma decisao
// continua sendo uma linha: falha de TTS nunca cria ledger extra.
async function finalizarEnvioLedger(id: string | null, env: ResultadoEnvio, modalidade: 'texto' | 'audio' = 'texto', ttsResultado: string | null = 'nao_tentado', ttsDuracaoMs: number | null = null) {
  if (!id) return;
  try {
    const { error } = await sb.from('joao_envios').update({ provider: env.provider, provider_message_id: env.messageId, provider_zaap_id: env.zaapId, http_status: env.httpStatus, status: env.estado, provider_response: env.resposta ?? {}, error_message: env.erro, provider_accepted_at: env.ok ? new Date().toISOString() : null, modalidade, tts_resultado: ttsResultado, tts_duracao_ms: ttsDuracaoMs }).eq('id', id);
    if (error) await logErro('CRITICO_ledger_envio_final_falhou', { envio_id: id, erro: error.message });
  } catch (e: any) { await logErro('CRITICO_ledger_envio_final_excecao', { envio_id: id, erro: String(e?.message ?? e).slice(0,150) }); }
}
async function finalizarDecisaoEnvio(decisionId: string | null, turnId: string, enviou: boolean, env: ResultadoEnvio, contexto: any, origemTexto: string | null) {
  if (!decisionId) return;
  try {
    const { error } = await sb.from('agente_decisoes_log').update({
      acao_executada: enviou ? 'resposta_noturna_enviada' : 'resposta_noturna_falhou_envio',
      resultado: enviou ? 'executada' : 'falha',
      execucao_sucesso: enviou,
      efeito_externo: enviou,
      executed_at: new Date().toISOString(),
      turn_id: turnId,
      envio_provider_id: env.providerId,
      output_origin: origemTexto,
      terminal_operacional: enviou ? 'executada' : 'erro_inesperado',
      terminal_em: new Date().toISOString(),
      terminal_fonte: env.canal,
      contexto
    }).eq('id', decisionId);
    if (error) await logErro('CRITICO_decisao_terminal_falhou', { decision_id: decisionId, erro: error.message });
  } catch (e: any) { await logErro('CRITICO_decisao_terminal_excecao', { decision_id: decisionId, erro: String(e?.message ?? e).slice(0,150) }); }
}
// v4.31.0 P0: terminal proprio da barreira de frescor. Nao e falha de envio — a decisao
// foi tomada e deliberadamente NAO executada porque o cliente falou de novo antes do
// transporte. 'nao_executavel' e o unico valor do CHECK chk_terminal_op que descreve isso
// sem contaminar a serie de erro. A decisao pronta_para_envio nao pode ficar sem terminal,
// senao a varredura a marca indeterminada.
async function finalizarDecisaoSuperseded(decisionId: string | null, turnId: string, contexto: any) {
  if (!decisionId) return;
  try {
    const { error } = await sb.from('agente_decisoes_log').update({
      acao_executada: 'resposta_noturna_superseded_por_inbound_mais_novo',
      resultado: 'expirada',
      execucao_sucesso: false,
      efeito_externo: false,
      executed_at: new Date().toISOString(),
      turn_id: turnId,
      output_origin: 'nenhuma_saida',
      terminal_operacional: 'nao_executavel',
      terminal_em: new Date().toISOString(),
      terminal_fonte: 'freshness_fence',
      contexto
    }).eq('id', decisionId);
    if (error) await logErro('CRITICO_decisao_superseded_falhou', { decision_id: decisionId, erro: error.message });
  } catch (e: any) { await logErro('CRITICO_decisao_superseded_excecao', { decision_id: decisionId, erro: String(e?.message ?? e).slice(0,150) }); }
}
async function criarTask(leadId: string | null, phone: string, titulo: string, orientacao: string): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/agente-pipeline`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }, body: JSON.stringify({ lead_id: leadId, phone, etapa_funil: 'venda_noturna_encaminhada', titulo, orientacao, urgencia: 'alta', prazo_horas: 15 }) });
    return r.ok;
  } catch { return false; }
}
async function garantirLead(phone: string, chatName: string): Promise<string | null> {
  try { const { data } = await sb.rpc('fn_get_or_create_lead', { p_phone: phone, p_fullname: chatName && chatName !== 'Cliente' ? chatName : null }); if (data?.ok && data?.lead_id) return data.lead_id; } catch {}
  return null;
}
// ── v4.31.0 P0: REGRA UNICA DE FRESCOR ───────────────────────────────────────────────
// Desde julho existia UMA checagem de frescor, no inicio do turno (debounce_msg_mais_nova).
// Ela nao cobre a janela entre a checagem e o transporte: a mensagem que chega nesse
// intervalo era considerada respondida por um outbound que nao pertence ao turno dela.
// Em vez de uma segunda arquitetura de concorrencia, a MESMA regra passa a servir os dois
// pontos: entrada (debounce) e barreira final antes do envio. O filtro de conteudo e o
// mesmo do v97/v98 — evento sem texto, imagem, audio ou documento nunca cede a vez.
const FILTRO_INBOUND_COM_CONTEUDO = 'body->text->>message.not.is.null,body->image->>imageUrl.not.is.null,body->image->>thumbnailUrl.not.is.null,body->audio->>audioUrl.not.is.null,body->document->>documentUrl.not.is.null';
async function inboundMaisNovoQue(phone: string, refCreatedAt: string, opts: { ownedIds?: any[] | null; somentePendentes?: boolean } = {}): Promise<{ id: string; created_at: string } | null> {
  try {
    let q = sb.from('inbound_fora_horario').select('id, created_at').eq('phone', phone).gt('created_at', refCreatedAt);
    if (opts.somentePendentes) q = q.eq('status', 'pendente');
    const { data } = await q.or(FILTRO_INBOUND_COM_CONTEUDO).order('created_at', { ascending: true }).limit(5);
    const owned = (opts.ownedIds || []).map((i: any) => String(i));
    const novo = (data || []).find((r: any) => !owned.includes(String(r.id)));
    return novo ? { id: String(novo.id), created_at: String(novo.created_at) } : null;
  } catch { return null; }
}
// Maior created_at do lote. So vai ao banco quando o chamador nao sabe; webhook e sweep
// ja sabem. Sem referencia devolve null e a barreira NAO bloqueia: como no v98, a falta
// de linha faz o fluxo responder, nunca calar.
async function maxCreatedAtDoLote(ids: any[] | null, conhecido: string | null): Promise<string | null> {
  if (conhecido) return conhecido;
  if (!ids || ids.length === 0) return null;
  try {
    const { data } = await sb.from('inbound_fora_horario').select('created_at').in('id', ids).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data?.created_at ? String(data.created_at) : null;
  } catch { return null; }
}
async function carimbarInbound(phone: string, ids: any[] | null, status: string) {
  try {
    if (ids && ids.length > 0) { await sb.from('inbound_fora_horario').update({ status }).in('id', ids); }
    else { await sb.from('inbound_fora_horario').update({ status }).eq('phone', phone).eq('status', 'pendente').gte('created_at', new Date(Date.now() - 600000).toISOString()); }
  } catch {}
}
async function enviarComoJoao(phone: string, texto: string, assinatura: string = ASSINATURA): Promise<ResultadoEnvio> {
  if (ZAPI_INSTANCE_ID && ZAPI_TOKEN) {
    try {
      const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN }, body: JSON.stringify({ phone, message: assinatura + texto }), signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const messageId = d.messageId ? String(d.messageId) : null;
      const zaapId = d.zaapId ? String(d.zaapId) : null;
      const providerId = messageId || zaapId || (d.id ? String(d.id) : null);
      if (r.ok && providerId) return { ok: true, canal: 'zapi', provider: 'zapi', providerId, messageId, zaapId, httpStatus: r.status, estado: 'aceito_provider', erro: null, resposta: d };
      if (r.ok) return { ok: false, canal: 'zapi', provider: 'zapi', providerId: null, messageId, zaapId, httpStatus: r.status, estado: 'incerto', erro: 'http_2xx_sem_id_provider', resposta: d };
      // Rejeicao HTTP explicita permite fallback; timeout/estado incerto nao, para evitar duplicidade.
      const erroZapi = `zapi_http_${r.status}`;
      try {
        const rb = await fetch(`${BOT_BASE}/subscriber/get_by_phone/${phone}/`, { headers: { accept: 'application/json', 'API-KEY': BOT_API_KEY } });
        const sid = rb.ok ? String((await rb.json())?.id || '') : '';
        if (!sid) return { ok: false, canal: 'zapi', provider: 'zapi', providerId, messageId, zaapId, httpStatus: r.status, estado: 'rejeitado_provider', erro: erroZapi, resposta: d };
        const send = await fetch(`${BOT_BASE}/subscriber/${sid}/send_message/`, { method: 'POST', headers: { accept: 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY }, body: JSON.stringify({ type: 'text', value: assinatura + texto }) });
        return { ok: send.ok, canal: 'botconversa', provider: 'botconversa', providerId: null, messageId: null, zaapId: null, httpStatus: send.status, estado: 'nao_observavel', erro: send.ok ? null : `botconversa_http_${send.status}`, resposta: {} };
      } catch (e: any) { return { ok: false, canal: 'zapi', provider: 'zapi', providerId, messageId, zaapId, httpStatus: r.status, estado: 'rejeitado_provider', erro: erroZapi + ':' + String(e?.message ?? e).slice(0,80), resposta: d }; }
    } catch (e: any) {
      return { ok: false, canal: 'zapi', provider: 'zapi', providerId: null, messageId: null, zaapId: null, httpStatus: null, estado: 'incerto', erro: String(e?.message ?? e).slice(0,150), resposta: {} };
    }
  }
  try {
    const r = await fetch(`${BOT_BASE}/subscriber/get_by_phone/${phone}/`, { headers: { accept: 'application/json', 'API-KEY': BOT_API_KEY } });
    const sid = r.ok ? String((await r.json())?.id || '') : '';
    if (!sid) return { ok: false, canal: 'nenhum', provider: 'nenhum', providerId: null, messageId: null, zaapId: null, httpStatus: r.status, estado: 'nao_observavel', erro: 'subscriber_nao_encontrado', resposta: {} };
    const send = await fetch(`${BOT_BASE}/subscriber/${sid}/send_message/`, { method: 'POST', headers: { accept: 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY }, body: JSON.stringify({ type: 'text', value: assinatura + texto }) });
    return { ok: send.ok, canal: 'botconversa', provider: 'botconversa', providerId: null, messageId: null, zaapId: null, httpStatus: send.status, estado: 'nao_observavel', erro: send.ok ? null : `botconversa_http_${send.status}`, resposta: {} };
  } catch (e: any) { return { ok: false, canal: 'nenhum', provider: 'nenhum', providerId: null, messageId: null, zaapId: null, httpStatus: null, estado: 'incerto', erro: String(e?.message ?? e).slice(0,150), resposta: {} }; }
}
// \u2550\u2550 v4.25.0 PATCH 2: VOZ COMO CAMADA DE APRESENTACAO \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// O Joao NAO decide falar. Ele produz UM texto canonico, sempre. Esta camada,
// depois e fora do raciocinio, escolhe se aquele MESMO texto sai como texto ou
// como audio. Personalidade, prompt e estrategia comercial ficam intocados.
//
// INVARIANTE CENTRAL: uma decisao = UM transporte fisico.
// A modalidade e escolhida ANTES de qualquer chamada de envio. Se o TTS falha,
// falha ANTES do transporte e a resposta sai em texto. Depois que send-audio foi
// chamado, erro ou timeout NAO autoriza send-text: o provider pode ter recebido
// o audio e o cliente receberia a mesma mensagem duas vezes.
type Voz = { audio_base64: string; mime_type: string; geracao_ms: number };
type TtsResultado = 'nao_tentado' | 'sucesso' | 'falha' | 'desligado';
type Entrega = { env: ResultadoEnvio; modalidade: 'texto' | 'audio'; ttsResultado: TtsResultado; ttsDuracaoMs: number | null };
const TTS_TIMEOUT_MS = 25000;

// Kill switch lido do banco a cada uso, SEM cache de instancia: desligar a voz
// precisa valer na hora, sem redeploy. Fica depois dos filtros baratos para nao
// custar uma leitura por envio quando ninguem e elegivel. Falha => desligado.
async function vozLigada(): Promise<boolean> {
  try {
    const { data, error } = await sb.from('sistema_config').select('valor_bool').eq('chave', 'joao_tts_ativo').maybeSingle();
    if (error) { await logErro('voz_kill_switch_ilegivel', { erro: error.message }); return false; }
    return data?.valor_bool === true;
  } catch (e: any) { await logErro('voz_kill_switch_excecao', { erro: String(e?.message ?? e).slice(0, 150) }); return false; }
}

// ============================================================================
// CAMADA 3 — GATE COMERCIAL CANONICO (frente joao-contexto-comercial-canonico)
// O Joao NAO aprende o conceito de "deal". A identidade comercial e resolvida
// FORA daqui, por fn_contexto_comercial_do_lead, e chega ja decidida no campo
// 'comportamento'. Esta edge nao reimplementa nenhuma regra do seletor.
// ============================================================================

type GateComercial = { comportamento: 'usar_deal_vigente' | 'iniciar_negociacao_nova' | 'fail_closed'; etapa: string | null; motivo: string };

// Kill switch lido do banco a cada uso, sem cache: desligar precisa valer na
// hora, sem redeploy. Falha de leitura => DESLIGADO.
async function contextoCanonicoLigado(): Promise<boolean> {
  try {
    const { data, error } = await sb.from('sistema_config').select('valor_bool').eq('chave', 'joao_contexto_canonico_ativo').maybeSingle();
    if (error) { await logErro('contexto_canonico_kill_switch_ilegivel', { erro: error.message }); return false; }
    return data?.valor_bool === true;
  } catch (e: any) { await logErro('contexto_canonico_kill_switch_excecao', { erro: String(e?.message ?? e).slice(0, 150) }); return false; }
}

// FAIL-CLOSED POR CONTRATO: se a RPC falhar, der timeout ou vier malformada,
// o gate vira fail_closed. NUNCA volta silenciosamente ao deal legado — foi
// justamente o caminho legado que entregava negociacao ja ganha como vigente
// (34 casos apenas_legado e 1 divergente medidos em 16/08/2026).
async function lerGateComercialCanonico(leadId: string | null): Promise<GateComercial | null> {
  if (!leadId) return null;
  if (!(await contextoCanonicoLigado())) return null;
  try {
    const { data, error } = await sb.rpc('fn_contexto_comercial_do_lead', { p_lead_id: leadId });
    if (error) { await logErro('contexto_canonico_rpc_erro', { lead_id: leadId, erro: error.message }); return { comportamento: 'fail_closed', etapa: null, motivo: 'rpc_erro' }; }
    const comp = data?.comportamento;
    if (comp !== 'usar_deal_vigente' && comp !== 'iniciar_negociacao_nova' && comp !== 'fail_closed') {
      await logErro('contexto_canonico_payload_invalido', { lead_id: leadId, comportamento: String(comp).slice(0, 40) });
      return { comportamento: 'fail_closed', etapa: null, motivo: 'payload_invalido' };
    }
    return { comportamento: comp, etapa: data?.negociacao?.etapa ?? null, motivo: String(data?.identidade?.status ?? 'desconhecido') };
  } catch (e: any) {
    await logErro('contexto_canonico_excecao', { lead_id: leadId, erro: String(e?.message ?? e).slice(0, 150) });
    return { comportamento: 'fail_closed', etapa: null, motivo: 'excecao' };
  }
}

// O bloco e deterministico: o texto sai do 'comportamento', nunca de inferencia
// do modelo sobre o historico.
function blocoGateComercial(g: GateComercial | null): string {
  if (!g) return '';
  if (g.comportamento === 'usar_deal_vigente') {
    return `\n\n[ESTADO COMERCIAL CANONICO: este cliente TEM uma negociacao em andamento${g.etapa ? ` (etapa "${g.etapa}")` : ''}. Trate ELA como a negociacao vigente. NAO trate conversa, orcamento ou cobranca anterior como se fosse outra negociacao em paralelo.]`;
  }
  if (g.comportamento === 'iniciar_negociacao_nova') {
    return '\n\n[ESTADO COMERCIAL CANONICO: este cliente NAO tem negociacao comercial aberta. Construa uma negociacao NOVA. NAO herde pedido, orcamento ou valor de negociacao antiga como se ainda valesse.]';
  }
  return '\n\n[ESTADO COMERCIAL CANONICO INDISPONIVEL: nao foi possivel identificar com seguranca qual negociacao esta vigente. PROIBIDO afirmar qual e o pedido atual, retomar orcamento anterior, ou tratar cobranca/Pix/operacao financeira existente como prova de qual negociacao vale. PERMITIDO conversar, tirar duvidas e coletar informacao — mas o historico da conversa NAO tem autoridade para furar este gate. Se precisar dessa identidade, PERGUNTE ao cliente.]';
}

// TRAVA DURA SOB fail_closed (decisao do Alessandro, 16/08/2026).
// O bloco [JA EXECUTADO] entrega ao modelo valor de cobranca, operation_id, CEP,
// frete e o literal "Retome do ponto em que parou" — ou seja, IDENTIDADE e
// CONTINUIDADE de negociacao por Pix/orcamento/operacao financeira. Sob
// fail_closed ele e suprimido.
// MAS o mesmo bloco carrega a guarda antiduplicidade ("PAGAMENTO JA CONFIRMADO,
// NAO gere cobranca nova"). Apagar tudo trocaria "citar negociacao errada" por
// "cobrar duas vezes". Entao a supressao mantem um RESIDUO SEM VALORES: preserva
// a proibicao de cobrar, remove tudo que reconstroi identidade.
const BLOCO_EXECUCOES_SUPRIMIDO = '\n\n[MOVIMENTACAO FINANCEIRA RECENTE EXISTE neste cliente, mas os detalhes NAO estao disponiveis porque a negociacao vigente nao pode ser identificada. NAO gere cobranca nova, NAO prometa Pix, NAO cite valores anteriores e NAO afirme o que ja foi feito. Se o cliente mencionar pagamento, peca que ele confirme o que foi combinado.]';

// Conteudo que o cliente PRECISA copiar nunca vira audio. Decisao 100%
// deterministica: o modelo nao opina sobre isso.
const RX_VOZ_URL = /https?:\/\/|www\./i;
const RX_VOZ_PIX_BR = /000201\d{6,}/;
const RX_VOZ_CEP = /\b\d{5}-?\d{3}\b/;
const RX_VOZ_MEDIDA = /\b\d+([.,]\d+)?\s?(cm|mm|m|metros?|polegadas?)\b/i;
const RX_VOZ_CODIGO = /\d{8,}/;
const RX_VOZ_VALOR = /R\$\s?\d/;
function respostaElegivelParaVoz(texto: string): boolean {
  const t = String(texto || '').trim();
  if (t.length < 2 || t.length > 1200) return false; // limites do proprio joao-tts
  if (RX_VOZ_URL.test(t)) return false;
  if (RX_VOZ_PIX_BR.test(t)) return false;
  if (RX_VOZ_CEP.test(t)) return false;
  if (RX_VOZ_MEDIDA.test(t)) return false;
  if (RX_VOZ_CODIGO.test(t)) return false;
  if (RX_VOZ_VALOR.test(t)) return false;
  if (t.includes(PIX_CHAVE)) return false;
  return true;
}

// Nunca lanca. Qualquer falha (desligado, timeout, provider, payload invalido)
// vira null, e null significa "segue em texto".
async function sintetizarVoz(texto: string): Promise<Voz | null> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/joao-tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ texto }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.ok !== true) { L('voz_tts_recusado', { http: r.status, motivo: d?.motivo ?? null }); return null; }
    const b64 = String(d.audio_base64 || '');
    if (b64.length < 100) { L('voz_tts_audio_vazio', { chars: b64.length }); return null; }
    return { audio_base64: b64, mime_type: String(d.mime_type || 'audio/ogg'), geracao_ms: Number(d.geracao_ms) || (Date.now() - t0) };
  } catch (e: any) { L('voz_tts_excecao', { erro: String(e?.message ?? e).slice(0, 120) }); return null; }
}

// Mesmo contrato de rastreabilidade do send-text: messageId, zaapId, id, http.
// SEM fallback para BotConversa: audio e transporte unico por definicao.
async function enviarAudioComoJoao(phone: string, audioBase64: string, mime: string): Promise<ResultadoEnvio> {
  const base = { canal: 'zapi', provider: 'zapi' as const };
  if (!(ZAPI_INSTANCE_ID && ZAPI_TOKEN)) {
    return { ok: false, ...base, provider: 'nenhum', canal: 'nenhum', providerId: null, messageId: null, zaapId: null, httpStatus: null, estado: 'nao_observavel', erro: 'zapi_indisponivel_para_audio', resposta: {} };
  }
  // data: URI nao aceita parametros de midia (';codecs=opus') no cabecalho do MIME.
  const mimeLimpo = String(mime || 'audio/ogg').split(';')[0].trim();
  try {
    const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone, audio: `data:${mimeLimpo};base64,${audioBase64}`, waveform: true }),
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json().catch(() => ({}));
    const messageId = d.messageId ? String(d.messageId) : null;
    const zaapId = d.zaapId ? String(d.zaapId) : null;
    const providerId = messageId || zaapId || (d.id ? String(d.id) : null);
    if (r.ok && providerId) return { ok: true, ...base, providerId, messageId, zaapId, httpStatus: r.status, estado: 'aceito_provider', erro: null, resposta: d };
    if (r.ok) return { ok: false, ...base, providerId: null, messageId, zaapId, httpStatus: r.status, estado: 'incerto', erro: 'http_2xx_sem_id_provider', resposta: d };
    return { ok: false, ...base, providerId, messageId, zaapId, httpStatus: r.status, estado: 'rejeitado_provider', erro: `zapi_audio_http_${r.status}`, resposta: d };
  } catch (e: any) {
    // Timeout/rede DEPOIS de disparar: estado incerto, e incerto nao vira texto.
    return { ok: false, ...base, providerId: null, messageId: null, zaapId: null, httpStatus: null, estado: 'incerto', erro: String(e?.message ?? e).slice(0, 150), resposta: {} };
  }
}

// Ponto unico de transporte do Joao. Todo caminho de envio passa por aqui.
async function entregarComoJoao(phone: string, texto: string, assinatura: string, clienteMandouAudio: boolean): Promise<Entrega> {
  const soTexto = async (r: TtsResultado): Promise<Entrega> =>
    ({ env: await enviarComoJoao(phone, texto, assinatura), modalidade: 'texto', ttsResultado: r, ttsDuracaoMs: null });

  // Filtros baratos primeiro: sem eles, cada envio pagaria uma leitura de config.
  if (!clienteMandouAudio) return soTexto('nao_tentado');
  if (assinatura !== ASSINATURA) return soTexto('nao_tentado'); // Pix e ditada nunca falam
  if (!respostaElegivelParaVoz(texto)) return soTexto('nao_tentado');
  if (!(await vozLigada())) return soTexto('desligado');

  const voz = await sintetizarVoz(texto);
  if (!voz) return soTexto('falha'); // falhou ANTES do transporte: texto, uma vez

  // A partir daqui existe UM transporte, e so um. Erro aqui nao vira send-text.
  const env = await enviarAudioComoJoao(phone, voz.audio_base64, voz.mime_type);
  if (!env.ok) await logErro('voz_audio_transporte_falhou', { phone, estado: env.estado, http: env.httpStatus, erro: env.erro });
  return { env, modalidade: 'audio', ttsResultado: 'sucesso', ttsDuracaoMs: voz.geracao_ms };
}

async function reagirComoJoao(phone: string, messageId: string, reaction: string = '\u2764\ufe0f'): Promise<{ ok: boolean; canal: string }> {
  if (!(ZAPI_INSTANCE_ID && ZAPI_TOKEN && messageId)) return { ok: false, canal: 'nenhum' };
  try {
    const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone, reaction, messageId }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && !!(d.messageId || d.zaapId || d.id), canal: 'zapi' };
  } catch { return { ok: false, canal: 'zapi' }; }
}
async function messageIdInbound(ids: any[] | null, phone: string, mensagem: string): Promise<string | null> {
  try {
    let q: any = sb.from('inbound_fora_horario').select('body, created_at').eq('phone', phone).order('created_at', { ascending: false }).limit(10);
    if (ids && ids.length > 0) q = q.in('id', ids);
    else q = q.gte('created_at', new Date(Date.now() - 600000).toISOString());
    const { data } = await q;
    const alvo = (data || []).find((r: any) => String(r.body?.text?.message || '').trim() === mensagem.trim()) || (data || [])[0];
    return alvo?.body?.messageId ? String(alvo.body.messageId) : null;
  } catch { return null; }
}
async function gravarFio(row: any) { try { await sb.from('fact_conversations').insert(row); } catch {} }

const sanearMsg = (m: string) => String(m || '')
  .replace(REGEX_EMOJI, '')
  .replace(/\*\*(.+?)\*\*/g, '*$1*')
  .replace(/\bopa\b[,!.]?\s*/gi, '')
  .replace(/\s*\((?![^)]*R\$)[^)]*\)/g, '')
  .replace(/\s*[\u2014\u2013]\s*/g, ', ')
  .replace(/\bamanh\u00e3 (cedo )?a equipe/gi, 'no pr\u00f3ximo dia \u00fatil, logo cedo, a equipe')
  .replace(/(?<![.:\d])\b([\p{L}]{2,12})\/([\p{L}]{2,12})/gu, (m: string, a: string, b: string) => a + ', ' + b)
  .replace(/[ \t]{2,}/g, ' ').trim();
const validarMsg = (m: string, ehPerguntaDireta: boolean) => m.length >= 5 && m.length <= 1200
  && !/\[[^\]]+\]|\{[^}]+\}/.test(m)
  && !/plant(\u00e3o|ao|onista)/i.test(m)
  && !REGEX_INVENCAO.test(m) && !REGEX_NEGA_VISAO.test(m)
  && !/(o sistema (est\u00e1|esta) (bloquea|impedin)|sistema bloqueou|minha ferramenta)/i.test(m)
  && (m.includes(PIX_CHAVE) || m.includes('61795-4') || /000201/.test(m) || // v104: a guarda barrava NOME DE BAIRRO. "Jardim Sao Marcos" contem "Marcos", que e
    // nome de agente, entao a resposta com o endereco da loja foi derrubada e a cliente
    // recebeu o cardapio (01/08 20:05). Agora nome precedido de palavra de LUGAR nao conta.
    !/(?<!\b(?:s[\u00e3a]o|santo|santa|jardim|jd\.?|vila|vl\.?|rua|r\.|av|avenida|bairro|parque|pq\.?|residencial|conjunto|estrada|travessa|alameda|pra[\u00e7c]a)\s)\b(Tamires|Alessandro|Julia|Marcos|Bruno)\b/i.test(m))
  && !(ehPerguntaDireta && /logo cedo a equipe te responde/i.test(m));
// v4.33.0 P0: antes esta guarda LIBERAVA o CNPJ 30248650000111 como chave valida. Ele nao
// e a chave operacional, entao nenhuma chave de 14 digitos pode mais atravessar.
const validarPix = (m: string) => { const semQr = m.replace(/000201[\w\W]{50,}/, ''); const chaves = semQr.match(/\b\d{14}\b/g) || []; return chaves.length === 0; };


// ── v4.33.0 P0: EGRESSO DE IDENTIFICADOR FINANCEIRO INTERNO ─────────────────────────
// DEFEITO PROVADO. 25/08/2026 02:19:01 UTC, lead b77c4808-a3e0-4240-90af-967c845190bc:
// Joao enviou "Perfeito! Segue o Pix:" e, na linha seguinte, o UUID
// 02d22212-8e17-4dfb-9fa4-1c184b7ac1b9 — que e operacoes_financeiras.id, kind=produto,
// amount=101.18, status=ativa, emitido 6 segundos antes por calcular_rendimento_uv.
// Nao e payment_id e nao existia cobranca mp_pix_cobrancas desse lead. O cliente recebeu
// um identificador INTERNO como se fosse Pix.
//
// INCIDENCIA MEDIDA em fact_conversations outbound (deduplicando o eco joao/zapi, que
// duplica 2x cada mensagem): 8 linhas brutas => 4 vazamentos distintos, 4 telefones:
//   04/08 01:00 tel 0059 — pedido_total R$64,52, id dentro de code block markdown ```
//   08/08 20:20 tel 1308 — pedido_total R$41,83, id dentro de https://pay.smartpag.com.br/<id>
//   23/08 22:15 tel 9530 — produto R$233,61, id solto apos "Cartao certo?"
//   25/08 02:19 tel 5163 — produto R$101,18, id apos "Segue o Pix:"
// Os quatro formatos da REGRA (solto, apos frase de Pix, em markdown, dentro de URL)
// aconteceram de verdade. Nao e caso isolado e a frequencia subiu em agosto.
//
// CAUSA ESTRUTURAL. lerExecucoes injeta AUTORIZACOES ATIVAS com operation_id no contexto e
// financial_authorizations devolve operation_id — as duas coisas sao NECESSARIAS para o
// modelo chamar gerar_pix. O defeito nunca foi a entrada: e a ausencia de qualquer barreira
// na SAIDA. validarPix so olhava chave CNPJ de 14 digitos; a extracao deterministica do Pix
// so reconhecia linha comecando em '000201'; a guarda de URL tinha um furo proprio (abaixo).
// Uma frase como "Segue o Pix: <uuid>" atravessava inteira.
//
// A PROTECAO E POR PROVENIENCIA, NAO POR FORMATO. Nao se bloqueia todo UUID: uma chave Pix
// aleatoria legitima tambem tem formato UUID. Bloqueia-se o UUID que EXISTE em
// operacoes_financeiras — onde vivem TODOS os ids internos em jogo: as autorizacoes lidas por
// lerExecucoes, os operation_id do envelope, o id novo devolvido por compor_total e o
// ctx.pixGerado.operation_id. Um UUID que nao esta la nao e identificador interno e passa.
const RX_UUID_G = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const RX_UUID_EXATO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Ids internos que este turno JA conhece sem ir ao banco. Serve de atalho e de rede de
// seguranca: se a leitura do banco falhar, o que esta aqui ja basta para fechar a porta.
function colherIdsInternosDoCtx(ctx: any): Set<string> {
  const s = new Set<string>();
  const add = (v: unknown) => { const x = String(v ?? '').trim().toLowerCase(); if (RX_UUID_EXATO.test(x)) s.add(x); };
  for (const a of (Array.isArray(ctx?.autorizacoes) ? ctx.autorizacoes : [])) { add(a?.operation_id); add(a?.id); }
  add(ctx?.pixGerado?.operation_id);
  return s;
}

// Remove do texto A SER AUDITADO apenas os QR EMV de proveniencia PROVADA, para que uma chave
// Pix aleatoria legitima DENTRO do payload oficial 000201... nao seja confundida com id
// interno. Nao basta "comecar com 000201": so o codigo EXATO devolvido pelo provider (ou lido
// de mp_pix_cobrancas.qr_code) e exempto — senao bastaria prefixar 000201 para escapar.
// O QR oficial em si nao e tocado por esta funcao: ele atravessa intacto para o cliente.
function textoSemQrProvado(t: string, qrsProvados: Array<string | null | undefined>): string {
  let out = String(t || '');
  for (const qr of qrsProvados) {
    const s = String(qr || '').trim();
    if (s.length >= 40) out = out.split(s).join(' ');
  }
  return out;
}

// Devolve os UUIDs do texto que sao identificadores financeiros INTERNOS.
// Nao filtra por lead: um operation_id de OUTRO lead tambem e interno e tambem nao pode sair.
// Erro de leitura FECHA a porta — na duvida, nao entrega.
async function idsInternosNoTexto(texto: string, ctx: any, qrsProvados: Array<string | null | undefined>): Promise<string[]> {
  const limpo = textoSemQrProvado(texto, qrsProvados);
  const achados = Array.from(new Set((limpo.match(RX_UUID_G) || []).map((u: string) => u.toLowerCase())));
  if (achados.length === 0) return [];
  const conhecidos = colherIdsInternosDoCtx(ctx);
  const jaInternos = achados.filter((u: string) => conhecidos.has(u));
  const restantes = achados.filter((u: string) => !conhecidos.has(u));
  if (restantes.length === 0) return jaInternos;
  try {
    const { data, error } = await sb.from('operacoes_financeiras').select('id').in('id', restantes);
    if (error) throw new Error(String(error.message || 'erro_leitura'));
    const doBanco = (data || []).map((r: any) => String(r.id).toLowerCase());
    return Array.from(new Set([...jaInternos, ...doBanco]));
  } catch (e: any) {
    await logErro('guardrail_egresso_leitura_falhou', { erro: String(e?.message ?? e).slice(0, 150), candidatos: restantes.slice(0, 3) });
    return Array.from(new Set([...jaInternos, ...restantes]));
  }
}

// Expurga os ids internos do texto: soltos, em markdown ou dentro de URL. A URL INTEIRA cai —
// um link inventado que carrega o id nao pode virar "link sem id", que continuaria quebrado.
function expurgarIdsInternos(texto: string, ids: string[]): string {
  let out = String(texto || '');
  for (const id of ids) out = out.replace(new RegExp('\\S*' + id + '\\S*', 'gi'), '');
  return out
    .replace(/```\s*```/g, '')
    .replace(/^[ \t]*[`>*_-]+[ \t]*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// GUARDA DE TRANSPORTE. Roda imediatamente antes de a mensagem sair, em TODO caminho de saida
// (resposta do fluxo principal e _direct_message). Nao confia no texto do modelo nem no texto
// ditado: pergunta ao banco se aquele UUID e um identificador financeiro interno.
async function guardaEgressoFinanceiro(
  texto: string, ctx: any, qrsProvados: Array<string | null | undefined>, phone: string, origem: string,
): Promise<{ bloqueou: boolean; texto: string; ids: string[] }> {
  const ids = await idsInternosNoTexto(texto, ctx, qrsProvados);
  if (ids.length === 0) return { bloqueou: false, texto, ids: [] };
  await logErro('guardrail_identificador_financeiro_interno', {
    phone, origem, ids: ids.slice(0, 4),
    trecho: String(texto || '').replace(/\n/g, ' ').slice(0, 180),
  });
  L('guardrail_identificador_financeiro_interno', { phone: String(phone || '').slice(-4), origem, qtd: ids.length });
  return { bloqueou: true, texto: expurgarIdsInternos(texto, ids), ids };
}

// ── v4.33.0 P0: CLIENTE CONDICIONOU O PAGAMENTO A APROVACAO DA ARTE ─────────────────
// No caso de 25/08 o cliente escreveu "Ok fico no aguardo da art para finalizacao e pagamento"
// e o Pix saiu 3 segundos depois. A politica comercial NAO muda: pagamento continua ANTES da
// producao. O que muda e so o TURNO: quando o proprio cliente condiciona explicitamente o
// pagamento a ver a arte, a sequencia dele e arte -> aprovacao -> finalizacao -> pagamento ->
// producao, e cobrar naquele turno atropela o que ele acabou de dizer. Vale so para o turno em
// que a frase aparece — nao vira regra geral de "pagar depois".
const RX_HOLD_ARTE_PAGAMENTO = /\b(?:aguard\w*|esper\w*|assim que|depois que|quando|ap[oó]s)\b[^.!?\n]{0,60}\b(?:arte|art|layout|mockup|prova)\b[^.!?\n]{0,60}\b(?:pag\w*|finaliza\w*|fech\w*)\b|\b(?:arte|art|layout|mockup)\b[^.!?\n]{0,40}\b(?:antes d[eo]|primeiro)\b[^.!?\n]{0,30}\b(?:pag\w*|fech\w*)\b/i;

async function processarLostCanonico(conversationId: string | null, leadId: string | null, mensagem: string, decisionId: string | null, dryRun: boolean): Promise<any> {
  if (!conversationId || !leadId) return { ok: true, aplicado: false, motivo: 'identidade_incompleta' };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/joao-lost-canonico`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ conversation_id: conversationId, lead_id: leadId, decision_id: decisionId, mensagem, dry_run: dryRun }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) await logErro('joao_lost_canonico_falhou', { conversation_id: conversationId, http: r.status, erro: body?.erro ?? null });
    return { http: r.status, ...body };
  } catch (e: any) {
    await logErro('joao_lost_canonico_falhou', { conversation_id: conversationId, erro: String(e).slice(0, 160) });
    return { ok: false, aplicado: false, erro: 'falha_tecnica' };
  }
}

// v4.31.0 P0: idsParaCarimbar passa a ser owned_inbound_ids — os IDs exatos dos inbounds
// incorporados a ESTA mensagem — e loteCreatedAtMax a fronteira temporal do lote. Os dois
// acompanham o turno inteiro: entrada -> decisao -> barreira -> transporte -> carimbo.
async function atenderCliente(phone: string, chatName: string, mensagem: string, imagens: string[], transcricoes: string[], idsParaCarimbar: any[] | null, dryRun: boolean, loteCreatedAtMax: string | null = null): Promise<any> {
  if (!dryRun) { const temLock = await adquirirLock(phone); if (!temLock) return { ok: true, skip: 'lock_ocupado' }; }
  try { return await atenderClienteInterno(phone, chatName, mensagem, imagens, transcricoes, idsParaCarimbar, dryRun, loteCreatedAtMax); }
  finally { if (!dryRun) await liberarLock(phone); }
}

async function atenderClienteInterno(phone: string, chatName: string, mensagem: string, imagens: string[], transcricoes: string[], idsParaCarimbar: any[] | null, dryRun: boolean, loteCreatedAtMax: string | null = null): Promise<any> {
  if (await agentePausado(phone)) {
    if (!dryRun) await carimbarInbound(phone, idsParaCarimbar, 'pausado_humano');
    return { ok: true, respondeu: false, skip: 'agente_pausado' };
  }
  const ehFormulario = REGEX_FORMULARIO.test(mensagem);
  const ehPerguntaDireta = /\?\s*$/.test(mensagem.trim()) || REGEX_PEDIDO_INFO.test(mensagem);
  const pediuMudanca = REGEX_PEDIU_MUDANCA.test(mensagem);
  const objecaoPreco = REGEX_OBJECAO_PRECO.test(mensagem);

  let leadId: string | null = null; let comprou = false; let categoriaAnuncio = '';
  try {
    const lead = await resolverLeadPorTelefone(phone);
    leadId = lead.lead_id;
    categoriaAnuncio = lead.content_category;
    if (leadId) {
      const { data: p } = await sb.from('pixel_events').select('id').eq('lead_id', leadId).eq('event_name', 'Purchase').gt('value', 0).limit(1).maybeSingle();
      comprou = !!p;
    }
  } catch {}
  if (comprou) {
    if (!dryRun) await carimbarInbound(phone, idsParaCarimbar, 'silencio_joao');
    return { ok: true, skip: 'cliente_comprador' };
  }
  if (!leadId && !dryRun) leadId = await garantirLead(phone, chatName);

  const estadoRaw = await lerEstado(phone);
  const idadeEstado = estadoRaw?.updated_at ? Date.now() - new Date(estadoRaw.updated_at).getTime() : Infinity;
  const estadoFresco = idadeEstado < ESTADO_VALIDO_MS;
  const slotsSalvos = (estadoRaw?.slots || {}) as any;
  const estado = estadoFresco ? estadoRaw : null;

  const execucoes = await lerExecucoes(leadId, pediuMudanca);
  const blocoArquivos = await blocoArquivosDoLead(leadId);
  const gateComercial = await lerGateComercialCanonico(leadId);

  let blocoAnuncio = ''; let anuncioTexto = ''; let anuncioRecente = false;
  try {
    const { data: adRow } = await sb.from('inbound_fora_horario').select('body, created_at').like('phone', `%${phone.slice(-8)}`).not('body->externalAdReply', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const ad: any = (adRow as any)?.body?.externalAdReply;
    if (ad && (ad.title || ad.body || ad.greetingMessageBody)) {
      const adTitulo = String(ad.title || '').slice(0, 120);
      const adTexto = String(ad.body || '').replace(/\s+/g, ' ').slice(0, 350);
      // v101: a SAUDACAO do anuncio e onde o produto aparece com todas as letras
      // ("Ola! Tenho interesse em impressao DTF Textil vendido por metro"). O titulo costuma
      // ser chamada de marketing sem produto nenhum ("Seu prazo nao permite retrabalho") e
      // sozinho fazia o Joao abrir cardapio para quem ja tinha declarado o que queria.
      const adSaudacao = String(ad.greetingMessageBody || '').replace(/\s+/g, ' ').slice(0, 200);
      anuncioTexto = (adTitulo + ' ' + adTexto + ' ' + adSaudacao).toLowerCase();
      anuncioRecente = adRow?.created_at ? (Date.now() - new Date(adRow.created_at).getTime()) < ANUNCIO_RECENTE_MS : false;
      blocoAnuncio = adSaudacao
        ? `\n\n[AN\u00daNCIO DE ORIGEM: "${adTitulo}". O cliente clicou dizendo: "${adSaudacao}". ELE J\u00c1 DISSE O QUE QUER \u2014 N\u00c3O pergunte qual produto interessa nem liste cardapio. V\u00e1 direto para esse produto e fa\u00e7a a PR\u00d3XIMA pergunta que falta para orcar. S\u00f3 mude de produto se ELE pedir.]`
        : `\n\n[AN\u00daNCIO DE ORIGEM: "${adTitulo}". Comece por esse produto, mas atenda outro se ele pedir.]`;
    }
  } catch {}
  const prodAnuncio = categoriaParaProduto(anuncioTexto);
  const prodCategoria = categoriaParaProduto(categoriaAnuncio);
  const prodOrigem = (anuncioRecente && prodAnuncio) ? prodAnuncio : (prodCategoria || prodAnuncio);
  if (anuncioRecente && prodAnuncio && prodCategoria && prodAnuncio !== prodCategoria) categoriaAnuncio = '';

  let conversaAtivaHoje = false; let ultimaMsgJoao = ''; let promessaJaDada = false; let jaDespediuHoje = false;
  let ackCortesiaJaEnviado = false; // v4.21.4 A2
  let humanoAtivoRecente = false; let humanoNegociou = false;
  let jaPediuPrecoAntes = false; let joaoJaDeuPreco = false;
  let inbounds: any[] = [];
  const valoresCitados: number[] = [...execucoes.valores];
  const RX_HUMANO = /^\*(Tamires|Helen|Alessandro|Gabriel|Daniel|Edson|Kezia|Equipe)/i;
  let blocoAprendizados = '';
  let manifestoAprendizados: any = null;
  // v4.23.4: historico/conversa e aprendizados falham de forma independente.
  // Uma falha na entrega das licoes nao apaga as guardas de humano, preco e continuidade.
  try {
    const [outsR, inbsR] = await Promise.all([
      sb.from('fact_conversations').select('source, message_text, timestamp').like('phone', `%${phone.slice(-8)}`).eq('direction', 'outbound').gte('timestamp', new Date(Date.now() - 14 * 3600000).toISOString()).order('timestamp', { ascending: false }).limit(6),
      sb.from('fact_conversations').select('message_text, timestamp').like('phone', `%${phone.slice(-8)}`).eq('direction', 'inbound').gte('timestamp', new Date(Date.now() - 14 * 3600000).toISOString()).order('timestamp', { ascending: false }).limit(8),
    ]);
    const outs = outsR.data;
    inbounds = inbsR.data || [];
    conversaAtivaHoje = !!(outs && outs.length > 0);
    const uj = (outs || []).find((o: any) => o.source === 'joao');
    if (uj && Date.now() - new Date(uj.timestamp).getTime() < 3600000) ultimaMsgJoao = uj.message_text || '';
    promessaJaDada = (outs || []).some((o: any) => /pr\u00f3ximo dia \u00fatil/i.test(o.message_text || ''));
    jaDespediuHoje = (outs || []).some((o: any) => { const t = String(o.message_text || '').trim(); return /bom descanso/i.test(t) || RX_DESPEDIDA_FIM.test(t); });
    ackCortesiaJaEnviado = (outs || []).some((o: any) => RX_ACK_CORTESIA.test(String(o.message_text || '')));
    humanoAtivoRecente = (outs || []).some((o: any) => RX_HUMANO.test(o.message_text || '') && Date.now() - new Date(o.timestamp).getTime() < 2 * 3600000);
    humanoNegociou = (outs || []).some((o: any) => RX_HUMANO.test(o.message_text || '') && /\.pdf|or\u00e7amento|link de pagamento|chave pix|comprovante/i.test(o.message_text || ''));
    joaoJaDeuPreco = (outs || []).some((o: any) => /R\$\s?\d/.test(o.message_text || ''));
    jaPediuPrecoAntes = inbounds.some((i: any) => REGEX_PEDIU_PRECO.test(String(i.message_text || '')));
    for (const o of (outs || [])) {
      const ms = String(o.message_text || '').match(/R\$\s?(\d{1,5}[.,]\d{2})/g) || [];
      for (const mv of ms) { const n = parseFloat(mv.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.')); if (!isNaN(n) && n > 0 && n < 100000) valoresCitados.push(Math.round(n * 100) / 100); }
    }
  } catch (e: any) {
    await logErro('contexto_conversa_falhou', { phone, erro: String(e?.message ?? e).slice(0,150) });
  }
  try {
    const { data: apr, error: aprErro } = await sb.rpc('fn_contexto_aprendizados', { p_agente_slug: 'agente-noturno', p_segmento: null });
    if (aprErro || apr?.ok !== true) throw new Error(aprErro?.message || 'retorno_sem_ok');
    const blocoCompleto = String(apr.bloco_erros || '') + String(apr.bloco_acertos || '');
    const man = apr.manifesto || {};
    const hashCalculado = await sha256Texto(blocoCompleto);
    const charsReais = Array.from(blocoCompleto).length;
    const ids = Array.isArray(man.ids) ? man.ids : [];
    const candidatas = Number(man.regras_candidatas);
    const incluidas = Number(man.regras_incluidas);
    const selecionados = Number(man.selecionados);
    const omitidos = Number(man.omitidos);
    const criticasFora = Number(man.criticas_fora_orcamento);
    const charsDeclarados = Number(man.chars);
    const numericosValidos = [candidatas, incluidas, selecionados, omitidos, criticasFora, charsDeclarados].every((n: number) => Number.isInteger(n) && n >= 0);
    let motivoRecusa: string | null = null;
    if (!numericosValidos || !Array.isArray(man.ids)) motivoRecusa = 'manifesto_formato_invalido';
    else if (charsDeclarados !== charsReais) motivoRecusa = 'chars_divergentes';
    else if (String(man.sha256 || '') !== hashCalculado) motivoRecusa = 'sha256_divergente';
    else if (ids.length !== incluidas || selecionados !== incluidas) motivoRecusa = 'ids_ou_selecionados_divergentes';
    else if (candidatas !== incluidas + omitidos) motivoRecusa = 'contagem_candidatas_divergente';
    else if (charsReais > 6000) motivoRecusa = 'orcamento_excedido_sem_truncar';
    else if (criticasFora > 0) motivoRecusa = 'critica_fora_orcamento';
    manifestoAprendizados = {
      aprendizados_ok: motivoRecusa === null, motivo: motivoRecusa,
      regras_candidatas: candidatas, regras_incluidas: incluidas, selecionados, omitidos,
      criticas_fora_orcamento: criticasFora, ids,
      chars_declarados: charsDeclarados, chars_reais: charsReais,
      sha256_declarado: String(man.sha256 || ''), sha256_real: hashCalculado
    };
    if (motivoRecusa) {
      await logErro('aprendizados_manifesto_recusado', manifestoAprendizados);
      blocoAprendizados = '';
    } else {
      blocoAprendizados = blocoCompleto;
      if (omitidos > 0) await logErro('aprendizados_manifesto_aceito_com_omissoes', manifestoAprendizados); else L('aprendizados_manifesto_aceito', manifestoAprendizados);
    }
  } catch (e: any) {
    blocoAprendizados = '';
    manifestoAprendizados = { aprendizados_ok: false, motivo: 'recuperacao_falhou', erro: String(e?.message ?? e).slice(0,150) };
    await logErro('aprendizados_recuperacao_falhou', { phone, ...manifestoAprendizados });
  }

  if (humanoAtivoRecente || humanoNegociou) {
    if (!dryRun) await carimbarInbound(phone, idsParaCarimbar, 'humano_ativo');
    return { ok: true, respondeu: false, skip: 'humano_ativo' };
  }
  // v4.22.2: ack curto depois de encerramento e gesto, nao um novo turno comercial.
  // A dupla condicao impede reagir a "sim/ok" no meio da coleta de dados ou da venda.
  if (RX_CONFIRMACAO_CURTA.test(mensagem.trim()) && RX_ENCERRAMENTO_JOAO.test(ultimaMsgJoao)) {
    if (dryRun) return { ok: true, dry_run: true, respondeu: false, reagiu: true, reaction: '\u2764\ufe0f', motivo: 'confirmacao_curta_pos_encerramento' };
    const messageId = await messageIdInbound(idsParaCarimbar, phone, mensagem);
    const envR = messageId ? await reagirComoJoao(phone, messageId) : { ok: false, canal: 'zapi' };
    await registrarDecisao(leadId, envR.ok ? 'reacao_cortesia_enviada' : 'reacao_cortesia_falhou',
      { phone_final: phone.slice(-4), canal: envR.canal, message_id_presente: !!messageId, reaction: '\u2764\ufe0f' },
      { mensagem_cliente: mensagem.slice(0, 80), ultima_msg_joao: ultimaMsgJoao.slice(0, 180) });
    if (!envR.ok) await logErro('reacao_cortesia_falhou', { phone, message_id_presente: !!messageId });
    await carimbarInbound(phone, idsParaCarimbar, envR.ok ? 'atendido_joao' : 'cortesia_encerrada');
    return { ok: true, respondeu: false, reagiu: envR.ok, motivo: 'confirmacao_curta_pos_encerramento', canal: envR.canal };
  }
  // ── v4.21.4 ETAPA A2: cortesia nunca encerra turno em silencio mudo ──
  const cortesiaPura = REGEX_CORTESIA.test(mensagem.trim());
  const motivoCortesia = (jaDespediuHoje && cortesiaPura) ? 'cortesia_pos_despedida'
    : (execucoes.cobrancaPendente && !pediuMudanca && cortesiaPura) ? 'cortesia_pos_cobranca' : null;
  if (motivoCortesia) {
    if (ackCortesiaJaEnviado) {
      if (!dryRun) {
        await registrarDecisao(leadId, 'silencio_cortesia_deliberado', { phone_final: phone.slice(-4), motivo: motivoCortesia }, { mensagem_cliente: mensagem.slice(0, 80) });
        await carimbarInbound(phone, idsParaCarimbar, 'cortesia_encerrada');
      }
      return { ok: true, respondeu: false, motivo: motivoCortesia, deliberado: true };
    }
    const respostaCortesia = motivoCortesia === 'cortesia_pos_cobranca'
      ? 'Seu pedido está reservado e o Pix que te mandei continua valendo. A confirmação é automática e eu te aviso por aqui.'
      : despedidaPeriodo(slotsSalvos._idioma === 'es' ? 'es' : 'pt');
    if (dryRun) return { ok: true, dry_run: true, respondeu: true, motivo: motivoCortesia, resposta: respostaCortesia };
    // v4.25.0: a cortesia enviava FORA do ledger — sem linha em joao_envios, sem
    // provider_message_id, sem reconciliacao por callback. Passa a usar o mesmo
    // preparo/finalizacao dos demais caminhos. tipo='resposta' porque o CHECK de
    // joao_envios so admite resposta|pix|mensagem_ditada|reacao, e cortesia e uma
    // resposta; quem a distingue e registrarDecisao logo abaixo.
    const executionIdC = crypto.randomUUID();
    const envioCId = await prepararEnvio(null, executionIdC, 1, 'resposta', phone);
    const entregaC = await entregarComoJoao(phone, respostaCortesia, ASSINATURA, transcricoes.length > 0);
    const envC = entregaC.env;
    await finalizarEnvioLedger(envioCId, envC, entregaC.modalidade, entregaC.ttsResultado, entregaC.ttsDuracaoMs);
    if (envC.ok) {
      await gravarFio({ lead_id: leadId, phone, direction: 'outbound', message_text: ASSINATURA + respostaCortesia, message_type: entregaC.modalidade === 'audio' ? 'audio' : 'text', timestamp: new Date().toISOString(), source: 'joao' });
      await carimbarInbound(phone, idsParaCarimbar, 'atendido_joao');
    } else {
      await logErro('cortesia_resposta_falhou_envio', { phone, motivo: motivoCortesia });
      await carimbarInbound(phone, idsParaCarimbar, 'silencio_joao');
    }
    await registrarDecisao(leadId, envC.ok ? 'resposta_cortesia_enviada' : 'resposta_cortesia_falhou', { motivo: motivoCortesia, canal: envC.canal, phone_final: phone.slice(-4) }, { mensagem: respostaCortesia.slice(0, 200) });
    return { ok: true, respondeu: envC.ok, motivo: motivoCortesia, canal: envC.canal };
  }

  const prodMsg = produtoNaMensagem(mensagem);
  // v4.28.0 P14: correlaciona as duas camadas observacionais deste turno. decisionId so
  // nasce depois das tools e dos slots, entao ele nao serve de chave aqui.
  const obsTurnId = crypto.randomUUID();
  const obsModalidade = detectarModalidade(mensagem);
  const obsCorrecoes = detectarCorrecoes(mensagem);

  // ── v4.34.0 P0: HISTORICO LOGISTICO DO CLIENTE (fonte de NIVEL 3) ─────────
  // Janela longa e SOMENTE INBOUND: o que o Joao escreveu nao declara nada pelo cliente.
  // Recorta fora a janela do pedido atual (14h), que ja e coberta por `inbounds` no nivel 2.
  let historicoInbound: any[] = [];
  try {
    const { data: hl } = await sb.from('fact_conversations')
      .select('message_text, timestamp').like('phone', `%${phone.slice(-8)}`)
      .eq('direction', 'inbound')
      .gte('timestamp', new Date(Date.now() - 180 * 24 * 3600000).toISOString())
      .lt('timestamp', new Date(Date.now() - 14 * 3600000).toISOString())
      .order('timestamp', { ascending: false }).limit(40);
    historicoInbound = hl || [];
  } catch (e: any) { await logErro('historico_logistico_falhou', { phone, erro: String(e?.message ?? e).slice(0, 120) }); }

  let estadoLog = resolverModalidadeLogistica({
    mensagemAtual: mensagem,
    inboundsPedido: inbounds,
    historicoInbound,
    slots: { ...(estado?.slots || {}) },
    phone,
    freteJa: execucoes.freteJa,
    produtoContexto: [prodMsg, estado?.slots?.produto, categoriaAnuncio].filter(Boolean).join(' '),
  });
  // ── v4.35.0 P0: NIVEL 3 DO CEP. O cadastro canonico so e LIDO quando a modalidade
  // admite frete. Sob retirada, motoboy ou produto digital nao ha leitura nenhuma — e por
  // isso "CEP salvo no cadastro nao interfere" e propriedade estrutural, nao promessa.
  let cadastroPessoa: PessoaCadastro = CADASTRO_VAZIO;
  if (!estadoLog.bloqueia_frete) {
    cadastroPessoa = await lerPessoaCanonicaPorTelefone(phone);
    estadoLog = refinarCepComCadastro(estadoLog, cadastroPessoa, { ...(estado?.slots || {}) }, mensagem, ultimaMsgJoao || '');
  }
  L('modalidade_logistica', {
    phone: phone.slice(-4), modalidade: estadoLog.modalidade, prov: estadoLog.proveniencia,
    nivel: estadoLog.fonte_nivel, bloqueia_frete: estadoLog.bloqueia_frete, pedir_cep: estadoLog.pedir_cep,
    cep_fonte: estadoLog.cep_fonte, confirmar_cep: estadoLog.pedir_confirmacao_cep,
  });
  if (!dryRun && estadoLog.fonte_nivel <= 3) {
    await logErro('modalidade_logistica_resolvida', {
      phone, turn_id: obsTurnId, agent_version: V,
      modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
      fonte_nivel: estadoLog.fonte_nivel, evidencia: estadoLog.evidencia,
      confirmar_com_cliente: estadoLog.confirmar_com_cliente,
      bloqueia_frete: estadoLog.bloqueia_frete, motivo_bloqueio: estadoLog.motivo_bloqueio,
      pedir_cep: estadoLog.pedir_cep, cep_conhecido: estadoLog.cep_conhecido, cep_fonte: estadoLog.cep_fonte,
    });
  }
  const mudouProduto = !!(prodMsg && prodOrigem && prodMsg !== prodOrigem);
  const vezesCitou = inbounds.filter((i: any) => produtoNaMensagem(String(i.message_text || '')) === prodMsg).length;
  const insistindo = !!(prodMsg && vezesCitou >= 2);
  let blocoMudouProduto = '';
  if (mudouProduto) {
    blocoMudouProduto = `\n\n[O CLIENTE MUDOU DE ASSUNTO: chegou pelo an\u00fancio de ${NOME_PRODUTO[prodOrigem!] || prodOrigem}, mas pergunta sobre ${NOME_PRODUTO[prodMsg!] || prodMsg}. ATENDA O QUE ELE PEDIU com pre\u00e7o.${insistindo ? ' ELE J\u00c1 PERGUNTOU MAIS DE UMA VEZ: responda agora sem rodeio.' : ''}]`;
  }
  // v109 CAMADA 1: RESPOSTA CURTA A PERGUNTA PROPRIA.
  // MEDIDO em 02/08, tres casos no mesmo dia: "Um a4" virou frase de espera · "Streetwear"
  // virou impressao de camiseta · "13503668" (CEP que ELE tinha acabado de pedir) fez ele voltar
  // para a PRIMEIRA pergunta da conversa. Sempre resposta curta a pergunta que ele mesmo fez.
  // Existe regra em texto no prompt ("UMA PALAVRA e SEMPRE resposta do cliente") e ele IGNORA.
  // Em vez de torcer para o modelo deduzir, o sistema entrega a ligacao pronta.
  const msgCurta = mensagem.trim().split(/\s+/).length <= 3 && mensagem.trim().length <= 40;
  const perguntaAnterior = (ultimaMsgJoao || '').replace(/^\*[^*]+:\*\n?/, '').trim();
  const temPerguntaAnterior = /\?/.test(perguntaAnterior);
  let blocoRespostaCurta = '';
  if (msgCurta && temPerguntaAnterior) {
    const ultimaPergunta = (perguntaAnterior.match(/[^.!?\n]*\?/g) || []).slice(-1)[0]?.trim() || perguntaAnterior.slice(-160);
    blocoRespostaCurta = `\n\n[VOC\u00ca ACABOU DE PERGUNTAR: "${ultimaPergunta}"\n`
      + `O CLIENTE RESPONDEU: "${mensagem.trim()}"\n`
      + `ISSO \u00c9 A RESPOSTA \u00c0 SUA PERGUNTA. Use e siga para o PR\u00d3XIMO passo. `
      + `PROIBIDO perguntar de novo a mesma coisa ou voltar a uma pergunta anterior da conversa.]`;
  }

  const blocoObjecao = objecaoPreco ? '\n\n[O CLIENTE ACHOU CARO OU EST\u00c1 COMPARANDO PRE\u00c7O: N\u00c3O repita s\u00f3 o total. Explique que o DTF UV \u00e9 cobrado pela \u00c1REA do filme, diga quantos adesivos cabem em 1 metro naquele tamanho e quanto sai por unidade. Se sobrar espa\u00e7o no material, ofere\u00e7a levar mais unidades pelo mesmo filme.]' : '';

  let hist: any[] = [];
  try {
    // v102: o corpus guarda CADA mensagem do agente DUAS vezes — uma com source='joao' e outra
    // com o eco do 'zapi' que volta do WhatsApp. Medido num atendimento real (991990717): das 60
    // linhas carregadas, 25 eram eco. O merge mais abaixo ja descartava o texto repetido, mas o
    // eco OCUPAVA VAGA no limite de 60 — entao a memoria util era ~35 linhas, e ele esquecia o que
    // foi combinado 2h antes (perguntou "varias canecas ou varias camisetas?" as 18:02 sobre algo
    // ja acordado as 16:04). Agora busca 120 e descarta o eco ANTES de cortar em 60.
    const { data: brutas } = await sb.from('fact_conversations')
      .select('direction, message_text, timestamp, source')
      .like('phone', `%${phone.slice(-8)}`)
      .order('timestamp', { ascending: false }).limit(120);
    const vistas = new Set<string>();
    const data = (brutas || []).filter((h: any) => {
      if (h.direction !== 'outbound') return true;
      const chave = String(h.message_text || '').slice(0, 160);
      if (!chave) return true;
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    }).slice(0, 60);
    // v4.31.0 P0: REMOVIDO o atalho ja_respondida. Ele concluia "existe outbound com
    // timestamp maior que o do ultimo inbound, logo esse inbound ja foi respondido" e
    // carimbava atendido_joao sem enviar nada. A propriedade outbound.created_at >
    // inbound.created_at nao prova autoria: no caso 5513974079782 o outbound posterior
    // pertencia ao turno de A e engoliu B. Nenhuma heuristica de relogio entra no lugar —
    // quem garante que uma resposta ainda vale e a barreira de frescor antes do envio.
    const linhas = (data || []).reverse().map((h: any) => ({ role: h.direction === 'inbound' ? 'user' : 'assistant', content: (h.message_text || '').replace(/^\*[^*]+:\*\n?/, '').trim() })).filter((m: any) => m.content.length > 0 && !/^\[[^\]]+\]$/.test(m.content));
    const mescladas: any[] = [];
    for (const m of linhas) {
      const ult = mescladas[mescladas.length - 1];
      if (ult && ult.role === m.role) { if (!ult.content.includes(m.content)) ult.content += '\n' + m.content; }
      else mescladas.push({ role: m.role, content: m.content });
    }
    if (mescladas.length > 0) {
      const ult = mescladas[mescladas.length - 1];
      if (ult.role === 'user' && (mensagem.includes(ult.content.slice(0, 80)) || ult.content.includes(mensagem.slice(0, 80)))) mescladas.pop();
    }
    hist = mescladas.slice(-34);
  } catch {}

  // Trava dura: sob fail_closed o [JA EXECUTADO] vira residuo sem valores.
  const gateFechado = gateComercial?.comportamento === 'fail_closed';
  const blocoExecucoesEfetivo = gateFechado
    ? (execucoes.bloco ? BLOCO_EXECUCOES_SUPRIMIDO : '')
    : execucoes.bloco;
  if (gateFechado && execucoes.bloco) L('contexto_canonico_execucoes_suprimido', { phone: phone.slice(-4), motivo: gateComercial?.motivo });
  const blocoEstado = estado ? `\n\n[FICHA: etapa=${estado.etapa}; slots=${JSON.stringify(estado.slots)}. N\u00c3O pergunte o preenchido.]` : '';
  const blocoOrigem = (categoriaAnuncio && !mudouProduto) ? `\n\n[ORIGEM: an\u00fancio "${categoriaAnuncio}". Comece por este produto, mas atenda outro se o cliente pedir.]` : '';
  const pediuPrecoAgora = REGEX_PEDIU_PRECO.test(mensagem);
  const devePrecoJa = (pediuPrecoAgora || jaPediuPrecoAntes) && !joaoJaDeuPreco;
  const blocoPreco = devePrecoJa ? '\n\n[O CLIENTE J\u00c1 PEDIU PRE\u00c7O E N\u00c3O RECEBEU N\u00daMERO. Sua pr\u00f3xima mensagem TEM QUE CONTER valor em R$ vindo de ferramenta.]' : '';
  const blocoMudanca = pediuMudanca ? '\n\n[ALTERACAO DE PEDIDO: recalcule o pedido COMPLETO. Se houver largura, altura e copias de DTF textil, use calcular_dtf_por_arte — NUNCA calcular_dtf_metro. O minimo e 1 metro. Se a reducao nao baixar o valor, explique o minimo e incentive manter a quantidade anterior ou aproveitar o metro. Pix pendente NAO e pagamento confirmado. Nao some pedido antigo com novo.]' : '';

  const systemFinal = SYSTEM + REGRAS_EXTRA
    + (blocoAprendizados.trim() ? '\n\n' + blocoAprendizados : '')
    + blocoRelogio() + blocoGateComercial(gateComercial) + blocoEstado + blocoExecucoesEfetivo + blocoMudanca
    + blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) + blocoCepCanonico(estadoLog) + blocoOrigem + blocoAnuncio + blocoMudouProduto + blocoPreco + blocoObjecao + blocoRespostaCurta + blocoArquivos
    + (conversaAtivaHoje ? '\n\n[Cliente EM CONVERSA hoje. Continue do ponto, sem cumprimentar de novo.]' : '\n\n[PRIMEIRO CONTATO: acolha, diga o que temos e fa\u00e7a UMA pergunta.]')
    + (promessaJaDada ? '\n\n[Promessa de retorno J\u00c1 DITA. N\u00e3o repita.]' : '')
    + (ehFormulario ? '\n\n[FORMUL\u00c1RIO DO SITE: use os campos, responder SEMPRE.]' : '')
    + (ehPerguntaDireta ? '\n\n[PERGUNTA DIRETA: responda a pergunta em si.]' : '');

  if (!dryRun) {
    const charsFixosAprendizado = SYSTEM.length + REGRAS_EXTRA.length + blocoAprendizados.length;
    await registrarManifestoJoao({
      systemFinal, aprendizados: blocoAprendizados,
      dinamicosChars: Math.max(0, systemFinal.length - charsFixosAprendizado),
      historico: hist, temImagem: imagens.length > 0, temAudio: transcricoes.length > 0,
      temObjecao: objecaoPreco, primeiroContato: !conversaAtivaHoje, phone,
      aprendizadosOk: manifestoAprendizados?.aprendizados_ok === true,
      manifestoAprendizados
    });
  }

  let userContent: any = mensagem;
  if (imagens.length > 0) {
    const blocos: any[] = [];
    for (const u of imagens.slice(0, 3)) { const b64 = await baixarImagemB64(u); if (b64) blocos.push({ type: 'image', source: { type: 'base64', media_type: b64.media, data: b64.data } }); }
    if (blocos.length === 0) userContent = mensagem + '\n[imagem nao chegou legivel. NAO diga que nao consegue ver: peca a informacao que falta]';
    else {
      blocos.push({ type: 'text', text: mensagem || '(cliente enviou imagem)' }); userContent = blocos;
      if (!dryRun) await gravarFio({ lead_id: leadId, phone, direction: 'inbound', message_text: '(foto enviada pelo cliente)', message_type: 'image', timestamp: new Date().toISOString(), source: 'joao_visao' });
    }
  }

  let ultimoRaw = ''; let toolsUsadas: string[] = [];
  // v4.21.9: recupera arte+copias do estado e da mensagem para impedir calculo por metragem.
  // Quantidade dita agora prevalece sobre a salva. Pedido explicito em metros nao e redirecionado.
  const slotsCtx: any = estado?.slots || {};
  const textoArteCtx = [String(slotsCtx.arte || ''), mensagem].join(' ');
  const mxCtx = textoArteCtx.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/);
  const mlCtx = mensagem.match(/(\d+(?:[.,]\d+)?)\s*(?:de\s+)?largura[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*(?:de\s+)?altura/i);
  const mqCtx = mensagem.match(/(\d+)\s*c[oó]pias?/i);
  const larguraCtx = Number(String(mxCtx?.[1] || mlCtx?.[1] || slotsCtx.largura_cm || '').replace(',', '.'));
  const alturaCtx = Number(String(mxCtx?.[2] || mlCtx?.[2] || slotsCtx.altura_cm || '').replace(',', '.'));
  const copiasCtx = Math.max(0, parseInt(String(mqCtx?.[1] || slotsCtx.quantidade || slotsCtx.copias || 0)));
  const pediuMetrosDiretos = /\b\d+(?:[.,]\d+)?\s*metros?\b/i.test(mensagem) && !mqCtx;
  const arteParaCalculo = !pediuMetrosDiretos && larguraCtx > 0 && alturaCtx > 0 && copiasCtx > 0
    ? { largura_cm: larguraCtx, altura_cm: alturaCtx, copias: copiasCtx } : null;
  // v84: valores conversacionais nao autorizam cobranca. Somente operation_id tipado.
  const ctx: any = { leadId, phone, autorizacoes: [] as any[], precosAutorizados: [] as any[], rendimentosAutorizados: [] as any[], rendimentosAuxiliares: [] as number[], cobrancaPendente: execucoes.cobrancaPendente, permiteMudanca: pediuMudanca, freteJa: execucoes.freteJa, arteParaCalculo, pixGerado: null, holdArte: RX_HOLD_ARTE_PAGAMENTO.test(mensagem), modalidadeLogistica: estadoLog.modalidade, produtoDigital: estadoLog.produto_digital };
  // v4.26.0: fonte canonica CalcMe, somente extracao validada e vigente.
  let calcmeVigente: any = null;
  try {
    let q = sb.from('vw_orcamento_calcme_vigente').select('id,lead_id,phone,numero_orcamento,itens,total,condicoes,confianca,file_name,document_timestamp').gte('confianca', 0.90).limit(1);
    q = leadId ? q.eq('lead_id', leadId) : q.eq('phone', phone);
    const { data: cv } = await q.maybeSingle();
    calcmeVigente = cv || null;
  } catch (e) {
    await logErro('calcme_vigente_leitura_falhou', { phone, erro: String(e).slice(0, 120) });
  }
  // v4.26.4: PDF novo entra no indice sob demanda, apenas quando a conversa pede
  // orcamento/fechamento. O extrator falha fechado e so devolve CalcMe validado >= 0,90.
  const pediuContextoCalcme = /\b(or[cç]amento|proposta|pix|fecha(?:do|mos)?|confirmo|aprovad[oa]|mudei|alter(?:ar|ei|ou)|quantidade)\b/i.test(mensagem);
  if (!calcmeVigente && pediuContextoCalcme) {
    try {
      const er = await fetch(SUPABASE_URL + '/functions/v1/joao-orcamento-calcme', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(45000),
      });
      const ej = await er.json().catch(() => ({}));
      if (er.ok && ej?.ok === true && ej?.orcamento && Number(ej.orcamento.confianca) >= 0.90) {
        calcmeVigente = ej.orcamento;
      } else if (!er.ok) {
        await logErro('calcme_extrator_http_falhou', { phone, status: er.status });
      }
    } catch (e) {
      await logErro('calcme_extrator_falhou', { phone, erro: String(e).slice(0, 120) });
    }
  }
  const chamarCerebro = async (nudge?: string): Promise<any> => {
    const msgs: any[] = [...hist, { role: 'user', content: userContent }];
    if (nudge) msgs.push({ role: 'user', content: nudge });
    for (let i = 0; i < 6; i++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 1100, system: systemFinal, messages: msgs, tools: TOOLS }), signal: AbortSignal.timeout(35000) });
      const d = await res.json().catch(() => ({}));
      // v96: erro HTTP da Anthropic NUNCA segue como resposta. Antes, d.error.message
      // virava mensagem do agente e o cliente recebia 'Your credit balance is too low'.
      if (!res.ok || d?.type === 'error') {
        const motivo = String(d?.error?.message || ('http_' + res.status)).slice(0, 200);
        await logErro('anthropic_api_erro', { status: res.status, tipo: d?.error?.type || null, motivo, phone });
        throw new Error('anthropic_indisponivel: ' + motivo);
      }
      await logTokens(d, dryRun ? 'dry_run' : 'plantao', ctx.leadId);
      const blocks = Array.isArray(d.content) ? d.content : [];
      const toolUses = blocks.filter((b: any) => b.type === 'tool_use');
      const texto = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (d.stop_reason !== 'tool_use' || toolUses.length === 0) {
        // v96: so o TEXTO do modelo pode virar resposta. Mensagem de erro da API e
        // infraestrutura, nao fala do agente: vira excecao e cai no fallback.
        ultimoRaw = texto;
        if (!String(ultimoRaw || '').trim()) throw new Error('modelo_sem_texto');
        try { return extrairJson(ultimoRaw); }
        catch (e) {
          const t = String(ultimoRaw || '').trim();
          // v96: alem de nao ser JSON, o texto nao pode cheirar a erro de infraestrutura.
          const RX_INFRA = /(credit balance|api key|rate limit|quota|billing|upgrade or purchase|internal server error|overloaded|anthropic|openai)/i;
          if (RX_INFRA.test(t)) { await logErro('texto_de_infra_bloqueado', { phone, t: t.slice(0, 150) }); throw new Error('texto_de_infra'); }
          if (t.length >= 5 && t.length <= 1200 && !t.includes('{') && !t.includes('}')) return { responde: true, mensagem: t, tema: 'complexo', encaminhou_venda: false, etapa: null, slots: {} };
          throw e;
        }
      }
      msgs.push({ role: 'assistant', content: blocks });
      const results: any[] = [];
      for (const tu of toolUses) {
        let toolEfetiva = tu.name;
        let inputEfetivo = tu.input;
        if (tu.name === 'calcular_dtf_metro' && ctx.arteParaCalculo) {
          toolEfetiva = 'calcular_dtf_por_arte';
          inputEfetivo = { ...ctx.arteParaCalculo };
          await logErro('guardrail_dtf_metro_redirecionado', {
            phone, input_original: tu.input, input_efetivo: inputEfetivo
          });
        }
        // ── v4.28.0 P14: GUARDA DE COMPATIBILIDADE EM SHADOW ──────────────────
        // Calcula e REGISTRA. NAO bloqueia. executada=true sempre nesta fase, mesmo
        // quando permitida=false — e exatamente esse par que mede o falso positivo.
        // O caso sentinela cairia aqui: calcular_dtf_por_arte (textil) em conversa UV.
        {
          const prodMacro = normalizarProdutoMacro(
            (decisao?.slots || {}).produto ?? estado?.slots?.produto ?? prodMsg
          );
          const av = avaliarCompatibilidadeTool(toolEfetiva, prodMacro, obsModalidade.modalidade);
          if (!dryRun) {
            await registrarGuardaToolShadow({
              phone, lead_id: leadId, turn_id: obsTurnId, agent_version: V,
              tool_name: toolEfetiva, produto_macro: prodMacro,
              modalidade_detectada: obsModalidade.modalidade,
              permitida: av.permitida, motivo: av.motivo,
              executada: true, enforcement_ativo: false,
            });
          }
          if (!av.permitida) L('shadow_tool_incompativel', { tool: toolEfetiva, produto: prodMacro, motivo: av.motivo });
        }
        // ── v4.34.0 P0: GUARDA DETERMINISTICA DE FRETE POR MODALIDADE ────────
        // ENFORCEMENT REAL, nao shadow. Texto de prompt nao resolve: no caso Carolina o
        // modelo pediu o CEP e chamou calcular_frete com "retirada presencial" escrito no
        // proprio turno. A chamada e INTERCEPTADA ANTES DA EXECUCAO, no mesmo ponto em que
        // a v4.21.9 ja intercepta calcular_dtf_metro. Nenhuma autorizacao de frete nasce,
        // entao compor_total e gerar_pix nao tem como somar frete que nao existe.
        // v4.35.0: alem do bloqueio por modalidade (v4.34.0, intacto), o frete tambem nao
        // roda com CEP que veio do cadastro e ainda nao foi confirmado pelo cliente.
        if (toolEfetiva === 'calcular_frete' && !estadoLog.bloqueia_frete
            && estadoLog.pedir_confirmacao_cep && !cepDoTexto(String((inputEfetivo as any)?.cep_destino || '')) ) {
          await logErro('guardrail_frete_com_cep_nao_confirmado', {
            phone, lead: leadId, turn_id: obsTurnId, cep_fonte: estadoLog.cep_fonte,
            cep_cadastro_final: mascararCep(estadoLog.cep_cadastro),
          });
          toolsUsadas.push('calcular_frete_aguardando_confirmacao');
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({
            ok: false, erro: 'cep_do_cadastro_nao_confirmado',
            acao: 'O CEP veio do CADASTRO e o cliente ainda nao confirmou que o envio vai para la. '
              + 'Pergunte em UMA frase: "Vai ser enviado para o mesmo CEP final '
              + mascararCep(estadoLog.cep_cadastro) + '?" e so calcule o frete depois da resposta. NAO peca o CEP inteiro.',
          }) });
          continue;
        }
        if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {
          await logErro('guardrail_frete_bloqueado_modalidade', {
            phone, lead: leadId, turn_id: obsTurnId,
            modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
            fonte_nivel: estadoLog.fonte_nivel, motivo: estadoLog.motivo_bloqueio,
            evidencia: estadoLog.evidencia,
            cep_tentado: String((inputEfetivo as any)?.cep_destino || '').slice(0, 12),
          });
          if (!dryRun) {
            await registrarGuardaToolShadow({
              phone, lead_id: leadId, turn_id: obsTurnId, agent_version: V,
              tool_name: 'calcular_frete',
              produto_macro: normalizarProdutoMacro((decisao?.slots || {}).produto ?? estado?.slots?.produto ?? prodMsg),
              modalidade_detectada: obsModalidade.modalidade,
              permitida: false, motivo: estadoLog.motivo_bloqueio,
              executada: false, enforcement_ativo: true,
            });
          }
          toolsUsadas.push('calcular_frete_bloqueado');
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({
            ok: false, erro: 'frete_incompativel_com_modalidade',
            modalidade_logistica: estadoLog.modalidade,
            acao: estadoLog.produto_digital
              ? 'Este produto e DIGITAL: a entrega e por link no WhatsApp. NAO existe frete, NAO peca CEP e NAO fale de PAC nem Sedex.'
              : estadoLog.modalidade === 'desconhecida'
                ? 'A forma de entrega ainda NAO foi resolvida e retirada e plausivel. Pergunte em UMA frase se ele quer retirada aqui em Embu ou envio, e NAO peca CEP antes da resposta.'
                : 'O cliente JA disse que vai ' + (estadoLog.modalidade === 'motoboy' ? 'mandar motoboy buscar' : 'retirar presencialmente')
                  + '. NAO existe frete neste pedido. NAO peca CEP, NAO ofereca PAC nem Sedex e NAO diga que precisa do CEP para gerar a cobranca. Feche com o valor do produto.',
          }) });
          continue;
        }
        const out = await executarTool(toolEfetiva, inputEfetivo, ctx);
        toolsUsadas.push(toolEfetiva);
        // v84: numero sem semantica NAO autoriza dinheiro. A autorizacao vem de operation_id.
        try { const parsed = JSON.parse(out); if (Array.isArray(parsed?.financial_authorizations)) ctx.autorizacoes.push(...parsed.financial_authorizations);
             if (Array.isArray(parsed?.precos_verbalizaveis)) ctx.precosAutorizados.push(...parsed.precos_verbalizaveis);
             // v4.32.0 P1: proveniencia de rendimento. Capacidade canonica entra como objeto;
             // numeros auxiliares que a tool JA devolvia (sobra no material, quantidade pedida,
             // cabem por folha) entram como numeros verbalizaveis, para a guarda nova nao bloquear
             // frase legitima do fluxo com quantidade.
             if (Array.isArray(parsed?.rendimentos_autorizados)) {
               for (const r of parsed.rendimentos_autorizados) {
                 const cpm = Number(r?.cabem_por_metro);
                 if (Number.isInteger(cpm) && cpm > 0) ctx.rendimentosAutorizados.push(r);
               }
             }
             const ddR = parsed?.display_data;
             if (ddR && typeof ddR === 'object') {
               // NUNCA incluir cabem_por_metro/estampas_por_metro aqui: capacidade por metro so
               // e autorizada pela fonte canonica via rendimentos_autorizados. Estes sao numeros
               // auxiliares que a tool ja devolvia e que a resposta legitima cita.
               for (const kR of ['cabem_ainda_no_material', 'quantidade_desejada', 'cabem_por_folha', 'copias', 'quantidade']) {
                 const nR = Number((ddR as any)[kR]);
                 if (Number.isInteger(nR) && nR > 0) ctx.rendimentosAuxiliares.push(nR);
               }
             } } catch {}
        L('tool_exec', { tool: tu.name, phone: phone.slice(-4) });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
      }
      msgs.push({ role: 'user', content: results });
    }
    throw new Error('loop_tools_excedido');
  };

  let decisao: any = { responde: false, mensagem: '', tema: 'ruido', encaminhou_venda: false };
  const pediuHumano = REGEX_PEDIDO_HUMANO.test(mensagem);
  const pediuDesistencia = ehDesistenciaInequivoca(mensagem);
  const linhasDoEvento = mensagem.split('\n').map((x: string) => x.trim()).filter(Boolean);
  const somenteArquivos = linhasDoEvento.length > 0 && linhasDoEvento.every((x: string) => /^\[Arquivo recebido pelo WhatsApp:/i.test(x));
  const calcmeAceitouSemMudanca = !!calcmeVigente && !pediuMudanca
    && /\b(fecha(?:do|mos)?|pode\s+(?:gerar|mandar|enviar)(?:\s+o)?\s+pix|manda(?:r)?(?:\s+o)?\s+pix|vamos\s+fechar|vou\s+querer|pode\s+seguir|confirmo|aprovad[oa])\b/i.test(mensagem);
  const calcmePediuResumo = !!calcmeVigente && !pediuMudanca
    && /\b(or[cç]amento|proposta|qual\s+(?:o\s+)?valor|quanto\s+(?:ficou|deu)|meu\s+pedido)\b/i.test(mensagem);

  if (calcmeAceitouSemMudanca) {
    const ajusteSalvo = estado?.slots?.orcamento_calcme_id === calcmeVigente.id
      && Number(estado?.slots?.calcme_total_ajustado) > 0
      && Array.isArray(estado?.slots?.calcme_itens_ajustados)
      ? estado.slots : null;
    const totalCalcme = Math.round(Number(ajusteSalvo?.calcme_total_ajustado ?? calcmeVigente.total) * 100) / 100;
    const itensParaFechar = ajusteSalvo?.calcme_itens_ajustados ?? calcmeVigente.itens;
    const condPag = String(calcmeVigente.condicoes?.pagamento || '');
    const pctMatch = condPag.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const pctEntrada = pctMatch ? Number(pctMatch[1].replace(',', '.')) : 100;
    const valorEntrada = Math.round(totalCalcme * pctEntrada) / 100;
    const numero = String(calcmeVigente.numero_orcamento || '').trim();
    ctx.precosAutorizados.push(
      { tipo: 'total_pdf_calcme', centavos: Math.round(totalCalcme * 100) },
      { tipo: 'entrada_pdf_calcme', centavos: Math.round(valorEntrada * 100) },
    );
    toolsUsadas.push('calcme_canonico');
    let pixOk = dryRun;
    if (!dryRun) {
      const op = await emitirAutorizacao(leadId, 'orcamento_calcme_entrada', valorEntrada, 'pdf_calcme_canonico', {
        orcamento_calcme_id: calcmeVigente.id, numero_orcamento: numero || null,
        total_pdf: Number(calcmeVigente.total), total_cobranca: totalCalcme,
        percentual_entrada: pctEntrada, itens_cobranca: itensParaFechar, ajustado: !!ajusteSalvo,
      });
      if (op?.id) {
        ctx.autorizacoes.push(op);
        const outPix = await executarTool('gerar_pix', {
          operation_id: op.id, produto: numero ? ('Orcamento CalcMe ' + numero) : 'Orcamento CalcMe',
          quantidade: 1,
        }, ctx);
        toolsUsadas.push('gerar_pix');
        try { pixOk = JSON.parse(outPix)?.ok === true && ctx.pixGerado?.ok === true; } catch { pixOk = false; }
      } else pixOk = false;
    }
    const fmt = (v: number) => v.toFixed(2).replace('.', ',');
    decisao = pixOk
      ? { responde: true, mensagem: 'Perfeito. Segui exatamente o orçamento CalcMe' + (numero ? ' nº ' + numero : '') + ', no total de R$' + fmt(totalCalcme) + '. A entrada de ' + String(pctEntrada).replace('.', ',') + '% fica em R$' + fmt(valorEntrada) + '. Segue o Pix copia e cola abaixo.', tema: 'fechamento_calcme', encaminhou_venda: true, etapa: 'fechamento', slots: { orcamento_calcme_id: calcmeVigente.id } }
      : { responde: true, mensagem: 'Seu orçamento CalcMe' + (numero ? ' nº ' + numero : '') + ' permanece confirmado no total de R$' + fmt(totalCalcme) + ', mas a cobrança não foi emitida agora. Vou tentar novamente sem alterar nenhum valor.', tema: 'fechamento_calcme', encaminhou_venda: false, etapa: 'fechamento', slots: { orcamento_calcme_id: calcmeVigente.id } };
  } else if (calcmePediuResumo) {
    const ajusteSalvo = estado?.slots?.orcamento_calcme_id === calcmeVigente.id
      && Number(estado?.slots?.calcme_total_ajustado) > 0
      && Array.isArray(estado?.slots?.calcme_itens_ajustados)
      ? estado.slots : null;
    const itens = ajusteSalvo?.calcme_itens_ajustados ?? (Array.isArray(calcmeVigente.itens) ? calcmeVigente.itens : []);
    const fmt = (v: number) => Number(v).toFixed(2).replace('.', ',');
    const linhas = itens.map((x: any) => String(x.qtd) + 'x ' + String(x.descricao) + ' a R$' + fmt(x.valor_unit) + ' = R$' + fmt(x.valor_total));
    const totalCalcme = Number(ajusteSalvo?.calcme_total_ajustado ?? calcmeVigente.total);
    for (const x of itens) {
      ctx.precosAutorizados.push({ tipo: 'unitario_pdf_calcme', centavos: Math.round(Number(x.valor_unit) * 100) });
      ctx.precosAutorizados.push({ tipo: 'item_pdf_calcme', centavos: Math.round(Number(x.valor_total) * 100) });
    }
    ctx.precosAutorizados.push({ tipo: 'total_pdf_calcme', centavos: Math.round(totalCalcme * 100) });
    toolsUsadas.push('calcme_canonico');
    decisao = { responde: true, mensagem: 'O orçamento CalcMe' + (calcmeVigente.numero_orcamento ? ' nº ' + calcmeVigente.numero_orcamento : '') + ' vigente é:\n' + linhas.join('\n') + '\nTotal: R$' + fmt(totalCalcme) + '. ' + String(calcmeVigente.condicoes?.pagamento || ''), tema: 'orcamento_calcme', encaminhou_venda: false, etapa: 'negociacao', slots: { orcamento_calcme_id: calcmeVigente.id } };
  } else if (calcmeVigente && pediuMudanca) {
    const itensOrig = Array.isArray(calcmeVigente.itens) ? calcmeVigente.itens : [];
    const norm = (v: any) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const aliases = (d: any) => {
      const n = norm(d); const a: string[] = [];
      if (n.includes('polo')) a.push('polo', 'polos', 'camiseta polo', 'camisetas polo');
      if (n.includes('copo')) a.push('copo', 'copos', 'cuia', 'cuias');
      if (n.includes('bone')) a.push('bone', 'bones');
      if (n.includes('frete')) a.push('frete', 'pac', 'sedex');
      return a;
    };
    const msgNorm = norm(mensagem);
    let idxMud = -1; let novaQtd = 0;
    for (let ix = 0; ix < itensOrig.length && idxMud < 0; ix++) {
      for (const al of aliases(itensOrig[ix]?.descricao)) {
        const e = al.replace(/[.*+?^{}()|[\]\\]/g, '\\$&');
        const m1 = msgNorm.match(new RegExp('(?:para|pra|ficam?|serao|sao|quero|mudei\\s+para)?\\s*(\\d+)\\s+(?:' + e + ')\\b', 'i'));
        const m2 = msgNorm.match(new RegExp('(?:' + e + ')\\s*(?:para|pra|ficam?|serao|sao|:)?\\s*(\\d+)\\b', 'i'));
        const q = Number(m1?.[1] || m2?.[1] || 0);
        if (q > 0) { idxMud = ix; novaQtd = q; break; }
      }
    }
    if (idxMud >= 0 && novaQtd > 0) {
      const antigo = Number(itensOrig[idxMud].qtd);
      const quedaGrande = novaQtd < antigo * 0.5;
      if (quedaGrande) {
        toolsUsadas.push('calcme_queda_grande');
        decisao = { responde: true, mensagem: 'Essa redução de ' + String(antigo) + ' para ' + String(novaQtd) + ' unidades cruza a faixa de quantidade. O valor unitário do PDF não pode ser mantido; o preço precisa ser recalculado pela nova quantidade antes do Pix.', tema: 'orcamento_calcme', encaminhou_venda: false, etapa: 'negociacao', slots: { orcamento_calcme_id: calcmeVigente.id } };
      } else {
        const itensNovos = itensOrig.map((x: any, ix: number) => {
          const qtd = ix === idxMud ? novaQtd : Number(x.qtd);
          const unit = Number(x.valor_unit);
          return { ...x, qtd, valor_total: Math.round(qtd * unit * 100) / 100 };
        });
        const totalNovo = Math.round(itensNovos.reduce((a: number, x: any) => a + Number(x.valor_total), 0) * 100) / 100;
        const condPag = String(calcmeVigente.condicoes?.pagamento || '');
        const pctMatch = condPag.match(/(\d+(?:[.,]\d+)?)\s*%/);
        const pctEntrada = pctMatch ? Number(pctMatch[1].replace(',', '.')) : 100;
        const entradaNova = Math.round(totalNovo * pctEntrada) / 100;
        const item = itensNovos[idxMud];
        const fmt = (v: number) => Number(v).toFixed(2).replace('.', ',');
        ctx.precosAutorizados.push(
          { tipo: 'unitario_pdf_calcme', centavos: Math.round(Number(item.valor_unit) * 100) },
          { tipo: 'item_alterado_pdf_calcme', centavos: Math.round(Number(item.valor_total) * 100) },
          { tipo: 'total_alterado_pdf_calcme', centavos: Math.round(totalNovo * 100) },
          { tipo: 'entrada_alterada_pdf_calcme', centavos: Math.round(entradaNova * 100) },
        );
        toolsUsadas.push('calcme_mudanca_unitario_pdf');
        decisao = { responde: true, mensagem: 'Atualizei apenas a quantidade para ' + String(novaQtd) + ' unidades de ' + String(item.descricao) + ', mantendo o unitário do PDF em R$' + fmt(item.valor_unit) + '. Esse item fica em R$' + fmt(item.valor_total) + ' e o novo total do pedido em R$' + fmt(totalNovo) + '. A entrada de ' + String(pctEntrada).replace('.', ',') + '% fica em R$' + fmt(entradaNova) + '. Confirma esse ajuste?', tema: 'orcamento_calcme', encaminhou_venda: false, etapa: 'negociacao', slots: { orcamento_calcme_id: calcmeVigente.id, calcme_total_ajustado: totalNovo, calcme_itens_ajustados: itensNovos } };
      }
    } else {
      toolsUsadas.push('calcme_mudanca_nao_identificada');
      decisao = { responde: true, mensagem: 'Para alterar o orçamento CalcMe sem divergência, diga a nova quantidade junto do item, por exemplo: 19 polos.', tema: 'orcamento_calcme', encaminhou_venda: false, etapa: 'negociacao', slots: { orcamento_calcme_id: calcmeVigente.id } };
    }
  } else if (pediuHumano || pediuDesistencia) {
    const titulo = pediuHumano ? 'Joao: cliente pediu atendimento humano' : 'Joao: desistência ou cancelamento solicitado';
    const tarefaCriada = dryRun ? true : await criarTask(leadId, phone, titulo, `Mensagem do cliente: ${mensagem.slice(0, 300)}`);
    const respostaHandoff = pediuHumano
      ? (tarefaCriada
          ? 'Claro. Registrei seu pedido para uma pessoa da equipe continuar por aqui.'
          : 'Claro. Não vou continuar o atendimento automático por aqui.')
      : (tarefaCriada
          ? 'Entendi. Registrei sua desistência ou pedido de cancelamento para a equipe e não vou avançar com uma nova venda.'
          : 'Entendi. Não vou avançar com uma nova venda por aqui.');
    decisao = { responde: true, mensagem: respostaHandoff, tema: 'complexo', encaminhou_venda: false, etapa: 'despedida', slots: {}, escalonamento_humano: pediuHumano, desistencia: pediuDesistencia, tarefa_criada: tarefaCriada };
  } else if (somenteArquivos && blocoArquivos) {
    decisao = { responde: true, mensagem: respostaDeterministicaArquivos(blocoArquivos), tema: 'dtf_metro', encaminhou_venda: false, etapa: 'sondagem', slots: {} };
  }
  try { if (decisao.responde !== true) decisao = await chamarCerebro(); }
  catch (e: any) {
    L('cerebro_err', { e: String(e).slice(0, 100) });
    if (Array.isArray(userContent)) { try { userContent = mensagem + '\n[imagem indisponivel]'; decisao = await chamarCerebro(); } catch {} }
  }

  let resposta = aberturaCorreta(ajustarSaudacao(sanearMsg(decisao.mensagem)), !conversaAtivaHoje, false);
  if ((promessaJaDada || decisao.tema === 'copo') && /pr\u00f3ximo dia \u00fatil/i.test(resposta)) {
    const frases = resposta.split(/(?<=[.!?])\s+/).filter((f: string) => !/pr\u00f3ximo dia \u00fatil/i.test(f));
    const semPromessa = frases.join(' ').trim();
    if (semPromessa.length >= 5) resposta = semPromessa; else decisao.responde = false;
  }
  const temPreco = /R\$\s?\d/.test(resposta);
  // ── v4.24.0 PATCH A: PRODUTO EM CONTEXTO ─────────────────────────────────
  // Precedencia: slots do turno -> estado persistido -> produto detectado na mensagem -> tema.
  // Qualquer coisa fora de dtf_textil/dtf_uv fica NULL = INDETERMINADO, que LIBERA e registra.
  // Raio pequeno de proposito: copo, camiseta e pack seguem com o comportamento historico.
  const produtoGuarda: string | null = (() => {
    const cands = [
      String((decisao.slots || {}).produto || ''),
      String(estado?.slots?.produto || ''),
      String(prodMsg || ''),
      decisao.tema === 'adesivo_uv' ? 'dtf_uv' : (decisao.tema === 'dtf_metro' ? String(prodMsg || '') : ''),
    ];
    for (const c of cands) {
      const s = c.toLowerCase().trim();
      if (!s || s === 'null') continue;
      if (s === 'dtf_textil' || s === 'textil' || /t[e\u00ea]xtil/.test(s)) return 'dtf_textil';
      if (s === 'dtf_uv' || s === 'uv') return 'dtf_uv';
    }
    return null;
  })();
  // v4.24.0: a guarda passa a rodar em TODA resposta com preco sem ferramenta.
  // O antigo desvio `!valoresCitados.length` desligava a conferencia inteira depois do
  // primeiro preco da janela de 14h — MEDIDO: 133 de 141 respostas nao eram conferidas.
  // valoresCitados deixa de ser chave geral e vira UMA das fontes, valor a valor.
  if (decisao.responde === true && temPreco && toolsUsadas.length === 0) {
    // v106: valor que a propria ficha do prompt entrega NAO precisa de ferramenta.
    // So derruba se aparecer algum valor FORA da tabela fixa.
    // v108: a guarda pergunta ao BANCO se o valor existe, em vez de exigir chamada de ferramenta.
    // A pergunta certa nao e "voce chamou tool?" e sim "esse valor e verdadeiro?".
    // Um preco CERTO dito de memoria e certo. Um preco ERRADO vindo de tool seria errado.
    // fn_valor_e_legitimo confere catalogo, faixas, degraus, operacoes financeiras, cobrancas
    // e orcamentos do proprio lead. Testada em 9 casos reais: libera A4, A3, tabela textil,
    // packs, copo e o pix ja cobrado; bloqueia os R$29,70 e R$44,55 inventados no caso Erica.
    const naMsg = valoresDaMensagem(resposta);
    const naoConferidos: number[] = [];
    const cruzados: Array<{ centavos: number; produto_do_valor: string }> = [];
    const semFonte: number[] = [];
    const falhaTecnica: number[] = [];
    const conferidos: Array<{ centavos: number; fonte: string }> = [];
    const citadosCent = new Set<number>(valoresCitados.map((v: number) => Math.round(v * 100)));

    for (const centavos of naMsg) {
      // SEM produto: comportamento historico preservado.
      if (!produtoGuarda) {
        if (PRECOS_FICHA_FECHADOS.has(centavos)) {
          conferidos.push({ centavos, fonte: 'ficha_preco_fechado' });
          continue;
        }
        if (PRECOS_DE_FICHA.has(centavos)) {
          conferidos.push({ centavos, fonte: 'ficha_unitario' });
          continue;
        }
        if (citadosCent.has(centavos)) {
          conferidos.push({ centavos, fonte: 'valor_ja_citado_ao_lead' });
          continue;
        }
      }

      // COM produto: banco decide PRIMEIRO.
      // Repetir um preco errado nunca cria legitimidade.
      try {
        const { data: v } = await sb.rpc('fn_valor_e_legitimo', {
          p_centavos: centavos,
          p_lead_id: leadId,
          p_produto: produtoGuarda,
        });

        if (v?.legitimo === true) {
          L('valor_conferido_no_banco', {
            phone: phone.slice(-4),
            centavos,
            fonte: v.fonte,
            produto: produtoGuarda,
          });
          conferidos.push({ centavos, fonte: String(v.fonte || 'banco') });
          continue;
        }

        if (v && v.legitimo === false) {
          if (String(v.motivo || '') === 'preco_de_outro_produto') {
            cruzados.push({
              centavos,
              produto_do_valor: String(v.produto_do_valor || ''),
            });
            naoConferidos.push(centavos);
            continue;
          }

          // O banco ja descartou cruzamento de produto.
          // Agora repeticao pode servir como fonte para frete/total ja combinado.
          if (citadosCent.has(centavos)) {
            conferidos.push({ centavos, fonte: 'valor_ja_citado_ao_lead' });
            continue;
          }

          semFonte.push(centavos);
          naoConferidos.push(centavos);
          continue;
        }

        // Resposta vazia/shape inesperado = falha tecnica, nunca prova de preco errado.
        falhaTecnica.push(centavos);
      } catch (e: any) {
        falhaTecnica.push(centavos);
        await logErro('guarda_preco_falha_tecnica', {
          phone,
          centavos,
          produto: produtoGuarda,
          erro: String(e?.message ?? e).slice(0, 150),
        });
      }
    }

    // Total composto somente por componentes legitimos da MESMA mensagem.
    if (semFonte.length > 0 && conferidos.length >= 2) {
      const ok = conferidos.map((c) => c.centavos);
      for (let i = semFonte.length - 1; i >= 0; i--) {
        const alvo = semFonte[i];
        const bate = ok.some((a) => ok.some((b) => a !== b && a + b === alvo));
        if (bate) {
          conferidos.push({ centavos: alvo, fonte: 'total_composto' });
          semFonte.splice(i, 1);
        }
      }
    }
    // v4.24.0:
    // preco_de_outro_produto -> BLOQUEIA
    // valor_sem_fonte -> PERMITE + registra
    // falha tecnica -> PERMITE + registra
    if (cruzados.length > 0) {
      decisao.responde = false;
      await logErro('guardrail_preco_de_outro_produto', {
        phone,
        produto_contexto: produtoGuarda,
        cruzados,
        resposta: resposta.slice(0, 300),
      });
    } else {
      if (semFonte.length > 0) {
        await logErro('preco_sem_fonte_liberado', {
          phone,
          produto_contexto: produtoGuarda,
          valores: semFonte,
          resposta: resposta.slice(0, 300),
        });
      }

      if (falhaTecnica.length > 0) {
        await logErro('preco_liberado_por_falha_de_guarda', {
          phone,
          produto_contexto: produtoGuarda,
          valores: falhaTecnica,
        });
      }

      if (!produtoGuarda && naMsg.length > 0) {
        L('guarda_preco_produto_indeterminado', {
          phone: phone.slice(-4),
          valores: naMsg,
          tema: decisao.tema,
        });
      }
    }

    if (naMsg.length > 0 && cruzados.length === 0) {
      L('preco_legitimo_liberado', {
        phone: phone.slice(-4),
        valores: naMsg,
        produto: produtoGuarda,
        sem_fonte: semFonte.length,
      });
      // ── v4.21.2 INVARIANTE 1: preco de ficha usado em FECHAMENTO vira autorizacao ──
      // Sem isso, compor_total nunca tem os dois operation_id e o agente fica impedido de
      // cobrar o valor que ele mesmo acabou de dizer (caso Josiene 03/08).
      // TRES condicoes, todas obrigatorias. Valor unico NAO basta: nao prova que o valor
      // e o PRODUTO. Exigimos que a fonte confirme a natureza.
      //  (1) a mensagem tem UM UNICO valor — com produto+frete+total nao da para inferir qual e qual;
      //  (2) esse valor e um preco FECHADO de unidade da ficha (folha A4/A3, copo avulso, pack).
      //      A tabela por METRO nao entra: R$59,90 ali e preco unitario, nao total do pedido;
      //  (3) nao existe autorizacao de PRODUTO ativa nem emitida neste turno.
      try {
        const soUm = naMsg.length === 1 && conferidos.length === 1;

        // Valor sozinho nao carrega semantica suficiente para autorizar produto.
        // Ex.: R$39,90 em dtf_textil pode ser preco POR METRO de uma faixa.
        // A fonte precisa representar unidade fechada.
        const FONTES_UNIDADE_FECHADA = (f: string) =>
          f === 'ficha_preco_fechado'
          || f === 'dtf_uv_degraus'
          || (f === 'catalogo_produtos' && !produtoGuarda);

        // ── v4.37.3: PRECO UNITARIO NAO AUTORIZA O TOTAL ────────────────────
        // MEDIDO em 16 autorizacoes preco_de_ficha ja emitidas: 4 nasceram de frase
        // explicitamente unitaria ("a partir de R$29,90 cada", "R$35,90 a unidade.
        // Quantas voce quer?"). A lista de valores nao podia barra-las: um numero nao
        // carrega a informacao de ser total ou unitario. Nenhuma chegou a ser consumida,
        // entao o risco era latente — esta guarda o fecha antes de virar cobranca.
        // DOIS SINAIS, do mais confiavel para o menos:
        //  1 ESTRUTURADO: quantidade ja conhecida (slot do turno, estado salvo ou soma da
        //    grade) maior que 1. Se o pedido tem N>1 pecas, um valor unico da ficha NAO
        //    pode ser o total — o total seria N x unitario. Nao depende de ler texto.
        //  2 SEMANTICO: a FRASE que carrega o valor o enuncia como unitario. Escopo por
        //    frase, nao pela mensagem inteira, para nao derrubar preco fechado legitimo
        //    por causa de frase vizinha.
        // Esta guarda so REMOVE autorizacao; nunca cria. O Joao continua livre para
        // INFORMAR o preco unitario: nada aqui toca o texto enviado ao cliente.
        const qtdDoPedido: number | null = (() => {
          for (const v of [(decisao.slots || {}).quantidade, estado?.slots?.quantidade]) {
            const n = Number(String(v ?? '').replace(',', '.'));
            if (Number.isFinite(n) && n > 0) return n;
          }
          const sg = somaGrade((decisao.slots || {}).grade ?? estado?.slots?.grade);
          return (sg !== null && sg > 0) ? sg : null;
        })();
        const frasesDoValor = soUm ? frasesComValor(resposta, conferidos[0].centavos) : [];
        const valorEUnitario = soUm && (
          (qtdDoPedido !== null && qtdDoPedido > 1)
          || (frasesDoValor.length > 0
                ? frasesDoValor.some((f) => RX_PRECO_UNITARIO.test(f))
                : RX_PRECO_UNITARIO.test(resposta))
        );
        const ehProduto = soUm
          && !valorEUnitario
          && PRECOS_FICHA_FECHADOS.has(conferidos[0].centavos)
          && FONTES_UNIDADE_FECHADA(conferidos[0].fonte);
        if (soUm && valorEUnitario) {
          await logErro('preco_unitario_nao_autoriza_total', {
            phone, centavos: conferidos[0].centavos, fonte: conferidos[0].fonte,
            quantidade_conhecida: qtdDoPedido,
            frase: (frasesDoValor[0] || resposta).trim().slice(0, 160),
          });
        }
        const jaTemProdutoNoTurno = (ctx.autorizacoes || []).some((o: any) => o.kind === 'produto');
        if (ehProduto && !jaTemProdutoNoTurno) {
          const { data: jaAtiva } = await sb.from('operacoes_financeiras')
            .select('id').eq('lead_id', leadId).eq('kind', 'produto').eq('status', 'ativa')
            .gt('expires_at', new Date().toISOString()).limit(1).maybeSingle();
          if (!jaAtiva?.id) {
            const reais = conferidos[0].centavos / 100;
            const opF = await emitirAutorizacao(leadId, 'produto', reais, 'preco_de_ficha',
              { origem: 'ficha_tecnica', centavos: conferidos[0].centavos, fonte: conferidos[0].fonte, quantidade: 1, texto: resposta.slice(0, 160) });
            if (opF?.id) {
              ctx.autorizacoes.push({ operation_id: opF.id, kind: 'produto', amount: Number(opF.amount) });
              L('autorizacao_preco_de_ficha', { phone: phone.slice(-4), operation_id: opF.id, centavos: conferidos[0].centavos });
            } else {
              await logErro('preco_de_ficha_sem_autorizacao', { phone, centavos: conferidos[0].centavos });
            }
          }
        }
      } catch (e: any) { await logErro('preco_de_ficha_excecao', { phone, e: String(e?.message ?? e).slice(0, 150) }); }
    } else if (naMsg.length > 0) {
      // cruzados > 0. Ja bloqueado acima com guardrail_preco_de_outro_produto.
      // Comportamento e log preservados exatamente como no v4.29.0.
      decisao.responde = false;
      await logErro('guardrail_preco_sem_tool', { phone, resposta: resposta.slice(0, 300), nao_conferidos: naoConferidos });
    } else {
      // v4.30.0: naMsg vazio. A guarda nao extraiu NENHUM valor para julgar, logo nao
      // existe preco reprovado pelo contrato vigente e nao existe base para bloquear.
      // Nao libera preco: nao ha preco extraido. So deixa de derrubar resposta certa.
      await logErro('guarda_preco_sem_valor_extraido', { phone, resposta: resposta.slice(0, 300) });
    }
  }
  // ── v92: GUARDRAIL DE PRECO FALADO ────────────────────────────────────────
  // So atua quando alguma ferramenta declarou precos verbalizaveis neste turno.
  // Valor monetario fora da lista derruba a resposta e vai para retry com os oficiais.
  // v97 GUARDA B: nao pedir nem negar midia que o cliente JA MANDOU neste turno.
  // Rede de seguranca independente do desempate: se a imagem chegou junto e por qualquer
  // motivo a frase saiu assim, derruba e refaz com a instrucao correta.
  if (decisao.responde === true && (imagens.length > 0 || transcricoes.length > 0)) {
    const RX_NEGA_MIDIA = /(n[a\u00e3]o recebi (a |o )?(imagem|foto|arquivo|[a\u00e1]udio)|pode reenviar|me mostra a imagem|manda a foto|envie a imagem|reenvia a (imagem|foto)|n[a\u00e3]o consegui (ver|abrir))/i;
    if (RX_NEGA_MIDIA.test(resposta)) {
      await logErro('guardrail_negou_midia_recebida', { phone, imagens: imagens.length, audios: transcricoes.length, resposta: resposta.slice(0, 200) });
      try {
        const dm = await chamarCerebro('[SISTEMA: sua resposta foi bloqueada. O cliente JA ENVIOU ' + (imagens.length > 0 ? 'imagem' : 'audio') + ' e voce disse que nao recebeu ou pediu de novo. Voce TEM o conteudo. Responda ao que foi enviado, descrevendo o que viu ou ouviu. NUNCA peca para reenviar. Retorne APENAS o JSON.]');
        const rm = aberturaCorreta(sanearMsg(dm.mensagem), !conversaAtivaHoje, false);
        if (dm.responde === true && !RX_NEGA_MIDIA.test(rm) && validarMsg(rm, ehPerguntaDireta) && validarPix(rm)) { decisao = dm; resposta = rm; }
        else { await logErro('guardrail_negou_midia_2a_falha', { phone }); decisao.responde = false; }
      } catch { decisao.responde = false; }
    }
  }

  if (decisao.responde === true && temPreco && ctx.precosAutorizados.length > 0) {
    const permitidos = new Set<number>(ctx.precosAutorizados.map((p: any) => Number(p.centavos)));
    const naMsg = valoresDaMensagem(resposta);
    const intrusos = naMsg.filter((c: number) => !permitidos.has(c));
    if (intrusos.length > 0) {
      await logErro('guardrail_preco_nao_autorizado', { phone, intrusos, autorizados: [...permitidos], resposta: resposta.slice(0, 300) });
      const lista = ctx.precosAutorizados.map((p: any) => `- ${p.tipo}: R$${(Number(p.centavos)/100).toFixed(2).replace('.', ',')}`).join('\n');
      try {
        const dg = await chamarCerebro('[SISTEMA: sua resposta foi bloqueada porque continha valor monetario nao autorizado. Use EXCLUSIVAMENTE os valores oficiais abaixo, exatamente como estao:\n' + lista + '\nNao recalcule, nao estime, nao some e nao altere nenhum valor. Retorne APENAS o JSON.]');
        const rg = aberturaCorreta(sanearMsg(dg.mensagem), !conversaAtivaHoje, false);
        const intrusos2 = valoresDaMensagem(rg).filter((c: number) => !permitidos.has(c));
        if (dg.responde === true && intrusos2.length === 0 && validarMsg(rg, ehPerguntaDireta) && validarPix(rg)) {
          decisao = dg; resposta = rg;
        } else {
          await logErro('guardrail_preco_nao_autorizado_2a_falha', { phone, intrusos2 });
          decisao.responde = false;
        }
      } catch { decisao.responde = false; }
    }
  }

  if (decisao.responde === true && execucoes.cobrancaPendente && !pediuMudanca && temPreco) {
    const vPend = Math.round(Number(execucoes.cobrancaPendente.valor) * 100) / 100;
    const valoresNaMsg = (resposta.match(/R\$\s?(\d{1,5}(?:[.,]\d{3})*[.,]\d{2})/g) || []).map((s: string) => {
      const n = parseFloat(s.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.')); return Math.round(n * 100) / 100;
    });
    if (valoresNaMsg.some((v: number) => Math.abs(v - vPend) > 0.015)) {
      decisao.responde = false;
      await logErro('guardrail_valor_diverge_cobranca_pendente', { phone, valor_pendente: vPend, valores_msg: valoresNaMsg });
    }
  }
  const RX_PROMETE = /(vou|vamos|j\u00e1 vou|deixa eu) (calcular|verificar|ver|consultar|conferir)|(j\u00e1|ja) (calculo|verifico|confiro)|um momento|s\u00f3 um instante/i;
  if (decisao.responde === true && RX_PROMETE.test(resposta) && !/R\$\s?\d/.test(resposta)) {
    try {
      const d6 = await chamarCerebro('[SISTEMA: voce prometeu calcular mas nao chamou ferramenta e nao mandou numero. CHAME AGORA a ferramenta necessaria e RESPONDA com o resultado em R$ na mesma mensagem. Retorne APENAS o JSON.]');
      const r6 = aberturaCorreta(sanearMsg(d6.mensagem), !conversaAtivaHoje, false);
      if (d6.responde === true && /R\$\s?\d/.test(r6) && validarMsg(r6, ehPerguntaDireta) && validarPix(r6)) { decisao = d6; resposta = r6; }
    } catch {}
  }
  if (decisao.responde === true && devePrecoJa && !/R\$\s?\d/.test(resposta)) {
    // v107: este retry FALHAVA EM SILENCIO. O catch vazio engolia tudo e nao havia log de
    // sucesso nem de fracasso, entao ficava invisivel que o cliente pediu preco e nao recebeu.
    // Caso 02/08 08:46 (11 93939-4155): perguntou "Qual valor do metro" e o agente repetiu
    // "qual a medida da sua arte e quantas copias" — a MESMA pergunta que ele acabara de fazer.
    let salvou = false;
    try {
      const d3 = await chamarCerebro('[SISTEMA: o cliente PEDIU PRECO e sua resposta nao trouxe valor em R$. '
        + 'Se ele perguntou o valor do METRO, MANDE A TABELA COMPLETA agora, uma faixa por linha. '
        + 'NAO pergunte medida de arte nem quantidade: ele quer a tabela, nao um orcamento. '
        + 'Chame a ferramenta correta e RESPONDA com os precos. Retorne APENAS o JSON.]');
      const r3 = aberturaCorreta(sanearMsg(d3.mensagem), !conversaAtivaHoje, false);
      if (d3.responde === true && /R\$\s?\d/.test(r3) && validarMsg(r3, ehPerguntaDireta) && validarPix(r3)) {
        decisao = d3; resposta = r3; salvou = true;
      }
    } catch (e: any) {
      await logErro('retry_preco_excecao', { phone, e: String(e?.message ?? e).slice(0, 150) });
    }
    if (!salvou) {
      await logErro('pediu_preco_e_nao_recebeu', { phone, mensagem_cliente: mensagem.slice(0, 120), resposta: resposta.slice(0, 250) });
    }
  }
  // v4.34.0 P0: `&& !estadoLog.bloqueia_frete` — este retry EXIGE PAC/Sedex no texto. Sob
  // retirada/motoboy ele seria a propria fonte da oferta de Correios que a frente proibe.
  if (decisao.responde === true && !estadoLog.bloqueia_frete && toolsUsadas.includes('calcular_frete') && !execucoes.freteJa && !/PAC|Sedex|SEDEX|frete/i.test(resposta)) {
    try {
      const d4 = await chamarCerebro('[SISTEMA: voce chamou calcular_frete e nao colocou as opcoes na resposta. Reescreva informando PAC e Sedex com preco, prazo e TOTAL. Retorne APENAS o JSON.]');
      const r4 = aberturaCorreta(sanearMsg(d4.mensagem), !conversaAtivaHoje, false);
      if (d4.responde === true && /PAC|Sedex|SEDEX/i.test(r4) && validarMsg(r4, ehPerguntaDireta) && validarPix(r4)) { decisao = d4; resposta = r4; }
    } catch {}
  }
  // ── v4.21.1: PIX PROMETIDO OU PEDIDO E NAO GERADO ──────────────────────────
  // A guarda da v107 so acionava quando o CLIENTE escrevia "pix". Caso Josiene 03/08 17:28:
  // a mensagem dela era "Vou ficar com o sedex" e a promessa partiu DELE ("Total R$52,70.
  // Vou gerar o Pix pra voce agora"). Nada verificou, e a venda saiu por chave manual.
  // Agora a guarda olha os DOIS lados: o pedido do cliente E a promessa do agente.
  // v4.33.0 P0: o cliente condicionou o pagamento a ver a arte. Nesse turno o pedido de Pix
  // dele nao arma a maquinaria de cobranca — a frase seguinte dele e que manda.
  const holdArtePagamento = RX_HOLD_ARTE_PAGAMENTO.test(mensagem);
  const pediuPix = /\b(pix|pode ser pix|manda o pix|gera o pix|quero pagar)\b/i.test(mensagem) && !holdArtePagamento;
  // v4.33.0 P0: prometeuPix so enxergava promessa em FUTURO ("vou gerar o pix"). O vazamento
  // de 25/08 usou o PRESENTE — "Segue o Pix:" — que nao casava com nada e, por isso, nao
  // acionava nem a guarda de promessa nem o reenvio da cobranca pendente. Agora a afirmacao
  // de ENTREGA conta como promessa: se ele diz que esta entregando Pix, tem de existir Pix.
  const RX_ENTREGA_PIX = /(segue|segui|aqui (?:est[a\u00e1]|vai|v\u00e3o)|te (?:envio|mando|passo)|vou te (?:enviar|mandar|passar))\s+(?:o |a |seu |sua )?(?:pix|c[o\u00f3]digo|chave|cobran[c\u00e7]a)\b|\b(?:c[o\u00f3]digo|chave)\s+pix\b|\bpix\s*:/i;
  const prometeuPix = /(vou|vamos|j[a\u00e1] vou|deixa eu|posso) (gerar|mandar|enviar|passar|criar|fazer)\s+(o |seu |a |sua )?(pix|c[o\u00f3]digo|cobran[c\u00e7]a|chave)|(gero|mando|envio|passo|crio)\s+(o |seu )?pix|pix (vai |ja |j[a\u00e1] )?(sai|segue|vem)|te mando o pix/i.test(resposta)
    || RX_ENTREGA_PIX.test(resposta);
  const pediuCartao = /\b(cart[a\u00e3]o|cr[e\u00e9]dito|parcel(?:a|ado|amento|ar)|at[e\u00e9]\s*3x)\b/i.test(mensagem);
  const prometeuCartao = /(?:link|checkout).{0,45}(?:cart[a\u00e3]o|pagamento)|(?:cart[a\u00e3]o|cr[e\u00e9]dito).{0,45}(?:link|checkout)|https?:\/\/\S+/i.test(resposta)
    && /cart[a\u00e3]o|cr[e\u00e9]dito|parcel|pagamento|checkout/i.test(resposta);
  // v4.33.0 P0: a chave manual saiu de circulacao, entao ela nao prova mais "tem Pix".
  const temCodigoPix = /000201/.test(resposta);
  // v4.21.2 INVARIANTE 3: a condicao passa a ser "o Pix EXISTE?", nao "a tool foi chamada?".
  // A v4.21.1 exigia !toolsUsadas.includes('gerar_pix') — e o caso REAL medido em 10 de 10
  // falhas e ele CHAMAR a tool com id inventado e ela recusar. Nesse caso a tool estava em
  // toolsUsadas e a guarda nao rodava justamente no cenario que a motivou.
  const pixConfirmado = ctx.pixGerado?.ok === true && !!ctx.pixGerado?.qr_code;
  if (decisao.responde === true && (pediuPix || prometeuPix || pediuCartao || prometeuCartao) && !temCodigoPix
      && !pixConfirmado && !execucoes.cobrancaPendente) {
    try {
      // v4.21.1: a escolha da autorizacao passa a ser por SEMANTICA, nao por recencia.
      // Antes pegava a mais recente, e num pedido produto + frete onde so o frete tinha
      // autorizacao ela apontaria para o frete: cobranca de R$22,80 num pedido de R$52,70,
      // 57% a menos. Ordem correta: total ja composto > produto > frete sozinho.
      const { data: ativas } = await sb.from('operacoes_financeiras')
        .select('id, kind, amount').eq('lead_id', leadId).eq('status', 'ativa')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(6);
      const lista = ativas || [];
      // v4.21.2 INVARIANTE 2: FRETE JAMAIS E ELEGIVEL SOZINHO.
      // O fallback `|| lista[0]` da v4.21.1 permitia escolher o frete quando era a unica
      // autorizacao ativa: num pedido de R$52,70 com produto sem autorizacao, cobraria
      // R$22,80 — 57% a menos. Frete e PARCELA, nunca pedido. Sem total e sem produto,
      // nao existe autorizacao elegivel: o caminho correto e calcular o produto.
      const escolhida = lista.find((a: any) => a.kind === 'total')
        || lista.find((a: any) => a.kind === 'produto')
        || null;
      const produto = lista.find((a: any) => a.kind === 'produto');
      const frete = lista.find((a: any) => a.kind === 'frete');
      const temPar = !!(produto && frete && !lista.some((a: any) => a.kind === 'total'));

      if (escolhida?.id) {
        await logErro('pix_prometido_e_nao_gerado', { phone, origem: pediuPix ? 'cliente_pediu' : 'agente_prometeu', operation_id: escolhida.id, kind: escolhida.kind, amount: escolhida.amount, tools: toolsUsadas });
        const instrucao = temPar
          ? '[SISTEMA: o Pix foi prometido e nao foi gerado. Existem DUAS autorizacoes ativas: produto R$'
            + Number(produto!.amount).toFixed(2).replace('.', ',') + ' com operation_id ' + produto!.id
            + ' e frete R$' + Number(frete!.amount).toFixed(2).replace('.', ',') + ' com operation_id ' + frete!.id
            + '. Chame compor_total com esses DOIS operation_id e depois gerar_pix com o id que ele devolver. '
            + 'Copie os identificadores EXATAMENTE como estao: sao UUID, e PROIBIDO inventar ou montar um. Retorne APENAS o JSON.]'
          : '[SISTEMA: o Pix foi prometido e nao foi gerado. Existe autorizacao ATIVA de R$'
            + Number(escolhida.amount).toFixed(2).replace('.', ',') + ' com operation_id ' + escolhida.id
            + '. Chame gerar_pix AGORA com esse operation_id, copiado EXATAMENTE como esta: e um UUID, '
            + 'e PROIBIDO inventar ou montar um identificador. NAO ofereca outros produtos. Retorne APENAS o JSON.]';
        const dp = await chamarCerebro(instrucao);
        const rp = aberturaCorreta(sanearMsg(dp.mensagem), !conversaAtivaHoje, false);
        // v4.21.2: aceitar o retry exige PROVA de cobranca, nao texto convincente.
        // Sem ctx.pixGerado.ok o retry falhou, mesmo que a mensagem pareca perfeita.
        const gerouAgora = ctx.pixGerado?.ok === true && !!ctx.pixGerado?.qr_code;
        if (dp.responde === true && gerouAgora && validarMsg(rp, ehPerguntaDireta) && validarPix(rp)) {
          decisao = dp; resposta = rp;
        } else {
          await logErro('retry_pix_nao_gerou', { phone, operation_id: escolhida.id, respondeu: dp?.responde === true, pix_confirmado: gerouAgora });
        }
      } else if (prometeuPix) {
        // Prometeu e nao existe autorizacao nenhuma para cobrar. Melhor nao prometer:
        // refaz a resposta pedindo o que falta em vez de deixar o cliente esperando codigo.
        await logErro('pix_prometido_sem_autorizacao', { phone, tools: toolsUsadas, resposta: resposta.slice(0, 200) });
        try {
          const dq = await chamarCerebro('[SISTEMA: voce prometeu gerar o Pix e NAO existe nenhum valor calculado por ferramenta para cobrar. '
            + 'PROIBIDO prometer cobranca sem ter o calculo. Chame a ferramenta de calculo do produto AGORA '
            + '(e calcular_frete se houver envio), apresente o total e so entao gere o Pix. '
            + 'Se ainda faltar algum dado do cliente, pergunte O QUE FALTA em vez de prometer o Pix. Retorne APENAS o JSON.]');
          const rq = aberturaCorreta(sanearMsg(dq.mensagem), !conversaAtivaHoje, false);
          if (dq.responde === true && validarMsg(rq, ehPerguntaDireta) && validarPix(rq)) { decisao = dq; resposta = rq; }
        } catch {}
      }
    } catch (e: any) { await logErro('guarda_pix_excecao', { phone, e: String(e?.message ?? e).slice(0, 150) }); }
  }

  // v4.22.1: o texto do modelo nunca e fonte de link financeiro. Para cartao, a resposta
  // e reconstruida com a URL exata retornada por mp-pix-criar ou lida da cobranca pendente.
  // Sem essa prova, nenhum link sai — inclusive URLs com aparencia de checkout.
  const checkoutOficial = checkoutMercadoPago(ctx.pixGerado?.checkout_url)
    || checkoutMercadoPago(execucoes.cobrancaPendente?.checkout_url);
  const urlsResposta = resposta.match(/https?:\/\/[^\s<>]+/gi) || [];
  const temUrlPagamento = urlsResposta.some((u: string) => /pay|checkout|pagamento|mercadopago/i.test(u));
  if (decisao.responde === true && (pediuCartao || prometeuCartao)) {
    if (checkoutOficial) {
      if (urlsResposta.some((u: string) => u.replace(/[),.;!?]+$/, '') !== checkoutOficial.replace(/\/$/, ''))) {
        await logErro('link_cartao_modelo_divergia', { phone, payment_id: ctx.pixGerado?.payment_id ?? execucoes.cobrancaPendente?.payment_id ?? null, urls_modelo: urlsResposta.slice(0, 3) });
      }
      resposta = `Segue o link oficial do Mercado Pago para pagar no cartao em ate 3x:\n\n${checkoutOficial}`;
    } else {
      if (temUrlPagamento) await logErro('link_cartao_sem_cobranca', { phone, urls_modelo: urlsResposta.slice(0, 3), tools: toolsUsadas });
      resposta = resposta.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      if (/segue (?:o )?link|link (?:para|de) pagamento|checkout/i.test(resposta) || resposta.length < 12) {
        resposta = 'Ainda nao consegui criar o link oficial do Mercado Pago. Para gerar a cobranca correta, preciso primeiro concluir o valor do pedido.';
      }
    }
  // v4.33.0 P0: FURO CORRIGIDO. checkoutMercadoPago devolve null para host que nao e do
  // Mercado Pago; sem checkout oficial, checkoutOficial tambem e null, e a comparacao
  // null === null dava 'URL autorizada' para QUALQUER link inventado. Foi por aqui que
  // https://pay.smartpag.com.br/<operation_id> saiu em 08/08. Sem checkout oficial
  // PROVADO, nenhuma URL de pagamento atravessa.
  } else if (temUrlPagamento && !(checkoutOficial && urlsResposta.some((u: string) => checkoutMercadoPago(u) === checkoutOficial))) {
    await logErro('link_pagamento_nao_autorizado', { phone, urls_modelo: urlsResposta.slice(0, 3), tools: toolsUsadas });
    resposta = resposta.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // v105: ESCOLHEU O PACK E NAO FECHOU.
  // O cliente responde so o nome do tema depois de receber a lista. Isso e compra, nao duvida.
  // MEDIDO em 30 dias: 12 escolheram tema, 10 nao viraram venda. Os desvios foram: perguntar
  // design e quantidade (Os Incansaveis 01/08), pedir email (16 vezes, 56% sumiu), reapresentar
  // a lista, "deixa eu anotar", e uma vez nao responder nada.
  // Quem recebe pix de pack PAGA em 63% das vezes: e o produto mais facil da casa.
  const RX_TEMA_PACK = /^\s*(streetwear|street ?wear|animes?|nba|rock|futebol|hip ?hop|cat[o\u00f3]lic[oa]s?|caveiras?)[\s,.!]*$/i;
  const escolheuTema = RX_TEMA_PACK.test(mensagem.trim());
  const listouPacksAntes = /pack de estampas|packs? dispon|Animes? -|Streetwear -|R\$ ?6,90/i.test(ultimaMsgJoao || '');
  if (decisao.responde === true && escolheuTema && listouPacksAntes
      && !/R\$\s?\d/.test(resposta)) {
    await logErro('escolheu_pack_e_nao_fechou', { phone, tema: mensagem.trim().slice(0, 30), resposta: resposta.slice(0, 200) });
    try {
      const dpk = await chamarCerebro('[SISTEMA: o cliente ESCOLHEU o pack "' + mensagem.trim()
        + '" da lista que voce mandou. Isso e FECHAMENTO. Chame consultar_catalogo com esse tema, '
        + 'informe o preco e GERE O PIX agora. NAO pergunte design, quantidade nem email. '
        + 'NAO ofereca impressao. Ele quer o ARQUIVO DIGITAL. Retorne APENAS o JSON.]');
      const rpk = aberturaCorreta(sanearMsg(dpk.mensagem), !conversaAtivaHoje, false);
      if (dpk.responde === true && /R\$\s?\d/.test(rpk) && validarMsg(rpk, ehPerguntaDireta) && validarPix(rpk)) {
        decisao = dpk; resposta = rpk;
      }
    } catch {}
  }

  // v110: RENDIMENTO AFIRMADO SEM FERRAMENTA.
  // O guardrail de preco protege DINHEIRO. Nao existia nada protegendo QUANTIDADE — e o agente
  // errou o rendimento DUAS VEZES em 02/08, sempre contando so a largura e esquecendo que o
  // metro tem 100cm de comprimento:
  //   manha (11 93939-4155): "4 copias = 1 metro" para 7x5cm, quando cabem 152 por metro;
  //   noite (11 98287-9283): "cabem 2 estampas de 20cm por metro", quando cabem 8 — e quando
  //   o cliente reclamou que era pouco, ELE REPETIU o numero errado em vez de recalcular.
  // O preco sai CERTO e a entrega sai ERRADA: o cliente paga certo e recebe outra coisa.
  // Rendimento so pode ser afirmado se veio de calcular_dtf_por_arte ou calcular_rendimento_uv.
  // v4.32.0 P1: a regex antiga nao enxergava "cabem aproximadamente 9 a 10 adesivos" — exatamente
  // a forma que o modelo usou no incidente do telefone final 4789. Adverbio de estimativa e
  // intervalo agora sao reconhecidos. Todas as alternativas antigas foram preservadas.
  const REND_ADV = '(?:aproximadamente|aprox\\.?|cerca\\s+de|em\\s+m[e\u00e9]dia|na\\s+m[e\u00e9]dia|mais\\s+ou\\s+menos|por\\s+volta\\s+de|em\\s+torno\\s+de|no\\s+m[a\u00e1]ximo|no\\s+m[i\u00ed]nimo|quase|at[e\u00e9]|uns|umas)';
  const REND_VERBO = '(?:cabem?|rende[mn]?|entram?|d[a\u00e1]\\s+para)';
  const RX_AFIRMA_RENDIMENTO = new RegExp(
    REND_VERBO + '\\s+(?:' + REND_ADV + '\\s+)*\\d+'
    + '|\\d+\\s*(estampas?|adesivos?|c[o\u00f3]pias?|pe[c\u00e7]as?|unidades?|artes?)\\s*(por|em|a cada|no|=)\\s*\\d*\\s*(metro|1\\s*m\\b|cada metro)'
    + '|\\d+\\s*(por|em)\\s*metro'
    + '|\\d+\\s*(por|na)\\s*(linha|fileira)', 'i');
  // Extrai os numeros DE RENDIMENTO afirmados (nao confundir com dimensao "5x6cm" nem com
  // dinheiro "R$99,00 por metro": dimensao nao vem apos verbo de capacidade e o lookbehind
  // barra valor monetario e casa decimal).
  const numerosRendimentoAfirmados = (txt: string): number[] => {
    const out: number[] = [];
    let m: RegExpExecArray | null;
    const rxA = new RegExp(REND_VERBO + '\\s+(?:' + REND_ADV + '\\s+)*(\\d+)(?:\\s*(?:a|at[e\u00e9]|ou|-|\u2013)\\s*(\\d+))?', 'gi');
    while ((m = rxA.exec(txt)) !== null) {
      for (const g of [m[1], m[2]]) { const v = Number(g); if (Number.isInteger(v) && v > 0) out.push(v); }
    }
    const rxB = /(?<![\d,.])(?<!R\$)(?<!R\$\s)(\d+)\s*(?:estampas?|adesivos?|c[o\u00f3]pias?|pe[c\u00e7]as?|unidades?|artes?)?\s*(?:por|a cada)\s*(?:1\s*)?metro/gi;
    while ((m = rxB.exec(txt)) !== null) { const v = Number(m[1]); if (Number.isInteger(v) && v > 0) out.push(v); }
    return [...new Set(out)];
  };
  const TOOLS_RENDIMENTO = ['calcular_dtf_por_arte', 'calcular_rendimento_uv'];
  if (decisao.responde === true && RX_AFIRMA_RENDIMENTO.test(resposta)
      && !toolsUsadas.some((t: string) => TOOLS_RENDIMENTO.includes(t))) {
    await logErro('guardrail_rendimento_sem_tool', { phone, resposta: resposta.slice(0, 300), tools: toolsUsadas });
    try {
      const dr = await chamarCerebro('[SISTEMA: sua resposta afirma QUANTAS pecas cabem e voce NAO chamou a ferramenta de rendimento. '
        + 'PROIBIDO calcular isso de cabeca. Rendimento tem DUAS dimensoes: quantas cabem LADO A LADO na largura '
        + '(util 57cm no textil, 28cm no UV) E quantas FILEIRAS cabem no comprimento do metro. O total e a MULTIPLICACAO. '
        + 'Chame calcular_dtf_por_arte (textil) ou calcular_rendimento_uv (UV) AGORA e use o numero que ela devolver. Retorne APENAS o JSON.]');
      const rr = aberturaCorreta(sanearMsg(dr.mensagem), !conversaAtivaHoje, false);
      const aindaSemTool = RX_AFIRMA_RENDIMENTO.test(rr) && !toolsUsadas.some((t: string) => TOOLS_RENDIMENTO.includes(t));
      if (dr.responde === true && !aindaSemTool && validarMsg(rr, ehPerguntaDireta) && validarPix(rr)) {
        decisao = dr; resposta = rr;
      } else {
        await logErro('guardrail_rendimento_2a_falha', { phone });
        decisao.responde = false;
      }
    } catch (e: any) {
      await logErro('guardrail_rendimento_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) });
      decisao.responde = false;
    }
  }

  // v4.32.0 P1: TOOL CHAMADA != RENDIMENTO AUTORIZADO.
  // No incidente do telefone final 4789 o modelo chamou calcular_rendimento_uv DUAS vezes e
  // ainda assim verbalizou "9 a 10" e "6 a 7" quando o correto era 75 e 48: sem
  // quantidade_desejada a tool executava mas NAO devolvia capacidade nenhuma, e a guarda antiga
  // so olhava a PRESENCA da tool em toolsUsadas. Agora o numero afirmado tem de bater com o que
  // a fonte canonica fn_dtf_uv_capacidade_folha devolveu NESTE turno.
  const rendAutorizados: any[] = Array.isArray(ctx.rendimentosAutorizados) ? ctx.rendimentosAutorizados : [];
  const numerosRendOk = new Set<number>();
  for (const r of rendAutorizados) { const v = Number(r?.cabem_por_metro); if (Number.isInteger(v) && v > 0) numerosRendOk.add(v); }
  for (const v of (Array.isArray(ctx.rendimentosAuxiliares) ? ctx.rendimentosAuxiliares : [])) { if (Number.isInteger(v) && v > 0) numerosRendOk.add(Number(v)); }
  // DTF textil tem fonte propria (calcular_dtf_por_arte) e esta fora deste patch: a camada
  // dura nao roda quando a resposta se apoia nela. A guarda antiga acima continua valendo la.
  const usouRendTextil = toolsUsadas.includes('calcular_dtf_por_arte');
  if (decisao.responde === true && !usouRendTextil && RX_AFIRMA_RENDIMENTO.test(resposta)) {
    const afirmados = numerosRendimentoAfirmados(resposta);
    const divergentes = afirmados.filter((v: number) => !numerosRendOk.has(v));
    if (afirmados.length > 0 && (rendAutorizados.length === 0 || divergentes.length > 0)) {
      await logErro('guardrail_rendimento_nao_autorizado', { phone, afirmados, divergentes, autorizados: [...numerosRendOk], canonicos: rendAutorizados, tools: toolsUsadas, resposta: resposta.slice(0, 300) });
      const listaCanonica = rendAutorizados.length > 0
        ? rendAutorizados.map((r: any) => `- ${r.largura_cm}x${r.altura_cm}cm: cabem EXATAMENTE ${r.cabem_por_metro} por metro (fonte ${r.fonte})`).join('\n')
        : '(nenhum rendimento foi medido neste turno)';
      try {
        const dn = await chamarCerebro('[SISTEMA: sua resposta foi bloqueada porque afirmou QUANTOS cabem com numero que a ferramenta NAO devolveu. '
          + 'PROIBIDO estimar, arredondar ou dar faixa do tipo "9 a 10". Rendimento so pode ser verbalizado com o numero exato medido.\n'
          + 'Rendimentos oficiais deste turno:\n' + listaCanonica + '\n'
          + (rendAutorizados.length > 0
              ? 'Use EXATAMENTE esses numeros, sem arredondar e sem faixa.'
              : 'Nenhum rendimento foi medido: chame calcular_rendimento_uv com largura_cm e altura_cm SEM quantidade_desejada e use o cabem_por_metro devolvido.')
          + ' Retorne APENAS o JSON.]');
        const rn = aberturaCorreta(sanearMsg(dn.mensagem), !conversaAtivaHoje, false);
        const rendAut2: any[] = Array.isArray(ctx.rendimentosAutorizados) ? ctx.rendimentosAutorizados : [];
        const okSet2 = new Set<number>(numerosRendOk);
        for (const r of rendAut2) { const v = Number(r?.cabem_por_metro); if (Number.isInteger(v) && v > 0) okSet2.add(v); }
        for (const v of (Array.isArray(ctx.rendimentosAuxiliares) ? ctx.rendimentosAuxiliares : [])) { if (Number.isInteger(v) && v > 0) okSet2.add(Number(v)); }
        const afirmados2 = RX_AFIRMA_RENDIMENTO.test(rn) ? numerosRendimentoAfirmados(rn) : [];
        const aindaDivergente = afirmados2.length > 0 && (rendAut2.length === 0 || afirmados2.some((v: number) => !okSet2.has(v)));
        if (dn.responde === true && !aindaDivergente && validarMsg(rn, ehPerguntaDireta) && validarPix(rn)) {
          decisao = dn; resposta = rn;
        } else {
          // FAIL-CLOSED: melhor nao responder do que mandar rendimento inventado.
          await logErro('guardrail_rendimento_nao_autorizado_2a_falha', { phone, afirmados2, autorizados: [...okSet2] });
          decisao.responde = false;
        }
      } catch (e: any) {
        await logErro('guardrail_rendimento_nao_autorizado_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) });
        decisao.responde = false;
      }
    }
  }

  const RX_JOGA_CONTA = /quantos metros (voc[e\u00ea] |vc )?(quer|deseja|vai|pretende|precisa)|prefere que (a gente|eu) calcul|quer arredondar/i;
  if (decisao.responde === true && RX_JOGA_CONTA.test(resposta)) {
    try {
      const d5 = await chamarCerebro('[SISTEMA: nao devolva a conta de metragem ao cliente. Chame calcular_rendimento_uv com quantidade_desejada e RESPONDA com metros e VALOR TOTAL. Retorne APENAS o JSON.]');
      const r5 = aberturaCorreta(sanearMsg(d5.mensagem), !conversaAtivaHoje, false);
      if (d5.responde === true && /R\$\s?\d/.test(r5) && !RX_JOGA_CONTA.test(r5) && validarMsg(r5, ehPerguntaDireta) && validarPix(r5)) { decisao = d5; resposta = r5; }
    } catch {}
  }
  if (decisao.responde === true && mudouProduto) {
    const rxNovo = prodMsg === 'dtf_uv' ? /\buv\b|adesivo/i : prodMsg === 'dtf_textil' ? /t[e\u00ea]xtil|pel[i\u00ed]cula|filme|metro/i : prodMsg === 'camiseta' ? /camiseta|baby|polo|moletom/i : prodMsg === 'copo' ? /copo|caneca|garrafa/i : /pack|estampa/i;
    if (!rxNovo.test(resposta)) {
      try {
        const d7 = await chamarCerebro(`[SISTEMA: o cliente perguntou sobre ${NOME_PRODUTO[prodMsg!] || prodMsg} e sua resposta nao fala disso. Responda AGORA sobre ${NOME_PRODUTO[prodMsg!] || prodMsg} com preco de ferramenta. Retorne APENAS o JSON.]`);
        const r7 = aberturaCorreta(sanearMsg(d7.mensagem), !conversaAtivaHoje, false);
        if (d7.responde === true && rxNovo.test(r7) && validarMsg(r7, ehPerguntaDireta) && validarPix(r7)) { decisao = d7; resposta = r7; }
      } catch {}
    }
  }
  const rxUV = /adesivo|\buv\b|copo|caneca|garrafa|vidro|metal|madeira|mdf|acr\u00edlico/i;
  const contextoUV = rxUV.test(mensagem) || rxUV.test(String(categoriaAnuncio)) || rxUV.test(anuncioTexto) || rxUV.test(String(estado?.slots?.produto || ''));
  const rxPrecoTextil = /R\$\s?(59,90|54,90|49,90|44,90|39,90|35,90)/;
  if (decisao.responde === true && contextoUV && !mudouProduto && (/6 estampas A4|3 estampas A3/i.test(resposta) || rxPrecoTextil.test(resposta)) && !/dtf t\u00eaxtil|dtf textil|para tecido|camiseta/i.test(resposta)) {
    decisao.responde = false;
    await logErro('guardrail_tabela_textil_em_contexto_uv', { phone, resposta: resposta.slice(0, 400) });
  }
  // v109 CAMADA 2: PERGUNTA REPETIDA.
  // Rede de seguranca da camada 1: se mesmo com o contexto explicito ele repetir uma pergunta
  // que ja fez nas ultimas mensagens, a resposta e derrubada e refeita com ordem de usar o que
  // o cliente ja respondeu. Deterministico: nao depende de o modelo obedecer regra em texto.
  // Caso 02/08 20:00 (19 99884-8248): pediu o CEP as 19:56, recebeu "13503668" as 19:58 e as
  // 20:00 perguntou "qual o tamanho do adesivo e quantos voce quer" — a PRIMEIRA pergunta da
  // conversa, feita as 19:49. O cliente respondeu certo e foi mandado de volta ao inicio.
  // v109: compara por FAMILIA DE ASSUNTO, nao por texto igual. "Qual o tamanho?" e "Me diz a
  // medida?" sao a MESMA pergunta com palavras diferentes; "Qual o CEP para a regiao?" e
  // "Qual o CEP para o frete?" tambem. Testado em 9 casos: pega repeticao com sinonimo e com
  // variacao (quantos/quantas), e deixa passar avanco real (quantidade -> cor, tamanho -> fechamento).
  const FAMILIAS_PERGUNTA: Record<string, string[]> = {
    medida:     ['tamanho','tamanhos','medida','medidas','dimensao','dimensoes','centimetros'],
    quantidade: ['quantos','quantas','quantidade','unidades','pecas'],
    cor:        ['cor','cores'],
    arte:       ['arte','artes','estampa','estampas','layout','design'],
    local:      ['cep','endereco','regiao'],
    contato:    ['email','mail'],
    prazo:      ['prazo','data'],
    modelo:     ['modelo','modelos'],
    tema:       ['tema','temas'],
  };
  const PARADAS = ['voce','vcs','qual','quais','para','pra','seu','sua','que','precisa','quer','gostaria','poderia','sabe','tem','com','dos','das','uma','sao','esta','diz'];
  function palavrasDaPergunta(t: string): string[] {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w: string) => w.length >= 3 && !PARADAS.includes(w));
  }
  function familiasDaPergunta(t: string): string[] {
    const tk = new Set(palavrasDaPergunta(t)); const out: string[] = [];
    for (const f of Object.keys(FAMILIAS_PERGUNTA)) if (FAMILIAS_PERGUNTA[f].some((w) => tk.has(w))) out.push(f);
    return out;
  }
  function ehMesmaPergunta(anterior: string, nova: string): boolean {
    const nT = new Set(palavrasDaPergunta(nova)); if (nT.size === 0) return false;
    const sT = new Set(palavrasDaPergunta(anterior)); if (sT.size === 0) return false;
    const nF = familiasDaPergunta(nova); const sF = familiasDaPergunta(anterior);
    if (nF.length && sF.length && nF.some((f) => sF.includes(f))) return true;
    let comuns = 0; for (const t of nT) if (sT.has(t)) comuns++;
    const menor = Math.min(nT.size, sT.size);
    return menor > 0 && (comuns / menor) >= 0.6;
  }
  // v4.21.6 — remocao cirurgica da pergunta repetida (recuperacao deterministica).
  // Localiza dentro da resposta ORIGINAL a sentenca interrogativa que corresponde ao
  // nucleo detectado, usando a MESMA logica de ehMesmaPergunta(). Remove somente ela,
  // preserva literalmente o restante e faz apenas limpeza de espacos/quebras.
  // NAO reescreve, NAO resume, NAO recalcula. Devolve null quando a identificacao nao
  // e inequivoca (zero ou mais de uma candidata, ou a candidata aparece 2x no texto):
  // nesse caso o chamador registra preservacao_falhou em vez de improvisar cirurgia.
  function removerPerguntaRepetida(original: string, nucleo: string): string | null {
    const brutos = String(original || '').match(/[^.!?\n]*\?/g) || [];
    const candidatas = brutos.filter((b: string) => b.trim().length >= 8 && ehMesmaPergunta(b.trim(), nucleo));
    if (candidatas.length !== 1) return null;
    const alvo = candidatas[0];
    const idx = original.indexOf(alvo);
    if (idx < 0) return null;
    if (original.indexOf(alvo, idx + alvo.length) >= 0) return null;
    const cortado = original.slice(0, idx) + original.slice(idx + alvo.length);
    const limpo = cortado
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return limpo.length >= 5 ? limpo : null;
  }
  if (decisao.responde === true && /\?/.test(resposta)) {
    try {
      const { data: ultimasSaidas } = await sb.from('fact_conversations')
        .select('message_text, timestamp').like('phone', `%${phone.slice(-8)}`)
        .eq('direction', 'outbound').eq('source', 'joao')
        .gte('timestamp', new Date(Date.now() - 3 * 3600000).toISOString())
        .order('timestamp', { ascending: false }).limit(3);
      const minhasPerguntas = (ultimasSaidas || [])
        .flatMap((o: any) => (String(o.message_text || '').match(/[^.!?\n]*\?/g) || []))
        .map((q: string) => q.trim()).filter((q: string) => q.length >= 8);
      const perguntasAgora = (resposta.match(/[^.!?\n]*\?/g) || [])
        .map((q: string) => q.trim()).filter((q: string) => q.length >= 8);
      const repetida = perguntasAgora.find((nova: string) =>
        minhasPerguntas.some((velha: string) => ehMesmaPergunta(velha, nova)));
      if (repetida) {
        await logErro('pergunta_repetida', { phone, nucleo: repetida.slice(0, 80), mensagem_cliente: mensagem.slice(0, 80), resposta: resposta.slice(0, 200) });
        // v4.21.6: congela original e tools ANTES do retry (toolsUsadas e mutavel).
        const respostaOriginal = resposta;
        const toolsAntes = [...toolsUsadas];
        const dpr = await chamarCerebro('[SISTEMA: voce esta REPETINDO uma pergunta que ja fez nesta conversa. '
          + 'O cliente respondeu "' + mensagem.trim().slice(0, 80) + '". USE essa resposta e siga para o PROXIMO passo. '
          + 'PROIBIDO perguntar de novo o que ja foi respondido e PROIBIDO voltar a uma pergunta anterior. '
          + 'Se ja tem o que precisa, ORCE ou FECHE. Retorne APENAS o JSON.]');
        const rpr = aberturaCorreta(sanearMsg(dpr.mensagem), !conversaAtivaHoje, false);
        // v4.21.6: toolsUsadas e MUTAVEL e o retry pode chamar ferramenta nova.
        const toolsDepois = [...toolsUsadas];
        const aindaRepete = (rpr.match(/[^.!?\n]*\?/g) || [])
          .some((nova: string) => minhasPerguntas.some((velha: string) => ehMesmaPergunta(velha, nova.trim())));
        // v4.21.6: invariante de preservacao. Preservacao e SUBCONJUNTO, nao igualdade:
        // o retry PODE acrescentar valor, mas NAO pode apagar valor ja presente.
        const valoresAntes = valoresDaMensagem(respostaOriginal);
        const valoresDepois = valoresDaMensagem(rpr);
        const perdeuValor = valoresAntes.some((v: number) => !valoresDepois.includes(v));
        const aceiteNormal = dpr.responde === true && !aindaRepete && validarMsg(rpr, ehPerguntaDireta) && validarPix(rpr);
        let resultadoGuarda = 'rejeitado';
        if (aceiteNormal && !perdeuValor) {
          decisao = dpr; resposta = rpr; resultadoGuarda = 'aceito';
        } else if (aceiteNormal && perdeuValor) {
          // v4.21.6: retry parou de repetir a pergunta mas apagou fato comercial.
          // NAO aceita o retry e NAO devolve a original inteira: remove da ORIGINAL
          // apenas a pergunta repetida. Sem identificacao inequivoca: preservacao_falhou.
          const preservada = removerPerguntaRepetida(respostaOriginal, repetida);
          if (preservada) { resposta = preservada; resultadoGuarda = 'preservado_cirurgia'; }
          else { resultadoGuarda = 'preservacao_falhou'; }
        }
        if (resultadoGuarda !== 'aceito') {
          await logErro('pergunta_repetida_2a_falha', { phone, nucleo: repetida.slice(0, 60) });
        }
        // v4.21.6: telemetria SIMETRICA. Antes, retry aceito nao escrevia nada e a
        // troca de orcamento por promessa era invisivel. Agora todo desfecho e gravado.
        await logErro('pergunta_repetida_desfecho', {
          phone,
          nucleo: repetida.slice(0, 120),
          resultado: resultadoGuarda,
          perdeu_valor: perdeuValor,
          resposta_original: respostaOriginal.slice(0, 1200),
          resposta_retry: rpr.slice(0, 1200),
          resposta_final: resposta.slice(0, 1200),
          valores_antes: valoresAntes,
          valores_depois: valoresDepois,
          tools_antes: toolsAntes,
          tools_depois: toolsDepois,
        });
      }
    } catch (e: any) { await logErro('guarda_repeticao_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) }); }
  }

  // ── v4.34.0 P0: VALIDACAO DE SAIDA — PEDIDO DE CEP / OFERTA DE CORREIOS ───────────
  // A guarda de ferramenta impede o frete de ser CALCULADO; esta impede que a RESPOSTA peca
  // CEP ou ofereca PAC/Sedex quando a modalidade nao admite frete. Foi exatamente por aqui
  // que "Preciso do seu CEP para gerar a cobranca correta, mesmo sendo retirada" saiu sem
  // nenhuma ferramenta envolvida. Preservacao de valor e SUBCONJUNTO (invariante da
  // v4.21.6): o retry so e aceito se nao apagar valor que nao seja de frete.
  if (decisao.responde === true && estadoLog.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(resposta)) {
    const respostaOriginalLog = resposta;
    const valoresAntesLog = valoresDaMensagem(respostaOriginalLog);
    await logErro('guardrail_cep_ou_correios_sem_frete', {
      phone, modalidade: estadoLog.modalidade, proveniencia: estadoLog.proveniencia,
      motivo: estadoLog.motivo_bloqueio, resposta: respostaOriginalLog.slice(0, 300),
      tools: toolsUsadas,
    });
    let desfechoLog = 'rejeitado';
    try {
      const nomeMod = estadoLog.produto_digital ? 'PRODUTO DIGITAL (entrega por link)'
        : estadoLog.modalidade === 'motoboy' ? 'MOTOBOY'
        : estadoLog.modalidade === 'retirada' ? 'RETIRADA PRESENCIAL'
        : 'AINDA NAO RESOLVIDA';
      const dcep = await chamarCerebro('[SISTEMA: a forma de entrega deste pedido e ' + nomeMod + '. '
        + 'Nesta situacao NAO existe frete: e PROIBIDO pedir CEP, PROIBIDO falar em PAC, Sedex ou Correios '
        + 'e PROIBIDO dizer que precisa do CEP para gerar a cobranca. Cobranca nao usa CEP. '
        + (estadoLog.modalidade === 'desconhecida'
            ? 'Pergunte em UMA frase apenas se ele quer retirar aqui em Embu ou receber por envio. '
            : 'Nao pergunte de novo a forma de entrega: ela ja esta definida. ')
        + 'Reescreva a resposta MANTENDO todos os valores em R$ que voce ja calculou para o produto. Retorne APENAS o JSON.]');
      const rcep = aberturaCorreta(sanearMsg(dcep.mensagem), !conversaAtivaHoje, false);
      const valoresDepoisLog = valoresDaMensagem(rcep);
      // Valor de FRETE pode e deve sumir; valor de PRODUTO nao. Como o frete nunca foi
      // calculado neste turno (a guarda o bloqueou), qualquer valor perdido e perda real.
      const perdeuValorLog = valoresAntesLog.some((v: number) => !valoresDepoisLog.includes(v));
      if (dcep.responde === true && !RX_SAIDA_TERMO_FRETE.test(rcep) && !perdeuValorLog
          && validarMsg(rcep, ehPerguntaDireta) && validarPix(rcep)) {
        decisao = dcep; resposta = rcep; desfechoLog = 'aceito';
      }
    } catch (e: any) {
      await logErro('guardrail_cep_sem_frete_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) });
    }
    if (desfechoLog !== 'aceito') {
      // Cirurgia deterministica: remove SO as sentencas que carregam CEP/PAC/Sedex/Correios.
      const podado = removerSentencasComTermo(respostaOriginalLog, RX_SAIDA_TERMO_FRETE);
      if (podado.length >= 8 && !RX_SAIDA_TERMO_FRETE.test(podado)) {
        resposta = podado; desfechoLog = 'preservado_cirurgia';
      } else {
        // Sem texto aproveitavel. Mensagem deterministica, SEM numero novo: nao inventa
        // total e nao repete pergunta ja respondida.
        resposta = estadoLog.produto_digital
          ? 'O arquivo \u00e9 digital e vai por link aqui no WhatsApp, sem frete. Pix ou cart\u00e3o?'
          : estadoLog.modalidade === 'motoboy'
            ? 'Combinado, o motoboy retira aqui em Embu e n\u00e3o tem frete. Pix ou cart\u00e3o?'
            : estadoLog.modalidade === 'retirada'
              ? 'Combinado, fica retirada aqui em Embu e n\u00e3o tem frete. Pix ou cart\u00e3o?'
              : 'Voc\u00ea prefere retirar aqui em Embu ou receber por envio?';
        desfechoLog = 'substituido_deterministico';
      }
    }
    await logErro('guardrail_cep_ou_correios_desfecho', {
      phone, modalidade: estadoLog.modalidade, resultado: desfechoLog,
      valores_antes: valoresAntesLog, valores_depois: valoresDaMensagem(resposta),
      resposta_original: respostaOriginalLog.slice(0, 600), resposta_final: resposta.slice(0, 600),
    });
  }

  // v4.22.6: terminal anti-promessa. Os retries acima podem falhar ou devolver outra promessa;
  // nada com acao futura sai sem prova do efeito ou sem ser convertido em pergunta objetiva.
  const promessaCalculoPendente = RX_PROMETE.test(resposta) && !/R\$\s?\d/.test(resposta);
  const promessaPixPendente = prometeuPix && !pixConfirmado && !temCodigoPix && !execucoes.cobrancaPendente?.qr_code;
  const promessaCartaoPendente = prometeuCartao && !checkoutOficial;
  // CORRECAO DE ESCOPO (frente joao-silencio-vazamento-quente, 16/08/2026).
  // produtoSlot era usado no bloco de PROMESSA SEM CONCLUSAO logo abaixo, mas so era declarado
  // ~93 linhas adiante, em bloco IRMAO. Nao e TDZ: o nome nao existia neste escopo, entao a
  // avaliacao lancava ReferenceError e o fallback que existe para IMPEDIR silencio PRODUZIA silencio.
  // Provado em producao: 2 ReferenceError em 24h (15/08 23:29, 16/08 00:36) e TS2304 x3 no deno check.
  // Mesma expressao da declaracao original; a de baixo passa a apenas sombrear esta, sem mudar valor.
  const produtoSlot = String((({ ...(estado?.slots || {}), ...(decisao.slots || {}) }) as any).produto || '').replace(/^null$/i, '').trim();

  // v4.37.4 P0: prazo padrao nao e agenda confirmada. Impede promessas como
  // "produz amanha", "pode buscar amanha de manha", "pronto hoje" e "em poucas horas".
  const RX_PROMESSA_PRODUCAO_EXATA = /\b(?:fic(?:a|am|arao?|ara)|estar(?:a|ao)|vai\s+(?:ficar|estar)|deix(?:o|amos)|produz(?:imos|ir|ido|ida)?|termin(?:o|amos)|finaliz(?:o|amos)|entreg(?:o|amos)|post(?:o|amos)|pode\s+(?:buscar|retirar|pegar)|consegue\s+(?:buscar|retirar|pegar))\b.{0,60}\b(?:hoje|amanha|esta\s+noite|ainda\s+hoje|pela\s+manha|de\s+manha|ate\s+(?:as?\s*)?\d{1,2}(?::\d{2}|h)?)\b|\bpront[oa]s?\s+(?:hoje|amanha|esta\s+noite|pela\s+manha|de\s+manha)\b|\bem\s+poucas\s+horas\b/i;
  if (decisao.responde === true && RX_PROMESSA_PRODUCAO_EXATA.test(normalizar(resposta))) {
    const respostaPrazoOriginal = resposta;
    const partesSeguras = resposta.split(/(?<=[.!?])\s+|\n+/)
      .filter((p: string) => p.trim() && !RX_PROMESSA_PRODUCAO_EXATA.test(normalizar(p)));
    const prodPrazo = normalizar(produtoSlot + ' ' + String(prodOrigem || ''));
    const prazoSeguro = /camis|polo|molet|peca.*cliente|aplica/.test(prodPrazo)
      ? 'O prazo padrao e de 7 a 10 dias uteis apos a aprovacao do layout. Para uma data especifica, a equipe precisa confirmar o encaixe na agenda.'
      : /copo|garrafa/.test(prodPrazo)
        ? 'O prazo padrao e de 1 a 2 dias uteis para conferencia. A retirada so fica confirmada quando a equipe avisar que o pedido esta pronto.'
        : /dtf|filme|adesivo|textil|uv/.test(prodPrazo)
          ? 'O prazo padrao e de 1 dia util apos a aprovacao do layout. A retirada so fica confirmada quando a equipe avisar que o pedido esta pronto.'
          : 'Para uma data especifica, a equipe precisa confirmar o encaixe na agenda. A retirada so fica confirmada quando o pedido estiver pronto.';
    resposta = [...partesSeguras, prazoSeguro].join(' ').trim();
    await logErro('guardrail_promessa_producao_exata', {
      phone, produto: produtoSlot || prodOrigem || null,
      resposta_original: respostaPrazoOriginal.slice(0, 600), resposta_final: resposta.slice(0, 600)
    });
  }
  if (decisao.responde === true && (promessaCalculoPendente || promessaPixPendente || promessaCartaoPendente)) {
    const consultaOperacional = /\b(status|andamento|ficou pronto|est[a\u00e1] pronto|produ[c\u00e7][a\u00e3]o|meu pedido|cad[e\u00ea] meu pedido)\b/i.test(mensagem);
    if (consultaOperacional) {
      const tarefaCriada = await criarTask(leadId, phone, 'Joao: promessa operacional bloqueada', `Consulta do cliente: ${mensagem.slice(0, 300)}`);
      resposta = tarefaCriada
        ? 'Registrei sua consulta para a equipe respons\u00e1vel verificar o pedido.'
        : 'Qual informa\u00e7\u00e3o voc\u00ea precisa agora: produ\u00e7\u00e3o, retirada ou entrega?';
    } else if (promessaPixPendente || promessaCartaoPendente) {
      // v4.34.0 P0: a lista FIXA saiu. Ela citava CEP e "forma de retirada" mesmo com os
      // dois ja respondidos, e foi ela que fechou o loop com a Carolina (21:00, 21:03,
      // 21:09 e 21:16 — quatro vezes o mesmo texto, tres delas depois de ela responder).
      resposta = perguntaDoQueFaltaFechamento(estadoLog, { ...(estado?.slots || {}), ...(decisao.slots || {}) });
    } else if (produtoSlot === 'dtf_uv') {
      resposta = 'Para calcular agora, me informe a medida do adesivo e a quantidade desejada.';
    } else if (produtoSlot === 'dtf_textil') {
      resposta = 'Para calcular agora, me informe a metragem total ou as medidas da arte e a quantidade de c\u00f3pias.';
    } else if (produtoSlot === 'camiseta') {
      resposta = 'Para calcular agora, me informe o modelo, a quantidade e o que ser\u00e1 estampado.';
    } else {
      resposta = 'Qual informa\u00e7\u00e3o voc\u00ea precisa agora: valor, prazo, pagamento ou entrega?';
    }
    await logErro('promessa_sem_conclusao_bloqueada_terminal', { phone, tema: decisao.tema, tools: toolsUsadas, resposta_original: String(decisao.mensagem || '').slice(0, 250) });
  }

  const estiloOk = (m: string) => ((m.match(/\(/g) || []).length <= 2);
  let respondeValido = decisao.responde === true && validarMsg(resposta, ehPerguntaDireta) && validarPix(resposta) && estiloOk(resposta);

  if (!respondeValido && !dryRun) {
    try {
      const d2 = await chamarCerebro('[SISTEMA: sua resposta anterior foi invalida. Responda a ultima mensagem do cliente ("' + mensagem.slice(-120) + '") em 1-2 frases curtas. Se pediu preco, chame a ferramenta e traga o valor em R$. Retorne APENAS o JSON.]');
      const r2 = aberturaCorreta(sanearMsg(d2.mensagem), !conversaAtivaHoje, false);
      const temPreco2 = /R\$\s?\d/.test(r2);
      // v4.24.0: retry passa pelo mesmo criterio de cruzamento de produto.
      let cruzaNoRetry = false;

      if (temPreco2 && toolsUsadas.length === 0) {
        const prodRetry: string | null = (() => {
          const s = String(
            (d2.slots || {}).produto
            || estado?.slots?.produto
            || prodMsg
            || ''
          ).toLowerCase().trim();

          if (!s || s === 'null') return null;
          if (s === 'dtf_textil' || s === 'textil' || /t[e\u00ea]xtil/.test(s)) return 'dtf_textil';
          if (s === 'dtf_uv' || s === 'uv') return 'dtf_uv';
          return null;
        })();

        if (prodRetry) {
          for (const cent of valoresDaMensagem(r2)) {
            try {
              const { data: vr } = await sb.rpc('fn_valor_e_legitimo', {
                p_centavos: cent,
                p_lead_id: leadId,
                p_produto: prodRetry,
              });

              if (
                vr
                && vr.legitimo === false
                && String(vr.motivo || '') === 'preco_de_outro_produto'
              ) {
                cruzaNoRetry = true;
                break;
              }
            } catch {
              // Falha tecnica da guarda nao reprova o retry.
            }
          }
        }
      }

      if (
        d2.responde === true
        && validarMsg(r2, ehPerguntaDireta)
        && validarPix(r2)
        && estiloOk(r2)
        && !cruzaNoRetry
      ) {
        decisao = d2;
        resposta = r2;
        respondeValido = true;
      }
    } catch {}
  }

  if (respondeValido && ultimaMsgJoao) {
    const a = resposta.toLowerCase().slice(0, 60);
    const b = ultimaMsgJoao.replace(/^\*[^*]+:\*\n?/, '').toLowerCase().slice(0, 60);
    if (a === b) respondeValido = false;
  }

  if (!respondeValido && !dryRun) await logErro('modelo_sem_resposta_valida', { phone, mensagem_cliente: mensagem.slice(0, 200), raw_modelo: ultimoRaw.slice(0, 500) });

  let fechamentoForcado = false;
  if (!respondeValido && !dryRun && !jaDespediuHoje) {
    if (execucoes.cobrancaPendente && !pediuMudanca) {
      const vP = Number(execucoes.cobrancaPendente.valor).toFixed(2).replace('.', ',');
      resposta = `Seu pedido est\u00e1 reservado e o Pix de R$${vP} que te mandei continua valendo. A confirma\u00e7\u00e3o \u00e9 autom\u00e1tica e eu te aviso por aqui.`;
      decisao.tema = 'fechamento_pix'; respondeValido = true; fechamentoForcado = true;
    } else {
      const contextoFio = (mensagem + ' ' + (mudouProduto ? '' : categoriaAnuncio + ' ' + anuncioTexto)).toLowerCase();
      const slotsAtuais = { ...(estado?.slots || {}), ...(decisao.slots || {}) };
      const produtoSlot = String(slotsAtuais.produto || '').replace(/^null$/i, '').trim();
      const ehCep = /\b\d{5}-?\d{3}\b/.test(mensagem.trim());
      const alvo = prodMsg;
      const pedeCopo = alvo === 'copo' || (!alvo && !produtoSlot && /copo|garrafa|t[e\u00e9]rmic|stanley/i.test(contextoFio) && !RX_PECA_PROPRIA.test(contextoFio));
      const pedeAdesivo = alvo === 'dtf_uv' || (!alvo && !produtoSlot && /adesivo|\buv\b|etiqueta|r[o\u00f3]tulo|vidro|metal|madeira|mdf/i.test(contextoFio));
      const pedePack = alvo === 'pack' || (!alvo && !produtoSlot && /pack|estampas? pronta|anime/i.test(contextoFio));
      const pedeTextil = alvo === 'dtf_textil' || (!alvo && !produtoSlot && /dtf t[e\u00ea]xtil|pel[i\u00ed]cula|filme dtf|tecido|malha/i.test(contextoFio));
      const pedeCamiseta = alvo === 'camiseta';
      if (REGEX_CORTESIA.test(mensagem.trim())) { resposta = despedidaPeriodo('pt'); decisao.tema = 'despedida'; }
      // v4.34.0 P0: `&& !estadoLog.bloqueia_frete`. Sob retirada/motoboy um CEP recebido
      // NAO vira frete: no caso Carolina o CEP so existiu porque o Joao o exigiu contra o
      // que ela tinha acabado de escrever.
      else if (ehCep && !estadoLog.bloqueia_frete) { resposta = 'Anotei seu CEP! J\u00e1 calculo o frete e te passo o total certinho.'; decisao.tema = 'frete'; }
      else if (pedeAdesivo) { resposta = 'O DTF UV \u00e9 um adesivo pronto que voc\u00ea descola e cola em copo, vidro, metal, madeira, MDF ou acr\u00edlico, sem prensa e resistente \u00e0 \u00e1gua. Cobramos pela \u00e1rea do filme, com largura \u00fatil de 28cm. Me fala o tamanho do adesivo em cent\u00edmetros e quantos voc\u00ea quer que eu calculo o valor exato.'; decisao.tema = 'adesivo_uv'; }
      else if (pedeTextil) { resposta = 'Trabalhamos sim com DTF t\u00eaxtil, \u00e9 o nosso principal produto. Vendemos por metro: 1 a 4 metros R$59,90 o metro, 5 a 9 metros R$54,90, 10 a 20 metros R$49,90, 21 a 40 metros R$44,90, 41 a 50 metros R$39,90 e a partir de 51 metros R$35,90. Me fala o tamanho da sua estampa e quantas c\u00f3pias.'; decisao.tema = 'dtf_metro'; }
      else if (pedeCopo) { resposta = 'O copo t\u00e9rmico personalizado em inox de 473ml sai R$35,90 a unidade, e R$29,90 a partir de 10 iguais, com a arte montada pela gente. Me fala o tema e quantos copos voc\u00ea quer.'; decisao.tema = 'copo'; }
      else if (pedeCamiseta) { resposta = 'Fazemos camiseta b\u00e1sica e baby look personalizadas e consigo calcular o or\u00e7amento por aqui. Me passa primeiro a quantidade de cada tamanho.'; decisao.tema = 'camiseta'; decisao.encaminhou_venda = false; }
      else if (pedePack) { resposta = 'Nossos packs de estampas t\u00eam artes prontas em alta resolu\u00e7\u00e3o com fundo transparente, a partir de R$6,90. \u00c9 arquivo digital, voc\u00ea baixa na hora pelo link. Qual tema voc\u00ea procura?'; decisao.tema = 'pack'; }
      else if (joaoJaDeuPreco || produtoSlot || conversaAtivaHoje) {
        // v4.22.5: fallback finito. Nunca prometa retorno futuro sem criar uma acao real.
        const pediuCancelamento = /\b(cancelar|cancela|cancelamento|desistir|desisti|n[a\u00e3]o quero mais)\b/i.test(mensagem);
        const pediuStatus = /\b(status|andamento|ficou pronto|est[a\u00e1] pronto|produ[c\u00e7][a\u00e3]o|meu pedido|cad[e\u00ea] meu pedido)\b/i.test(mensagem);
        if (blocoArquivos) {
          resposta = respostaDeterministicaArquivos(blocoArquivos);
          decisao.tema = 'dtf_metro';
        } else if (pediuCancelamento || pediuStatus) {
          const assunto = pediuCancelamento ? 'cancelamento solicitado' : 'consulta de status solicitada';
          const tarefaCriada = await criarTask(leadId, phone, `Joao: ${assunto}`, `Mensagem do cliente: ${mensagem.slice(0, 300)}`);
          if (tarefaCriada) {
            resposta = pediuCancelamento
              ? 'Entendi. Registrei seu pedido de cancelamento para a equipe respons\u00e1vel.'
              : 'Registrei sua consulta de status para a equipe respons\u00e1vel verificar o pedido.';
            decisao.encaminhou_venda = false;
          } else {
            resposta = pediuCancelamento
              ? 'Entendi. N\u00e3o vou avan\u00e7ar com uma nova venda por aqui.'
              : 'Qual informa\u00e7\u00e3o voc\u00ea precisa agora: produ\u00e7\u00e3o, retirada ou entrega?';
          }
          decisao.tema = 'complexo';
        } else {
          resposta = 'Qual informa\u00e7\u00e3o voc\u00ea precisa agora: valor, prazo, pagamento ou entrega?';
          decisao.tema = 'acolhimento_venda';
        }
      }
      else { resposta = 'Trabalhamos com DTF t\u00eaxtil para camisetas, DTF UV que \u00e9 adesivo para copo, vidro e metal, copos t\u00e9rmicos personalizados e camisetas prontas. Me conta o que voc\u00ea quer personalizar que eu te passo os valores.'; decisao.tema = 'acolhimento_venda'; }
      respondeValido = true; fechamentoForcado = true;
      resposta = aberturaCorreta(resposta, !conversaAtivaHoje, false);
    }
  }

  if (!respondeValido) {
    await registrarDecisao(leadId, 'silencio_noturno', { phone_final: phone.slice(-4) }, { motivo: 'validacao_ou_complexo' });
    if (!dryRun) await carimbarInbound(phone, idsParaCarimbar, 'silencio_joao');
    return { ok: true, respondeu: false, tema: decisao.tema };
  }

  // FIX 1 (v87): resposta vazia do modelo NAO sobrescreve memoria estruturada ja preenchida.
  const slotsAnteriores: any = estado?.slots || {};
  // ── v4.37.0 P0: o modelo PROPOE; so vira fato com proveniencia verificavel ──
  const textosCliente: string[] = [String(mensagem || ''), ...(inbounds || []).map((i: any) => String(i?.message_text || ''))];
  // Numeros que as FERRAMENTAS deste turno devolveram: fonte legitima de quantidade.
  const numerosFerramenta: number[] = [];
  for (const r of (Array.isArray(ctx.rendimentosAutorizados) ? ctx.rendimentosAutorizados : [])) {
    const v = Number(r?.cabem_por_metro); if (Number.isFinite(v) && v > 0) numerosFerramenta.push(v);
  }
  for (const v of (Array.isArray(ctx.rendimentosAuxiliares) ? ctx.rendimentosAuxiliares : [])) {
    if (Number.isFinite(Number(v)) && Number(v) > 0) numerosFerramenta.push(Number(v));
  }
  for (const it of (Array.isArray(calcmeVigente?.itens) ? calcmeVigente.itens : [])) {
    const q = Number(it?.qtd); if (Number.isFinite(q) && q > 0) numerosFerramenta.push(q);
  }
  const provSlots = filtrarSlotsPorProveniencia({
    anteriores: slotsAnteriores,
    recebidos: decisao.slots || {},
    textosCliente,
    macroCanonico: normalizarProdutoMacro(prodOrigem),
    toolsUsadas,
    midiaNoTurno: (imagens || []).length > 0 || (transcricoes || []).length > 0,
    numerosDeFerramenta: numerosFerramenta,
    perguntaQuantidadePendente: RX_PERGUNTA_QUANTIDADE.test(String(ultimaMsgJoao || '')),
  });
  const slotsRecebidos: any = provSlots.slots;
  if (provSlots.rejeitados.length && !dryRun) {
    await logErro('slot_critico_sem_proveniencia', {
      phone: phone.slice(-4), turn_id: obsTurnId,
      rejeitados: provSlots.rejeitados.slice(0, 8),
    });
  }
  const slotsNovos: any = {
    ...slotsAnteriores,
    ...slotsRecebidos,
    grade: (Array.isArray(slotsRecebidos.grade) && slotsRecebidos.grade.length > 0) ? slotsRecebidos.grade : slotsAnteriores.grade,
    estampas: (Array.isArray(slotsRecebidos.estampas) && slotsRecebidos.estampas.length > 0) ? slotsRecebidos.estampas : slotsAnteriores.estampas,
  };
  Object.keys(slotsNovos).forEach((k) => { if (slotsNovos[k] === null || slotsNovos[k] === 'null' || slotsNovos[k] === '') delete slotsNovos[k]; });
  if (slotsNovos.cep) {
    const cepLimpo = String(slotsNovos.cep).replace(/\D/g, '');
    if (cepLimpo.length !== 8) delete slotsNovos.cep; else slotsNovos.cep = cepLimpo;
  }
  // v4.34.0 P0: a modalidade resolvida por fonte EXPLICITA (niveis 1 e 2) vira estado do
  // pedido, para o proximo turno nao precisar redescobrir nem reperguntar. Historico
  // (nivel 3) e pista regional (nivel 4) NAO sao persistidos: nao sao declaracao do cliente.
  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {
    slotsNovos.modalidade_logistica = estadoLog.modalidade;
    slotsNovos.envio_retirada = estadoLog.modalidade === 'envio' ? 'envio'
      : estadoLog.modalidade === 'motoboy' ? 'motoboy' : 'retirada';
  }
  // ── v4.35.0 P0: ESTADO DE CEP DO PEDIDO + PERSISTENCIA GUARDADA ─────────────
  if (!estadoLog.bloqueia_frete && estadoLog.cep_conhecido) {
    slotsNovos.cep = estadoLog.cep_conhecido;
    slotsNovos.cep_origem = estadoLog.cep_fonte;
    slotsNovos.cep_confirmado_para_envio = estadoLog.cep_confirmado === true;
  }
  if (slotsSalvos._idioma) slotsNovos._idioma = slotsSalvos._idioma;

  // ── v4.28.0 P14: OBSERVABILIDADE DE SLOTS ────────────────────────────────
  // Registra antes -> correcoes -> invalidacoes PROPOSTAS -> depois. As propostas
  // NAO sao aplicadas: slotsNovos segue exatamente como o fluxo atual o produziu.
  // Sem isso a regressao R8 e improvavel de provar, porque agente_noturno_estado e
  // upsert sem historico e agente_decisoes_log grava slots nulo.
  if (!dryRun) {
    const prodMacroObs = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
    // v4.37.0: produto preenchido que o vocabulario canonico nao reconhece deixa de
    // ser silencio. Foi assim que "adesivo_uv" atravessou com produto_macro=null.
    if ((slotsNovos.produto ?? null) !== null && prodMacroObs === null) {
      await logErro('slot_produto_fora_do_vocabulario', {
        phone: phone.slice(-4), turn_id: obsTurnId,
        produto: String(slotsNovos.produto).slice(0, 60),
      });
    }
    const propostas: Array<{ slot: string; motivo: string; aplicada?: boolean }> = [];
    // v4.37.0: o que a porta RECUSOU fica na observacao, ja aplicado.
    for (const r of provSlots.rejeitados) propostas.push({ slot: r.slot, motivo: r.motivo, aplicada: true });
    // Regra observada, ainda NAO aplicada: mudou a modalidade -> slots dependentes de
    // unidade deixam de ser fato. Produto macro permanece: nao e mudanca de produto.
    if (obsModalidade.modalidade === 'metro') {
      for (const s of ['arte', 'quantidade']) {
        if (slotsAnteriores[s] !== undefined) propostas.push({ slot: s, motivo: 'modalidade_virou_metro' });
      }
    }
    if (obsCorrecoes.some((c) => c.tipo === 'midia_e_apenas_exemplo')) {
      if (slotsAnteriores.arte !== undefined) propostas.push({ slot: 'arte', motivo: 'midia_declarada_como_exemplo' });
    }
    // v4.29.0 P15: sinais de frete/CEP do turno. Observacional: nao chama ferramenta,
    // nao altera slots, nao bloqueia. Calculado aqui porque este ponto roda mesmo com
    // tools:[] — ao contrario da guarda de ferramenta, que vive dentro do laco.
    const sf = sinaisFreteDoTurno(resposta, inbounds, slotsNovos, toolsUsadas, ctx.autorizacoes);
    await registrarObservacaoSlots({
      phone, lead_id: leadId, turn_id: obsTurnId, agent_version: V,
      produto_macro: prodMacroObs,
      modalidade_detectada: obsModalidade.modalidade,
      modalidade_proveniencia: obsModalidade.proveniencia,
      correcoes_detectadas: obsCorrecoes,
      slots_antes: slotsAnteriores,
      slots_depois: slotsNovos,
      invalidacoes_propostas: propostas,
      mencionou_frete: sf.mencionou_frete,
      afirma_valor_frete: sf.afirma_valor_frete,
      cep_disponivel: sf.cep_disponivel,
      cep_detectado: sf.cep_detectado,
      chamou_calcular_frete: sf.chamou_calcular_frete,
      frete_operation_id: sf.frete_operation_id,
      pediu_cep: sf.pediu_cep,
      situacao_frete: sf.situacao_frete,
    });
  }

  // v4.35.0: a persistencia do cadastro roda DEPOIS de tudo decidido e NUNCA em dry-run.
  // Falha aqui jamais derruba o atendimento: o pedido ja tem o CEP no proprio estado.
  if (!dryRun && !estadoLog.bloqueia_frete) {
    try {
      const p = await persistirCepCanonico(estadoLog, phone);
      await logErro('cep_fluxo', {
        phone, turn_id: obsTurnId, agent_version: V,
        modalidade: estadoLog.modalidade,
        cep_fonte: estadoLog.cep_fonte,
        cep_confirmacao_solicitada: estadoLog.pedir_confirmacao_cep,
        cep_reutilizado: estadoLog.cep_fonte === 'pessoas' && estadoLog.cep_confirmado === true,
        cep_novo_informado: estadoLog.cep_fonte === 'pedido',
        cep_diferente_do_cadastro: estadoLog.cep_divergente_do_cadastro,
        intencao_cep_padrao: estadoLog.intencao_cep_padrao,
        cep_persistido: p.persistido,
        cep_nao_persistido_motivo: p.persistido ? null : p.motivo,
        pessoa_id: estadoLog.pessoa_id, cadastro_ambiguo: estadoLog.cadastro_ambiguo,
        cadastro_tem_endereco: estadoLog.cadastro_tem_endereco,
      });
      // Divergencia que a guarda recusou gravar nao pode morrer em log: vira trabalho humano,
      // porque atualizar endereco fiscal exige logradouro, numero, bairro, cidade e IBGE.
      if (!p.persistido && p.motivo === 'endereco_fiscal_coerente_exige_atualizacao_completa') {
        await criarTask(leadId, phone, 'Cadastro: cliente declarou novo CEP padrao',
          `O cliente informou o CEP ${estadoLog.cep_conhecido} como novo padrao. O cadastro tem `
          + `${estadoLog.cep_cadastro} com endereco preenchido. NAO foi sobrescrito de proposito: `
          + 'trocar so o CEP deixaria logradouro, numero, bairro e cidade do endereco antigo, e '
          + 'pessoas alimenta a NF-e. Atualizar o endereco COMPLETO no ERP.');
      }
    } catch (e: any) { await logErro('cep_fluxo_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) }); }
  }
  if (!dryRun) await salvarEstado(phone, leadId, decisao.etapa || estado?.etapa || 'sondagem', slotsNovos);

  if (dryRun) {
    const lostCanonico = pediuDesistencia
      ? await processarLostCanonico(idsParaCarimbar?.[0] ? String(idsParaCarimbar[0]) : null, leadId, mensagem, null, true)
      : null;
    return { ok: true, dry_run: true, tema: decisao.tema, tools: toolsUsadas, etapa: decisao.etapa, slots: slotsNovos, resposta, fallback: fechamentoForcado, mudou_produto: mudouProduto, objecao_preco: objecaoPreco, lost_canonico: lostCanonico };
  }

  // v4.21.2 INVARIANTE 3: o codigo que vai ao cliente sai do RETORNO DA FERRAMENTA.
  // Antes era extraido do texto do modelo — ou seja, o cliente recebia o que o modelo
  // TRANSCREVEU. Um caractere trocado numa transcricao de 150 caracteres e um Pix que
  // nao abre. Agora o texto do modelo so serve para REMOVER a linha; o valor enviado
  // e sempre ctx.pixGerado.qr_code, e so existe se a cobranca existir de fato.
  let codigoPixEnviado = '';
  const linhasResp = resposta.split('\n');
  const idxPix = linhasResp.findIndex((l: string) => l.trim().startsWith('000201') && l.trim().length > 60);
  if (idxPix >= 0) {
    resposta = linhasResp.filter((_: string, i: number) => i !== idxPix).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (resposta.length < 5) resposta = 'Segue seu Pix copia e cola logo abaixo. O pagamento confirma automaticamente.';
  }
  if (ctx.pixGerado?.ok === true && ctx.pixGerado?.qr_code) {
    codigoPixEnviado = String(ctx.pixGerado.qr_code).trim();
    if (idxPix >= 0 && linhasResp[idxPix].trim() !== codigoPixEnviado) {
      await logErro('codigo_pix_do_modelo_divergia', { phone, payment_id: ctx.pixGerado.payment_id });
    }
  } else if (execucoes.cobrancaPendente?.qr_code && (idxPix >= 0 || prometeuPix)) {
    // ── v4.21.5 (item 6): COBRANCA PENDENTE LEGITIMA — o codigo vem DO BANCO ──────────────
    // REGRESSAO CORRIGIDA AQUI. A v4.21.2 fez o codigo sair so de ctx.pixGerado, que existe
    // apenas quando um Pix NASCE no turno. Havendo cobranca pendente, gerar_pix devolve
    // 'ja_existe', ctx.pixGerado fica null — e a v4.21.2 REMOVIA a linha do codigo que o
    // modelo escreveu sem colocar nada no lugar. O cliente recebia "segue o Pix abaixo" e
    // nada abaixo. MEDIDO em 06/08 no lead 5511948430629: aconteceu as 18:02 e as 18:06,
    // duas vezes na mesma conversa, com a cliente pedindo o Pix nas duas.
    // A cobranca EXISTE e e valida: o certo nao e calar, e reenviar o codigo dela.
    // A garantia da invariante 3 continua de pe — a fonte e o banco, nunca a transcricao
    // do modelo, que pode vir com um caractere trocado e nao abrir no app do cliente.
    codigoPixEnviado = String(execucoes.cobrancaPendente.qr_code).trim();
    L('codigo_pix_reenviado_da_cobranca_pendente', { phone: phone.slice(-4), payment_id: execucoes.cobrancaPendente.payment_id, valor: execucoes.cobrancaPendente.valor });
    if (idxPix >= 0 && linhasResp[idxPix].trim() !== codigoPixEnviado) {
      await logErro('codigo_pix_do_modelo_divergia', { phone, payment_id: execucoes.cobrancaPendente.payment_id, origem: 'cobranca_pendente' });
    }
  } else if (idxPix >= 0) {
    // O modelo escreveu um codigo e NAO existe cobranca. Nao envia codigo nenhum.
    await logErro('codigo_pix_sem_cobranca', { phone, trecho: linhasResp[idxPix].trim().slice(0, 40) });
  }
  // ── v4.33.0 P0: CLIENTE CONDICIONOU PAGAMENTO A APROVAR A ARTE ─────────────────────
  // Menor protecao deterministica possivel: nao muda politica, nao adia pagamento como
  // regra, so impede que ESTE turno empurre cobranca contra o que o cliente acabou de
  // dizer. A ordem que ele pediu (arte -> aprovacao -> finalizacao -> pagamento) e
  // confirmada em voz alta, e o pagamento segue antes da producao.
  if (holdArtePagamento && decisao.responde === true && (prometeuPix || prometeuCartao || temCodigoPix || codigoPixEnviado)) {
    await logErro('cobranca_suspensa_hold_arte', { phone, tema: decisao.tema, tools: toolsUsadas, resposta_original: String(resposta).slice(0, 250) });
    resposta = 'Combinado! Primeiro a arte vem aqui para voc\u00ea aprovar. Assim que voc\u00ea aprovar, eu te envio a cobran\u00e7a para finalizar e a\u00ed entra na produ\u00e7\u00e3o.';
    codigoPixEnviado = '';
  }

  // ── v4.33.0 P0: INVARIANTE DE TRANSPORTE ───────────────────────────────────────────
  // Ultima barreira antes do transporte. Entre este ponto e entregarComoJoao nenhuma linha
  // volta a escrever em `resposta`: a barreira de frescor so pode SUPRIMIR o envio.
  // Os QRs de proveniencia provada entram como isentos para que a chave aleatoria que vive
  // DENTRO do payload 000201... nao seja confundida com identificador interno.
  const egresso = await guardaEgressoFinanceiro(resposta, ctx, [codigoPixEnviado, ctx.pixGerado?.qr_code, execucoes.cobrancaPendente?.qr_code], phone, 'resposta_noturna');
  if (egresso.bloqueou) {
    resposta = egresso.texto;
    if (codigoPixEnviado) {
      // A cobranca e REAL e o codigo vem de fonte provada; so o texto estava contaminado.
      // O id interno ja foi expurgado do texto e o Pix legitimo continua saindo.
      if (resposta.length < 5) resposta = 'Segue seu Pix copia e cola logo abaixo. O pagamento confirma automaticamente.';
    } else {
      // Nao existe cobranca provada. FALHA FECHADA: nenhum UUID, nenhuma chave inventada,
      // nenhum link improvisado. E melhor pedir o dado que falta do que entregar um
      // identificador interno vestido de Pix.
      resposta = 'Para gerar a cobran\u00e7a correta eu preciso fechar o pedido no sistema. Me confirma a quantidade e se \u00e9 retirada ou entrega que eu finalizo agora.';
    }
  }
  // Rede de seguranca do SEGUNDO envio: o codigo copiavel e um payload EMV, nunca um UUID.
  if (codigoPixEnviado && RX_UUID_EXATO.test(codigoPixEnviado.trim().toLowerCase())) {
    await logErro('guardrail_identificador_financeiro_interno', { phone, origem: 'codigo_pix_uuid', ids: [codigoPixEnviado.trim()] });
    codigoPixEnviado = '';
  }

  const turnId = crypto.randomUUID();
  const executionId = crypto.randomUUID();
  // v4.31.0 P0: owned_inbound_ids viaja no contexto que ja existe da decisao. Nao ha
  // tabela nova nem ledger paralelo: turn_id ja e coluna, execution_id ja era contexto.
  const ownedInboundIds = (idsParaCarimbar || []).map((i: any) => String(i));
  const contextoDecisao = { tema: decisao.tema, tools: toolsUsadas, phone_final: phone.slice(-4), mudou_produto: mudouProduto, fechamento_forcado: fechamentoForcado, objecao_preco: objecaoPreco, execution_id: executionId, turn_id: turnId, owned_inbound_ids: ownedInboundIds };
  const decisionId = await registrarDecisao(leadId, 'resposta_noturna_pronta_para_envio', contextoDecisao, { mensagem: resposta.slice(0, 400) });
  if (!decisionId) await logErro('CRITICO_decisao_pre_envio_sem_id', { execution_id: executionId, phone: phone.slice(-4) });
  if (pediuDesistencia) {
    await processarLostCanonico(idsParaCarimbar?.[0] ? String(idsParaCarimbar[0]) : null, leadId, mensagem, decisionId, false);
  }
  // ── v4.31.0 P0: BARREIRA FINAL DE FRESCOR ────────────────────────────────────────────
  // Ultimo ponto antes do primeiro transporte fisico da resposta principal. Se existe
  // inbound PENDENTE do mesmo telefone mais novo que o lote e fora de owned_inbound_ids,
  // esta resposta nasceu velha: nao sai, e NADA e carimbado — nem os inbounds do lote, nem
  // o novo. Os dois seguem 'pendente' e o joao-sweep-2min recolhe A+B no MESMO lote
  // (status='pendente', idade entre 30s e 4h), respondendo uma unica vez com o contexto ja
  // completo. Suprimir sem carimbar e exatamente o que impede a resposta de um turno antigo
  // de dar por atendida uma mensagem que ela nunca leu.
  if (!dryRun) {
    const refLote = await maxCreatedAtDoLote(idsParaCarimbar, loteCreatedAtMax);
    const novoInbound = refLote ? await inboundMaisNovoQue(phone, refLote, { ownedIds: ownedInboundIds, somentePendentes: true }) : null;
    if (novoInbound) {
      const contextoSuperseded = { ...contextoDecisao, superseded: true, skip_reason: 'superseded_por_inbound_mais_novo', newer_inbound_id: novoInbound.id, newer_inbound_created_at: novoInbound.created_at, lote_created_at_max: refLote };
      await finalizarDecisaoSuperseded(decisionId, turnId, contextoSuperseded);
      L('superseded_por_inbound_mais_novo', { phone: phone.slice(-4), turn_id: turnId, execution_id: executionId, owned_inbound_ids: ownedInboundIds, newer_inbound_id: novoInbound.id, lote_created_at_max: refLote });
      return { ok: true, respondeu: false, skip: 'superseded_por_inbound_mais_novo', superseded: true, turn_id: turnId, execution_id: executionId, owned_inbound_ids: ownedInboundIds, newer_inbound_id: novoInbound.id };
    }
  }
  const envio1Id = await prepararEnvio(decisionId, executionId, 1, 'resposta', phone);
  // v4.25.0: unico ponto do fluxo principal onde a voz pode entrar. A modalidade
  // e decidida aqui dentro, ANTES do transporte, e sai exatamente um envio.
  const entrega = await entregarComoJoao(phone, resposta, ASSINATURA, transcricoes.length > 0);
  const env = entrega.env;
  await finalizarEnvioLedger(envio1Id, env, entrega.modalidade, entrega.ttsResultado, entrega.ttsDuracaoMs);
  const enviou = env.ok;
  // v4.21.2 INVARIANTE 5: o SEGUNDO envio tem retorno conferido.
  // Antes o retorno era ignorado: o codigo era gravado no corpus como enviado e o inbound
  // marcado como atendido mesmo quando a entrega falhava. Cobranca criada, cliente sem
  // codigo, e o sistema afirmando sucesso. Agora falha de entrega do codigo NAO carimba
  // o inbound: a fila fica pendente e o sweep tenta de novo.
  let codigoEntregue = false;
  if (enviou) {
    if (codigoPixEnviado) {
      await sleep(1200);
      const envio2Id = await prepararEnvio(decisionId, executionId, 2, 'pix', phone);
      // Codigo Pix e conteudo copiavel: SEMPRE texto, nunca passa pela voz.
      const env2 = await enviarComoJoao(phone, codigoPixEnviado, '');
      await finalizarEnvioLedger(envio2Id, env2, 'texto', 'nao_tentado', null);
      codigoEntregue = env2.ok === true;
      if (!codigoEntregue) {
        await logErro('CRITICO_codigo_pix_nao_entregue', { phone, payment_id: ctx.pixGerado?.payment_id ?? null, valor: ctx.pixGerado?.valor ?? null, canal: env2.canal });
      }
    }
    // v4.25.0: o TEXTO CANONICO e gravado sempre, inclusive quando a entrega saiu
    // em audio. So o message_type muda. Auditoria nunca perde o que foi dito.
    await gravarFio({ lead_id: leadId, phone, direction: 'outbound', message_text: ASSINATURA + resposta, message_type: entrega.modalidade === 'audio' ? 'audio' : 'text', timestamp: new Date().toISOString(), source: 'joao' });
    if (codigoPixEnviado && codigoEntregue) await gravarFio({ lead_id: leadId, phone, direction: 'outbound', message_text: codigoPixEnviado, message_type: 'text', timestamp: new Date().toISOString(), source: 'joao' });
    if (transcricoes.length > 0) await gravarFio({ lead_id: leadId, phone, direction: 'inbound', message_text: '[\u00c1udio]: ' + transcricoes.join(' | ').slice(0, 400), message_type: 'audio', timestamp: new Date().toISOString(), source: 'joao_whisper' });
    if (!codigoPixEnviado || codigoEntregue) await carimbarInbound(phone, idsParaCarimbar, 'atendido_joao');
    if (decisao.encaminhou_venda === true && leadId) {
      await criarTask(leadId, phone, `Venda encaminhada pelo Joao (${decisao.tema})`, `Slots: ${JSON.stringify(slotsNovos).slice(0, 200)}.`);
    }
  }
  const contextoTerminal = { ...contextoDecisao, canal: env.canal, provider: env.provider, envio_estado: env.estado, provider_message_id: env.messageId, provider_zaap_id: env.zaapId };
  if (decisionId) await finalizarDecisaoEnvio(decisionId, turnId, enviou, env, contextoTerminal, fechamentoForcado ? 'fallback' : 'enviar_mensagem');
  else await registrarDecisao(leadId, enviou ? 'resposta_noturna_enviada_sem_rastreio' : 'resposta_noturna_falhou_envio_sem_rastreio', contextoTerminal, { mensagem: resposta.slice(0, 400) });
  return { ok: true, respondeu: enviou, canal: env.canal, tema: decisao.tema, tools: toolsUsadas };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 405 });
  let body: any = {};
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  if (body._sweep === true) {
    const { data: rows } = await sb.from('inbound_fora_horario').select('id, phone, chat_name, body, created_at').eq('status', 'pendente').gte('created_at', new Date(Date.now() - 4 * 3600000).toISOString()).lte('created_at', new Date(Date.now() - 30000).toISOString()).order('created_at', { ascending: true }).limit(40);
    const porPhone = new Map<string, any[]>();
    for (const r of (rows || [])) { const p = String(r.phone || '').replace(/\D/g, ''); if (!p) continue; if (!porPhone.has(p)) porPhone.set(p, []); porPhone.get(p)!.push(r); }
    const resultados: any[] = []; let atendidos = 0;
    for (const [ph, lote] of porPhone) {
      if (atendidos >= SWEEP_MAX_CLIENTES) break;
      try {
        const ids = lote.map((r: any) => r.id);
        const textos = lote.map((r: any) => {
          const doc = r.body?.document;
          const marcador = doc ? `[Arquivo recebido pelo WhatsApp: ${String(doc.fileName || doc.title || 'documento')}; tipo=${String(doc.mimeType || 'desconhecido')}]` : '';
          return String(r.body?.text?.message || r.body?.image?.caption || marcador || '').trim();
        }).filter((t: string) => t.length > 0 && !REGEX_AUTO_ATENDIMENTO.test(t));
        const imgs: string[] = []; const trans: string[] = [];
        for (const r of lote) {
          const iu = r.body?.image?.imageUrl || r.body?.image?.thumbnailUrl;
          if (iu && imgs.length < 3) imgs.push(String(iu));
          const au = r.body?.audio?.audioUrl || r.body?.audio?.url;
          if (au && trans.length < 2) { const t = await transcreverAudio(String(au)); if (t) trans.push(t); }
        }
        let msg = textos.join('\n');
        if (trans.length > 0) msg = (msg ? msg + '\n' : '') + trans.join(' | ');
        if (!mensagemValida(msg) && imgs.length === 0) { await carimbarInbound(ph, ids, 'silencio_joao'); continue; }
        // v4.31.0 P0: o sweep ja agrupava o lote inteiro; agora tambem declara a fronteira
        // temporal dele, para a barreira de frescor saber o que e "mais novo que este lote".
        const loteMax = lote.reduce((m: string | null, r: any) => (!m || String(r.created_at) > m) ? String(r.created_at) : m, null as string | null);
        const out = await atenderCliente(ph, lote[0]?.chat_name || 'Cliente', msg || '(cliente enviou imagem)', imgs, trans, ids, false, loteMax);
        atendidos++; resultados.push({ ph: ph.slice(-4), ...out });
      } catch (e: any) { L('sweep_err', { ph: ph.slice(-4), e: String(e).slice(0, 100) }); }
    }
    return new Response(JSON.stringify({ ok: true, sweep: true, clientes_na_fila: porPhone.size, atendidos, resultados }), { status: 200 });
  }

  const phone = String(body.phone || '').replace(/\D/g, '');
  const chatName = String(body.chat_name || body.chatName || 'Cliente');
  const docOriginal = body?.document;
  const marcadorDocumento = docOriginal ? `[Arquivo recebido pelo WhatsApp: ${String(docOriginal.fileName || docOriginal.title || 'documento')}; tipo=${String(docOriginal.mimeType || 'desconhecido')}]` : '';
  const mensagemOriginal = String(body.mensagem || marcadorDocumento || '');
  const inboundId = body.inbound_id || null;
  const dryRun = body._dry_run === true;
  const directMessage = String(body._direct_message || '').trim();
  if (!phone) return new Response(JSON.stringify({ ok: false, motivo: 'campos' }), { status: 400 });

  if (directMessage) {
    // ── v4.33.0 P0: _direct_message tem caminho PROPRIO de transporte e nao passava por
    // nenhuma guarda. Texto ditado tambem nao e fonte financeira: se carrega identificador
    // interno, nada sai. Aqui a falha e FECHADA e explicita — quem ditou e um operador
    // humano, que recebe o erro e reenvia certo; nao ha risco de silencio para o cliente.
    const idsDmInternos = await idsInternosNoTexto(directMessage, null, []);
    if (idsDmInternos.length > 0) {
      await logErro('guardrail_identificador_financeiro_interno', { phone, origem: 'direct_message', ids: idsDmInternos.slice(0, 4), trecho: directMessage.replace(/\n/g, ' ').slice(0, 180) });
      L('guardrail_identificador_financeiro_interno', { phone: phone.slice(-4), origem: 'direct_message', qtd: idsDmInternos.length });
      return new Response(JSON.stringify({ ok: false, motivo: 'guardrail_identificador_financeiro_interno', detalhe: 'A mensagem contem identificador financeiro interno (operacoes_financeiras.id). Nada foi enviado.' }), { status: 422 });
    }
    const assinar = String(body._assinar_como || 'joao').toLowerCase() === 'julia' ? ASSINATURA_JULIA : ASSINATURA;
    const sourceTag = assinar === ASSINATURA_JULIA ? 'julia_ditado' : 'joao';
    let codigoDm = ''; let msgDm = directMessage;
    const linhasDm = directMessage.split('\n');
    const idxDm = linhasDm.findIndex((l: string) => l.trim().startsWith('000201') && l.trim().length > 60);
    if (idxDm >= 0) {
      codigoDm = linhasDm[idxDm].trim();
      msgDm = linhasDm.filter((_: string, i: number) => i !== idxDm).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (msgDm.length < 5) msgDm = 'Segue seu Pix copia e cola logo abaixo.';
    }
    let lid: string | null = null;
    try { const { data: l } = await sb.from('leads_marketing').select('lead_id').eq('ph', phone).maybeSingle(); lid = l?.lead_id || null; } catch {}
    const turnIdDm = crypto.randomUUID();
    const executionIdDm = crypto.randomUUID();
    const decisionIdDm = await registrarDecisao(lid, 'mensagem_ditada_pronta_para_envio', { phone_final: phone.slice(-4), execution_id: executionIdDm, origem: sourceTag }, { mensagem: msgDm.slice(0, 300) });
    if (!decisionIdDm) await logErro('CRITICO_decisao_dm_sem_id', { execution_id: executionIdDm, phone: phone.slice(-4) });
    const envioDm1 = await prepararEnvio(decisionIdDm, executionIdDm, 1, 'mensagem_ditada', phone);
    const env = await enviarComoJoao(phone, msgDm, assinar);
    await finalizarEnvioLedger(envioDm1, env, 'texto', 'nao_tentado', null);
    let envPixDm: ResultadoEnvio | null = null;
    if (env.ok && codigoDm) {
      await sleep(1200);
      const envioDm2 = await prepararEnvio(decisionIdDm, executionIdDm, 2, 'pix', phone);
      envPixDm = await enviarComoJoao(phone, codigoDm, '');
      await finalizarEnvioLedger(envioDm2, envPixDm, 'texto', 'nao_tentado', null);
    }
    const efeitoCompleto = env.ok && (!codigoDm || envPixDm?.ok === true);
    if (env.ok) {
      await gravarFio({ lead_id: lid, phone, direction: 'outbound', message_text: assinar + msgDm, message_type: 'text', timestamp: new Date().toISOString(), source: sourceTag });
      if (codigoDm && envPixDm?.ok === true) await gravarFio({ lead_id: lid, phone, direction: 'outbound', message_text: codigoDm, message_type: 'text', timestamp: new Date().toISOString(), source: sourceTag });
      if (efeitoCompleto) {
        try { await sb.from('inbound_fora_horario').update({ status: 'atendido_joao' }).eq('phone', phone).eq('status', 'pendente').gte('created_at', new Date(Date.now() - 600000).toISOString()); } catch {}
      }
    }
    const terminalDm = envPixDm && !envPixDm.ok ? envPixDm : env;
    if (decisionIdDm) await finalizarDecisaoEnvio(decisionIdDm, turnIdDm, efeitoCompleto, terminalDm, { canal: terminalDm.canal, phone_final: phone.slice(-4), execution_id: executionIdDm, origem: sourceTag, provider_message_id: terminalDm.messageId, provider_zaap_id: terminalDm.zaapId }, null);
    else await registrarDecisao(lid, efeitoCompleto ? 'mensagem_ditada_enviada_sem_rastreio' : 'mensagem_ditada_falhou_sem_rastreio', { canal: terminalDm.canal, phone_final: phone.slice(-4), execution_id: executionIdDm }, { mensagem: msgDm.slice(0, 300) });
    return new Response(JSON.stringify({ ok: efeitoCompleto, canal: env.canal, direct: true, execution_id: executionIdDm }), { status: 200 });
  }

  if (!mensagemOriginal) return new Response(JSON.stringify({ ok: false, motivo: 'campos' }), { status: 400 });
  if (REGEX_AUTO_ATENDIMENTO.test(mensagemOriginal)) return new Response(JSON.stringify({ ok: true, skip: 'filtro_deterministico' }), { status: 200 });

  let mensagem = mensagemOriginal;
  const imagens: string[] = [];
  let transcricoes: string[] = [];
  // v4.31.0 P0: identidade do lote formada no ponto de entrada e propagada dali em diante.
  const ownedIds: string[] = [];
  let loteCreatedAtMax: string | null = null;
  if (!dryRun) {
    await sleep(DEBOUNCE_MS);
    try {
      // v97: o desempate cedia a vez SO para mensagem mais nova com TEXTO. Imagem e audio
      // nao tem texto, entao o turno anterior respondia CEGO e o turno da midia respondia de
      // novo, ja enxergando. O cliente lia 'me mostra a imagem' com a imagem ja enviada.
      // Medido em 3 dias: 64 de 71 fotos tiveram resposta antes da midia entrar no turno.
      // Casos: Palmeiras 26/07 16:02 e Lucas 26/07 17:14 ('nao recebi a imagem').
      if (inboundId) {
        // v98: ANTES comparava .gt('id', inboundId) com id uuid gen_random_uuid() — ALEATORIO.
        // "Mensagem mais nova" por UUID nao tem relacao com tempo: acertava por sorte, em torno
        // de metade das vezes. Agora compara created_at da propria linha, que e o unico campo
        // com ordem real. Sem linha (id nao encontrado), NAO cede a vez: falha para responder,
        // nunca para silencio.
        const { data: minhaLinha } = await sb.from('inbound_fora_horario')
          .select('created_at, status').eq('id', inboundId).maybeSingle();
        // v4.31.0 P0: DEDUPLICACAO CAUSAL, nao temporal. Sai com ja_respondida a unica
        // protecao contra reentrega do MESMO webhook. Ela nao volta: no lugar entra a
        // identidade da propria linha — este inbound ja alcancou um estado terminal, logo
        // ja foi tratado por outra execucao. Nao e relogio, e a linha dizendo o que houve
        // com ela. Linha ausente ou ainda pendente NAO bloqueia: como no v98, a duvida
        // faz o fluxo responder, nunca calar.
        if (minhaLinha?.status && minhaLinha.status !== 'pendente') {
          return new Response(JSON.stringify({ ok: true, skip: 'inbound_ja_terminal', status: minhaLinha.status }), { status: 200 });
        }
        if (minhaLinha?.created_at) {
          // v4.31.0 P0: o created_at da propria linha ja serve de fronteira do lote — vale
          // quando a rajada nao devolve nada (linha ja nao pendente, ou consulta falhando).
          loteCreatedAtMax = String(minhaLinha.created_at);
          // v4.31.0 P0: mesma regra de frescor da barreira final, agora num helper unico.
          const maisNova = await inboundMaisNovoQue(phone, String(minhaLinha.created_at));
          if (maisNova) return new Response(JSON.stringify({ ok: true, skip: 'debounce_msg_mais_nova' }), { status: 200 });
        }
      }
      const { data: rajada } = await sb.from('inbound_fora_horario').select('id, body, created_at').eq('phone', phone).eq('status', 'pendente').gte('created_at', new Date(Date.now() - 300000).toISOString()).order('created_at', { ascending: true }).limit(10);
      if (rajada && rajada.length > 0) {
        // v4.31.0 P0: BUG DE PROPAGACAO DO LOTE. A rajada agregava varios inbounds na
        // mensagem, mas o turno seguia carregando apenas [inboundId] — as demais linhas
        // eram carimbadas depois pelo fallback por telefone+janela de 10 min, que tambem
        // alcanca mensagem que nao pertence ao lote. Agora todo ID usado para construir a
        // mensagem vira owned_inbound_ids e so eles sao carimbados.
        for (const r of rajada) {
          ownedIds.push(String(r.id));
          if (!loteCreatedAtMax || String(r.created_at) > loteCreatedAtMax) loteCreatedAtMax = String(r.created_at);
        }
        const textos = rajada.map((r: any) => {
          const doc = r.body?.document;
          const marcador = doc ? `[Arquivo recebido pelo WhatsApp: ${String(doc.fileName || doc.title || 'documento')}; tipo=${String(doc.mimeType || 'desconhecido')}]` : '';
          return String(r.body?.text?.message || r.body?.image?.caption || r.body?.mensagem || marcador || '').trim();
        }).filter((t: string) => t.length > 0);
        if (textos.length > 1) mensagem = textos.join('\n');
        for (const r of rajada) {
          const imgUrl = r.body?.image?.imageUrl || r.body?.image?.thumbnailUrl || null;
          if (imgUrl && imagens.length < 3) imagens.push(String(imgUrl));
          const audioUrl = r.body?.audio?.audioUrl || r.body?.audio?.url || null;
          if (audioUrl && transcricoes.length < 2) { const t = await transcreverAudio(String(audioUrl)); if (t) transcricoes.push(t); }
        }
        if (transcricoes.length > 0) mensagem = (mensagem ? mensagem + '\n' : '') + transcricoes.join(' | ');
      }
    } catch {}
  }
  if (!mensagemValida(mensagem)) return new Response(JSON.stringify({ ok: true, skip: 'sem_conteudo' }), { status: 200 });

  // v4.31.0 P0: sem rajada observada (dry-run ou consulta vazia) o lote e o proprio inbound.
  const idsDoLote = ownedIds.length > 0 ? ownedIds : (inboundId ? [String(inboundId)] : null);
  const out = await atenderCliente(phone, chatName, mensagem, imagens, transcricoes, idsDoLote, dryRun, loteCreatedAtMax);
  return new Response(JSON.stringify(out), { status: 200 });
});
