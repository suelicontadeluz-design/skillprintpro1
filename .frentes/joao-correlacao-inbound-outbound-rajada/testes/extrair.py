# Extrai do index.ts PATCHADO os trechos reais exercitados pelos testes T1..T9.
# Nada aqui e reescrito a mao: cada bloco e uma fatia literal do arquivo que sera
# deployado. Se o codigo mudar e a fatia sumir, a extracao FALHA (assert), e nao
# passa um teste verde sobre codigo que nao existe mais.
import io, os, sys, re

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(RAIZ, 'supabase/functions/agente-noturno/index.ts')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'alvo_gerado.ts')
s = io.open(SRC, encoding='utf-8', newline='').read()

def entre(ini, fim, inclusivo_fim=True):
    a = s.find(ini)
    assert a >= 0, 'marcador inicial nao encontrado: ' + ini[:80]
    b = s.find(fim, a + len(ini))
    assert b >= 0, 'marcador final nao encontrado: ' + fim[:80]
    return s[a:(b + len(fim)) if inclusivo_fim else b]

def linha(sub):
    a = s.find(sub)
    assert a >= 0, 'trecho nao encontrado: ' + sub[:80]
    ini = s.rfind('\n', 0, a) + 1
    fim = s.find('\n', a)
    return s[ini:fim]

BLOCOS = {}
# helpers de frescor + carimbo + terminal superseded
BLOCOS['helpers_frescor'] = entre("const FILTRO_INBOUND_COM_CONTEUDO =", "async function carimbarInbound", inclusivo_fim=False)
BLOCOS['carimbar'] = entre("async function carimbarInbound(phone: string, ids: any[] | null, status: string) {", "\n}\n")
BLOCOS['terminal_superseded'] = entre("async function finalizarDecisaoSuperseded(", "\n}\n")
# barreira final: exatamente o bloco que roda antes do primeiro transporte fisico
BLOCOS['barreira'] = entre("  if (!dryRun) {\n    const refLote = await maxCreatedAtDoLote", "  const envio1Id = await prepararEnvio", inclusivo_fim=False)
# formacao do lote no webhook
BLOCOS['rajada_query'] = linha("const { data: rajada } = await sb.from('inbound_fora_horario')")
BLOCOS['rajada_owned'] = entre("        for (const r of rajada) {\n          ownedIds.push(String(r.id));", "        }\n")
BLOCOS['ids_do_lote'] = linha("const idsDoLote = ownedIds.length > 0")
BLOCOS['guarda_terminal'] = entre("        if (minhaLinha?.status && minhaLinha.status !== 'pendente') {", "        }\n")
# sweep
BLOCOS['sweep_query'] = linha("const { data: rows } = await sb.from('inbound_fora_horario').select('id, phone, chat_name, body, created_at')")
BLOCOS['sweep_lotemax'] = linha("const loteMax = lote.reduce(")
# wrapper de lock
BLOCOS['atender_lock'] = entre("async function atenderCliente(phone: string, chatName: string,", "\n}\n")

for k, v in BLOCOS.items():
    assert v.strip(), k

cab = """// GERADO por extrair.py — NAO EDITAR. Cada bloco abaixo e fatia literal de
// supabase/functions/agente-noturno/index.ts (versao patchada v4.31.0).
import { sb, L, logErro, adquirirLock, liberarLock, atenderClienteInterno } from './stubs.ts';
export { sb } from './stubs.ts';
"""

corpo = []
corpo.append('// ── helpers de frescor (literal) ──')
corpo.append(BLOCOS['helpers_frescor'].rstrip())
corpo.append(BLOCOS['carimbar'].rstrip())
corpo.append(BLOCOS['terminal_superseded'].rstrip())
corpo.append('export { inboundMaisNovoQue, maxCreatedAtDoLote, carimbarInbound, finalizarDecisaoSuperseded };')

# barreira embrulhada numa funcao: o bloco usa return, e no index.ts ele esta dentro
# de atenderClienteInterno. Os locais sao exatamente os mesmos nomes do original.
corpo.append("""
export type Barreira = { bloqueou: boolean; retorno: any };
export async function barreiraFinal(p: { dryRun: boolean; phone: string; idsParaCarimbar: any[] | null; loteCreatedAtMax: string | null; decisionId: string | null; turnId: string; executionId: string; contextoDecisao: any }): Promise<Barreira> {
  const { dryRun, phone, idsParaCarimbar, loteCreatedAtMax, decisionId, turnId, executionId, contextoDecisao } = p;
  const ownedInboundIds = (idsParaCarimbar || []).map((i: any) => String(i));
  const r = await (async () => {
""" + BLOCOS['barreira'].rstrip() + """
    return null;
  })();
  return r ? { bloqueou: true, retorno: r } : { bloqueou: false, retorno: null };
}
""")

corpo.append("""
// ── formacao do lote no webhook (literal) ──
export async function formarLoteWebhook(phone: string, inboundId: string | null): Promise<{ skip?: string; idsDoLote: any[] | null; loteCreatedAtMax: string | null }> {
  const ownedIds: string[] = [];
  let loteCreatedAtMax: string | null = null;
  if (inboundId) {
    const { data: minhaLinha } = await sb.from('inbound_fora_horario')
      .select('created_at, status').eq('id', inboundId).maybeSingle();
""" + BLOCOS['guarda_terminal'].replace('return new Response(JSON.stringify({ ok: true, skip: \'inbound_ja_terminal\', status: minhaLinha.status }), { status: 200 });', "return { skip: 'inbound_ja_terminal', idsDoLote: null, loteCreatedAtMax: null };").rstrip() + """
    if (minhaLinha?.created_at) {
      loteCreatedAtMax = String(minhaLinha.created_at);
      const maisNova = await inboundMaisNovoQue(phone, String(minhaLinha.created_at));
      if (maisNova) return { skip: 'debounce_msg_mais_nova', idsDoLote: null, loteCreatedAtMax: null };
    }
  }
  """ + BLOCOS['rajada_query'].strip() + """
  if (rajada && rajada.length > 0) {
""" + BLOCOS['rajada_owned'].rstrip() + """
  }
  """ + BLOCOS['ids_do_lote'].strip() + """
  return { idsDoLote, loteCreatedAtMax };
}
""")

corpo.append("""
// ── selecao e agrupamento do sweep (literal) ──
export async function loteDoSweep(): Promise<Array<{ phone: string; ids: any[]; loteMax: string | null }>> {
  """ + BLOCOS['sweep_query'].strip() + """
  const porPhone = new Map<string, any[]>();
  for (const r of (rows || [])) { const p = String(r.phone || '').replace(/\\D/g, ''); if (!p) continue; if (!porPhone.has(p)) porPhone.set(p, []); porPhone.get(p)!.push(r); }
  const saida: Array<{ phone: string; ids: any[]; loteMax: string | null }> = [];
  for (const [ph, lote] of porPhone) {
    const ids = lote.map((r: any) => r.id);
    """ + BLOCOS['sweep_lotemax'].strip() + """
    saida.push({ phone: ph, ids, loteMax });
  }
  return saida;
}
""")

corpo.append('// ── wrapper de lock (literal) ──')
corpo.append(BLOCOS['atender_lock'].rstrip())
corpo.append('export { atenderCliente };')

io.open(OUT, 'w', encoding='utf-8', newline='').write(cab + '\n' + '\n'.join(corpo) + '\n')
print('gerado:', OUT)
for k, v in BLOCOS.items():
    print('  bloco', k, len(v), 'bytes')
