"""Extract the KSB agricultural performance booklet into normalized JSON.

Geometry-based (PyMuPDF word coordinates) reconstruction. pdfplumber's
line-based table detection merges rows unreliably on these faint-ruled tables,
so we cluster words -> cells -> rows -> columns deterministically.

Orientations handled:
  A  flow values are column headers, head values in the body   (most borewell,
     radial, mixed, stainless CORAchrom, vertical VO/MRV with Q(m3/h))
  B  head values are column headers, discharge LPM in the body  (ULTRA+ monobloc)
  C  per-pump paired rows: an LPM row + a Head row              (Monosub R(S),
     ULTRA+ (S), MREG D+)

Every emitted operating point keeps flow_m3h/lph/lpm + head_m/ft + 1-based
position + is_approved (spec section 9) + raw source values + page/coords.

Usage:
  python extraction/scripts/import_technical_catalogue.py "source_pdfs/Selection Chart Agri.pdf"
  python extraction/scripts/import_technical_catalogue.py <pdf> --debug 5
"""
from __future__ import annotations
import json
import os
import re
import sys
import datetime as dt

import fitz  # PyMuPDF

sys.path.insert(0, os.path.dirname(__file__))
from common import (  # noqa: E402
    PARSER_VERSION, sha256_file, clean_str, parse_number, split_stage,
    approved_positions, m_to_ft, m3h_to_lph, m3h_to_lpm, lph_to_m3h,
)

Y_TOL = 3.2
GAP_MERGE = 6.0          # words within this x-gap merge into one cell
COL_TOL = 14.0           # body cell assigned to header column within this x-dist

# A table is located by its flow-header row, so this list decides whether a table
# is seen at all. Where the column is narrow the booklet wraps the unit onto two
# lines ("m3/" above "hr."), leaving the header cell as a bare "m3/" - the whole
# table was silently dropped. The wrapped forms are therefore accepted too.
FLOW_LABELS = ("m3/hr.", "m3/hr", "m³/hr.", "m³/hr", "Q(m3/h)", "Q(m³/h)", "m3/", "m³/")
LPM_LABEL = "LPM"
HEAD_HDR = "Total Head in Metres"
DISCHARGE_LPM = "Discharge in LPM"
HEAD_JUNK = ("daeH", ")m(", "Head", "(m)", "(H)")
FLOW_LABEL_WRAP_Y = 12.0  # how far below a wrapped flow label its values may sit


def get_rows(page):
    words = page.get_text("words")  # (x0,y0,x1,y1,text,block,line,word)
    rows = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        x0, y0, x1, y1, txt = w[0], w[1], w[2], w[3], w[4].strip()
        if not txt:
            continue
        yc = (y0 + y1) / 2
        placed = False
        for r in rows:
            if abs(r["yc"] - yc) <= Y_TOL:
                r["words"].append((x0, x1, txt))
                r["yc"] = (r["yc"] * r["n"] + yc) / (r["n"] + 1)
                r["n"] += 1
                placed = True
                break
        if not placed:
            rows.append({"yc": yc, "n": 1, "words": [(x0, x1, txt)]})
    rows.sort(key=lambda r: r["yc"])
    for r in rows:
        r["cells"] = merge_cells(sorted(r["words"]))
    return rows


def _is_num(s):
    return " " not in s and parse_number(s) is not None


def _is_unit(s):
    return s.endswith("hr.") or s.endswith("hr") or s in ("LPM", "Q(m3/h)", "Q(m³/h)", "Head", "(H)")


def merge_cells(words):
    """Merge adjacent words with small x-gap into cells: (x0,x1,xc,text).

    Never merge two adjacent pure numbers (keeps tightly-packed flow/head
    headers like '13.0 14.0' as separate columns) but still merges motor-type
    fragments like '0.75 / 22' and cable '1.5 / 2.5'."""
    cells = []
    for x0, x1, txt in words:
        if cells and x0 - cells[-1][1] <= GAP_MERGE:
            px0, px1, _, ptxt = cells[-1]
            tail = ptxt.split()[-1]
            block = (_is_num(tail) and _is_num(txt)) or (_is_unit(tail) and _is_num(txt))
            if not block:
                cells[-1] = (px0, x1, (px0 + x1) / 2, ptxt + " " + txt)
                continue
        cells.append((x0, x1, (x0 + x1) / 2, txt))
    return cells


def cell_text(rows_cells):
    return [c[3] for c in rows_cells]


