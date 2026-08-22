# Extrai a funcao alvo (baseline e candidato) SEM transcricao manual e monta o harness.
FN_START = "async function gerarOrientacaoHandoff(params: {"
FN_END   = "\nasync function resolverDealId("

def extrai(path):
    s = open(path, encoding="utf-8").read()
    i = s.index(FN_START); j = s.index(FN_END) + 1
    return s[i:j]

PRE = """// harness gerado automaticamente — nao editado a mao
const MODELO_HANDOFF = 'claude-haiku-4-5-20251001';
const ANTHROPIC_KEY = 'TEST_KEY_DRY_RUN';
export const capturas: any[] = [];
let RESPOSTA_MODELO: any = { content: [{ text: '{"titulo":"T","orientacao":"O","urgencia":"alta","prazo_horas":2}' }] };
export function setResposta(r: any) { RESPOSTA_MODELO = r; }
export function arm() {
  capturas.length = 0;
  (globalThis as any).fetch = async (url: any, init: any) => {
    capturas.push({ url: String(url), init });
    return { ok: true, json: async () => RESPOSTA_MODELO } as any;
  };
}
"""

for src, out, nome in [("baseline_index.ts","fn_baseline.ts","BASELINE"),
                       ("candidato_index.ts","fn_candidato.ts","CANDIDATO")]:
    corpo = extrai(src)
    open(out, "w", encoding="utf-8").write(PRE + "export " + corpo)
    print(nome, "->", out, len(corpo), "bytes de funcao")
