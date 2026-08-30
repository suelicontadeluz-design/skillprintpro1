// Varredura de regressao: roda normalizarProdutoMacro ANTES e DEPOIS sobre TODO
// valor de slots.produto que o modelo ja emitiu em producao (joao_slots_observacao
// + agente_noturno_estado). Prova a propriedade que a correcao promete:
// nenhum valor hoje classificado muda de familia; a mudanca so ocorre onde a
// funcao devolvia null.
import { readFileSync } from 'node:fs';
const A = await import('./.gen/antes.ts');
const D = await import('./.gen/depois.ts');
const corpus = JSON.parse(readFileSync(new URL('./corpus-produto.json', import.meta.url), 'utf8'));

let mudou = [], reclassificou = [], iguais = 0, totalTurnos = 0, turnosResolvidos = 0;
for (const [v, n] of corpus) {
  totalTurnos += n;
  const a = A.normalizarProdutoMacro(v), d = D.normalizarProdutoMacro(v);
  if (a === d) { iguais++; continue; }
  mudou.push({ v, n, antes: a, depois: d });
  if (a !== null) reclassificou.push({ v, n, antes: a, depois: d });
  if (a === null && d !== null) turnosResolvidos += n;
}
console.log(`corpus: ${corpus.length} valores distintos / ${totalTurnos} ocorrencias`);
console.log(`inalterados: ${iguais} valores`);
console.log(`RECLASSIFICADOS (antes != null e mudou de familia): ${reclassificou.length}`);
for (const r of reclassificou) console.log('   !!', r);
console.log(`RESOLVIDOS (antes = null, agora tem macro): ${mudou.length} valores / ${turnosResolvidos} ocorrencias`);
for (const r of mudou) console.log(`   + ${JSON.stringify(r.v).padEnd(30)} n=${String(r.n).padEnd(5)} null -> ${r.depois}`);
console.log(reclassificou.length === 0 ? '\nOK: zero falso match. A correcao so alcanca o que era null.' : '\nFALHOU: houve reclassificacao.');
process.exit(reclassificou.length === 0 ? 0 : 1);
