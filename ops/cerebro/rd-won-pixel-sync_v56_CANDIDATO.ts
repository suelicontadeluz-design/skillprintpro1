// rd-won-pixel-sync v56 (R33) — resolucao de lead por telefone do deal_nome, fail-closed.
//
// MOTIVO: a v55 resolvia lead por lead_identificadores.deal_rdstation_id / contact_rdstation_id.
// Essas chaves NAO sao unicas: 29 deal_ids e 37 contact_ids apontam para mais de um lead
// (82 leads afetados). O `for (const cid ...) { ...; if (leadId) break; }` escolhia o primeiro
// que aparecesse. Resultado medido: 41 vendas (R$12.919,45) ligadas ao cliente errado, sendo
// 28 num unico lead que recebeu negocios de 12 clientes distintos.
// Taxa de erro medida: v55 (lead_identificadores) 11,9% | webhook (telefone) 0,17%.
//
// MUDANCA: o lead passa a ser resolvido pelo telefone que o proprio RD grava em deal.name
// ("Nome | Telefone"), normalizado para DDD + 8 ultimos digitos. Se a chave apontar para
// exatamente 1 lead -> RESOLVE. Se apontar para 2+ -> AMBIGUO e NAO insere. Se nao houver
// telefone ou nenhum lead -> SEM_LEAD e NAO insere.
//
// Simulacao retrospectiva sobre 1.195 deals won com nome:
//   RESOLVE 1.138 (95,2%) | AMBIGUO 21 (1,8%) | SEM_LEAD 36 (3,0%)
//   dos 41 casos hoje errados: 37 passam a resolver CERTO, 4 viram SEM_LEAD, 0 mantem o erro.
// Cobertura NAO piora: a v55 resolvia 278 por deal_id; a v56 resolve 1.138.
//
// O telefone e EVIDENCIA do evento, nunca identidade permanente: nenhum merge e feito aqui.
// Rollback: version 55 (ops/cerebro/rd-won-pixel-sync_v55_ROLLBACK.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PIPELINE_VENDAS = "63191f7dd02b2e000cb1805b";

function log(step: string, status: string, detail: any = {}) {
  console.log(JSON.stringify({ fn: "rd-won-pixel-sync", v: "v56", step, status, ...detail }));
}

// v56: DDD + 8 ultimos digitos. Tolera 55 na frente e ausencia do nono digito.
function chaveTelefone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  const sem55 = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  if (sem55.length < 10) return null;
  return sem55.slice(0, 2) + sem55.slice(-8);
}

// v56: o telefone que o RD grava no nome do deal, no formato "Nome | Telefone".
function telefoneDoDealNome(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const partes = nome.split("|");
  return chaveTelefone(partes[partes.length - 1]);
}

// v56: leads_marketing.ph e 100% digitos (15.999/16.000). Estas sao as 4 formas
// em que a mesma linha telefonica aparece na base.
function variantesDaChave(ch: string): string[] {
  const ddd = ch.slice(0, 2), ult8 = ch.slice(2);
  return [`55${ddd}9${ult8}`, `55${ddd}${ult8}`, `${ddd}9${ult8}`, `${ddd}${ult8}`];
}

