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
    campo: 'ponte_cerebro_erp',
    fonte: '(inexistente)',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'calcular-frete v34 roda no CEREBRO e nao alcanca o banco do ERP. O pedido e o endereco vivem no ERP. Consequencia de projeto: a EMISSAO deve rodar no projeto ERP, onde o dado esta, e nao no Cerebro. Nenhuma edge de emissao existe hoje em nenhum dos dois.',
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
    fonte: 'ERP.public.perfil_empresa VS CEREBRO.frete_config[remetente] / calcular-frete',
    autoridade: Autoridade.AMBIGUA,
    evidencia: 'DIVERGENCIA VIVA: perfil_empresa.cep = 06803-150 (com logradouro, numero, complemento, bairro, cidade e estado preenchidos). frete_config[remetente].cep = 06813-230 e calcular-frete v34 tem CEP_ORIGEM = 06813230 hardcoded. Ambos em Embu das Artes/SP. Endereco fiscal e endereco de postagem podem legitimamente diferir; escolher e decisao de negocio e muda o preco do frete.',
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
    autoridade: Autoridade.FONTE_CANDIDATA,
    evidencia: 'ERP public.venda_itens = 3 linhas, 3 com quantidade > 0 e 3 com produto_id. Estrutura correta, volume baixo demais para chamar de provada: 8 vendas geram apenas 3 itens.',
    obrigatorio_para_emitir: true,
  },

  // ------------------------------------------------ PACOTE (REGRA DURA)
  {
    campo: 'pacote.peso_kg',
    fonte: 'ERP.public.produtos.peso_bruto_kg',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'ERP public.produtos: 12 ativos, 1 com peso_bruto_kg (Baby look 100% algodao, 0,150 kg). Os outros 11 sao NULL. gramatura_g_m2 e NULL em 12 de 12.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.dimensoes_cm',
    fonte: 'ERP.public.produtos.altura_cm/largura_cm/comprimento_cm',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'ERP public.produtos: 1 de 12 com as tres dimensoes (10 x 30 x 40). Os outros 11 sao NULL.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.regra_de_embalagem',
    fonte: '(inexistente)',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Nao existe regra de como N pecas viram M volumes. produtos.unidade_venda tem dois regimes: unidade (11 produtos) e metro_linear (Filme DTF Textil). Peso de peca sozinho nao determina o volume postado.',
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
    fonte: 'CEREBRO.public.operacoes_financeiras[kind=frete].components',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: '125 operacoes kind=frete; components guarda apenas {cep, servico}, sem ServiceCode, sem peso, sem dimensoes e sem vinculo com o pedido. A cotacao devolve ServiceCode mas ele e descartado, entao hoje nao da para reconciliar cotacao x etiqueta. ERP public.transportadoras = 1 e 0 de 8 vendas apontam transportadora_id.',
    obrigatorio_para_emitir: true,
  },

  // ----------------------------------------------------------- ESTADO
  {
    campo: 'estado_envio_etiqueta_tracking',
    fonte: 'sql/0001_logistica_envio.sql (nao aplicada)',
    autoridade: Autoridade.AUSENTE,
    evidencia: 'Zero tabelas/views etiqueta/label/shipment/tracking/rastreio no CEREBRO. A migration existe no repo e nao foi aplicada em nenhum ambiente.',
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
