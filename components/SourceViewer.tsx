"use client";
// Side-by-side source viewer (spec section 42). Opens the exact technical-chart
// page and the exact price-list page. Extracted row facts are shown above each
// pane; opening the exact page is mandatory, pixel highlighting is best-effort.
export interface SourceRef {
  title: string;
  techPage: number | null;      // 1-based
  techFacts: { label: string; value: string }[];
  pricePage: number | null;     // 1-based
  priceFacts: { label: string; value: string }[];
}

export function SourceViewer({ src, onClose }: { src: SourceRef | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 700 }}>{src.title}</div>
          <button className="btn" onClick={onClose}>Close ✕</button>
        </div>
        <div className="iframe-wrap">
          <Pane heading="Technical chart" doc="technical" page={src.techPage} facts={src.techFacts} />
          <Pane heading="Price list" doc="price" page={src.pricePage} facts={src.priceFacts} />
        </div>
      </div>
    </div>
  );
}

function Pane({ heading, doc, page, facts }: { heading: string; doc: string; page: number | null; facts: { label: string; value: string }[] }) {
  return (
    <div>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", fontWeight: 700 }}>
          {heading}{page ? ` · page ${page}` : ""}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 4 }}>
          {facts.map((f, i) => (
            <span key={i} className="tnum" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>{f.label}:</span> {f.value}
            </span>
          ))}
        </div>
      </div>
      {page
        ? <iframe src={`/api/pdf/${doc}#page=${page}&view=FitH`} title={`${heading} page ${page}`} />
        : <div style={{ padding: 20, color: "var(--muted)" }}>No source page for this side.</div>}
    </div>
  );
}
