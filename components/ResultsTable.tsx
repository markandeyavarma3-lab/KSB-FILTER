"use client";
import { useMemo, useRef, useState } from "react";

export interface Col<T> {
  key: string;
  label: string;
  num?: boolean;
  sortable?: boolean;
  hideable?: boolean;
  get?: (r: T) => string | number | null;   // sort/search value
  cell: (r: T) => React.ReactNode;
}

export interface Facet<T> { key: string; label: string; get: (r: T) => string | number | null }

export function ResultsTable<T>({ cols, rows, rowId, renderDetail, searchText, defaultHidden = [], facets = [] }: {
  cols: Col<T>[];
  rows: T[];
  rowId: (r: T) => number | string;
  renderDetail?: (r: T) => React.ReactNode;
  searchText?: (r: T) => string;
  defaultHidden?: string[];
  facets?: Facet<T>[];
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [dense, setDense] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set(defaultHidden));
  const [menuOpen, setMenuOpen] = useState(false);
  const [facetOpen, setFacetOpen] = useState<string | null>(null);
  const [facetSel, setFacetSel] = useState<Record<string, Set<string>>>({});
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());

  // distinct values per facet (numeric-aware sort)
  const facetValues = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of facets) {
      const set = new Set<string>();
      for (const r of rows) { const v = f.get(r); if (v != null && v !== "") set.add(String(v)); }
      out[f.key] = [...set].sort((a, b) => (isFinite(+a) && isFinite(+b) ? +a - +b : a.localeCompare(b)));
    }
    return out;
  }, [rows, facets]);

  const filtered = useMemo(() => {
    let r = rows;
    for (const f of facets) {
      const sel = facetSel[f.key];
      if (sel && sel.size) r = r.filter((x) => sel.has(String(f.get(x) ?? "")));
    }
    if (query.trim() && searchText) {
      const q = query.toLowerCase();
      r = r.filter((x) => searchText(x).toLowerCase().includes(q));
    }
    if (sortKey) {
      const col = cols.find((c) => c.key === sortKey);
      if (col?.get) {
        r = [...r].sort((a, b) => {
          const av = col.get!(a), bv = col.get!(b);
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
          return String(av).localeCompare(String(bv)) * sortDir;
        });
      }
    }
    return r;
  }, [rows, query, sortKey, sortDir, cols, searchText, facets, facetSel]);

  const total = filtered.length;
  const start = page * pageSize;
  const pageRows = pageSize >= 1e9 ? filtered : filtered.slice(start, start + pageSize);
  const visCols = cols.filter((c) => !hidden.has(c.key));

  function clickSort(c: Col<T>) {
    if (!c.sortable) return;
    if (sortKey === c.key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(c.key); setSortDir(1); }
  }
  function toggleExpand(id: string | number) {
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        {searchText && <input className="input" style={{ width: 220 }} placeholder="Filter results…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />}
        {facets.map((f) => {
          const sel = facetSel[f.key] ?? new Set<string>();
          return (
            <div key={f.key} style={{ position: "relative" }}>
              <button className={`btn ${sel.size ? "btn-primary" : ""}`} onClick={() => setFacetOpen((o) => (o === f.key ? null : f.key))}>
                {f.label}{sel.size ? ` (${sel.size})` : ""} ▾
              </button>
              {facetOpen === f.key && (
                <div className="menu" onMouseLeave={() => setFacetOpen(null)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingBottom: 4, borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>{f.label}</span>
                    <button className="btn" style={{ padding: "0 6px" }} onClick={() => { setFacetSel((s) => ({ ...s, [f.key]: new Set() })); setPage(0); }}>clear</button>
                  </div>
                  {(facetValues[f.key] || []).map((v) => (
                    <label key={v} style={{ display: "flex", gap: 6, padding: "2px 4px", whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={sel.has(v)} onChange={() => {
                        setFacetSel((s) => { const n = new Set(s[f.key] ?? []); n.has(v) ? n.delete(v) : n.add(v); return { ...s, [f.key]: n }; });
                        setPage(0);
                      }} />
                      <span className="tnum">{v}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => setMenuOpen((v) => !v)}>Columns ▾</button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              {cols.filter((c) => c.hideable !== false).map((c) => (
                <label key={c.key} style={{ display: "flex", gap: 6, padding: "2px 4px", whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <label style={{ display: "flex", gap: 5, alignItems: "center", color: "var(--muted)" }}>
          <input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} /> dense
        </label>
        <select className="input" style={{ width: 110 }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
          <option value={25}>25 / page</option><option value={50}>50 / page</option>
          <option value={100}>100 / page</option><option value={1e9}>All</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", color: "var(--muted)" }}>
          <span className="tnum">{total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} of {total}</span>
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
          <button className="btn" disabled={start + pageSize >= total} onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      </div>

      <div className={`card scrollx ${dense ? "dense" : ""}`}>
        <table>
          <thead><tr>
            {renderDetail && <th style={{ width: 22 }}></th>}
            {visCols.map((c) => (
              <th key={c.key} className={`${c.num ? "num" : ""} ${c.sortable ? "sortable" : ""}`} onClick={() => clickSort(c)}>
                {c.label}{sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={visCols.length + 1} style={{ padding: 16, color: "var(--muted)" }}>No rows.</td></tr>}
            {pageRows.map((r) => {
              const id = rowId(r);
              const open = expanded.has(id);
              return (
                <FragmentRow key={id} id={id} open={open}>
                  <tr onClick={renderDetail ? () => toggleExpand(id) : undefined} style={renderDetail ? { cursor: "pointer" } : undefined}>
                    {renderDetail && <td>{open ? "▾" : "▸"}</td>}
                    {visCols.map((c) => <td key={c.key} className={c.num ? "num tnum" : ""}>{c.cell(r)}</td>)}
                  </tr>
                  {renderDetail && open && <tr><td></td><td colSpan={visCols.length} style={{ padding: 0 }}>{renderDetail(r)}</td></tr>}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { id: any; open: boolean; children: React.ReactNode }) {
  return <>{children}</>;
}
