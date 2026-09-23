export type LinkProvider =
  | 'GOOGLE_DRIVE'
  | 'CANVA'
  | 'DROPBOX'
  | 'ONEDRIVE'
  | 'WETRANSFER'
  | 'DIRECT_FILE'
  | 'WEB_PAGE'
  | 'UNKNOWN';

export type LinkKind = 'IMAGE' | 'PDF' | 'ARCHIVE' | 'DESIGN' | 'DOCUMENT' | 'WEB' | 'UNKNOWN';

export type LinkAccessStatus =
  | 'FETCH_SUCCEEDED'
  | 'FETCH_ATTEMPTED_NO_RESULT'
  | 'FETCH_FAILED'
  | 'FETCH_NOT_OBSERVED';

const RX_URL = /https?:\/\/[^\s<>"'`\]\[{}]+/gi;
const DIRECT_EXT = /\.(png|jpe?g|webp|gif|svg|pdf|zip|rar|7z|tif?f|psd|ai|eps|cdr)(?:$|[?#])/i;

function cleanTrailingPunctuation(value: string): string {
  return String(value || '').replace(/[),.;!?]+$/g, '').trim().slice(0, 2048);
}

export function normalizeHttpUrl(raw: string): string | null {
  const cleaned = cleanTrailingPunctuation(raw);
  if (!cleaned) return null;
  try {
    const u = new URL(cleaned);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function extractUrlsFromText(text: string, limit = 3): string[] {
  const out: string[] = [];
  for (const match of String(text || '').match(RX_URL) || []) {
    const normalized = normalizeHttpUrl(match);
    if (normalized && !out.includes(normalized)) out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function classifyProvider(rawUrl: string): LinkProvider {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return 'UNKNOWN';
  const u = new URL(normalized);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();

  if (host === 'drive.google.com' || host === 'docs.google.com') return 'GOOGLE_DRIVE';
  if (host === 'canva.com' || host.endsWith('.canva.com')) return 'CANVA';
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) return 'DROPBOX';
  if (host === '1drv.ms' || host === 'onedrive.live.com' || host.endsWith('.sharepoint.com')) return 'ONEDRIVE';
  if (host === 'wetransfer.com' || host.endsWith('.wetransfer.com') || host === 'we.tl') return 'WETRANSFER';
  if (DIRECT_EXT.test(path + u.search)) return 'DIRECT_FILE';
  return 'WEB_PAGE';
}

export function classifyKind(rawUrl: string): LinkKind {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return 'UNKNOWN';
  const u = new URL(normalized);
  const path = u.pathname.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|tif?f)(?:$|[?#])/.test(path + u.search)) return 'IMAGE';
  if (/\.pdf(?:$|[?#])/.test(path + u.search)) return 'PDF';
  if (/\.(zip|rar|7z)(?:$|[?#])/.test(path + u.search)) return 'ARCHIVE';
  if (classifyProvider(normalized) === 'CANVA') return 'DESIGN';
  if (/\.(psd|ai|eps|cdr)(?:$|[?#])/.test(path + u.search)) return 'DESIGN';
  if (classifyProvider(normalized) === 'GOOGLE_DRIVE') return 'DOCUMENT';
  return 'WEB';
}

export function telemetryForUrl(rawUrl: string) {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return null;
  const u = new URL(normalized);
  const provider = classifyProvider(normalized);
  const kind = classifyKind(normalized);
  const extMatch = u.pathname.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return {
    provider,
    kind,
    host: u.hostname.toLowerCase(),
    extension: extMatch?.[1] ?? null,
    has_query: u.search.length > 0,
    https: u.protocol === 'https:',
  };
}

export function inspectAnthropicWebFetchResponse(payload: any): { status: LinkAccessStatus; error_code: string | null; result_count: number } {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  let attempted = false;
  let resultCount = 0;
  let errorCode: string | null = null;

  for (const b of blocks) {
    if (b?.type === 'server_tool_use' && b?.name === 'web_fetch') attempted = true;
    if (b?.type === 'web_fetch_tool_result') {
      attempted = true;
      const c = b?.content;
      if (Array.isArray(c)) {
        resultCount += c.length;
      } else if (c && typeof c === 'object') {
        if (typeof c.error_code === 'string') errorCode = c.error_code;
        else if (typeof c?.error?.code === 'string') errorCode = c.error.code;
        else if (typeof c?.type === 'string' && c.type.includes('error') && typeof c?.message === 'string') errorCode = c.message.slice(0, 120);
      }
    }
  }

  if (errorCode) return { status: 'FETCH_FAILED', error_code: errorCode, result_count: resultCount };
  if (resultCount > 0) return { status: 'FETCH_SUCCEEDED', error_code: null, result_count: resultCount };
  if (attempted) return { status: 'FETCH_ATTEMPTED_NO_RESULT', error_code: null, result_count: 0 };
  return { status: 'FETCH_NOT_OBSERVED', error_code: null, result_count: 0 };
}
