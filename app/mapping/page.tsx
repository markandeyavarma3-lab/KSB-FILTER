"use client";
import { useEffect, useState } from "react";
import { inr } from "@/lib/format";

type Filter = "all" | "EXACT_AUTO_MATCH" | "SUGGESTED_RELATED_SERIES" | "MANUALLY_APPROVED" | "MANUALLY_REJECTED";

export default function MappingReview() {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>("SUGGESTED_RELATED_SERIES");
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    const j = await (await fetch("/api/mapping")).json();
    setRows(j.mappings);
  }
  useEffect(() => { load(); }, []);

  async function decide(id: number, decision: string) {
    setBusy(id);
    await fetch("/api/mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }) });
    await load(); setBusy(null);
  }

  const counts: Record<string, number> = {};
  rows.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div><h1 style={{ fontSize: 18, fontWeight: 700 }}>Price mapping review</h1>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Exact matches auto-approve. Related-series (e.g. UQD↔UQDs) and suffix differences require review. Decisions persist across re-import.</div>
        </div>
        <a className="btn" href="/">← Selector</a>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {(["all", "SUGGESTED_RELATED_SERIES", "EXACT_AUTO_MATCH", "MANUALLY_APPROVED", "MANUALLY_REJECTED"] as Filter[]).map((f) => (
          <button key={f} className={`btn ${filter === f ? "btn-primary" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f.replace(/_/g, " ").toLowerCase()} <span className="badge badge-mut">{f === "all" ? rows.length : counts[f] || 0}</span>
          </button>
        ))}
      </div>

      <div className="card scrollx">
        <table>
          <thead><tr>
            <th>Status</th><th>Technical identity</th><th className="num">HP</th><th>Ph</th><th>Key</th>
            <th>Price IN code</th><th>Description</th><th className="num">Landing</th><th>Differs</th>
            <th>Src (T/P)</th><th>Action</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={11} style={{ padding: 16, color: "var(--muted)" }}>Nothing in this filter.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id}>
                <td><span className={r.status.includes("REJECT") ? "badge badge-err" : r.status.includes("SUGGEST") ? "badge badge-warn" : "badge badge-valid"}>{r.status.replace(/_/g, " ").toLowerCase()}</span></td>
                <td style={{ fontWeight: 600 }}>{r.vFamily} {r.vSeries} · st {r.vStage}</td>
                <td className="num tnum">{r.vHp}</td>
                <td className="tnum">{r.vPhase}</td>
                <td className="tnum" style={{ color: "var(--muted)" }}>{r.vKey}</td>
                <td className="tnum">{r.inCode}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 240 }}>{r.desc}</td>
                <td className="num tnum">{inr(r.landing)}</td>
                <td className="tnum" style={{ color: "var(--muted)" }}>{r.pFamily !== r.vFamily ? `${r.vFamily}→${r.pFamily}` : "—"}</td>
                <td>
                  <a className="btn" style={{ padding: "1px 6px" }} href={`/api/pdf/technical#page=${(r.vPage ?? 0) + 1}`} target="_blank">T{(r.vPage ?? 0) + 1}</a>{" "}
                  <a className="btn" style={{ padding: "1px 6px" }} href={`/api/pdf/price#page=${(r.pPage ?? 0) + 1}`} target="_blank">P{(r.pPage ?? 0) + 1}</a>
                </td>
                <td style={{ display: "flex", gap: 4 }}>
                  <button className="btn" disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>✓</button>
                  <button className="btn" disabled={busy === r.id} onClick={() => decide(r.id, "reject")}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