def is_headjunk(txt):
    return any(j in txt for j in HEAD_JUNK)


def numeric_cells(cells):
    """Return [(xc, value, raw)] for cells that parse as numbers."""
    out = []
    for _, _, xc, txt in cells:
        v = parse_number(txt)
        if v is not None:
            out.append((xc, v, txt))
    return out


# ---------------------------------------------------------------------------
# Title detection: nearest descriptive line above a table's header band.
TITLE_RE = re.compile(r":\s*\d+\s*mm|Pumpset|Monobloc|Openwell|Series|Pumpset", re.IGNORECASE)


TITLE_KEYWORDS = ("Pumpset", "Monobloc", "Openwell", "Series", "Submersible", "Induction Motor")


def find_titles(rows):
    """Descriptive titles live in the left region; the right-side spec panel
    ('Power supply : ...', 'NRV Size : ...') must be excluded."""
    titles = []
    for r in rows:
        left = [c[3] for c in r["cells"] if c[0] < 600]
        line = clean_str(" ".join(left)) or ""
        if any(k in line for k in TITLE_KEYWORDS) and "Performance Booklet" not in line:
            titles.append((r["yc"], line))
    return titles


def nearest_title_above(titles, yc):
    best = None
    for ty, txt in titles:
        if ty < yc:
            if best is None or ty > best[0]:
                best = (ty, txt)
    return best[1] if best else None


# ---------------------------------------------------------------------------
def parse_orientation_A(rows, titles, page_index):
    """flow headers -> head body. Returns list of table dicts."""
    tables = []
    # locate every flow-header row
    for hi, r in enumerate(rows):
        texts = cell_text(r["cells"])
        flow_label_idx = None
        for ci, t in enumerate(r["cells"]):
            if t[3] in FLOW_LABELS:
                flow_label_idx = ci
                break
        if flow_label_idx is None:
            continue
        label_x = r["cells"][flow_label_idx][1]
        flow_cells = [c for c in r["cells"] if c[2] > label_x and parse_number(c[3]) is not None]
        # Where the unit wraps onto two lines ("m3/" over "hr.") the flow values
        # sit on their own row between the two halves, so the label row carries no
        # numbers. Borrow them from the nearest following row, which is where the
        # header actually is; without this the whole table is invisible.
        header_row = r
        if len(flow_cells) < 3:
            for rj in rows[hi + 1:]:
                if rj["yc"] - r["yc"] > FLOW_LABEL_WRAP_Y:
                    break
                cand = [c for c in rj["cells"] if c[2] > label_x and parse_number(c[3]) is not None]
                if len(cand) >= 3:
                    flow_cells, header_row = cand, rj
                    break
        if len(flow_cells) < 3:
            continue
        hi = rows.index(header_row)
        flow_cols = [(c[2], parse_number(c[3]), c[3]) for c in flow_cells]
        flow_region_left = flow_cols[0][0] - COL_TOL
        table_right = flow_cols[-1][0] + 22.0   # clip the right-side spec panel

        # data rows: subsequent rows until next flow-header / next title
        data_rows = []
        for rj in rows[hi + 1:]:
            cells = [c for c in rj["cells"] if not is_headjunk(c[3])]
            left_cells = [c for c in cells if c[2] < flow_region_left]
            left_txt = " ".join(c[3] for c in left_cells)
            if any(c[3] in FLOW_LABELS for c in rj["cells"]):
                break
            if any(k in left_txt for k in ("Pumpset", "Submersible Pumpset")):
                break  # next table's title
            body = [c for c in cells if flow_region_left <= c[2] <= table_right]
            body_nums = [c for c in body if parse_number(c[3]) is not None]
            if LPM_LABEL in left_txt.split():
                continue  # LPM header validation row
            if len(body_nums) < 2:
                continue  # side-panel / blank / footer row between data rows
            data_rows.append((rj, left_cells, body))
        if not data_rows:
            continue

        op_count = len(flow_cols)
        appr, supported = approved_positions(op_count)
        title = nearest_title_above(titles, r["yc"])
        variants = []
        for rj, meta, body in data_rows:
            heads = assign_to_columns(body, [fc[0] for fc in flow_cols])
            meta_txt = " ".join(c[3] for c in meta)
            variants.append({
                "row_yc": round(rj["yc"], 1),
                "meta_raw": clean_str(meta_txt),
                "meta_cells": [c[3] for c in meta],
                "heads_raw": heads,
            })
        tables.append({
            "orientation": "A",
            "title": title,
            "page_index": page_index,
            "operating_point_count": op_count,
            "approved_positions": appr,
            "position_supported": supported,
            "flow_headers": [{"m3h": fc[1], "raw": fc[2]} for fc in flow_cols],
            "variants": variants,
        })
    return tables


