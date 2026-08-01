"use client";
import { useMemo, useState } from "react";
import { inr, num, hp } from "@/lib/format";
import { ResultsTable, Col } from "@/components/ResultsTable";
import { SourceViewer, SourceRef } from "@/components/SourceViewer";
import { resultsToCsv, download, stamp } from "@/lib/export";

const M_PER_FT = 0.3048;
type Tab = "valid" | "model" | "near" | "rejected" | "unpriced";

const SITE_WARNING =
  "Selection is based on catalogue performance and the entered ground-to-motor depth. Confirm actual site duty, pipe losses, borewell conditions and installation requirements before purchase or installation.";

export default function Home() {
  const [form, setForm] = useState({ flowMinLph: "30000", flowMaxLph: "40000", depthMinFt: "100", depthMaxFt: "200", nearTolerancePct: "5", ranking: "balanced" });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("valid");
  const [dark, setDark] = useState(false);
  const [source, setSource] = useState<SourceRef | null>(null);

  const conv = useMemo(() => {
    const f = (s: string) => (s === "" || isNaN(+s) ? null : +s);
    const fmin = f(form.flowMinLph), fmax = f(form.flowMaxLph), dmin = f(form.depthMinFt), dmax = f(form.depthMaxFt);
    return {
      m3h: fmin != null && fmax != null ? `${(fmin / 1000).toFixed(2)}–${(fmax / 1000).toFixed(2)} m³/hr` : "—",
      lpm: fmin != null && fmax != null ? `${(fmin / 60).toFixed(1)}–${(fmax / 60).toFixed(1)} LPM` : "—",
      head: dmin != null && dmax != null ? `${(dmin * M_PER_FT).toFixed(2)}–${(dmax * M_PER_FT).toFixed(2)} m head` : "—",
    };
  }, [form]);

  function set(k: string, v: string) { setForm((s) => ({ ...s, [k]: v })); }
  function toggleTheme() { const d = !dark; setDark(d); document.documentElement.setAttribute("data-theme", d ? "dark" : "light"); document.documentElement.classList.toggle("dark", d); }

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Search failed"); setData(null); }
      else { setData(j); setTab("valid"); }
    } catch (e: any) { setError(String(e)); }
    setLoading(false);
  }
  function sample() { setForm({ flowMinLph: "30000", flowMaxLph: "40000", depthMinFt: "100", depthMaxFt: "200", nearTolerancePct: "5", ranking: "balanced" }); }
  function reset() { setForm({ flowMinLph: "", flowMaxLph: "", depthMinFt: "", depthMaxFt: "", nearTolerancePct: "5", ranking: "balanced" }); setData(null); setError(null); }

  function openSource(r: any, focus: "technical" | "price" | null = null) {
    const opt = (r.priceOptions || []).find((o: any) => o.landingPrice != null) || (r.priceOptions || [])[0];
    setSource({
      title: `${r.pumpModel} · stage ${r.stageIdentity ?? "—"} · ${r.hp} HP`,
      techPage: r.pageIndex != null ? r.pageIndex + 1 : null,
      techFacts: [
        { label: "Flow", value: `${num(r.flowLph)} LPH` }, { label: "Head", value: `${num(r.headFt, 1)} ft` },
        { label: "Position", value: `${r.position}/${r.operatingPointCount}` }, { label: "Phase", value: String(r.phase ?? "—") },
      ],
      pricePage: opt ? opt.pageIndex + 1 : null,
      priceFacts: opt
        ? [{ label: "IN", value: opt.inCode }, { label: "Landing", value: inr(opt.landingPrice) }, { label: "Match", value: opt.mappingStatus === "EXACT_AUTO_MATCH" ? "exact" : "suggested" }]
        : [{ label: "Price", value: "no exact match" }],
      focus,
    });
  }

  const s = data?.statistics;
  const rows: any[] = data ? (tab === "valid" ? data.validResults : tab === "near" ? data.nearMatches : tab === "rejected" ? data.rejectedResults : tab === "unpriced" ? data.unpricedResults : []) : [];
  const cols = useMemo(() => buildColumns(tab, openSource), [tab]);
  const searchText = (r: any) => `${r.pumpModel} ${r.category} ${r.motorFamily} ${r.stageIdentity} ${r.matchStatus} ${(r.priceOptions || []).map((o: any) => o.inCode).join(" ")}`;

  function exportCsv() {
    const src = tab === "model" ? data.validResults : rows;
    download(`ksb-selection-${tab}-${stamp()}.csv`, resultsToCsv(src), "text/csv");
  }
  function exportJson() {
    download(`ksb-selection-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "16px 20px" }}>
      <SourceViewer src={source} onClose={() => setSource(null)} />
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>KSB Agricultural Pump Selector</h1>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Catalogue-backed pump selection by water flow and motor depth</div>
        </div>
        <div style={{ display: "flex", gap: 8 }} className="no-print">
          <a className="btn" href="/mapping">Price mapping</a>
          <a className="btn" href="/quality">Data quality</a>
          <button className="btn" onClick={toggleTheme}>{dark ? "☀︎" : "☾"}</button>
        </div>
      </header>

      <div className="card no-print" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <Field label="Min flow (LPH)"><input className="input tnum" value={form.flowMinLph} onChange={(e) => set("flowMinLph", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Max flow (LPH)"><input className="input tnum" value={form.flowMaxLph} onChange={(e) => set("flowMaxLph", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Min depth (ft)"><input className="input tnum" value={form.depthMinFt} onChange={(e) => set("depthMinFt", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Max depth (ft)"><input className="input tnum" value={form.depthMaxFt} onChange={(e) => set("depthMaxFt", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Near tolerance %"><input className="input tnum" value={form.nearTolerancePct} onChange={(e) => set("nearTolerancePct", e.target.value)} inputMode="decimal" /></Field>
          <Field label="Ranking">
            <select className="input" value={form.ranking} onChange={(e) => set("ranking", e.target.value)}>
              <option value="balanced">Balanced match</option><option value="flow">Closest flow</option><option value="head">Closest head/depth</option>
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={run} disabled={loading}>{loading ? "Searching…" : "Find all combinations"}</button>
          <button className="btn" onClick={sample}>Load sample</button>
          <button className="btn" onClick={reset}>Reset</button>
          <div className="tnum" style={{ color: "var(--muted)", fontSize: 12 }}>{conv.m3h} &nbsp;·&nbsp; {conv.lpm} &nbsp;·&nbsp; {conv.head}</div>
        </div>
        {error && <div className="badge badge-err" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {data && (
        <>
          <div className="card" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", gap: 22, flexWrap: "wrap" }}>
            <Stat label="Flow" v={`${num(data.request.flowMinLph)}–${num(data.request.flowMaxLph)} LPH`} />
            <Stat label="Required head" v={`${data.request.headMinM.toFixed(1)}–${data.request.headMaxM.toFixed(1)} m`} />
            <Stat label="Approved pts" v={num(s.approvedOperatingPointsScanned)} />
            <Stat label="Valid" v={num(s.validOperatingPoints)} accent />
            <Stat label="Models" v={num(s.uniqueTechnicalModels)} />
            <Stat label="Priced" v={num(s.pricedOperatingPoints)} />
            <Stat label="Unpriced" v={num(s.unpricedOperatingPoints)} />
            <Stat label="Near" v={num(s.nearMatches)} />
          </div>

          <div className="badge badge-warn" style={{ display: "block", marginBottom: 10, lineHeight: 1.5, whiteSpace: "normal" }}>⚠︎ {SITE_WARNING}</div>

          <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 10, justifyContent: "flex-end" }}>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={exportJson}>Export JSON</button>
            <button className="btn" onClick={() => window.print()}>Print / PDF</button>
          </div>

          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 10 }} className="no-print">
            <TabBtn t="valid" tab={tab} setTab={setTab} n={data.validResults.length}>Valid combinations</TabBtn>
            <TabBtn t="model" tab={tab} setTab={setTab} n={data.modelSummaries.length}>Model summary</TabBtn>
            <TabBtn t="near" tab={tab} setTab={setTab} n={data.nearMatches.length}>Near matches</TabBtn>
            <TabBtn t="rejected" tab={tab} setTab={setTab} n={data.rejectedResults.length}>Rejected</TabBtn>
            <TabBtn t="unpriced" tab={tab} setTab={setTab} n={data.unpricedResults.length}>Unpriced</TabBtn>
          </div>

          {tab === "model"
            ? <ModelTable rows={data.modelSummaries} openSource={openSource} />
            : <ResultsTable
                cols={cols} rows={rows}
                rowId={(r: any) => r.opId}
                searchText={searchText}
                facets={[{ key: "hp", label: "HP", get: (r: any) => r.hp }, { key: "phase", label: "Phase", get: (r: any) => r.phase }]}
                renderDetail={tab === "rejected" ? undefined : (r: any) => <Detail r={r} openSource={openSource} />}
                defaultHidden={tab === "valid" || tab === "unpriced" ? ["reason"] : []}
              />}
        </>
      )}

      {!data && !error && (
        <div style={{ color: "var(--muted)", padding: 20 }}>Enter a water-flow range and motor-depth range, then run a search. Try <button className="btn" onClick={sample} style={{ padding: "2px 8px" }}>Load sample</button>.</div>
      )}
    </div>
  );
}

// Printed page number of the price row backing this result. Options are ordered
// cheapest-landing first, so the first one is the page the operator wants.
function pricePageOf(r: any): number | null {
  const opts = r.priceOptions || [];
  const opt = opts.find((o: any) => o.landingPrice != null) || opts[0];
  return opt ? opt.pageIndex + 1 : null;
}

function buildColumns(tab: Tab, openSource: (r: any, focus?: "technical" | "price" | null) => void): Col<any>[] {
  const priceCell = (r: any) => r.priceStatus === "PRICED"
    ? <><span className="badge badge-valid">priced</span>{r.priceOptionCount > 1 && <span className="tnum" style={{ color: "var(--muted)" }}> ×{r.priceOptionCount}</span>}</>
    : <span className="badge badge-mut">{r.priceStatus === "NO_EXACT_PRICE_MATCH" ? "no price" : "—"}</span>;

  // Source page cell: shows the printed page number and opens that exact page.
  const pageCell = (page: number | null, r: any, doc: "technical" | "price") => page == null
    ? <span style={{ color: "var(--muted)" }}>—</span>
    : <button className="btn tnum" style={{ padding: "1px 7px" }} title={`View page ${page}`}
        onClick={(e) => { e.stopPropagation(); openSource(r, doc); }}>p{page}</button>;
  const cols: Col<any>[] = [
    { key: "rank", label: "#", num: true, sortable: true, hideable: false, get: (r) => r.rank ?? 1e9, cell: (r) => r.rank ?? "—" },
    { key: "match", label: "Match", sortable: true, get: (r) => r.matchStatus, cell: (r) => <span className={r.matchStatus === "VALID" ? "badge badge-valid" : r.matchStatus === "NEAR_MATCH" ? "badge badge-warn" : "badge badge-err"}>{r.matchStatus.replace(/_/g, " ").toLowerCase()}</span> },
    { key: "category", label: "Category", sortable: true, get: (r) => r.category, cell: (r) => (r.category || "").replace(/_/g, " ") },
    { key: "model", label: "Model", sortable: true, hideable: false, get: (r) => r.pumpModel, cell: (r) => <b>{r.pumpModel}</b> },
    { key: "motor", label: "Motor", sortable: true, get: (r) => r.motorFamily, cell: (r) => r.motorFamily || "—" },
    { key: "hp", label: "HP", num: true, sortable: true, get: (r) => r.hp, cell: (r) => hp(r.hp) },
    { key: "phase", label: "Ph", sortable: true, get: (r) => r.phase, cell: (r) => r.phase ?? "—" },
    { key: "stage", label: "Stage", sortable: true, get: (r) => r.stagesNumeric ?? 0, cell: (r) => r.stageIdentity ?? "—" },
    { key: "flow", label: "Flow LPH", num: true, sortable: true, get: (r) => r.flowLph, cell: (r) => num(r.flowLph) },
    { key: "head", label: "Head ft", num: true, sortable: true, get: (r) => r.headFt, cell: (r) => num(r.headFt, 1) },
    { key: "pos", label: "Pos", num: true, sortable: true, get: (r) => r.position, cell: (r) => `${r.position}/${r.operatingPointCount}` },
    { key: "reason", label: "Reason", get: (r) => r.reason || "", cell: (r) => <span style={{ whiteSpace: "normal" }}>{r.reason || "—"}</span> },
    { key: "score", label: "Score", num: true, sortable: true, get: (r) => r.balancedScore, cell: (r) => r.balancedScore },
    { key: "price", label: "Price", sortable: true, get: (r) => r.priceStatus, cell: priceCell },
    { key: "lowest", label: "Lowest landing", num: true, sortable: true, get: (r) => r.lowestLandingPrice, cell: (r) => r.priceStatus === "PRICED" ? inr(r.lowestLandingPrice) : "—" },
    { key: "chartPg", label: "Chart pg", num: true, sortable: true, get: (r) => r.pageIndex != null ? r.pageIndex + 1 : null,
      cell: (r) => pageCell(r.pageIndex != null ? r.pageIndex + 1 : null, r, "technical") },
    { key: "pricePg", label: "Price pg", num: true, sortable: true, get: (r) => pricePageOf(r),
      cell: (r) => pageCell(pricePageOf(r), r, "price") },
    { key: "src", label: "Both", hideable: false, cell: (r) => <button className="btn" style={{ padding: "1px 7px" }} title="View both pages side by side" onClick={(e) => { e.stopPropagation(); openSource(r); }}>⧉</button> },
  ];
  if (tab === "rejected") return cols.filter((c) => ["match", "category", "model", "motor", "hp", "phase", "stage", "flow", "head", "pos", "reason", "chartPg", "src"].includes(c.key));
  return cols;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block" }}><div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>{children}</label>;
}
function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div><div className="tnum" style={{ fontWeight: 600, color: accent ? "var(--accent)" : "var(--ink)" }}>{v}</div></div>;
}
function TabBtn({ t, tab, setTab, n, children }: any) {
  return <div className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>{children} <span className="badge badge-mut">{n}</span></div>;
}

function Detail({ r, openSource }: { r: any; openSource: (r: any) => void }) {
  return (
    <div style={{ padding: "12px 8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <div>
        <H>Operating point</H>
        <KV k="Position" v={`${r.position} of ${r.operatingPointCount} (approved: ${(r.approvedPositions || []).join(", ")})`} />
        <KV k="Flow" v={`${num(r.flowLph)} LPH · ${r.flowM3h} m³/hr · ${num(r.flowLpm, 1)} LPM`} />
        <KV k="Head" v={`${r.headM} m · ${num(r.headFt, 1)} ft`} />
        <KV k="Flow / head miss" v={`${r.flowMissPct}% / ${r.headMissPct}%`} />
        <KV k="Norm dist (flow/head)" v={`${r.normFlowDistance} / ${r.normHeadDistance} → score ${r.balancedScore}`} />
        <H>Physical</H>
        <KV k="Borewell / min well dia" v={`${r.borewellMm ?? "—"} mm / ${r.minWellMm ?? "—"} mm`} />
        <KV k="NRV / Cable" v={`${r.nrvSizeMm ?? "—"} mm / ${r.cableSizeMm2 ?? "—"} mm²`} />
        <KV k="Speed / Rotor" v={`${r.nominalSpeedRpm ?? "—"} rpm / ${r.rotorMaterial ?? "—"}`} />
        {r.borewellMm && <div className="badge badge-warn" style={{ marginTop: 6 }}>Confirm borewell diameter before purchase.</div>}
        <div style={{ marginTop: 8 }}><button className="btn" onClick={() => openSource(r)}>⧉ View source (side by side)</button></div>
      </div>
      <div>
        <H>Price options {r.priceOptionCount ? `(${r.priceOptionCount})` : ""}</H>
        {(!r.priceOptions || r.priceOptions.length === 0)
          ? <div className="badge badge-mut">No exact price match — technically valid, purchasable price unavailable.</div>
          : <div className="scrollx"><table>
            <thead><tr><th>IN Code</th><th>Description</th><th className="num">Landing</th><th className="num">Single</th><th className="num">Above ₹50K</th><th>Match</th><th>Src</th></tr></thead>
            <tbody>{r.priceOptions.map((o: any, i: number) => (
              <tr key={i}>
                <td className="tnum">{o.inCode}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 240 }}>{o.description}</td>
                <td className="num tnum">{inr(o.landingPrice)}</td>
                <td className="num tnum">{inr(o.singlePumpPrice)}</td>
                <td className="num tnum">{inr(o.above50kPrice)}</td>
                <td><span className={o.mappingStatus === "EXACT_AUTO_MATCH" ? "badge badge-valid" : "badge badge-warn"}>{o.mappingStatus === "EXACT_AUTO_MATCH" ? "exact" : "suggested"}</span></td>
                <td><a className="btn" style={{ padding: "1px 7px" }} href={`/api/pdf/price#page=${o.pageIndex + 1}`} target="_blank">p{o.pageIndex + 1}</a></td>
              </tr>))}</tbody>
          </table></div>}
      </div>
    </div>
  );
}

