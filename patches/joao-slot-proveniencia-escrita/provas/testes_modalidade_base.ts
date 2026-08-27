// ANTES — a mesma bateria contra a LIVE v4.33.0 (base.ts, sha a9a4aaf1...b91b4).
// Nao existe modalidade logistica na LIVE: o que se prova aqui e a AUSENCIA das quatro
// barreiras e a presenca literal das tres frases que produziram o defeito.
import * as fs from 'node:fs';
const BASE = fs.readFileSync(new URL('../base.ts', import.meta.url), 'utf8');

// blocoLocalizacao da LIVE, recortado VERBATIM (mesmo corpo do base.ts).
const DDD_UF: Record<string, string> = { '11':'SP','31':'MG' };
const UF_NOME: Record<string, string> = { SP:'São Paulo', MG:'Minas Gerais' };
function blocoLocalizacaoLive(phone: string): string {
  const ddd = phone.length >= 4 ? phone.slice(2, 4) : '';
  const uf = DDD_UF[ddd] || '';
  if (!uf) return '';
  if (ddd === '11') return '\n\n[LOCALIZAÇÃO: DDD 11 (Grande SP). Pode oferecer RETIRADA ou ENVIO.]';
  return `\n\n[LOCALIZAÇÃO: DDD ${ddd} = ${UF_NOME[uf] || uf}. ASSUMA ENVIO: peça o CEP completo, 8 dígitos.]`;
}

const linhas: string[] = []; let furos = 0;
function t(n: string, temFuro: boolean, amostra: string) {
  if (temFuro) { furos++; linhas.push(`  FURO     ${n}\n             -> ${amostra.slice(0, 190)}`); }
  else linhas.push(`  coberto  ${n}`);
}

console.log('\n========= MESMA BATERIA CONTRA A LIVE v4.33.0 (ANTES) =========\n');

t('B1 nenhuma interceptacao de calcular_frete por modalidade',
  !BASE.includes("toolEfetiva === 'calcular_frete'"),
  "o laco de tools so intercepta calcular_dtf_metro; calcular_frete executa sempre que o modelo pedir");

t('B2 nenhum estado canonico de modalidade logistica',
  !BASE.includes('modalidade_logistica') && !BASE.includes('ModalidadeLogistica'),
  "slots tem 'envio_retirada' como texto livre do modelo, sem precedencia de fontes nem enforcement");

t('B3 nenhuma validacao de saida contra pedido de CEP em retirada',
  !BASE.includes('guardrail_cep_ou_correios_sem_frete'),
  '"Preciso do seu CEP para gerar a cobranca correta, mesmo sendo retirada." atravessa sem nenhuma barreira');

t('B4 CEP e slot universal do fechamento no prompt',
  BASE.includes('SLOTS: produto -> arte -> quantidade -> envio/retirada + CEP -> or\\u00e7amento')
  && BASE.includes('2. CEP -> calcular_frete -> TOTAL = produto + frete.'),
  'SLOTS junta "envio/retirada + CEP" e FECHAMENTO abre em "CEP -> calcular_frete"');

t('B5 fallback terminal e lista FIXA com CEP',
  BASE.includes('Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?'),
  'a mesma frase saiu 4x para a Carolina (21:00, 21:03, 21:09 e 21:16), 3 delas depois de ela responder');

const b31 = blocoLocalizacaoLive('5531988887777');
t('B6 DDD fora da Grande SP vira ordem de pedir CEP',
  /ASSUMA ENVIO/.test(b31) && /peça o CEP completo/.test(b31), b31.trim());

const b11 = blocoLocalizacaoLive('5511952315439');
t('B7 DDD 11 nao impede pedir CEP antes de resolver a modalidade',
  !/PROIBIDO/.test(b11) && !/NÃO peça/.test(b11), b11.trim());

t('B8 retry que EXIGE PAC/Sedex roda sem olhar a modalidade',
  BASE.includes("if (decisao.responde === true && toolsUsadas.includes('calcular_frete') && !execucoes.freteJa"),
  'depois de calcular_frete o retry obriga o texto a citar PAC e Sedex, mesmo em retirada');

t('B9 "Anotei seu CEP! Ja calculo o frete" dispara com qualquer CEP',
  BASE.includes("else if (ehCep) { resposta = 'Anotei seu CEP! J\\u00e1 calculo o frete e te passo o total certinho.'"),
  'CEP recebido vira frete sem checar se o cliente vai retirar');

console.log(linhas.join('\n'));
console.log(`\n  >>> ${furos} de 9 barreiras AUSENTES na LIVE v4.33.0.\n`);
