// Acesso a segredos. Regra: o codigo pode provar PRESENCA, nunca expor VALOR.
//
// Nomes canonicos ja existentes no ambiente do Cerebro:
//   TOKEN_FRENET          -> Token do Cliente. Usado hoje em calcular-frete v34
//                            como header `token` em POST /shipping/quote.
//                            NAO substituir.
//   FRENET_PARTNER_TOKEN  -> Partner Token do produto Whitelabel/Envios.
//                            Consumido separadamente, nunca no lugar do outro.
//   FRENET_WEBHOOK_TOKEN_NAME / FRENET_WEBHOOK_TOKEN_VALUE
//                        -> par TOKEN_NAME/TOKEN_VALUE que a Frenet devolve
//                           como header em cada chamada de webhook. Credencial
//                           propria do callback. Ainda NAO cadastrada.

export const NOME_TOKEN_CLIENTE = 'TOKEN_FRENET';
export const NOME_TOKEN_PARCEIRO = 'FRENET_PARTNER_TOKEN';
export const NOME_WEBHOOK_TOKEN_NAME = 'FRENET_WEBHOOK_TOKEN_NAME';
export const NOME_WEBHOOK_TOKEN_VALUE = 'FRENET_WEBHOOK_TOKEN_VALUE';
export const NOME_BASE_WHITELABEL = 'FRENET_WHITELABEL_BASE_URL';

export interface LeitorSegredo {
  (nome: string): string | undefined;
}

/** Leitor padrao: variavel de ambiente do runtime (Deno ou Node). */
export const leitorAmbiente: LeitorSegredo = (nome) => {
  const g = globalThis as unknown as {
    Deno?: { env: { get(k: string): string | undefined } };
    process?: { env: Record<string, string | undefined> };
  };
  if (g.Deno?.env) return g.Deno.env.get(nome);
  return g.process?.env?.[nome];
};

export interface Presenca {
  nome: string;
  presente: boolean;
  /** Comprimento apenas. Nunca prefixo, sufixo, hash reversivel ou valor. */
  tamanho: number;
}

/** Prova de presenca sem vazar valor. Seguro para log e para relatorio. */
export function provarPresenca(nomes: readonly string[], ler: LeitorSegredo = leitorAmbiente): Presenca[] {
  return nomes.map((nome) => {
    const v = ler(nome);
    return { nome, presente: typeof v === 'string' && v.length > 0, tamanho: v?.length ?? 0 };
  });
}

export class SegredoAusente extends Error {
  readonly nome: string;
  constructor(nome: string) {
    super(`segredo_ausente:${nome}`);
    this.name = 'SegredoAusente';
    this.nome = nome;
  }
}

/**
 * Devolve o valor para uso imediato em header. Nunca deve ser logado,
 * serializado em resposta, gravado em banco nem devolvido a um agente.
 */
export function exigirSegredo(nome: string, ler: LeitorSegredo = leitorAmbiente): string {
  const v = ler(nome);
  if (typeof v !== 'string' || v.length === 0) throw new SegredoAusente(nome);
  return v;
}

/**
 * Guarda de separacao de credenciais. Existe para impedir tres erros que
 * matam a integracao em silencio:
 *   1. usar o Partner Token no lugar do Token do Cliente (ou vice-versa);
 *   2. usar qualquer um dos dois como token do webhook;
 *   3. cadastrar um webhook cujo segredo e igual a um segredo de API.
 */
export function conferirSeparacaoDeCredenciais(ler: LeitorSegredo = leitorAmbiente): void {
  const cliente = ler(NOME_TOKEN_CLIENTE);
  const parceiro = ler(NOME_TOKEN_PARCEIRO);
  const webhook = ler(NOME_WEBHOOK_TOKEN_VALUE);

  if (cliente && parceiro && cliente === parceiro) {
    throw new Error('credenciais_colididas:TOKEN_FRENET_igual_a_FRENET_PARTNER_TOKEN');
  }
  if (webhook && (webhook === cliente || webhook === parceiro)) {
    throw new Error('credencial_de_webhook_reutiliza_segredo_de_api');
  }
}
