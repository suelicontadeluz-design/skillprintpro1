declare const Deno:any;
const FCO_VERSION='joao-freight-checkout-output/v1';
const fcoBaseFetch=globalThis.fetch.bind(globalThis);
function fcoUrl(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url}
function fcoMoney(v:any){return Number(v).toFixed(2).replace('.',',')}
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const res=await fcoBaseFetch(input,init);
  if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(fcoUrl(input)))return res;
  if(!res.ok||!res.headers.get('x-cortex-freight-checkout'))return res;
  let payload:any;try{payload=await res.clone().json()}catch{return res}
  const block=Array.isArray(payload?.content)?payload.content.find((x:any)=>x?.type==='text'):null;
  if(!block?.text)return res;
  let decision:any;try{decision=JSON.parse(block.text)}catch{return res}
  const slots=decision?.slots??{};
  const service=String(slots?.frete_servico_escolhido??'').trim();
  const freight=Number(slots?.frete_valor_escolhido);
  const totalOp=String(slots?.pedido_total_operation_id??'');
  if(!service||!(freight>0)||!/^[0-9a-f-]{36}$/i.test(totalOp)||slots?.payment_id)return res;
  const old=String(decision?.mensagem??'');
  const totalMatch=old.match(/total(?:\s+do\s+pedido)?(?:\s+fica)?[^R$]{0,25}R\$\s*([0-9]+[.,][0-9]{2})/i);
  const total=totalMatch?Number(totalMatch[1].replace(',','.')):null;
  if(!(Number(total)>0))return res;
  const asksPix=String(decision?.tema??'')==='fechamento_pix'||slots?.pagamento==='pix';
  decision.mensagem=asksPix
    ?`Fechado! Frete ${service}: R$ ${fcoMoney(freight)}. Total do pedido: *R$ ${fcoMoney(total)}*. Posso gerar o Pix copia e cola nesse valor?`
    :`Fechado! Frete ${service}: R$ ${fcoMoney(freight)}. Total do pedido: *R$ ${fcoMoney(total)}*. Você prefere Pix ou cartão?`;
  block.text=JSON.stringify(decision);
  const headers=new Headers(res.headers);headers.set('x-cortex-freight-checkout-output',FCO_VERSION);headers.delete('content-length');
  return new Response(JSON.stringify(payload),{status:res.status,statusText:res.statusText,headers});
};
