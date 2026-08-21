// Mapa campo -> fonte canonica, com a classificacao de autoridade provada
// mecanicamente em 21/08/2026 (chat claude-20260821-criar-etiqueta-frenet).
//
// Este arquivo NAO e documentacao: o validador le estas entradas em runtime.
// Rebaixar uma fonte aqui bloqueia a emissao automaticamente.
//
// Projetos:
//   CEREBRO = Supabase ldrdtaibazplvrbwyrvx (onde vive calcular-frete)
//   ERP     = Supabase ynjsflvdfftcopibzxyo (criativa-futuro-erp, em desenvolvimento)

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
  {
    campo: 'pedido',
    fonte: 'ERP.public.vendas',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.vendas = 6 linhas; public.venda_itens = 3; public.produtos = 12. ERP ainda em desenvolvimento e sem ponte com o Cerebro.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pedido.alternativa_cerebro',
    fonte: 'CEREBRO.public.orcamentos',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'CEREBRO public.orcamentos = 99 linhas (38 status=pago). Nao possui destinatario, documento, endereco completo nem itens; so cep_destino (19/99), metros, largura_cm, altura_cm.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.nome',
    fonte: 'ERP.public.pessoas.nome',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.pessoas = 136 linhas, 128 com endereco completo. Base do ERP, ainda nao ligada ao pedido do Cerebro.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.documento',
    fonte: 'ERP.public.pessoas.cpf|cnpj',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'CEREBRO public.pessoas: 976 cpf, 502 cnpj de 1754. CEREBRO public.lead_identificadores.cpf_cnpj: 327 de 15715.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.telefone',
    fonte: 'CEREBRO.public.lead_identificadores.telefone',
    autoridade: Autoridade.AUTORIDADE_CONFIAVEL,
    evidencia: 'CEREBRO public.pessoas.telefone: 1554 de 1754. lead_identificadores = 15715 linhas, chave viva do WhatsApp.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.email',
    fonte: 'CEREBRO.public.pessoas.email',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'CEREBRO public.pessoas.email: 1325 de 1754.',
    obrigatorio_para_emitir: false,
  },
  {
    campo: 'destinatario.endereco.cep',
    fonte: 'ERP.public.pessoas.cep',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: 1754 linhas, 0 com cep. Unico CEP vivo no Cerebro e o cep_destino de cotacao (operacoes_financeiras.components), que nao e cadastro.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.logradouro',
    fonte: 'ERP.public.pessoas.logradouro',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: 0 de 1754 com logradouro.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.numero',
    fonte: 'ERP.public.pessoas.numero',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: 0 de 1754 com numero.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.complemento',
    fonte: 'ERP.public.pessoas.complemento',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: coluna existe, 0 preenchida.',
    obrigatorio_para_emitir: false,
  },
  {
    campo: 'destinatario.endereco.bairro',
    fonte: 'ERP.public.pessoas.bairro',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: 0 de 1754 com bairro.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.cidade',
    fonte: 'ERP.public.pessoas.cidade',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas: 1 de 1754 com cidade.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'destinatario.endereco.uf',
    fonte: 'ERP.public.pessoas.estado',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'CEREBRO public.pessoas.estado sem preenchimento util; calcme_itens_pedido.uf e historico importado, nao cadastro de entrega.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'remetente.*',
    fonte: 'CEREBRO.public.frete_config[chave=remetente]',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'frete_config.remetente = {uf: SP, cep: 06813-230, cidade: Embu das Artes}. Falta razao social, CNPJ, logradouro, numero, bairro, telefone e email do remetente — obrigatorios em etiqueta.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'itens',
    fonte: 'ERP.public.venda_itens',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.venda_itens = 3 linhas.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'itens.quantidade',
    fonte: 'ERP.public.venda_itens.quantidade',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'Mesma tabela do item; sem volume real ainda.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.peso_kg',
    fonte: 'ERP.public.produtos.peso_bruto_kg',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.produtos: 12 produtos, 1 com peso_bruto_kg (0.15). Frente entrega-cep-e-frete-sem-fonte-fiel esta BLOQUEADA aguardando entrevista humana de peso/volume/embalagem por produto.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.altura_cm',
    fonte: 'ERP.public.produtos.altura_cm',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.produtos: 1 de 12 com altura_cm.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.largura_cm',
    fonte: 'ERP.public.produtos.largura_cm',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.produtos: 1 de 12 com largura_cm.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.comprimento_cm',
    fonte: 'ERP.public.produtos.comprimento_cm',
    autoridade: Autoridade.AINDA_EM_DESENVOLVIMENTO,
    evidencia: 'ERP public.produtos: 1 de 12 com comprimento_cm.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'pacote.heuristica_dtf',
    fonte: 'CEREBRO.public.frete_config[chave=embalagem]',
    autoridade: Autoridade.NAO_AUTORIZADO_PARA_EMISSAO,
    evidencia: 'frete_config.embalagem = peso_por_metro_g 100 + duas caixas fixas 60x13x13 / 60x26x13. E regra de COTACAO para DTF linear. calcular-frete v34 aplica piso de 300 g. Serve para cotar, nunca para emitir: 125 operacoes kind=frete e 0 registram peso.',
    obrigatorio_para_emitir: false,
  },
  {
    campo: 'valor_declarado',
    fonte: 'CEREBRO.public.orcamentos.valor_total',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: 'calcular-frete v34 usa default 50 quando ausente. Default de cotacao nao pode virar valor segurado de etiqueta.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'servico',
    fonte: 'CEREBRO.public.operacoes_financeiras[kind=frete].components.servico',
    autoridade: Autoridade.INCOMPLETO,
    evidencia: '125 operacoes kind=frete; components guarda apenas {cep, servico}. Nao guarda codigo do servico, peso, dimensoes nem vinculo com pedido — impossivel reconciliar cotacao x etiqueta hoje.',
    obrigatorio_para_emitir: true,
  },
  {
    campo: 'estado_envio_etiqueta_tracking',
    fonte: '(inexistente)',
    autoridade: Autoridade.NAO_EXISTE,
    evidencia: 'Zero tabelas/views em CEREBRO public com nome etiqueta/label/shipment/tracking/rastreio. Nao ha onde persistir etiqueta, custo real, OrderId ou ShipmentId.',
    obrigatorio_para_emitir: true,
  },
]);

const INDICE: ReadonlyMap<string, FonteCampo> = new Map(
  MAPA_FONTES.map((f) => [f.campo, f]),
);

export function fonteDe(campo: string): FonteCampo | undefined {
  return INDICE.get(campo);
}

/** Autoridades que jamais podem sustentar uma emissao real. */
export const AUTORIDADES_QUE_BLOQUEIAM: ReadonlySet<Autoridade> = new Set([
  Autoridade.INCOMPLETO,
  Autoridade.AINDA_EM_DESENVOLVIMENTO,
  Autoridade.NAO_EXISTE,
  Autoridade.NAO_AUTORIZADO_PARA_EMISSAO,
]);

/** Campos obrigatorios cuja fonte hoje nao sustenta emissao. Fail-closed. */
export function fontesQueBloqueiamEmissao(): FonteCampo[] {
  return MAPA_FONTES.filter(
    (f) => f.obrigatorio_para_emitir && AUTORIDADES_QUE_BLOQUEIAM.has(f.autoridade),
  );
}
