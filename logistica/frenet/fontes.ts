// Mapa campo -> fonte canonica, lido em RUNTIME pelo validador.
// Rebaixar uma entrada aqui bloqueia a emissao sozinho.
//
// Rodada 2 — 21/08/2026, chat claude-20260821-criar-etiqueta-frenet-r2.
//
// CORRECAO IMPORTANTE DA RODADA 1: eu havia classificado o endereco do
// destinatario como AUSENTE depois de provar que CEREBRO.public.pessoas tinha
// 0 de 1754 linhas com CEP. Isso provava apenas que AQUELA tabela nao era a
// fonte. A fonte canonica existe, esta modelada e esta preenchida — ela vive
// no projeto ERP, nao no Cerebro.
//
// Projetos:
//   CEREBRO = Supabase ldrdtaibazplvrbwyrvx (onde vive calcular-frete)
//   ERP     = Supabase ynjsflvdfftcopibzxyo (criativa-futuro-erp)

import { Autoridade } from './tipos.ts';

export interface FonteCampo {
  campo: string;
  fonte: string;
  autoridade: Autoridade;
  /** Evidencia mecanica: contagem/consulta que sustenta a classificacao. */
  evidencia: string;
  /** Se true, a ausencia deste campo bloqueia EMITIR. */
  obrigatorio_para_emitir: boolean;
}

