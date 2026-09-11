export type PreflightFileSummary = {
  name: string;
  copies: number;
  status: string;
  verified: boolean;
  widthCm: number | null;
  heightCm: number | null;
  metersPerCopy: number | null;
  metersTotal: number | null;
  backgroundStatus: string;
  resolutionStatus: string;
  readyForQuote: boolean;
  readyForPrint: boolean;
  nextAction: string | null;
  reason: string | null;
};

export type PreflightContextSummary = {
  files: PreflightFileSummary[];
  allAnalyzed: boolean;
  allQuoteReady: boolean;
  allPrintReady: boolean;
  totalPhysicalMeters: number | null;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function summarizePreflightRows(rows: any[]): PreflightContextSummary {
  const files: PreflightFileSummary[] = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    for (const file of Array.isArray(row?.arquivos) ? row.arquivos : []) {
      const a = file?.analise && typeof file.analise === 'object' ? file.analise : {};
      const copies = positiveInt(a.copies ?? file?.quantidade, 1);
      const metersPerCopy = num(a.meters_raw_per_copy);
      files.push({
        name: String(file?.nome_original || file?.nome || 'arquivo').slice(0, 180),
        copies,
        status: String(a.status || 'SEM_LAUDO').slice(0, 80),
        verified: a.verified === true,
        widthCm: num(a.width_cm),
        heightCm: num(a.height_cm),
        metersPerCopy,
        metersTotal: metersPerCopy == null ? null : round(metersPerCopy * copies),
        backgroundStatus: String(a.background_status || 'UNKNOWN').slice(0, 100),
        resolutionStatus: String(a.resolution_status || 'UNKNOWN').slice(0, 140),
        readyForQuote: a.ready_for_quote === true,
        readyForPrint: a.ready_for_print === true,
        nextAction: a.next_action ? String(a.next_action).slice(0, 120) : null,
        reason: a.reason ? String(a.reason).slice(0, 200) : null,
      });
    }
  }

  const allAnalyzed = files.length > 0 && files.every((f) => f.status === 'ANALYZED' && f.verified);
  const allQuoteReady = files.length > 0 && files.every((f) => f.readyForQuote && f.metersTotal != null);
  const allPrintReady = files.length > 0 && files.every((f) => f.readyForPrint);
  const totalPhysicalMeters = allQuoteReady
    ? round(files.reduce((sum, f) => sum + Number(f.metersTotal || 0), 0))
    : null;

  return { files, allAnalyzed, allQuoteReady, allPrintReady, totalPhysicalMeters };
}

export function renderPreflightContext(summary: PreflightContextSummary): string {
  if (!summary.files.length) return '';
  const lines = summary.files.map((f, index) => {
    const dims = f.widthCm != null && f.heightCm != null ? `${f.widthCm}x${f.heightCm}cm` : 'dimensao_nao_provada';
    const meters = f.metersTotal != null ? `${f.metersTotal}m_fisicos_total` : 'metragem_nao_provada';
    return `${index + 1}. ${f.name} | copias=${f.copies} | status=${f.status} | ${dims} | ${meters} | fundo=${f.backgroundStatus} | resolucao=${f.resolutionStatus} | quote_ready=${f.readyForQuote} | print_ready=${f.readyForPrint}${f.reason ? ` | motivo=${f.reason}` : ''}`;
  });

  const total = summary.totalPhysicalMeters == null ? 'NAO_PROVADO' : `${summary.totalPhysicalMeters}m`;
  return `\n[DTF_FILE_PREFLIGHT_CANONICO]\n${lines.join('\n')}\nmetragem_fisica_total=${total}\nREGRAS: este bloco e evidencia tecnica da pre-impressao. Nao invente medidas, DPI, fundo ou metragem ausentes. Se quote_ready=true, nao pergunte tamanho de cada arte: use a medida do arquivo e suas copias. Se print_ready=false, explique a pendencia tecnica antes de afirmar que esta pronto para imprimir. O preco e arredondamento faturavel continuam pertencendo ao motor de precificacao, nao a este bloco.\n[/DTF_FILE_PREFLIGHT_CANONICO]\n`;
}