def assign_to_columns(body_cells, col_xs):
    """Map body numeric cells to nearest header column -> list aligned to cols."""
    out = [None] * len(col_xs)
    for _, _, xc, txt in body_cells:
        v = parse_number(txt)
        if v is None:
            continue
        best_i, best_d = None, 1e9
        for i, cx in enumerate(col_xs):
            d = abs(cx - xc)
            if d < best_d:
                best_d, best_i = d, i
        if best_i is not None and best_d <= COL_TOL and out[best_i] is None:
            out[best_i] = v
    return out


def parse_orientation_B(rows, titles, page_index):
    """head headers -> discharge LPM body (ULTRA+ monobloc)."""
    tables = []
    for hi, r in enumerate(rows):
        texts = cell_text(r["cells"])
        joined = " ".join(texts)
        if HEAD_HDR not in joined:
            continue
        # the head-value header row is the next row (within a few) with >=4 numbers
        head_row = None
        for rj in rows[hi + 1: hi + 8]:
            if HEAD_HDR in " ".join(cell_text(rj["cells"])):
                break
            if len(numeric_cells(rj["cells"])) >= 4:
                head_row = rj
                break
        if head_row is None:
            continue
        head_cols = numeric_cells(head_row["cells"])
        head_region_left = head_cols[0][0] - COL_TOL
        table_right = head_cols[-1][0] + 22.0
        start = rows.index(head_row) + 1
        data_rows = []
        for rj in rows[start:]:
            cells = [c for c in rj["cells"] if not is_headjunk(c[3])]
            left_cells = [c for c in cells if c[2] < head_region_left]
            left_txt = " ".join(c[3] for c in left_cells)
            if HEAD_HDR in " ".join(c[3] for c in rj["cells"]):
                break
            if any(k in left_txt for k in ("Pumpset", "Submersible Pumpset")):
                break
            if DISCHARGE_LPM in left_txt:
                continue
            body = [c for c in cells if head_region_left <= c[2] <= table_right]
            body_nums = [c for c in body if parse_number(c[3]) is not None]
            if len(body_nums) < 2:
                continue
            data_rows.append((rj, left_cells, body))
        if not data_rows:
            continue
        title = nearest_title_above(titles, r["yc"])
        variants = []
        for rj, meta, body in data_rows:
            lpms = assign_to_columns(body, [hc[0] for hc in head_cols])
            variants.append({
                "row_yc": round(rj["yc"], 1),
                "meta_raw": clean_str(" ".join(c[3] for c in meta)),
                "meta_cells": [c[3] for c in meta],
                "lpms_raw": lpms,
            })
        tables.append({
            "orientation": "B",
            "title": title,
            "page_index": page_index,
            "head_headers": [{"head_m": hc[1], "raw": hc[2]} for hc in head_cols],
            "variants": variants,
        })
    return tables


def parse_orientation_C(rows, titles, page_index):
    """per-pump paired LPM row + Head row (Monosub R(S), ULTRA+(S), MREG D+)."""
    tables = []
    i = 0
    while i < len(rows) - 1:
        t1 = cell_text(rows[i]["cells"])
        if t1 and t1[0] == LPM_LABEL:
            # this row: LPM label + lpm values; next row: Head (H) label + head values
            lpm_nums = numeric_cells(rows[i]["cells"])
            # find the head row within next 1-2 rows
            head_row = None
            for rj in rows[i + 1:i + 3]:
                tj = cell_text(rj["cells"])
                if tj and ("Head" in tj[0] or "(H)" in " ".join(tj)):
                    head_row = rj
                    break
            if head_row and lpm_nums:
                head_nums = numeric_cells(head_row["cells"])
                title = nearest_title_above(titles, rows[i]["yc"])
                pairs = list(zip(lpm_nums, head_nums))
                tables.append({
                    "orientation": "C",
                    "title": title,
                    "page_index": page_index,
                    "pairs": [{"lpm": l[1], "head_m": h[1]} for l, h in pairs],
                })
        i += 1
    return tables


