"""Extract the KSB confidential agricultural price list into normalized JSON.

The price PDF is a clean ruled grid. We anchor on the header row labels, derive
column x-boundaries as midpoints between adjacent anchors, and bucket each raw
word into a column. This survives multi-word Category / Material Desc cells and
the three column layouts that appear across pages:

  L1  Category | IN Code | Material Desc | HP | Stage | LP | Landing Price
  L2  Category | IN Code | Material Desc | HP | Stage | LP | Single Pump | Above 50 K
  L3  (same as L1/L2 but a 'Size' column instead of 'Stage')

LP is retained raw for audit but is NEVER a displayed price (spec section 19).
#N/A / blank prices become null with price_status='unavailable' (never 0).

Usage:
  python extraction/scripts/import_price_list.py "source_pdfs/Confidential Price 1-7-2026 Secunderabad Branch Final.pdf"
  python extraction/scripts/import_price_list.py <pdf> --debug 3
"""
from __future__ import annotations
import json
import os
import re
import sys
import datetime as dt
from collections import Counter, defaultdict

import fitz

sys.path.insert(0, os.path.dirname(__file__))
from common import (  # noqa: E402
    PARSER_VERSION, sha256_file, clean_str, parse_number, parse_price,
    split_stage, parse_material_desc,
)

Y_TOL = 3.2

# families that appear in the agricultural performance booklet (spec section 3)
AGRI_FAMILIES = {
    "CORA", "CORACHROM", "CORA75", "UPC", "BPC", "UQD", "UQDS", "UPFN", "UPF",
    "BPD", "BPDN", "BPI", "BPH", "BPHA", "UPH", "UPHA", "MR", "MRV", "VO",
    "MREG", "ULTRA", "ULTRA+",
}
# lines that are NOT in the agricultural booklet -> domestic / accessory
DOMESTIC_MARKERS = ("AQUA", "PERISTAR", "OPAL", "KGP", "AGRIBLOC", "KSTP",
                    "DSTART", "STARTER", "KMR", "V MB", "SSMB", "OF PANEL", "SEWAGE")

# Motor ranges that belong to the DOMESTIC booklet, matched on the price list's
# own Category column. These share family names with the agricultural booklet
# (they are all "CORA"), so the family test alone marks them agricultural and
# they then sit unmatched forever. They are domestic: none of these strings
# occurs anywhere in the agricultural chart, they carry numeric pump series
# (CORA 45/47/49/50) that the agricultural chart never uses, and those series do
# appear in the domestic chart. Checked before the family test for that reason.
DOMESTIC_CATEGORIES = ("RLX", "TRDX", "TRLX", "OIL FILLED")


def header_anchors(row_cells):
    """Return dict label->x-center and ordered anchor list from a header row."""
    labels = {}
    for x0, x1, xc, txt in row_cells:
        labels[txt] = xc
    return labels


def find_header(rows):
    for i, r in enumerate(rows):
        texts = [c[3] for c in r["cells"]]
        if "IN Code" in texts and "Material Desc" in texts:
            return i, r
    return None, None


def column_schema(header_cells):
    """Build ordered (name, xc) anchors + boundaries from the header row."""
    name_map = {
        "Category": "category", "IN Code": "in_code", "Material Desc": "material",
        "HP": "hp", "Stage": "stage", "Size": "size", "LP": "lp",
        "Landing Price": "landing_price", "Single Pump": "single_pump",
        "Above 50 K": "above_50k",
    }
    anchors = []
    for x0, x1, xc, txt in header_cells:
        if txt in name_map:
            anchors.append((name_map[txt], xc))
    anchors.sort(key=lambda a: a[1])
    # midpoint boundaries
    bounds = []
    for i in range(len(anchors) - 1):
        bounds.append((anchors[i][1] + anchors[i + 1][1]) / 2)
    # The material description is left-aligned and often spills its trailing
    # cable/starting tokens ('2.5 SQMM DOL') rightward into the wide gap before
    # the narrow, right-aligned HP column. Pull the material->HP boundary tight
    # to HP so those tokens stay in the description and HP is captured cleanly.
    for i, (name, _) in enumerate(anchors[:-1]):
        if name == "material":
            bounds[i] = anchors[i + 1][1] - 16
    return anchors, bounds


