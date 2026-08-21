// VALIDAR_EMISSAO: responde READY / BLOCKED_* / NEEDS_HUMAN sem nenhum
// efeito financeiro e sem tocar a Frenet.
//
// Ordem de avaliacao proposital: FONTE antes de DADOS. Um payload pode estar
// sintaticamente completo e ainda assim vir de uma fonte que nao tem
// autoridade para emitir — esse caso precisa aparecer como BLOCKED_FONTE, nao
// como "esta tudo certo".

import {
  Autoridade,
  Veredito,
  OrigemMedida,
  type Bloqueio,
  type PedidoEnvio,
  type ResultadoValidacao,
} from './tipos.ts';
import { fontesQueBloqueiamEmissao } from './fontes.ts';
import { chaveIdempotencia, decidirRetry, type Tentativa } from './idempotencia.ts';

const RE_CEP = /^\d{8}$/;
const RE_UF = /^[A-Z]{2}$/;
const RE_CPF = /^\d{11}$/;
const RE_CNPJ = /^\d{14}$/;
const RE_TEL = /^\d{10,13}$/;
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Medidas que descrevem um volume plausivel de despacho. */
const LIMITES = {
  peso_kg_min: 0.05,
  peso_kg_max: 30,
  cm_min: 1,
  cm_max: 200,
  valor_declarado_min: 0.01,
};

export interface ContextoValidacao {
  /** Tentativas ja registradas para a chave de idempotencia deste envio. */
  tentativas: readonly Tentativa[];
  /** Hash do payload que seria enviado agora. */
  payload_hash: string;
  /** Politica: emissao esta liberada operacionalmente? Default false. */
  emissao_liberada: boolean;
  /** Receptor de webhook auditado e autenticado? Default false. */
  webhook_receptor_pronto: boolean;
  agora?: () => string;
}

function b(veredito: Veredito, campo: string, motivo: string, extra: Partial<Bloqueio> = {}): Bloqueio {
  return { veredito, campo, motivo, ...extra };
}

function validarEndereco(prefixo: string, e: PedidoEnvio['destinatario']['endereco'], out: Bloqueio[]): void {
  if (!RE_CEP.test(e.cep ?? '')) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.cep`, 'cep_invalido_esperado_8_digitos'));
  if (!(e.logradouro ?? '').trim()) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.logradouro`, 'ausente'));
  if (!(e.numero ?? '').trim()) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.numero`, 'ausente_numero_nao_pode_ser_deduzido_do_cep'));
  if (!(e.bairro ?? '').trim()) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.bairro`, 'ausente'));
  if (!(e.cidade ?? '').trim()) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.cidade`, 'ausente'));
  if (!RE_UF.test(e.uf ?? '')) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.uf`, 'uf_invalida'));
  if (e.pais !== 'BR') out.push(b(Veredito.BLOCKED_POLITICA, `${prefixo}.pais`, 'somente_br_nesta_fase'));
}

function validarParte(prefixo: string, p: PedidoEnvio['destinatario'], out: Bloqueio[]): void {
  if (!(p?.nome ?? '').trim()) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.nome`, 'ausente'));
  const doc = (p?.documento ?? '').replace(/\D/g, '');
  const okDoc = p?.tipo_documento === 'CPF' ? RE_CPF.test(doc) : RE_CNPJ.test(doc);
  if (!okDoc) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.documento`, 'documento_invalido_para_o_tipo_declarado'));
  if (!RE_TEL.test((p?.telefone ?? '').replace(/\D/g, ''))) {
    out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.telefone`, 'telefone_invalido'));
  }
  if (!RE_EMAIL.test(p?.email ?? '')) out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.email`, 'email_invalido'));
  if (p?.endereco) validarEndereco(`${prefixo}.endereco`, p.endereco, out);
  else out.push(b(Veredito.BLOCKED_DADOS, `${prefixo}.endereco`, 'ausente'));
}

/**
 * Nao tem efeito externo. Pode ser chamada a vontade, inclusive por agente.
 */
