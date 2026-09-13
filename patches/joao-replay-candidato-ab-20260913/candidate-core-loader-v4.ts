import ts from 'npm:typescript@5.9.2';
import { createClient as preloadCreateClient } from 'https://esm.sh/@supabase/supabase-js@2';
(globalThis as any).__candidate_createClient = preloadCreateClient;
const RAW = 'https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/3f4505438ac63dc33b8aab5c3f5e3f4d171cfbc0/patches/joao-slot-proveniencia-escrita/candidato/index.ts';
const API = 'https://api.github.com/repos/suelicontadeluz-design/skillprintpro1/contents/patches/joao-slot-proveniencia-escrita/candidato/index.ts?ref=3f4505438ac63dc33b8aab5c3f5e3f4d171cfbc0';
const transport: typeof fetch = ((globalThis as any).__candidate_original_fetch ?? globalThis.fetch).bind(globalThis);
let s = ''; const r = await transport(RAW,{cache:'no-store'}); if(r.ok)s=await r.text();else{const api=await transport(API,{headers:{'Accept':'application/vnd.github.raw+json','User-Agent':'skillprint-replay-candidate'},cache:'no-store'});if(!api.ok)throw new Error(`candidate_core_fetch_failed:raw=${r.status},api=${api.status}`);s=await api.text();}
if(!s.includes("const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;"))throw new Error('candidate_core_shape_invalid');
function replaceOnce(label:string,before:string,after:string){const n=s.split(before).length-1;if(n!==1)throw new Error(`candidate_patch_anchor_${label}_count:${n}`);s=s.replace(before,after);}
replaceOnce('supabase_import',"import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';","const createClient = (globalThis as any).__candidate_createClient;");
replaceOnce('short_content_guard',"function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length >= 2 || /^\\d$/.test(t); }","function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length > 0; }");
replaceOnce('promotion_block',`const produtoMacroAnteriorResolvido = normalizarProdutoMacro(slotsAnteriores.produto);
const produtoMacroMensagemResolvido = normalizarProdutoMacro(prodMsg);
const produtoMacroOrigemResolvido = normalizarProdutoMacro(prodOrigem);
const produtoDeterministico = produtoMacroMensagemResolvido
  || (!produtoMacroAnteriorResolvido ? produtoMacroOrigemResolvido : null);
const produtoDeterministicoFonte = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (!produtoMacroAnteriorResolvido && produtoMacroOrigemResolvido ? 'anuncio' : null);`,`const produtoAnteriorBruto = String(slotsAnteriores.produto || '').trim();
const produtoMacroAnteriorResolvido = normalizarProdutoMacro(slotsAnteriores.produto);
const produtoMacroMensagemResolvido = normalizarProdutoMacro(prodMsg);
const produtoMacroOrigemResolvido = normalizarProdutoMacro(prodOrigem);
let produtoMacroAquisicaoResolvido: string | null = null;
let produtoAquisicaoDetalhe: string | null = null;
if (!produtoAnteriorBruto && leadId) {
  try {
    const { data: lmMeta } = await sb.from('leads_marketing').select('product_type,utm_campaign_name,utm_content,utm_ad_name').eq('lead_id', leadId).limit(1).maybeSingle();
    const fontesAquisicao = [
      ['product_type', String(lmMeta?.product_type || '')],
      ['utm_campaign_name', String(lmMeta?.utm_campaign_name || '')],
      ['utm_content', String(lmMeta?.utm_content || '')],
      ['utm_ad_name', String(lmMeta?.utm_ad_name || '')],
    ] as Array<[string,string]>;
    for (const [detalhe, valor] of fontesAquisicao) {
      const p = normalizarProdutoMacro(categoriaParaProduto(valor));
      if (p) { produtoMacroAquisicaoResolvido = p; produtoAquisicaoDetalhe = detalhe; break; }
    }
  } catch {}
}
const produtoDeterministico = produtoMacroMensagemResolvido
  || (!produtoAnteriorBruto ? (produtoMacroAquisicaoResolvido || produtoMacroOrigemResolvido) : null);
const produtoDeterministicoFonte = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (!produtoAnteriorBruto && produtoDeterministico ? 'anuncio' : null);
const produtoDeterministicoFonteDetalhe = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (produtoMacroAquisicaoResolvido && produtoDeterministico === produtoMacroAquisicaoResolvido
      ? produtoAquisicaoDetalhe
      : (produtoDeterministicoFonte === 'anuncio' ? 'origem_anuncio' : null));`);
replaceOnce('filter_macro',"    macroCanonico: normalizarProdutoMacro(prodOrigem),","    macroCanonico: produtoMacroAquisicaoResolvido || normalizarProdutoMacro(prodOrigem),");
replaceOnce('persist_source_insert',`  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {`,`  const produtoMacroNovoPersistido = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
  const produtoFontePersistida = produtoMacroNovoPersistido && produtoMacroNovoPersistido !== produtoMacroAnteriorResolvido && slotsRecebidos.produto !== undefined
    ? (produtoDeterministico && produtoMacroNovoPersistido === produtoDeterministico ? produtoDeterministicoFonte : 'modelo')
    : null;
  const produtoFonteDetalhePersistida = produtoFontePersistida
    ? (produtoFontePersistida === produtoDeterministicoFonte ? produtoDeterministicoFonteDetalhe : 'modelo_slot')
    : null;
  if (produtoFontePersistida) {
    slotsNovos._produto_fonte = produtoFontePersistida;
    slotsNovos._produto_fonte_detalhe = produtoFonteDetalhePersistida;
  } else if (produtoMacroNovoPersistido !== produtoMacroAnteriorResolvido) {
    delete slotsNovos._produto_fonte;
    delete slotsNovos._produto_fonte_detalhe;
  }
  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {`);
replaceOnce('observer_source_reuse',`  const prodMacroObs = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
  // Proveniencia observavel sem schema novo: grava somente quando um produto
  // canonico novo/mudado foi efetivamente aceito e persistido.
  const produtoFontePersistida = prodMacroObs
    && prodMacroObs !== produtoMacroAnteriorResolvido
    && slotsRecebidos.produto !== undefined
      ? (produtoDeterministico && prodMacroObs === produtoDeterministico
          ? produtoDeterministicoFonte
          : 'modelo_slot')
      : null;`,`  const prodMacroObs = produtoMacroNovoPersistido;
  // Proveniencia ja foi resolvida deterministicamente acima e persistida no mesmo JSONB.`);
if(/^\s*import\s/m.test(s))throw new Error('candidate_unresolved_import_after_patch');
const js=ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true},reportDiagnostics:true});
const erros=(js.diagnostics||[]).filter((d)=>d.category===ts.DiagnosticCategory.Error);if(erros.length)throw new Error('candidate_transpile_errors:'+erros.map((d)=>d.code).join(','));
await import(`data:application/javascript;charset=utf-8,${encodeURIComponent(js.outputText)}`);
