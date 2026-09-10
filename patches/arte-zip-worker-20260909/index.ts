import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

// arte-zip-worker v1 — 09/09/2026
// Especialização do pipeline existente de arte_uploads para ZIP.
// Não cria memória/tabela paralela. Materializa itens seguros no MESMO arte_uploads.
// Sem qualquer envio ao cliente e sem autoridade comercial.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "artes-clientes";
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_ENTRIES = 100;
const MAX_UNCOMPRESSED_TOTAL = 120 * 1024 * 1024;
const MAX_SINGLE_FILE = 30 * 1024 * 1024;
const MAX_NAMES_IN_DESCRIPTION = 20;

const ART_EXT = new Set([
  "png","jpg","jpeg","webp","tif","tiff","svg","pdf","psd","ai","eps","cdr","cdt","cdrx"
]);
const NESTED_ARCHIVE_EXT = new Set(["zip","rar","7z"]);

function log(step: string, status: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ worker: "arte-zip-worker", version: "v1", step, status, ...detail }));
}
function extOf(name: string): string {
  const clean = String(name || "").split("?")[0].toLowerCase();
  const i = clean.lastIndexOf(".");
  return i >= 0 ? clean.slice(i + 1) : "";
}
function baseName(name: string): string {
  const n = String(name || "").replace(/\\/g, "/");
  return n.split("/").filter(Boolean).pop() || "arquivo";
}
function suspiciousPath(name: string): boolean {
  const n = String(name || "").replace(/\\/g, "/");
  return n.startsWith("/") || /^[a-z]:\//i.test(n) || n.split("/").some(p => p === "..");
}
function ignoredSystemFile(name: string): boolean {
  const n = String(name || "").replace(/\\/g, "/");
  const b = baseName(n).toLowerCase();
  return n.includes("/__MACOSX/") || n.startsWith("__MACOSX/") || b === ".ds_store" || b === "thumbs.db";
}
function safeFileName(name: string): string {
  return baseName(name).normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "arquivo";
}
function mimeFor(ext: string): string {
  const m: Record<string,string> = {
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", tif:"image/tiff", tiff:"image/tiff",
    svg:"image/svg+xml", pdf:"application/pdf", psd:"image/vnd.adobe.photoshop", ai:"application/postscript",
    eps:"application/postscript", cdr:"application/cdr", cdt:"application/cdr", cdrx:"application/cdr"
  };
  return m[ext] || "application/octet-stream";
}
function imageDimensions(bytes: Uint8Array, ext: string): any | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let w = 0, h = 0;
    if (ext === "png" && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      w = v.getUint32(16, false); h = v.getUint32(20, false);
    } else if ((ext === "jpg" || ext === "jpeg") && bytes.length > 10) {
      for (let i=0; i<Math.min(bytes.length-9, 65536); i++) {
        if (bytes[i] === 0xff && (bytes[i+1] === 0xc0 || bytes[i+1] === 0xc2)) {
          h = v.getUint16(i+5, false); w = v.getUint16(i+7, false); break;
        }
      }
    }
    if (!(w > 0 && h > 0)) return null;
    return { fonte:"zip_image_header", largura_px:w, altura_px:h };
  } catch { return null; }
}
function pdfDimensions(bytes: Uint8Array): any | null {
  try {
    const limit = Math.min(bytes.length, 131072);
    let s = "";
    for (let i=0; i<limit; i++) s += String.fromCharCode(bytes[i]);
    const m = s.match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
    if (!m) return null;
    const d1 = Math.abs(parseFloat(m[3])-parseFloat(m[1]));
    const d2 = Math.abs(parseFloat(m[4])-parseFloat(m[2]));
    const ptToCm = 2.54/72;
    return { fonte:"zip_pdf_metadata", largura_cm:Math.round(Math.min(d1,d2)*ptToCm*10)/10, altura_cm:Math.round(Math.max(d1,d2)*ptToCm*10)/10 };
  } catch { return null; }
}
function originalZipName(row: any, url: string): string {
  const d = String(row?.descricao || "");
  const m1 = d.match(/Arquivo enviado via WhatsApp:\s*([^|]+\.zip)/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = d.match(/\|\s*Arquivo:\s*([^|]+\.zip)/i);
  if (m2?.[1]) return m2[1].trim();
  return decodeURIComponent(baseName(url)).slice(0,200);
}
function cleanDescription(d: string): string {
  return String(d || "").replace(/\s*\|\s*ZIP_VALIDADO:[\s\S]*$/i, "").trim();
}
function advertisedUncompressedSize(entry: any): number | null {
  const n = Number(entry?._data?.uncompressedSize ?? entry?._data?.uncompressedSize64 ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status:405 });
  let body:any = {};
  try { body = await req.json(); } catch { return Response.json({error:"invalid_json"},{status:400}); }
  const id = String(body?.arte_upload_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({error:"arte_upload_id_required"},{status:400});

  const { data: row, error } = await sb.from("arte_uploads")
    .select("id,lead_id,phone,descricao,file_urls_origem,files_progress,storage_sync_status,arquivos,arquivo_mime_type,arquivo_tamanho_bytes")
    .eq("id", id).maybeSingle();
  if (error || !row) return Response.json({error:error?.message || "not_found"},{status:404});

  const urls:string[] = Array.isArray(row.file_urls_origem) ? row.file_urls_origem : [];
  const url = String(urls[0] || "");
  const mime = String(row.arquivo_mime_type || "").toLowerCase();
  const zipName = originalZipName(row, url);
  const isZip = extOf(zipName) === "zip" || extOf(url) === "zip" || mime.includes("zip");
  if (!isZip) return Response.json({ok:true,skipped:"not_zip"});
  if (!url) return Response.json({ok:false,error:"zip_url_missing"},{status:422});
  if (row.storage_sync_status === "done" && Array.isArray(row.arquivos) && row.arquivos.length > 0 && body?.force !== true) {
    return Response.json({ok:true,skipped:"already_materialized",total:row.arquivos.length});
  }

  await sb.from("arte_uploads").update({ storage_sync_status:"processing", storage_last_error:null }).eq("id",id);

  try {
    let advertised = Number(row.arquivo_tamanho_bytes || 0);
    if (!(advertised > 0)) {
      try {
        const h = await fetch(url,{method:"HEAD",signal:AbortSignal.timeout(5000)});
        advertised = Number(h.headers.get("content-length") || 0);
      } catch {}
    }
    if (advertised > MAX_ZIP_BYTES) throw new Error(`ZIP_TOO_LARGE:${advertised}`);

    const r = await fetch(url,{signal:AbortSignal.timeout(20000)});
    if (!r.ok) throw new Error(`ZIP_DOWNLOAD_HTTP_${r.status}`);
    const ab = await r.arrayBuffer();
    if (ab.byteLength <= 0) throw new Error("ZIP_EMPTY_DOWNLOAD");
    if (ab.byteLength > MAX_ZIP_BYTES) throw new Error(`ZIP_TOO_LARGE:${ab.byteLength}`);

    let zip:any;
    try { zip = await JSZip.loadAsync(ab,{checkCRC32:true}); }
    catch (e:any) { throw new Error(`ZIP_INVALID_OR_ENCRYPTED:${String(e?.message||e).slice(0,120)}`); }

    const allEntries:any[] = Object.values(zip.files || {}).filter((e:any)=>!e?.dir);
    if (allEntries.length === 0) throw new Error("ZIP_NO_FILES");
    if (allEntries.length > MAX_ENTRIES) throw new Error(`ZIP_TOO_MANY_ENTRIES:${allEntries.length}`);

    let advertisedTotal = 0;
    for (const e of allEntries) {
      if (suspiciousPath(e.name)) throw new Error("ZIP_PATH_TRAVERSAL_BLOCKED");
      const s = advertisedUncompressedSize(e);
      if (s !== null) {
        if (s > MAX_SINGLE_FILE) throw new Error(`ZIP_ENTRY_TOO_LARGE:${baseName(e.name)}`);
        advertisedTotal += s;
        if (advertisedTotal > MAX_UNCOMPRESSED_TOTAL) throw new Error(`ZIP_UNCOMPRESSED_TOO_LARGE:${advertisedTotal}`);
      }
    }

    const progress:any[]=[];
    const arquivos:any[]=[];
    let realTotal=0;
    let accepted=0;
    let skipped=0;
    const names:string[]=[];

    for (let i=0; i<allEntries.length; i++) {
      const e:any = allEntries[i];
      const originalName = String(e.name || "");
      if (ignoredSystemFile(originalName)) { progress.push({nome:originalName,status:"ignored_system"}); skipped++; continue; }
      const ext = extOf(originalName);
      if (NESTED_ARCHIVE_EXT.has(ext)) { progress.push({nome:originalName,status:"skipped_nested_archive",extensao:ext}); skipped++; continue; }
      if (!ART_EXT.has(ext)) { progress.push({nome:originalName,status:"skipped_unsupported",extensao:ext}); skipped++; continue; }

      const bytes:Uint8Array = await e.async("uint8array");
      if (bytes.byteLength > MAX_SINGLE_FILE) throw new Error(`ZIP_ENTRY_TOO_LARGE:${baseName(originalName)}`);
      realTotal += bytes.byteLength;
      if (realTotal > MAX_UNCOMPRESSED_TOTAL) throw new Error(`ZIP_UNCOMPRESSED_TOO_LARGE:${realTotal}`);

      const safe = safeFileName(originalName);
      const path = `${row.lead_id || "sem_lead"}/${id}/zip/${String(i+1).padStart(3,"0")}_${safe}`;
      const contentType = mimeFor(ext);
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert:true });
      if (upErr) { progress.push({nome:baseName(originalName),status:"error",erro:String(upErr.message).slice(0,160)}); continue; }
      const { data:signed } = await sb.storage.from(BUCKET).createSignedUrl(path,60*60*24*30);
      const dim = ext === "pdf" ? pdfDimensions(bytes) : imageDimensions(bytes,ext);
      const item:any = {
        nome:baseName(originalName), path, url:signed?.signedUrl ?? null, url_origem:url,
        origem_zip:zipName, mime_type:contentType, tamanho_bytes:bytes.byteLength,
      };
      if (dim) item.dimensoes=dim;
      arquivos.push(item);
      progress.push({nome:baseName(originalName),path,status:"done",mime_type:contentType,tamanho_bytes:bytes.byteLength,dimensoes:dim || null});
      names.push(baseName(originalName));
      accepted++;
    }

    if (accepted === 0) throw new Error("ZIP_NO_SUPPORTED_ARTWORK_FILES");
    const summaryNames = names.slice(0,MAX_NAMES_IN_DESCRIPTION).join(", ");
    const more = names.length > MAX_NAMES_IN_DESCRIPTION ? ` (+${names.length-MAX_NAMES_IN_DESCRIPTION})` : "";
    const description = `${cleanDescription(row.descricao)} | ZIP_VALIDADO: ${accepted} arquivo(s) de arte; itens=${summaryNames}${more}; ignorados=${skipped}`.slice(0,4000);

    const { error:updateErr } = await sb.from("arte_uploads").update({
      descricao:description,
      arquivos,
      total_arquivos:accepted,
      files_progress:progress,
      arquivo_tamanho_bytes:ab.byteLength,
      arquivo_mime_type:"application/zip",
      is_dtf:true,
      motivo_rejeicao:null,
      storage_sync_status:"done",
      storage_synced_at:new Date().toISOString(),
      storage_sync_attempts:1,
      storage_last_error: skipped > 0 ? `${skipped} item(ns) ignorado(s)/não suportado(s) no ZIP` : null,
    }).eq("id",id);
    if (updateErr) throw new Error(`DB_UPDATE_FAILED:${updateErr.message}`);

    log("finalize","done",{id,zip:zipName,entries:allEntries.length,accepted,skipped,compressed_bytes:ab.byteLength,uncompressed_bytes:realTotal});
    return Response.json({ok:true,status:"done",zip:zipName,entries:allEntries.length,accepted,skipped,files:names});
  } catch (e:any) {
    const msg=String(e?.message||e).slice(0,500);
    await sb.from("arte_uploads").update({
      storage_sync_status:"rejeitado", storage_last_error:msg, storage_sync_attempts:1,
      is_dtf:false, motivo_rejeicao:`Falha ao inspecionar ZIP: ${msg}`.slice(0,500),
    }).eq("id",id);
    log("finalize","rejected",{id,error:msg});
    return Response.json({ok:false,status:"rejeitado",error:msg},{status:422});
  }
});