def build_operating_points(table):
    """Normalize a table's variants into flat operating points."""
    ops_out = []
    if table["orientation"] == "A":
        op_count = table["operating_point_count"]
        appr = set(table["approved_positions"])
        flows = table["flow_headers"]
        for var in table["variants"]:
            row_ops = []
            for idx, fh in enumerate(flows, start=1):
                head_m = var["heads_raw"][idx - 1]
                m3h = fh["m3h"]
                row_ops.append({
                    "position": idx,
                    "is_approved": idx in appr,
                    "flow_m3h": m3h,
                    "flow_lph": m3h_to_lph(m3h),
                    "flow_lpm": m3h_to_lpm(m3h),
                    "flow_raw": fh["raw"],
                    "head_m": head_m,
                    "head_ft": m_to_ft(head_m),
                    "head_raw": None if head_m is None else str(var["heads_raw"][idx - 1]),
                    "is_missing": head_m is None,
                })
            ops_out.append({"meta_raw": var["meta_raw"], "meta_cells": var["meta_cells"],
                            "operating_points": row_ops})
    elif table["orientation"] == "B":
        heads = table["head_headers"]
        op_count = len(heads)
        appr, supported = approved_positions(op_count)
        table["operating_point_count"] = op_count
        table["approved_positions"] = appr
        table["position_supported"] = supported
        for var in table["variants"]:
            row_ops = []
            for idx, hh in enumerate(heads, start=1):
                lpm = var["lpms_raw"][idx - 1]
                m3h = None if lpm is None else round(lpm / 16.6666666667, 4)
                row_ops.append({
                    "position": idx,
                    "is_approved": idx in set(appr),
                    "flow_m3h": m3h,
                    "flow_lph": m3h_to_lph(m3h),
                    "flow_lpm": lpm,
                    "flow_raw": None if lpm is None else str(lpm),
                    "head_m": hh["head_m"],
                    "head_ft": m_to_ft(hh["head_m"]),
                    "head_raw": hh["raw"],
                    "is_missing": lpm is None,
                })
            ops_out.append({"meta_raw": var["meta_raw"], "meta_cells": var["meta_cells"],
                            "operating_points": row_ops})
    elif table["orientation"] == "C":
        pairs = table["pairs"]
        op_count = len(pairs)
        appr, supported = approved_positions(op_count)
        table["operating_point_count"] = op_count
        table["approved_positions"] = appr
        table["position_supported"] = supported
        row_ops = []
        for idx, pr in enumerate(pairs, start=1):
            m3h = round(pr["lpm"] / 16.6666666667, 4)
            row_ops.append({
                "position": idx,
                "is_approved": idx in set(appr),
                "flow_m3h": m3h,
                "flow_lph": m3h_to_lph(m3h),
                "flow_lpm": pr["lpm"],
                "flow_raw": str(pr["lpm"]),
                "head_m": pr["head_m"],
                "head_ft": m_to_ft(pr["head_m"]),
                "head_raw": str(pr["head_m"]),
                "is_missing": False,
            })
        ops_out.append({"meta_raw": None, "meta_cells": [], "operating_points": row_ops})
    return ops_out


PANEL_KEYS = {
    "power supply": "power_supply", "starting method": "starting_method",
    "cable length": "cable_length", "minimum well diameter": "min_well_diameter",
    "min well diameter": "min_well_diameter", "nrv size": "nrv_size",
    "nominal speed": "nominal_speed", "rotor": "rotor", "del. size": "del_size",
    "normal speed": "nominal_speed",
}


def extract_panels(rows):
    """Right-side 'Label : value' spec facts, as (yc, key, value)."""
    facts = []
    for r in rows:
        right = [c for c in r["cells"] if c[0] > 625]
        if not right:
            continue
        text = " ".join(c[3] for c in right)
        for m in re.finditer(r"([A-Za-z][A-Za-z .]+?)\s*:\s*([^:]+?)(?=\s+[A-Z][a-z]+\s*:|$)", text):
            key = m.group(1).strip().lower()
            if key in PANEL_KEYS:
                facts.append((r["yc"], PANEL_KEYS[key], clean_str(m.group(2))))
    return facts