export const MAPA_FONTES: readonly FonteCampo[] = Object.freeze([
  // ------------------------------------------------------------ PEDIDO
  {
    campo: 'pedido',
    fonte: 'ERP.public.vendas',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.vendas = 8 linhas; FK vendas.cliente_id -> pessoa_cliente_dados(id) ON DELETE RESTRICT, entao o vinculo e garantido pelo banco. 7 de 8 vendas resolvem cliente completo; a venda 19 esta sem cliente_id. total_liquido preenchido em 8 de 8.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'execucao_emissao',
    fonte: 'ERP (dono dos dados e do estado) + agente controlado fail-closed',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'DECIDIDO PELO DONO em 21/08/2026: a emissao roda como ERP + Agente. Nao ha ponte Cerebro->ERP a construir; calcular-frete permanece no Cerebro so para COTAR. Todos os dados de emissao residem no ERP e o montador erp/montar-envio.ts foi provado contra as 8 vendas reais. O agente nunca monta payload livremente: o envio nasce de montarEnvio() e EMITIR continua exigindo GateAberto com autor humano e teto em BRL.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'credenciais_frenet_no_erp',
    fonte: 'secrets do projeto ERP ynjsflvdfftcopibzxyo',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Consequencia direta da decisao ERP + Agente: TOKEN_FRENET, FRENET_PARTNER_TOKEN, FRENET_WHITELABEL_BASE_URL, FRENET_WEBHOOK_TOKEN_NAME e FRENET_WEBHOOK_TOKEN_VALUE precisam existir no projeto ERP, onde a emissao vai rodar. Hoje o unico segredo Frenet em uso vive no CEREBRO (TOKEN_FRENET, header token de calcular-frete v34). Gate humano: cadastro de secrets.',
    obrigatorio_para_emitir: true,
  },

  // ------------------------------------------------------ DESTINATARIO
  {
    campo: 'destinatario.nome',
    fonte: 'ERP.public.pessoas.nome (via pessoa_cliente_dados.pessoa_id)',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.pessoas = 136 linhas; pessoa_papel papel=cliente = 129. 7 de 8 vendas resolvem nome do cliente.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.documento',
    fonte: 'ERP.public.pessoas.cpf | cnpj',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: '7 de 8 vendas resolvem CPF ou CNPJ do cliente pelo caminho vendas -> pessoa_cliente_dados -> pessoas.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.telefone',
    fonte: 'ERP.public.pessoas.telefone | whatsapp',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: '7 de 8 vendas resolvem telefone ou whatsapp.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.email',
    fonte: 'ERP.public.pessoas.email',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: '7 de 8 vendas resolvem email.',
    obrigatorio_para_emitir: false,
  },
  {
    campo: 'destinatario.endereco',
    fonte: 'ERP.public.pessoa_cliente_dados (cep, logradouro, numero, complemento, bairro, cidade, estado)',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.pessoa_cliente_dados = 130 linhas, 129 com cep, logradouro, numero, bairro, cidade e estado simultaneamente (99,2%). Nas vendas reais: 7 de 8 com endereco completo. Substitui a classificacao AUSENTE da rodada 1, que media a tabela errada (CEREBRO public.pessoas).',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.override_entrega',
    fonte: 'ERP.public.vendas.endereco_entrega / pessoa_cliente_dados.endereco_entrega (jsonb)',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'Shape confirmado em dado real: {cep, logradouro, numero, complemento, bairro, cidade, estado}. Preenchido em 5 de 130 clientes e 0 de 8 vendas — e override opcional, nao lacuna: quando vazio, vale o endereco cadastral.',
    obrigatorio_para_emitir: false,
  },

  // ---------------------------------------------------------- REMETENTE
  {
    campo: 'remetente.identificacao',
    fonte: 'ERP.public.perfil_empresa (razao_social, nome_fantasia, cnpj, email, telefone, inscricao_estadual)',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.perfil_empresa = 1 linha, com razao_social, nome_fantasia, CNPJ de 14 digitos, email, telefone e IE todos preenchidos. Substitui frete_config[remetente], que so tinha uf/cep/cidade.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'remetente.endereco',
    fonte: 'ERP.public.perfil_empresa',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'RESOLVIDO em 21/08/2026. Dono definiu 06813-230 como CEP canonico de origem e mandou corrigir perfil_empresa sem tocar frete_config nem CEP_ORIGEM, que ja usavam 06813230. Aplicado: perfil_empresa.cep de 06803-150 para 06813-230 (linha 6f478d93, so a coluna cep). Nao era divergencia legitima entre fiscal e postagem, era digitacao errada: perfil_empresa ja tinha Rua Agua Branca 185, Jardim Laila, Embu das Artes/SP, e o mesmo logradouro+numero+bairro aparece em tres registros independentes do ERP com CEP 06813-230. A correcao tambem melhora a NF-e, que le v_emp.cep em fn_montar_payload_nfe.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'remetente.telefone',
    fonte: 'ERP.public.perfil_empresa.telefone',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'Preenchido, mas com 10 digitos (fixo). Transportadora costuma exigir celular para contato de coleta/entrega. Nao bloqueia sozinho; confirmar na homologacao.',
    obrigatorio_para_emitir: false,
  },

  // -------------------------------------------------------------- ITENS
  {
    campo: 'itens',
    fonte: 'ERP.public.venda_itens',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.venda_itens = 3 linhas, 3 de 3 com quantidade > 0 e produto_id, e as tres resolvem produto por join em public.produtos (vendas 30 e 29 com 40 unidades de Baby look, venda 19 com 21 de Camiseta Basica). Volume baixo reflete o ERP ser novo, nao a fonte estar errada: preenchimento e vinculo ao pedido estao provados, que e o criterio.',
    obrigatorio_para_emitir: true,
  },

  // ------------------------------------------------ PACOTE (REGRA DURA)
  {
    campo: 'pacote.peso_kg',
    fonte: 'ERP.public.logistica_produto_medida.peso_kg',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Tabela criada em 21/08/2026 e VAZIA (0 linhas). O peso legado em public.produtos existe para 1 de 12 ativos (Baby look, 0,150 kg) e nao migra automaticamente: sem medido_por e medido_em nao e procedencia, e so um numero. gramatura_g_m2 NULL em 12 de 12.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.dimensoes_cm',
    fonte: 'ERP.public.logistica_produto_medida (altura_cm, largura_cm, comprimento_cm)',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Tabela criada em 21/08/2026 e VAZIA (0 linhas). O legado em public.produtos tem as tres dimensoes para 1 de 12 ativos (10 x 30 x 40, Baby look) e sao medidas de UMA peca, nao do volume postado.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.regra_de_embalagem',
    fonte: 'ERP.public.logistica_embalagem_regra',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Tabela criada em 21/08/2026 e VAZIA (0 linhas). Nao existe regra de como N pecas viram M volumes. CASO DIDATICO PROVADO: a venda 30 do ERP tem 40 unidades de Baby look 100% algodao, produto cadastrado com 0,150 kg e 10x30x40 cm — que sao as medidas de UMA peca. 40 pecas nao cabem numa caixa 10x30x40 e o frete cobra o volume, nao a peca. produtos.unidade_venda tem dois regimes: unidade (11 produtos) e metro_linear (Filme DTF Textil). montarPacotes() recusa fail-closed enquanto nao houver regra.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.procedencia_da_medida',
    fonte: 'ERP.public.logistica_produto_medida.origem + medido_por + medido_em',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'O ERP guarda peso e dimensoes mas nao guarda COMO foram obtidos. Coluna preenchida nao e medida com procedencia: o unico produto com medida (Baby look, 0,150 kg / 10x30x40) nao tem registro de quem mediu nem quando. montarEnvio() trata medida sem procedencia como OrigemMedida.DESCONHECIDA e recusa. Coluna proposta em sql/0002_erp_logistica_medidas.sql, nao aplicada.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.heuristica_dtf',
    fonte: 'CEREBRO.public.frete_config[chave=embalagem]',
    autoridade: Autoridade.NAO_AUTORIZADA,
    evidencia: 'peso_por_metro_g = 100 + duas caixas fixas 60x13x13 / 60x26x13, com piso de 300 g em calcular-frete v34. Legitima para COTAR e continua em uso. Nunca ganha autoridade para EMITIR: 125 operacoes kind=frete e 0 registram peso.',
    obrigatorio_para_emitir: false,
  },

  // ------------------------------------------------------ COMERCIAL
  {
    campo: 'valor_declarado',
    fonte: 'ERP.public.vendas.total_liquido',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'ERP public.vendas: total_liquido preenchido em 8 de 8; valor_frete em 8 de 8. subtotal_itens so em 4 de 8, por isso a fonte do valor segurado e total_liquido e nao subtotal_itens.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'servico',
    fonte: 'adapter cotar() -> ERP.public.logistica_envio.servico_snapshot + cotacao_ref + custo_cotado',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'RESOLVIDO pela arquitetura ERP + Agente. O buraco antigo era CEREBRO.operacoes_financeiras.components, que guardava so {cep, servico} e descartava o ServiceCode devolvido pela cotacao — por isso 125 operacoes kind=frete nao reconciliavam com etiqueta nenhuma. Agora o produtor e o proprio adapter: cotar() ja devolve codigo, descricao, transportadora, preco e prazo, e logistica_envio guarda servico_snapshot, cotacao_ref, custo_cotado e custo_real na mesma linha do envio. operacoes_financeiras continua sendo o ledger de cotacao do Cerebro e nao e mais a fonte da emissao.',
    obrigatorio_para_emitir: true,
  },

  // ----------------------------------------------------------- ESTADO
  {
    campo: 'estado_envio_etiqueta_tracking',
    fonte: 'ERP.public.logistica_envio / logistica_envio_tentativa / logistica_evento_tracking',
    autoridade: Autoridade.FONTE_CANONICA_PROVADA,
    evidencia: 'APLICADA em 21/08/2026 no ERP (migration logistica_envio_estado_canonico, somente aditiva). 5 tabelas criadas, RLS ligada e ZERO policies, entao anon e authenticated ficam sem acesso e so service_role passa. A guarda de idempotencia foi PROVADA no banco: inserir uma segunda tentativa EM_VOO com a mesma chave e recusada por ux_tentativa_viva_por_chave, indice unico parcial sobre estado in (EM_VOO, CONCLUIDA); a prova rodou em bloco abortado e as 5 tabelas seguem com 0 linhas. Rollback em sql/0002_erp_logistica_envio.sql.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'receptor_webhook_tracking',
    fonte: 'CEREBRO edge frenet-tracking-webhook',
    autoridade: Autoridade.NAO_AUTORIZADA,
    evidencia: 'v27 ACTIVE, ezbr af11c994... — identico a v25 ja auditada, o PATCH 0 continua nao deployado. Sem autenticacao, dispara WhatsApp antes de persistir, dedup inoperante e trata OrderId como telefone/CPF. PATCH 0 escrito e testado em receptor/patch0.ts (20 testes), mas a Edge Function pertence a frente logistica-frenet-fonte-canonica e depende do cadastro de FRENET_WEBHOOK_TOKEN_NAME/VALUE.',
    obrigatorio_para_emitir: true,
  },
]);

const INDICE: ReadonlyMap<string, FonteCampo> = new Map(
  MAPA_FONTES.map((f) => [f.campo, f]),
);

export function fonteDe(campo: string): FonteCampo | undefined {
  return INDICE.get(campo);
}

/** Unica autoridade que sustenta emissao. Todo o resto bloqueia. */
export const AUTORIDADE_QUE_EMITE = Autoridade.FONTE_CANONICA_PROVADA;

export function bloqueia(a: Autoridade): boolean {
  return a !== AUTORIDADE_QUE_EMITE;
}

/** Campos obrigatorios cuja fonte hoje nao sustenta emissao. Fail-closed. */
export function fontesQueBloqueiamEmissao(): FonteCampo[] {
  return MAPA_FONTES.filter((f) => f.obrigatorio_para_emitir && bloqueia(f.autoridade));
}

/** Placar por autoridade, para relatorio e teste de regressao. */
export function placarFontes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of MAPA_FONTES) out[f.autoridade] = (out[f.autoridade] ?? 0) + 1;
  return out;
}