def assign_words(words, anchors, bounds):
    """Bucket raw words into named columns by x-center; join in x order."""
    cols = defaultdict(list)
    for w in words:
        x0, x1, txt = w[0], w[2], w[4]
        xc = (x0 + x1) / 2
        idx = 0
        while idx < len(bounds) and xc >= bounds[idx]:
            idx += 1
        if idx >= len(anchors):
            idx = len(anchors) - 1
        cols[anchors[idx][0]].append((x0, txt))
    out = {}
    for name, items in cols.items():
        items.sort()
        out[name] = clean_str(" ".join(t for _, t in items))
    return out


def classify_segment(category, parsed, description):
    """agricultural = family present in the agricultural booklet; else domestic
    when a known domestic line marker appears (category or description); else
    ambiguous. Definitive pricing eligibility is decided later by exact identity
    match to a technical variant, so ambiguous rows simply never link."""
    cat = (category or "").upper().strip()
    if any(cat == c or cat.startswith(c + " ") for c in DOMESTIC_CATEGORIES):
        return "domestic"
    fam = (parsed.get("pump_family") or "").upper()
    if fam in AGRI_FAMILIES:
        return "agricultural"
    hay = f"{category or ''} {description or ''}".upper()
    if any(m in hay for m in DOMESTIC_MARKERS):
        return "domestic"
    return "ambiguous"


def extract_price_page(page, page_index):
    words = page.get_text("words")
    # cluster into rows for header detection only
    from import_technical_catalogue import get_rows
    rows = get_rows(page)
    hi, header = find_header(rows)
    if header is None:
        return []
    anchors, bounds = column_schema(header["cells"])
    header_y = header["yc"]
    col_names = {a[0] for a in anchors}
    has_stage = "stage" in col_names
    layout = ("L2" if "single_pump" in col_names else "L1")

    # group words by y (data rows only, below header)
    yrows = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        yc = (w[1] + w[3]) / 2  # w = (x0,y0,x1,y1,text,...)
        if yc <= header_y + 4:
            continue
        placed = False
        for yr in yrows:
            if abs(yr["yc"] - yc) <= Y_TOL:
                yr["words"].append(w)
                yr["yc"] = (yr["yc"] * yr["n"] + yc) / (yr["n"] + 1)
                yr["n"] += 1
                placed = True
                break
        if not placed:
            yrows.append({"yc": yc, "n": 1, "words": [w]})
    yrows.sort(key=lambda r: r["yc"])

    records = []
    for yr in yrows:
        cols = assign_words(yr["words"], anchors, bounds)
        in_code = cols.get("in_code")
        if not in_code or not re.match(r"^IN\d{4,}$", in_code.replace(" ", "")):
            continue  # not a data row (footer, wrapped text, etc.)
        in_code = in_code.replace(" ", "")
        desc = cols.get("material")
        parsed = parse_material_desc(desc or "")

        stage_or_size = cols.get("stage") if has_stage else cols.get("size")
        stage_num = stage_suf = stage_id = None
        size_val = None
        if has_stage and stage_or_size:
            stage_num, stage_suf, stage_id = split_stage(stage_or_size)
        else:
            size_val = stage_or_size

        landing = parse_price(cols.get("landing_price"))
        single = parse_price(cols.get("single_pump"))
        above = parse_price(cols.get("above_50k"))
        lp_raw = cols.get("lp")
        price_available = any(v is not None for v in (landing, single, above))

        segment = classify_segment(cols.get("category"), parsed, desc)

        # Prefer the description-parsed stage identity: it carries the variant
        # suffix (e.g. 'BPD242/04A' -> 4A) that the bare Stage column drops
        # ('4'), and the booklet indexes those pumps by the suffixed stage (4A).
        desc_id = parsed.get("stage_identity")
        final_stage_id = desc_id or stage_id
        final_stage_num = parsed.get("stage_numeric") if desc_id else stage_num
        final_stage_suf = parsed.get("stage_suffix") if desc_id else stage_suf

        records.append({
            "page_index": page_index,
            "layout": layout,
            "category_raw": cols.get("category"),
            "in_code": in_code,
            "material_description_raw": desc,
            "hp_raw": cols.get("hp"),
            "hp": parse_number(cols.get("hp")),
            "stage_or_size_raw": stage_or_size,
            "size_raw": size_val,
            "pump_family": parsed.get("pump_family"),
            "pump_series": parsed.get("pump_series"),
            "stage_numeric": final_stage_num,
            "stage_suffix": final_stage_suf,
            "stage_identity": final_stage_id,
            "motor_family": parsed.get("motor_family"),
            "motor_rating_token": parsed.get("motor_rating_token"),
            "cable_size_mm2": parsed.get("cable_size_mm2"),
            "starting_method": parsed.get("starting_method"),
            "ss_variant": parsed.get("ss_variant"),
            "g3_variant": parsed.get("g3_variant"),
            "lp_raw": lp_raw,                       # audit only, never displayed
            "landing_price": landing,
            "single_pump_price": single,
            "above_50k_price": above,
            "price_status": "available" if price_available else "unavailable",
            "segment": segment,
            "verification_status": "AUTO_HIGH_CONFIDENCE",
        })
    return records