export async function validarEmissao(
  envio: PedidoEnvio,
  ctx: ContextoValidacao,
): Promise<ResultadoValidacao> {
  const agora = ctx.agora ? ctx.agora() : new Date().toISOString();
  const bloqueios: Bloqueio[] = [];

  // 1. FONTE — a mais forte. Nao adianta o payload estar bonito se a fonte
  //    do dado ainda nao existe ou nao tem autoridade.
  for (const f of fontesQueBloqueiamEmissao()) {
    bloqueios.push(
      b(Veredito.BLOCKED_FONTE, f.campo, `fonte_sem_autoridade_para_emitir: ${f.evidencia}`, {
        fonte_esperada: f.fonte,
        autoridade: f.autoridade,
      }),
    );
  }

  // 2. POLITICA — gates operacionais que independem do dado.
  if (!ctx.emissao_liberada) {
    bloqueios.push(b(Veredito.BLOCKED_POLITICA, 'politica.emissao', 'emissao_nao_liberada_nesta_fase'));
  }
  if (!ctx.webhook_receptor_pronto) {
    bloqueios.push(
      b(
        Veredito.BLOCKED_POLITICA,
        'politica.webhook_receptor',
        'receptor_de_tracking_sem_autenticacao_e_com_efeito_whatsapp_nao_pode_ser_informado_na_criacao',
      ),
    );
  }

  // 3. DADOS — forma do payload.
  validarParte('remetente', envio?.remetente as PedidoEnvio['destinatario'], bloqueios);
  validarParte('destinatario', envio?.destinatario, bloqueios);

  if (!envio?.pedido_id?.trim()) bloqueios.push(b(Veredito.BLOCKED_DADOS, 'pedido_id', 'ausente'));
  if (!envio?.pedido_fonte?.trim()) bloqueios.push(b(Veredito.BLOCKED_DADOS, 'pedido_fonte', 'ausente'));
  if (!envio?.envio_id?.trim()) bloqueios.push(b(Veredito.BLOCKED_DADOS, 'envio_id', 'ausente'));

  if (!Array.isArray(envio?.itens) || envio.itens.length === 0) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'itens', 'vazio'));
  } else {
    envio.itens.forEach((it, i) => {
      if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) {
        bloqueios.push(b(Veredito.BLOCKED_DADOS, `itens[${i}].quantidade`, 'invalida'));
      }
      if (!Number.isFinite(it.peso_kg) || it.peso_kg <= 0) {
        bloqueios.push(b(Veredito.BLOCKED_DADOS, `itens[${i}].peso_kg`, 'ausente_ou_invalido'));
      }
    });
  }

  if (!Array.isArray(envio?.pacotes) || envio.pacotes.length === 0) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'pacotes', 'vazio'));
  } else {
    envio.pacotes.forEach((p, i) => {
      // REGRA DURA: heuristica de embalagem cota, mas nao emite.
      if (p.origem_medida !== OrigemMedida.FICHA_FISICA && p.origem_medida !== OrigemMedida.AFERIDO_NA_EXPEDICAO) {
        bloqueios.push(
          b(Veredito.BLOCKED_FONTE, `pacotes[${i}].origem_medida`, `medida_sem_fonte_fisica:${p.origem_medida}`, {
            autoridade: p.origem_medida === OrigemMedida.HEURISTICA_CONFIG
              ? Autoridade.NAO_AUTORIZADA
              : Autoridade.AUSENTE,
          }),
        );
      }
      const dims: Array<[string, number]> = [
        ['altura_cm', p.altura_cm], ['largura_cm', p.largura_cm], ['comprimento_cm', p.comprimento_cm],
      ];
      for (const [nome, v] of dims) {
        if (!Number.isFinite(v) || v < LIMITES.cm_min || v > LIMITES.cm_max) {
          bloqueios.push(b(Veredito.BLOCKED_DADOS, `pacotes[${i}].${nome}`, 'fora_da_faixa_plausivel'));
        }
      }
      if (!Number.isFinite(p.peso_kg) || p.peso_kg < LIMITES.peso_kg_min || p.peso_kg > LIMITES.peso_kg_max) {
        bloqueios.push(b(Veredito.BLOCKED_DADOS, `pacotes[${i}].peso_kg`, 'fora_da_faixa_plausivel'));
      }
    });
  }

  if (!Number.isFinite(envio?.valor_declarado) || envio.valor_declarado < LIMITES.valor_declarado_min) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'valor_declarado', 'ausente_ou_invalido'));
  }

  if (!envio?.servico?.codigo?.trim()) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'servico.codigo', 'ausente'));
  }
  if (!envio?.servico?.cotacao_ref?.trim()) {
    bloqueios.push(
      b(Veredito.BLOCKED_DADOS, 'servico.cotacao_ref', 'sem_vinculo_com_cotacao_impede_reconciliar_custo_x_etiqueta'),
    );
  }
  if (!Number.isFinite(envio?.servico?.preco_cotado) || envio.servico.preco_cotado <= 0) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'servico.preco_cotado', 'ausente_ou_invalido'));
  }

  if (!envio?.solicitado_por?.id?.trim()) {
    bloqueios.push(b(Veredito.BLOCKED_DADOS, 'solicitado_por', 'autoria_da_solicitacao_e_obrigatoria'));
  }

  // 4. IDEMPOTENCIA — so calculavel quando ha estrutura minima.
  let chave: string | null = null;
  const temEstruturaParaChave = Boolean(
    envio?.pedido_id && envio?.pedido_fonte && envio?.destinatario?.endereco && envio?.servico?.codigo &&
    Array.isArray(envio?.pacotes) && Number.isFinite(envio?.valor_declarado),
  );
  if (temEstruturaParaChave) {
    chave = await chaveIdempotencia(envio);
    const decisao = decidirRetry(ctx.tentativas, ctx.payload_hash);
    if (!decisao.pode_prosseguir) {
      bloqueios.push(
        b(
          decisao.exige_humano ? Veredito.NEEDS_HUMAN : Veredito.BLOCKED_IDEMPOTENCIA,
          'idempotencia',
          decisao.motivo,
        ),
      );
    }
  }

  return {
    veredito: escolherVeredito(bloqueios),
    bloqueios,
    chave_idempotencia: chave,
    avaliado_em: agora,
  };
}

/**
 * Precedencia do veredito. NEEDS_HUMAN vence tudo: significa que existe um
 * estado externo que so uma pessoa pode reconciliar.
 */
const PRECEDENCIA: readonly Veredito[] = [
  Veredito.NEEDS_HUMAN,
  Veredito.BLOCKED_IDEMPOTENCIA,
  Veredito.BLOCKED_FONTE,
  Veredito.BLOCKED_POLITICA,
  Veredito.BLOCKED_DADOS,
];

export function escolherVeredito(bloqueios: readonly Bloqueio[]): Veredito {
  if (bloqueios.length === 0) return Veredito.READY;
  for (const v of PRECEDENCIA) {
    if (bloqueios.some((x) => x.veredito === v)) return v;
  }
  return Veredito.BLOCKED_DADOS;
}
