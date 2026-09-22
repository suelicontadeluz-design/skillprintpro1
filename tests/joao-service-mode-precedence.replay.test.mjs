import assert from 'node:assert/strict';
import { SERVICE_MODE, smResolve, smAllowedTools, smPatchDecision } from '../patches/joao-service-mode-precedence-20260922/service-mode-precedence-core.mjs';

const tools = [
  {name:'consultar_tabela_dtf'}, {name:'calcular_dtf_por_arte'}, {name:'calcular_dtf_metro'},
  {name:'orcar_camisetas'}, {name:'consultar_modelos'}, {name:'calcular_frete'}
];

const organic = [
  {role:'user', text:'Impressão dtf'},
  {role:'assistant', text:'Perfeito! Para a impressão DTF têxtil, preciso saber os metros ou medida e cópias.'},
  {role:'user', text:'Precisarei de 27 cópias circulares mais ou menos 15 cm de diâmetro'},
  {role:'user', text:'Para aplicar em camisetas'},
  {role:'assistant', text:'Você quer o DTF para aplicar depois ou prefere que a gente já personalize as camisetas prontas?'},
  {role:'user', text:'Qto sairia cada camiseta ?'},
  {role:'user', text:'Isso para camiseta'},
  {role:'assistant', text:'Fazemos camiseta básica e baby look personalizadas. Me passa a quantidade de cada tamanho.'},
  {role:'user', text:'Tamanho P e M 28 camisetas'},
  {role:'user', text:'FTP têxtil'},
  {role:'user', text:'Dft têxtil'},
];

const r1 = smResolve(organic);
assert.equal(r1.mode, SERVICE_MODE.FINISHED);
assert.equal(r1.canonicalProduct, 'camiseta');
assert.equal(r1.weakTechnique, true);
assert.deepEqual(
  smAllowedTools(tools, r1).map(t => t.name),
  ['orcar_camisetas','consultar_modelos','calcular_frete']
);

const p1 = smPatchDecision({
  mensagem:'Ótimo, então são 28 cópias de DTF têxtil circular 15cm, que custam R$ 95,84.',
  slots:{produto:'dtf_textil',quantidade:28}
}, r1);
assert.equal(p1.decision.slots.produto, 'camiseta');
assert.equal(p1.contradiction, true);
assert.equal(/95,84/.test(p1.decision.mensagem), false);

const r2 = smResolve([...organic,
  {role:'user', text:'Na verdade já tenho as camisetas. Quero só o DTF têxtil para eu aplicar.'}
]);
assert.equal(r2.mode, SERVICE_MODE.TRANSFER);
assert.equal(r2.canonicalProduct, 'dtf_textil');
assert.equal(smAllowedTools(tools, r2).some(t=>t.name==='orcar_camisetas'), false);
assert.equal(smAllowedTools(tools, r2).some(t=>t.name==='calcular_dtf_por_arte'), true);

assert.equal(smResolve([{role:'user', text:'DTF têxtil'}]).mode, SERVICE_MODE.TRANSFER);

const r4 = smResolve([
  {role:'user', text:'Quero só o DTF têxtil, eu já tenho as camisetas'},
  {role:'assistant', text:'Qual a medida da arte?'},
  {role:'user', text:'Pensando melhor, quanto sairia cada camiseta personalizada pronta?'}
]);
assert.equal(r4.mode, SERVICE_MODE.FINISHED);

assert.equal(smResolve([
  {role:'user', text:'Preciso do DTF para aplicar em camisetas que eu já tenho'}
]).mode, SERVICE_MODE.TRANSFER);

console.log('PASS joao-service-mode-precedence', {
  organic:r1.mode,
  explicit_switch:r2.mode,
  reverse_switch:r4.mode,
});
