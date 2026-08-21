// Dry-run: percorre COTAR -> VALIDAR_EMISSAO -> (EMITIR bloqueado) sem
// nenhum efeito externo. Nao chama a Frenet: a cotacao e injetada.
//
// Uso: node --experimental-strip-types logistica/frenet/dry-run.ts

import { OrigemMedida, Veredito, type PedidoEnvio } from './tipos.ts';
import { validarEmissao } from './validador.ts';
import { fontesQueBloqueiamEmissao, placarFontes, MAPA_FONTES } from './fontes.ts';
import { ENDPOINT_COTACAO, ENDPOINT_EMISSAO, ENDPOINT_PROIBIDO_NESTA_FASE, endpoint } from './endpoints.ts';
import {
  NOME_BASE_WHITELABEL,
  NOME_TOKEN_CLIENTE,
  NOME_TOKEN_PARCEIRO,
  NOME_WEBHOOK_TOKEN_NAME,
  NOME_WEBHOOK_TOKEN_VALUE,
  provarPresenca,
} from './segredos.ts';
import { chaveIdempotencia } from './idempotencia.ts';

/**
 * Envio-exemplo montado com o MELHOR dado que o sistema tem hoje:
 * CEP de destino vindo de cotacao real e embalagem derivada da heuristica
 * frete_config. Serve para demonstrar que, mesmo no melhor caso atual, a
 * emissao continua fechada.
 */
export function envioMelhorCasoAtual(): PedidoEnvio {
  const vazio = {
    cep: '', logradouro: '', numero: '', complemento: null,
    bairro: '', cidade: '', uf: '', pais: 'BR' as const,
  };
  return {
    envio_id: '00000000-0000-4000-8000-000000000001',
    pedido_id: 'orcamento:exemplo',
    pedido_fonte: 'CEREBRO.public.orcamentos',
    remetente: {
      nome: '', documento: '', tipo_documento: 'CNPJ', telefone: '', email: '',
      endereco: { ...vazio, cep: '06813230', cidade: 'Embu das Artes', uf: 'SP' },
    },
    destinatario: {
      nome: '', documento: '', tipo_documento: 'CPF', telefone: '', email: '',
      endereco: { ...vazio, cep: '45203011' },
    },
    itens: [{ sku: 'DTF-TEXTIL', descricao: 'Filme DTF Textil Impresso', quantidade: 1, peso_kg: 0.3, valor_unitario: 50, categoria: 'Tecido' }],
    pacotes: [{ altura_cm: 13, largura_cm: 13, comprimento_cm: 60, peso_kg: 0.3, origem_medida: OrigemMedida.HEURISTICA_CONFIG }],
    valor_declarado: 50,
    servico: {
      codigo: '', descricao: 'Sedex', transportadora: 'Correios',
      preco_cotado: 70.07, prazo_dias: 3, cotado_em: '2026-08-20T22:27:05.908Z', cotacao_ref: '',
    },
    solicitado_por: { tipo: 'agente', id: 'dry-run', nome: 'dry-run' },
  };
}

export async function relatorio(): Promise<string> {
  const linhas: string[] = [];
  const p = (s = '') => linhas.push(s);

  p('== ESTADOS ==');
  p(`COTAR           -> ${ENDPOINT_COTACAO} (efeito ${endpoint(ENDPOINT_COTACAO).efeito})`);
  p(`EMITIR          -> ${ENDPOINT_EMISSAO} (efeito ${endpoint(ENDPOINT_EMISSAO).efeito})`);
  p(`PROIBIDO        -> ${ENDPOINT_PROIBIDO_NESTA_FASE} (efeito ${endpoint(ENDPOINT_PROIBIDO_NESTA_FASE).efeito})`);
  p();

  p('== SEGREDOS (presenca, nunca valor) ==');
  for (const s of provarPresenca([
    NOME_TOKEN_CLIENTE, NOME_TOKEN_PARCEIRO,
    NOME_WEBHOOK_TOKEN_NAME, NOME_WEBHOOK_TOKEN_VALUE, NOME_BASE_WHITELABEL,
  ])) {
    p(`${s.presente ? 'PRESENTE' : 'AUSENTE '}  ${s.nome}`);
  }
  p();

  p('== PLACAR DE FONTES ==');
  for (const [autoridade, n] of Object.entries(placarFontes()).sort()) p(`  ${String(n).padStart(2)}  ${autoridade}`);
  p();

  p('== FONTES QUE BLOQUEIAM EMISSAO ==');
  const bloq = fontesQueBloqueiamEmissao();
  p(`${bloq.length} de ${MAPA_FONTES.length} campos mapeados bloqueiam:`);
  for (const f of bloq) p(`  [${f.autoridade}] ${f.campo} <- ${f.fonte}`);
  p();

  const envio = envioMelhorCasoAtual();
  const r = await validarEmissao(envio, {
    tentativas: [],
    payload_hash: 'dry-run',
    emissao_liberada: false,
    webhook_receptor_pronto: false,
  });

  p('== VALIDAR_EMISSAO (melhor caso atual) ==');
  p(`veredito: ${r.veredito}`);
  p(`chave_idempotencia: ${r.chave_idempotencia ?? '(nao calculavel)'}`);
  p(`bloqueios: ${r.bloqueios.length}`);
  for (const x of r.bloqueios) p(`  ${x.veredito} ${x.campo}: ${x.motivo.slice(0, 110)}`);
  p();

  p('== EMITIR ==');
  p(r.veredito === Veredito.READY
    ? 'validacao READY — ainda assim exige gate humano com liberacao operacional.'
    : 'nao alcancavel: validacao nao e READY. Nenhuma chamada a Frenet foi feita.');
  p();
  p(`chave determinstica do exemplo: ${await chaveIdempotencia(envio)}`);
  return linhas.join('\n');
}

const ehPrincipal = (() => {
  const g = globalThis as unknown as { process?: { argv?: string[] } };
  const argv1 = g.process?.argv?.[1] ?? '';
  return argv1.endsWith('dry-run.ts');
})();
if (ehPrincipal) console.log(await relatorio());
