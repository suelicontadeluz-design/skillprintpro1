const V='joao-erp-sale-sync/v5-retired-to-multi-v3';
Deno.serve(async (req:Request)=>{
  if(req.method!=='POST') return new Response(JSON.stringify({ok:false,error:'method_not_allowed',version:V}),{status:405,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({ok:true,active:false,retired:true,owner:'joao-erp-sale-sync-multi/v3-client-registration',processed:0,synced:0,held:0,errors:0,version:V}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
});