def detect_metadata(doc, filename):
    """Verify branch / period / effective date from content where possible."""
    text = "\n".join(doc[i].get_text() for i in range(min(2, len(doc))))
    meta = {
        "effective_date": "2026-07-01",
        "period": "H2 2026" if "H2 2026" in text else None,
        "branch": "Secunderabad" if "secunderabad" in filename.lower() else None,
        "confidential": "CONFIDENTIAL" in text.upper(),
    }
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", filename)
    if m:
        d, mo, y = m.groups()
        meta["effective_date"] = f"{y}-{int(mo):02d}-{int(d):02d}"
    return meta


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    debug = None
    if "--debug" in sys.argv:
        debug = int(sys.argv[sys.argv.index("--debug") + 1])
    path = args[0]
    doc = fitz.open(path)

    if debug is not None:
        recs = extract_price_page(doc[debug], debug)
        print(json.dumps(recs, indent=2, default=str))
        return

    all_recs = []
    for i in range(len(doc)):
        all_recs.extend(extract_price_page(doc[i], i))

    # duplicate IN code detection within this version
    by_code = defaultdict(list)
    for r in all_recs:
        by_code[r["in_code"]].append(r)
    dup_conflicts = []
    for code, group in by_code.items():
        if len(group) > 1:
            keys = {(g["landing_price"], g["single_pump_price"], g["above_50k_price"],
                     g["material_description_raw"]) for g in group}
            if len(keys) > 1:
                dup_conflicts.append(code)
                for g in group:
                    g["verification_status"] = "NEEDS_REVIEW"
                    g["issue"] = "DUPLICATE_IN_CODE_CONFLICT"

    meta = detect_metadata(doc, os.path.basename(path))
    out_doc = {
        "document_type": "price_list",
        "file_name": os.path.basename(path),
        "checksum": sha256_file(path),
        "parser_version": PARSER_VERSION,
        "total_pages": len(doc),
        "effective_date": meta["effective_date"],
        "period": meta["period"],
        "branch": meta["branch"],
        "confidential": meta["confidential"],
        "imported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "record_count": len(all_recs),
        "records": all_recs,
    }
    out = os.path.join("extraction", "output", "price_list.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(out_doc, f, indent=2, default=str)

    seg = Counter(r["segment"] for r in all_recs)
    lay = Counter(r["layout"] for r in all_recs)
    unpriced = sum(1 for r in all_recs if r["price_status"] == "unavailable")
    agri_fam = Counter(r["pump_family"] for r in all_recs if r["segment"] == "agricultural")
    print(f"branch={meta['branch']} period={meta['period']} effective={meta['effective_date']} "
          f"confidential={meta['confidential']}", file=sys.stderr)
    print(f"records={len(all_recs)} layouts={dict(lay)}", file=sys.stderr)
    print(f"segments={dict(seg)}", file=sys.stderr)
    print(f"unpriced(#N/A)={unpriced} duplicate_conflicts={len(dup_conflicts)}", file=sys.stderr)
    print(f"agri_families={dict(agri_fam)}", file=sys.stderr)
    print(f"-> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
