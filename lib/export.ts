// Client-side exports (spec §45). LP is never emitted. Each operating point is
// expanded into one row per price option (unpriced -> a single row with blanks).
const CSV_COLS = [
  "rank", "match", "category", "pump_model", "motor_family", "hp", "phase",
  "stage", "flow_lph", "flow_m3h", "head_ft", "head_m", "position", "op_count",
  "balanced_score", "price_status", "in_code", "price_description",
  "landing_price", "single_pump_price", "above_50k_price", "mapping_status",
  "technical_page", "price_page",
];

function esc(v: any): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultsToCsv(rows: any[]): string {
  const out: string[] = [CSV_COLS.join(",")];
  for (const r of rows) {
    const base = [
      r.rank ?? "", r.matchStatus, r.category, r.pumpModel, r.motorFamily, r.hp,
      r.phase, r.stageIdentity, r.flowLph, r.flowM3h, r.headFt, r.headM,
      r.position, r.operatingPointCount, r.balancedScore, r.priceStatus,
    ];
    const opts = r.priceOptions && r.priceOptions.length ? r.priceOptions : [null];
    for (const o of opts) {
      const line = [
        ...base,
        o?.inCode ?? "", o?.description ?? "", o?.landingPrice ?? "",
        o?.singlePumpPrice ?? "", o?.above50kPrice ?? "", o?.mappingStatus ?? "",
        r.pageIndex != null ? r.pageIndex + 1 : "", o?.pageIndex != null ? o.pageIndex + 1 : "",
      ];
      out.push(line.map(esc).join(","));
    }
  }
  return out.join("\n");
}

export function download(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}
