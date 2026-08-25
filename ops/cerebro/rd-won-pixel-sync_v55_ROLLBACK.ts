// ROLLBACK R33 — rd-won-pixel-sync version 55
// ezbr_sha256 baseline = c5ac90062392131aba204c4b9fd5cf55a991b5746a7c741f55b5158191c31295
// verify_jwt = false
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PIPELINE_VENDAS = "63191f7dd02b2e000cb1805b";

function log(step: string, status: string, detail: any = {}) {
  console.log(JSON.stringify({ step, status, ...detail }));
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

  let novos = 0, ja_existia = 0, sem_lead = 0;
  const resultado: any[] = [];

  const dealIds = deals.map((d: any) => d.id);
  const allContactIds = deals.flatMap((d: any) => d.contact_ids ?? []);

  const { data: existingPixels } = await supabase
    .from("pixel_events")
    .select("event_id")
    .in("event_id", dealIds.map((id: string) => `rd_won_${id}`));
  const existingSet = new Set((existingPixels ?? []).map((p: any) => p.event_id));

  const { data: liByDeal } = await supabase
    .from("lead_identificadores")
    .select("lead_id, deal_rdstation_id")
    .in("deal_rdstation_id", dealIds);
  const liByDealMap = new Map((liByDeal ?? []).map((r: any) => [r.deal_rdstation_id, r.lead_id]));

  const { data: liByContact } = await supabase
    .from("lead_identificadores")
    .select("lead_id, contact_rdstation_id")
    .in("contact_rdstation_id", allContactIds);
  const liByContactMap = new Map((liByContact ?? []).map((r: any) => [r.contact_rdstation_id, r.lead_id]));

  const allLeadIds = [...new Set([...liByDealMap.values(), ...liByContactMap.values()])];
  const { data: leadsData } = await supabase
    .from("leads_marketing")
    .select("lead_id, ph, em")
    .in("lead_id", allLeadIds);
  const leadsMap = new Map((leadsData ?? []).map((l: any) => [l.lead_id, l]));

  const pixelInserts: any[] = [];

  for (const deal of deals) {
    const dealId = deal.id;
    const eventId = `rd_won_${dealId}`;

    if (existingSet.has(eventId)) { ja_existia++; continue; }

    const closedAt = deal.closed_at ? new Date(deal.closed_at) : new Date();
    const value = parseFloat(deal.amount ?? deal.total_price ?? "0") || 0;
    const contactIds: string[] = deal.contact_ids ?? [];

    let leadId = liByDealMap.get(dealId) ?? null;
    if (!leadId && contactIds.length > 0) {
      for (const cid of contactIds) {
        leadId = liByContactMap.get(cid) ?? null;
        if (leadId) break;
      }
    }

    if (!leadId) { sem_lead++; continue; }

    if (!dryRun) {
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
    resultado.push({ dealId, leadId, value, closedAt: closedAt.toISOString() });
  }

  if (!dryRun && pixelInserts.length > 0) {
    const { error } = await supabase.from("pixel_events").insert(pixelInserts);
    if (error) log("pixel_insert", "error", { error: error.message });
    else log("pixel_insert", "ok", { count: pixelInserts.length });
  }

  log("sync", "done", { page, totalPages, novos, ja_existia, sem_lead, dryRun });

  return new Response(JSON.stringify({
    ok: true, page, totalPages, total,
    novos, ja_existia, sem_lead, dryRun,
    resultado: dryRun ? resultado : resultado.slice(0, 10),
  }), { headers: { "Content-Type": "application/json" } });
});