function ModelTable({ rows, openSource }: { rows: any[]; openSource: (r: any, focus?: "technical" | "price" | null) => void }) {
  // model rows aggregate many operating points; the source view opens the table
  // page and the price page for the model itself.
  const asRef = (m: any) => ({
    ...m, position: "—", operatingPointCount: "—",
    flowLph: m.flowMin * 1000, headFt: m.headMin * 3.28084,
    pageIndex: m.pageIndex, priceOptions: m.priceOptions || [],
  });
  const pageCell = (page: number | null, m: any, doc: "technical" | "price") => page == null
    ? <span style={{ color: "var(--muted)" }}>—</span>
    : <button className="btn tnum" style={{ padding: "1px 7px" }} title={`View page ${page}`}
        onClick={(e) => { e.stopPropagation(); openSource(asRef(m), doc); }}>p{page}</button>;
  const cols: Col<any>[] = [
    { key: "rank", label: "#", num: true, sortable: true, hideable: false, get: (m) => m.rank, cell: (m) => m.rank },
    { key: "category", label: "Category", sortable: true, get: (m) => m.category, cell: (m) => (m.category || "").replace(/_/g, " ") },
    { key: "model", label: "Model", sortable: true, hideable: false, get: (m) => m.pumpModel, cell: (m) => <b>{m.pumpModel}</b> },
    { key: "motor", label: "Motor", sortable: true, get: (m) => m.motorFamily, cell: (m) => m.motorFamily || "—" },
    { key: "hp", label: "HP", num: true, sortable: true, get: (m) => m.hp, cell: (m) => hp(m.hp) },
    { key: "phase", label: "Ph", sortable: true, get: (m) => m.phase, cell: (m) => m.phase ?? "—" },
    { key: "stage", label: "Stage", sortable: true, get: (m) => m.stagesNumeric ?? 0, cell: (m) => m.stageIdentity ?? "—" },
    { key: "valid", label: "Valid pts", num: true, sortable: true, get: (m) => m.validOpCount, cell: (m) => m.validOpCount },
    { key: "flow", label: "Flow m³/hr", num: true, cell: (m) => `${m.flowMin}–${m.flowMax}` },
    { key: "head", label: "Head m", num: true, cell: (m) => `${m.headMin}–${m.headMax}` },
    { key: "opts", label: "Options", num: true, sortable: true, get: (m) => m.priceOptionCount, cell: (m) => m.priceOptionCount || "—" },
    { key: "lowest", label: "Lowest landing", num: true, sortable: true, get: (m) => m.lowestLandingPrice, cell: (m) => m.priceStatus === "PRICED" ? inr(m.lowestLandingPrice) : "—" },
    { key: "chartPg", label: "Chart pg", num: true, sortable: true, get: (m) => m.pageIndex != null ? m.pageIndex + 1 : null,
      cell: (m) => pageCell(m.pageIndex != null ? m.pageIndex + 1 : null, m, "technical") },
    { key: "pricePg", label: "Price pg", num: true, sortable: true, get: (m) => pricePageOf(m),
      cell: (m) => pageCell(pricePageOf(m), m, "price") },
    { key: "src", label: "Both", hideable: false, cell: (m) => <button className="btn" style={{ padding: "1px 7px" }} title="View both pages side by side" onClick={(e) => { e.stopPropagation(); openSource(asRef(m)); }}>⧉</button> },
  ];
  return <ResultsTable cols={cols} rows={rows} rowId={(m: any) => m.variantId}
    facets={[{ key: "hp", label: "HP", get: (m: any) => m.hp }, { key: "phase", label: "Phase", get: (m: any) => m.phase }]}
    searchText={(m: any) => `${m.pumpModel} ${m.category} ${m.motorFamily} ${m.stageIdentity}`} />;
}

function H({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", margin: "10px 0 4px" }}>{children}</div>; }
function KV({ k, v }: { k: string; v: React.ReactNode }) { return <div style={{ display: "flex", gap: 8, padding: "1px 0" }}><div style={{ color: "var(--muted)", minWidth: 170 }}>{k}</div><div className="tnum">{v}</div></div>; }
