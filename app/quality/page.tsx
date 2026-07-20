import { db, sqlite, schema } from "@/db/client";
import { sql, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function count(q: string, ...args: any[]): number {
  return (sqlite.prepare(q).get(...args) as any).n as number;
}

export default function QualityPage() {
  const docs = db.select().from(schema.sourceDocuments).all();
  const parserVersion = docs[0]?.parserVersion ?? "—";

  const stats = {
    "Source documents": count("SELECT COUNT(*) n FROM source_documents"),
    "Performance tables": count("SELECT COUNT(*) n FROM performance_tables"),
    "Tables auto-verified": count("SELECT COUNT(*) n FROM performance_tables WHERE verification_status='AUTO_HIGH_CONFIDENCE'"),
    "Tables needing review": count("SELECT COUNT(*) n FROM performance_tables WHERE verification_status='NEEDS_REVIEW'"),
    "Unsupported position-count tables (>15)": count("SELECT COUNT(*) n FROM performance_tables WHERE position_supported=0"),
    "Motor/pump variants": count("SELECT COUNT(*) n FROM motor_pump_variants"),
    "Operating points": count("SELECT COUNT(*) n FROM operating_points"),
    "Missing operating-point values (dash/blank)": count("SELECT COUNT(*) n FROM operating_points WHERE is_missing=1"),
    "Price records (all segments)": count("SELECT COUNT(*) n FROM price_records"),
    "Agricultural price records": count("SELECT COUNT(*) n FROM price_records WHERE segment='agricultural'"),
    "Domestic price records": count("SELECT COUNT(*) n FROM price_records WHERE segment='domestic'"),
    "Ambiguous price records": count("SELECT COUNT(*) n FROM price_records WHERE segment='ambiguous'"),
    "Price rows with #N/A (unavailable)": count("SELECT COUNT(*) n FROM price_records WHERE price_status='unavailable'"),
    "Duplicate IN-code conflicts": count("SELECT COUNT(*) n FROM price_records WHERE issue='DUPLICATE_IN_CODE_CONFLICT'"),
    "Exact price mappings": count("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='EXACT_AUTO_MATCH'"),
    "Suggested (related-series) mappings": count("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='SUGGESTED_RELATED_SERIES'"),
    "Manually approved mappings": count("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='MANUALLY_APPROVED'"),
    "Manually rejected mappings": count("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='MANUALLY_REJECTED'"),
    "Unresolved suggested (need review)": count("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='SUGGESTED_RELATED_SERIES' AND manually_reviewed=0"),
    "Variants with ≥1 price option": count("SELECT COUNT(DISTINCT motor_pump_variant_id) n FROM technical_price_mappings WHERE mapping_status!='MANUALLY_REJECTED'"),
  };

  const unsupported = sqlite.prepare(
    "SELECT title, page_index, operating_point_count FROM performance_tables WHERE position_supported=0 ORDER BY page_index"
  ).all() as any[];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div><h1 style={{ fontSize: 18, fontWeight: 700 }}>Data quality</h1>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Parser {parserVersion} · extraction & mapping health. Source prices cannot be edited here (spec §43).</div>
        </div>
        <a className="btn" href="/">← Selector</a>
      </div>

      <div className="card" style={{ padding: 4, marginBottom: 14 }}>
        <table>
          <tbody>
            {Object.entries(stats).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="num tnum" style={{ fontWeight: 600 }}>{v.toLocaleString("en-IN")}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 13, fontWeight: 700, margin: "6px 0" }}>Sources</h2>
      <div className="card" style={{ padding: 4, marginBottom: 14 }}>
        <table><thead><tr><th>Type</th><th>File</th><th>Branch</th><th>Period</th><th>Confidential</th><th className="num">Pages</th><th>Checksum</th></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}><td>{d.documentType}</td><td>{d.fileName}</td><td>{d.branch ?? "—"}</td><td>{d.period ?? "—"}</td><td>{d.confidential ? "yes" : "—"}</td><td className="num tnum">{d.totalPages}</td><td className="tnum" style={{ color: "var(--muted)" }}>{d.checksum?.slice(0, 12)}…</td></tr>
          ))}</tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 13, fontWeight: 700, margin: "6px 0" }}>Unsupported operating-point tables (excluded from recommendations)</h2>
      <div className="card scrollx">
        <table><thead><tr><th className="num">Page</th><th>Title</th><th className="num">Op count</th></tr></thead>
          <tbody>{unsupported.map((u, i) => (
            <tr key={i}><td className="num tnum">{u.page_index + 1}</td><td>{u.title}</td><td className="num tnum">{u.operating_point_count}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