async function getRDToken(): Promise<string> {
  const { data } = await supabase.from("token_crm").select("token").limit(1).single();
  return data?.token ?? "";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const dryRun = url.searchParams.get("dry") === "1";

  const rdToken = await getRDToken();

  const rdRes = await fetch(
    `https://api.rd.services/crm/v2/deals?filter=status:won,pipeline_id:${PIPELINE_VENDAS}&page[number]=${page}&page[size]=100&sort=-closed_at`,
    { headers: { "accept": "application/json", "Authorization": `Bearer ${rdToken}` } }
  );
  const rdData = await rdRes.json();
  const deals: any[] = rdData?.data ?? [];
  const total = rdData?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / 100);

  log("rd", "fetched", { page, totalPages, total, count: deals.length });

  // v56: quatro estados explicitos. ambiguo e sem_lead NAO inserem.
  let novos = 0, ja_existia = 0, sem_lead = 0, ambiguo = 0;
  const resultado: any[] = [];
  const naoResolvidos: any[] = [];

  const dealIds = deals.map((d: any) => d.id);

  const { data: existingPixels } = await supabase
    .from("pixel_events")
    .select("event_id")
    .in("event_id", dealIds.map((id: string) => `rd_won_${id}`));
  const existingSet = new Set((existingPixels ?? []).map((p: any) => p.event_id));

  // v56: uma unica busca por telefone substitui as duas buscas em lead_identificadores.
  const chavesDeal = new Map<string, string>(); // dealId -> chave
  const todasVariantes = new Set<string>();
  for (const deal of deals) {
    const ch = telefoneDoDealNome(deal.name);
    if (!ch) continue;
    chavesDeal.set(deal.id, ch);
    for (const v of variantesDaChave(ch)) todasVariantes.add(v);
  }

  // chave -> lista de lead_id. Se a lista tiver 2+, o deal e AMBIGUO.
  const leadsPorChave = new Map<string, string[]>();
  const variantes = [...todasVariantes];
  for (let i = 0; i < variantes.length; i += 200) {
    const lote = variantes.slice(i, i + 200);
    const { data, error } = await supabase
      .from("leads_marketing").select("lead_id, ph").in("ph", lote);
    if (error) { log("leads_lookup", "error", { error: error.message }); continue; }
    for (const l of data ?? []) {
      const ch = chaveTelefone(l.ph);
      if (!ch) continue;
      const atual = leadsPorChave.get(ch) ?? [];
      if (!atual.includes(l.lead_id)) atual.push(l.lead_id);
      leadsPorChave.set(ch, atual);
    }
  }

  const pixelInserts: any[] = [];

  for (const deal of deals) {
    const dealId = deal.id;
    const eventId = `rd_won_${dealId}`;

    if (existingSet.has(eventId)) { ja_existia++; continue; }

    const closedAt = deal.closed_at ? new Date(deal.closed_at) : new Date();
    const value = parseFloat(deal.amount ?? deal.total_price ?? "0") || 0;

    // v56: RESOLVIDO | AMBIGUO | SEM_LEAD. Nunca escolha arbitraria.
    const ch = chavesDeal.get(dealId) ?? null;
    const candidatos = ch ? (leadsPorChave.get(ch) ?? []) : [];

    if (candidatos.length > 1) {
      ambiguo++;
      naoResolvidos.push({ dealId, motivo: "ambiguo", chave: ch, candidatos: candidatos.length });
      log("resolver", "ambiguo", { dealId, chave: ch, candidatos: candidatos.length });
      continue;
    }
    if (candidatos.length === 0) {
      sem_lead++;
      naoResolvidos.push({ dealId, motivo: ch ? "sem_lead" : "sem_telefone_no_nome", chave: ch });
      log("resolver", "sem_lead", { dealId, chave: ch, temTelefone: !!ch });
      continue;
    }

    const leadId = candidatos[0];

    if (!dryRun) {
      // event_time = closed_at (data real da venda). Sem CAPI — Purchase nao vai para o Meta.
      pixelInserts.push({
        lead_id: leadId,
        event_name: "Purchase",
        event_time: closedAt.toISOString(),
        event_id: eventId,
        event_source: "chat",
        value: value || null,
        currency: "BRL",
      });
    }

    novos++;
    resultado.push({ dealId, leadId, value, evidencia: "telefone_deal_nome", closedAt: closedAt.toISOString() });
  }

  if (!dryRun && pixelInserts.length > 0) {
    const { error } = await supabase.from("pixel_events").insert(pixelInserts);
    if (error) log("pixel_insert", "error", { error: error.message });
    else log("pixel_insert", "enviado", { count: pixelInserts.length });
  }

  log("sync", "done", { page, totalPages, novos, ja_existia, ambiguo, sem_lead, dryRun });

  return new Response(JSON.stringify({
    ok: true, page, totalPages, total,
    novos, ja_existia, ambiguo, sem_lead, dryRun,
    resultado: dryRun ? resultado : resultado.slice(0, 10),
    naoResolvidos: naoResolvidos.slice(0, 20),
  }), { headers: { "Content-Type": "application/json" } });
});