def attach_panel(table, facts):
    rows_yc = [v["row_yc"] for row in table.get("parsed_rows", []) for v in [row]
               if False]  # placeholder
    ycs = [var.get("row_yc") for var in table.get("variants", []) if var.get("row_yc")]
    if not ycs:
        ycs = [table.get("page_index", 0)]
    top, bot = min(ycs), max(ycs)
    panel = {}
    for yc, key, val in facts:
        if top - 60 <= yc <= bot + 60 and key not in panel:
            panel[key] = val
    # phase/voltage from panel, falling back to the title line (monobloc /
    # openwell / vertical state 'Power supply : 415 V, 50 Hz, Three Phase' there)
    ps = (panel.get("power_supply") or "") + " " + (table.get("title") or "")
    phase = None
    if re.search(r"3\s*ph", ps, re.I) or "three phase" in ps.lower():
        phase = 3
    elif re.search(r"1\s*ph", ps, re.I) or "single phase" in ps.lower():
        phase = 1
    if phase is None:
        # motor-family convention: '(S)' motors (XUMA DX(S), UMA(S), LX PLUS(S))
        # are single-phase; UMAI / UMA H are three-phase.
        title = table.get("title") or ""
        if re.search(r"DX\s*\(S\)|UMA\s*\(S\)|LX\s*PLUS\s*\(S\)|\(S\)\s*100", title, re.I):
            phase = 1
        elif re.search(r"UMAI|UMA\s*H|UMN|HBC|HBCN|\bVO\b|MRV|MREG", title, re.I):
            phase = 3
    volt = None
    mv = re.search(r"(\d{3})\s*V", ps)
    if mv:
        volt = int(mv.group(1))
    table["panel"] = panel
    table["phase"] = phase
    table["voltage"] = volt
    table["min_well_diameter_mm"] = _num_mm(panel.get("min_well_diameter"))
    table["nrv_size_mm"] = _num_mm(panel.get("nrv_size"))
    table["nominal_speed_rpm"] = _num_mm(panel.get("nominal_speed"))
    table["rotor_material"] = panel.get("rotor")
    table["starting_method_panel"] = panel.get("starting_method")


def _num_mm(s):
    if not s:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    return float(m.group(1)) if m else None


def extract_page(page, page_index):
    rows = get_rows(page)
    titles = find_titles(rows)
    facts = extract_panels(rows)
    tables = []
    tables += parse_orientation_A(rows, titles, page_index)
    tables += parse_orientation_B(rows, titles, page_index)
    tables += parse_orientation_C(rows, titles, page_index)
    for t in tables:
        t["parsed_rows"] = build_operating_points(t)
        attach_panel(t, facts)
    return tables


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    debug = None
    if "--debug" in sys.argv:
        debug = int(sys.argv[sys.argv.index("--debug") + 1])
    path = args[0]
    doc = fitz.open(path)

    if debug is not None:
        tables = extract_page(doc[debug], debug)
        print(json.dumps(tables, indent=2, default=str))
        return

    checksum = sha256_file(path)
    all_tables = []
    for i in range(len(doc)):
        all_tables.extend(extract_page(doc[i], i))

    out_doc = {
        "document_type": "technical_catalogue",
        "file_name": os.path.basename(path),
        "checksum": checksum,
        "parser_version": PARSER_VERSION,
        "total_pages": len(doc),
        "segment": "agricultural",
        "imported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "table_count": len(all_tables),
        "tables": all_tables,
    }
    out = os.path.join("extraction", "output", "technical_catalogue.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(out_doc, f, indent=2, default=str)

    # ---- coverage summary to stderr ----
    from collections import Counter
    orient = Counter(t["orientation"] for t in all_tables)
    opc = Counter(t.get("operating_point_count") for t in all_tables)
    pages_with = len({t["page_index"] for t in all_tables})
    total_ops = sum(len(row["operating_points"]) for t in all_tables for row in t["parsed_rows"])
    total_variants = sum(len(t["parsed_rows"]) for t in all_tables)
    unsupported = sum(1 for t in all_tables if not t.get("position_supported", True))
    missing_title = sum(1 for t in all_tables if not t.get("title"))
    print(f"pages={len(doc)} pages_with_tables={pages_with} tables={len(all_tables)}", file=sys.stderr)
    print(f"orientations={dict(orient)}", file=sys.stderr)
    print(f"variants(rows)={total_variants} operating_points={total_ops}", file=sys.stderr)
    print(f"op_count_distribution={dict(sorted((k,v) for k,v in opc.items() if k))}", file=sys.stderr)
    print(f"unsupported_position_tables={unsupported} tables_missing_title={missing_title}", file=sys.stderr)
    print(f"-> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
