# -*- coding: utf-8 -*-
"""v4.36.0 P0 — o verbo "enviar" com o CLIENTE como remetente deixa de declarar envio."""
import io, sys, hashlib
BASE, OUT = sys.argv[1], sys.argv[2]
src = io.open(BASE, encoding='utf-8').read()
assert hashlib.sha256(src.encode('utf-8')).hexdigest() == \
    '33a4ec1287c97f20bd60b9565029f1a7152b4e1a4180a273a249052a487b7311', 'base nao e a LIVE 178'
trocas = []
def rep(a, n, r): trocas.append((a, n, r))

rep("const V = 'agente-noturno-v4.35.0';",
"""//
// v4.36.0 (27/08/2026) P0 — "ENVIAR" COM O CLIENTE COMO REMETENTE NAO E MODALIDADE.
// Rollback: redeploy do v4.35.0 (Edge 178, index.ts sha256 33a4ec1287c97f20bd60b9565029f1a
// 7152b4e1a4180a273a249052a487b7311). Sem migracao, sem estado novo.
//
// DEFEITO ENCONTRADO PELO CANARIO ORGANICO DA PROPRIA v4.35.0 — e a telemetria nova foi o
// que o tornou visivel. Lead 5511994088967 (Vitor, DDD 11, Grande SP) escreveu as 12:04:
//     "posso enviar 300 agora ? e o restante daqui a 5 dias?"
// Isso e o cliente falando de DINHEIRO: pagar 300 agora e o resto em 5 dias. RX_LOG_ENVIO
// casou o verbo "enviar" e declarou modalidade_logistica=envio no nivel 2. Com isso o
// bloqueio de Grande SP da v4.34.0 caiu, e as 23:54 o Joao escreveu:
//     "Pagamento confirmado. Qual e o seu CEP para a gente calcular o frete dos 300 adesivos?"
// — pediu CEP a um cliente da Grande SP sem nunca ter perguntado retirada ou envio. E a MESMA
// familia de defeito do caso Carolina, entrando por outra porta.
//
// A CAUSA NASCEU NA v4.34.0, nao na v4.35.0: RX_LOG_ENVIO ja era assim. Rollback NAO corrige.
//
// CORRECAO: o verbo sozinho deixa de decidir.
//   SINAL FORTE (correios, sedex, pac, transportadora, frete, postagem) -> envio, sempre.
//   VERBO de envio -> envio SO SE o cliente nao for o remetente e o objeto nao for dinheiro,
//   arquivo, arte ou comprovante. "Pode enviar?" e "voces enviam?" continuam valendo;
//   "posso enviar 300", "vou enviar o arquivo", "ja mandei o comprovante" nao valem mais.
// Nada mais muda: modalidade continua vindo antes do CEP, o fluxo de CEP canonico da v4.35.0
// fica intacto, e nenhuma regra financeira e tocada.
const V = 'agente-noturno-v4.36.0';""", "cabecalho + const V")

rep("""const RX_LOG_ENVIO = /\\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?)|correios?|sedex|pac|transportadora|frete|postagem|postar)\\b|\\bentreg(?:ar|a|ue)\\s+(?:em\\s+casa|no\\s+meu|no\\s+endere[c\\u00e7]o)\\b|\\breceber\\s+em\\s+casa\\b|\\bmandar?\\s+(?:pelo|por|via)\\b/i;""",
"""// v4.36.0: o sinal de envio passa a ter DOIS niveis, porque o verbo sozinho mentia.
// FORTE nomeia o meio de transporte — nao importa quem e o sujeito da frase.
const RX_LOG_ENVIO_FORTE = /\\b(correios?|sedex|pac|transportadora|postagem|postar|frete)\\b/i;
// VERBO e apenas candidato. Precisa passar pelos dois filtros abaixo.
const RX_LOG_ENVIO_VERBO = /\\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?))\\b|\\bmandar?\\s+(?:pelo|por|via|pra|para)\\b|\\bentreg(?:ar|a|ue)\\s+(?:em\\s+casa|no\\s+meu|no\\s+endere[c\\u00e7]o)\\b|\\breceber\\s+em\\s+casa\\b/i;
// O CLIENTE como REMETENTE. "posso enviar 300 agora", "vou mandar o comprovante", "ja enviei
// a arte" — nada disso e forma de entrega. Foi por aqui que o caso 5511994088967 entrou.
const RX_ENVIO_REMETENTE_CLIENTE = /\\b(posso|poderia|vou|irei|consigo|acabei\\s+de|estou|t[o\\u00f4]|j[a\\u00e1]|eu)\\s+(?:te\\s+|lhe\\s+|j[a\\u00e1]\\s+)?(?:envi|mand)/i;
// Objeto que nao e mercadoria: dinheiro, arquivo, arte, comprovante, numero solto.
const RX_ENVIO_OBJETO_NAO_LOGISTICO = /(?:envi|mand)\\w*\\s+(?:o\\s+|a\\s+|os\\s+|as\\s+|um\\s+|uma\\s+|meu\\s+|minha\\s+|mais\\s+)?(?:arquivo|arte|foto|imagem|print|comprovante|pix|pagamento|dinheiro|valor|dep[o\\u00f3]sito|r?\\$?\\s*\\d)/i;
// Mantido para compatibilidade de leitura: a uniao dos dois niveis, sem os filtros.
const RX_LOG_ENVIO = new RegExp(RX_LOG_ENVIO_FORTE.source + '|' + RX_LOG_ENVIO_VERBO.source, 'i');
// Decide envio numa sentenca. Negacao continua sendo tratada por termoPositivo.
function envioPositivoNaSentenca(s: string): boolean {
  if (termoPositivo(s, RX_LOG_ENVIO_FORTE)) return true;
  if (!termoPositivo(s, RX_LOG_ENVIO_VERBO)) return false;
  if (RX_ENVIO_REMETENTE_CLIENTE.test(s)) return false;
  if (RX_ENVIO_OBJETO_NAO_LOGISTICO.test(s)) return false;
  return true;
}""", "sinal de envio em dois niveis")

rep("""    if (envio === null && termoPositivo(s, RX_LOG_ENVIO)) envio = s;""",
"""    if (envio === null && envioPositivoNaSentenca(s)) envio = s;""",
"classificar usa envioPositivoNaSentenca")

out = src
for a, n, r in trocas:
    c = out.count(a)
    if c != 1:
        sys.stderr.write('FALHA ancora [%s]: %d ocorrencia(s)\n' % (r, c)); sys.exit(1)
    out = out.replace(a, n, 1)
    sys.stderr.write('ok  %s\n' % r)
io.open(OUT, 'w', encoding='utf-8').write(out)
sys.stderr.write('escrito %s (%d bytes, sha256 %s)\n' % (OUT, len(out.encode('utf-8')), hashlib.sha256(out.encode('utf-8')).hexdigest()))
