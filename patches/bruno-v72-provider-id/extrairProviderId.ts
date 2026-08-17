// Função pura extraída para ser testável fora do Deno/Edge Runtime.
// Destino: agente-conversacao (Bruno), inserida logo acima de `async function enviar(`.
//
// CONTRATO DELIBERADO — leia antes de mexer:
//  1. NUNCA lança. Qualquer entrada devolve um objeto válido.
//  2. NUNCA decide se o envio foi aceito. Quem decide isso é `estado`, que vem do
//     http_status e não passa por aqui. Extração de id é PURAMENTE ADITIVA.
//  3. Quando não encontra id, NÃO inventa: devolve id=null e registra as chaves que
//     realmente vieram, para que a próxima rodada seja baseada em amostra real.
//
// POR QUE A LISTA DE CANDIDATOS E NÃO UM CAMPO FIXO: a documentação pública do
// BotConversa está inacessível deste ambiente (egress bloqueado) e não existe nenhuma
// amostra do corpo de resposta persistida no banco — o campo `corpo` é lido na v72 mas
// nunca gravado. Fixar um nome de campo agora seria adivinhação apresentada como fato.
// Esta função tenta os formatos plausíveis e, no pior caso, ENTREGA O DIAGNÓSTICO
// necessário para fechar o campo certo com evidência na rodada seguinte.

export type ProviderIdExtraido = {
  id: string | null;
  origem: string | null;      // caminho de onde o id saiu, ex.: "data.id"
  chaves: string[];           // chaves de topo observadas, para diagnóstico
  forma: 'objeto' | 'array' | 'escalar' | 'vazio' | 'nao_json';
};

const CAMINHOS_CANDIDATOS = [
  'id',
  'message_id',
  'messageId',
  'msg_id',
  'uuid',
  'data.id',
  'data.message_id',
  'data.uuid',
  'result.id',
  'result.message_id',
  'message.id',
];

function buscarCaminho(raiz: unknown, caminho: string): unknown {
  let atual: unknown = raiz;
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

// Aceita string ou número como id. Rejeita boolean, objeto, array, null, vazio
// e a string "null"/"undefined", que alguns provedores serializam por engano.
function normalizarId(valor: unknown): string | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (!limpo || limpo === 'null' || limpo === 'undefined') return null;
  return limpo.slice(0, 200);
}

export function extrairProviderId(corpo: string | null | undefined): ProviderIdExtraido {
  const vazio: ProviderIdExtraido = { id: null, origem: null, chaves: [], forma: 'vazio' };
  if (corpo == null) return vazio;
  const bruto = corpo.trim();
  if (!bruto) return vazio;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    return { id: null, origem: null, chaves: [], forma: 'nao_json' };
  }

  if (parsed === null) return vazio;

  if (typeof parsed !== 'object') {
    // Alguns endpoints devolvem só o id cru, com ou sem aspas.
    const id = normalizarId(parsed);
    return { id, origem: id ? 'raiz_escalar' : null, chaves: [], forma: 'escalar' };
  }

  const ehArray = Array.isArray(parsed);
  // Em resposta de lista, o elemento relevante é o primeiro.
  const alvo = ehArray ? (parsed as unknown[])[0] : parsed;
  const chaves =
    alvo !== null && typeof alvo === 'object' && !Array.isArray(alvo)
      ? Object.keys(alvo as Record<string, unknown>).slice(0, 20)
      : [];

  for (const caminho of CAMINHOS_CANDIDATOS) {
    const id = normalizarId(buscarCaminho(alvo, caminho));
    if (id) return { id, origem: caminho, chaves, forma: ehArray ? 'array' : 'objeto' };
  }

  return { id: null, origem: null, chaves, forma: ehArray ? 'array' : 'objeto' };
}
