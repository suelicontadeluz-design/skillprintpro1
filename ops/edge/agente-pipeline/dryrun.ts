import * as B from './fn_baseline.ts';
import * as C from './fn_candidato.ts';

const MARCADOR_CRM = '[CRM] etapa_funil atual do lead: negociacao — avancar para fechamento.';
const PROMPT_BASE = 'Voce e Rafael Cunha. Regras institucionais do pipeline comercial.';
const REFLEXAO_CRM = '\n\n## Reflexao\n- Lead ja pediu orcamento.\n' + MARCADOR_CRM + '\n';
const REFLEXAO_SEM_CRM = '\n\n## Reflexao\n- Lead ja pediu orcamento.\n';

const CTX = { valor_ic: 850, compras: [{ value: 300 }], total_compras: 300, segmento: 'evangelicos' };
const HIST = [ { role: 'cliente', text: 'quero 50 camisetas' }, { role: 'empresa', text: 'qual tamanho?' } ];
const base = (promptBase: string, reflexao: string) => ({
  nome: 'Joao', segmento: 'evangelicos', historico: HIST as any, ctx: CTX as any, promptBase, reflexao,
});

let falhas = 0;
const ok = (n: string, cond: boolean, extra = '') => {
  if (!cond) falhas++;
  console.log(`${cond ? 'PASS' : 'FALHA'}  ${n}${extra ? '  :: ' + extra : ''}`);
};

async function corpoCandidato(promptBase: string, reflexao: string) {
  C.arm();
  const r = await C.gerarOrientacaoHandoff(base(promptBase, reflexao) as any);
  const cap = C.capturas[0];
  return { r, cap, raw: cap.init.body as string, obj: JSON.parse(cap.init.body as string) };
}
async function corpoBaseline(promptBase: string, reflexao: string) {
  B.arm();
  const r = await B.gerarOrientacaoHandoff(base(promptBase, reflexao) as any);
  const cap = B.capturas[0];
  return { r, cap, raw: cap.init.body as string, obj: JSON.parse(cap.init.body as string) };
}

// ---- T1: reflexao presente -> dentro de system -----------------------------
const t1 = await corpoCandidato(PROMPT_BASE, REFLEXAO_CRM);
ok('T1 system existe', typeof t1.obj.system === 'string');
ok('T1 system === promptBase + reflexao', t1.obj.system === PROMPT_BASE + REFLEXAO_CRM);
ok('T1 reflexao NAO vaza para o user prompt', !t1.obj.messages[0].content.includes('## Reflexao'));

// ---- T2: reflexao vazia -> chamada continua valida -------------------------
const t2 = await corpoCandidato(PROMPT_BASE, '');
ok('T2 body e JSON valido', typeof t2.obj === 'object');
ok('T2 system === promptBase', t2.obj.system === PROMPT_BASE);
ok('T2 system nao vazio', t2.obj.system.length > 0);
ok('T2 origem=modelo (sem excecao)', t2.r.origem === 'modelo', `origem=${t2.r.origem}`);

// ---- T2b: promptBase E reflexao vazios (borda documentada) -----------------
const t2b = await corpoCandidato('', '');
ok('T2b system === "" (borda)', t2b.obj.system === '');
ok('T2b nao lanca — fluxo segue', t2b.r.origem === 'modelo');

// ---- T3: canario CRM positivo -> texto CRM aparece UMA vez -----------------
const occ = (h: string, n: string) => h.split(n).length - 1;
const t3 = await corpoCandidato(PROMPT_BASE, REFLEXAO_CRM);
ok('T3 CRM aparece 1x no body inteiro', occ(t3.raw, MARCADOR_CRM) === 1, `n=${occ(t3.raw, MARCADOR_CRM)}`);
ok('T3 CRM aparece 1x no system', occ(t3.obj.system, MARCADOR_CRM) === 1);
ok('T3 CRM 0x no user prompt', occ(t3.obj.messages[0].content, MARCADOR_CRM) === 0);

// ---- T4: controle negativo -> texto CRM ausente ----------------------------
const t4 = await corpoCandidato(PROMPT_BASE, REFLEXAO_SEM_CRM);
ok('T4 CRM ausente do body', occ(t4.raw, MARCADOR_CRM) === 0);

// ---- T5: user prompt inalterado vs baseline (byte a byte) ------------------
for (const [rot, pb, rf] of [['com reflexao', PROMPT_BASE, REFLEXAO_CRM], ['sem reflexao', PROMPT_BASE, '']] as any[]) {
  const b = await corpoBaseline(pb, rf);
  const c = await corpoCandidato(pb, rf);
  ok(`T5 user prompt identico (${rot})`, b.obj.messages[0].content === c.obj.messages[0].content);
  ok(`T5 messages identico (${rot})`, JSON.stringify(b.obj.messages) === JSON.stringify(c.obj.messages));
  ok(`T5 model/max_tokens identicos (${rot})`, b.obj.model === c.obj.model && b.obj.max_tokens === c.obj.max_tokens);
  ok(`T5 baseline sem system (${rot})`, !('system' in b.obj));
  ok(`T5 url/headers/method identicos (${rot})`,
     JSON.stringify([b.cap.url, b.cap.init.method, b.cap.init.headers]) ===
     JSON.stringify([c.cap.url, c.cap.init.method, c.cap.init.headers]));
  // chaves e ordem do body: unica diferenca deve ser a insercao de "system"
  ok(`T5 chaves do body (${rot})`,
     JSON.stringify(Object.keys(b.obj)) === JSON.stringify(['model','max_tokens','messages']) &&
     JSON.stringify(Object.keys(c.obj)) === JSON.stringify(['model','max_tokens','system','messages']));
}

// ---- T6: titulo/orientacao/urgencia/prazo inalterados ----------------------
const RESP = { content: [{ text: '{"titulo":"Joao - 50 camisetas","orientacao":"Confirmar tamanhos","urgencia":"alta","prazo_horas":2}' }] };
B.setResposta(RESP); C.setResposta(RESP);
{
  const b = await corpoBaseline(PROMPT_BASE, REFLEXAO_CRM);
  const c = await corpoCandidato(PROMPT_BASE, REFLEXAO_CRM);
  ok('T6 saida identica (modelo ok)', JSON.stringify(b.r) === JSON.stringify(c.r), JSON.stringify(c.r));
}
// caminho de fallback: resposta invalida -> catch
const RESP_RUIM = { content: [{ text: 'nao e json' }] };
B.setResposta(RESP_RUIM); C.setResposta(RESP_RUIM);
{
  const b = await corpoBaseline(PROMPT_BASE, REFLEXAO_CRM);
  const c = await corpoCandidato(PROMPT_BASE, REFLEXAO_CRM);
  ok('T6 fallback identico', JSON.stringify(b.r) === JSON.stringify(c.r), `origem=${c.r.origem}`);
  ok('T6 fallback nao vaza reflexao no texto', !JSON.stringify(c.r).includes('## Reflexao'));
}

console.log(falhas === 0 ? '\nRESULTADO: TODOS OS TESTES PASSARAM' : `\nRESULTADO: ${falhas} FALHA(S)`);
if (falhas) process.exit(1);
