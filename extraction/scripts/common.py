"""Shared helpers for KSB extraction pipeline (Phase 1).

Deterministic parsing utilities: no network, no guessing of numeric values.
"""
from __future__ import annotations
import hashlib
import re
from typing import Optional

PARSER_VERSION = "0.1.0"

NA_TOKENS = {"", "-", "--", "—", "n/a", "na", "#n/a", "#na", "nil", "none"}

# --- approved middle operating-point positions (spec section 9) --------------
# 1-based indexing, counted left->right including a zero-flow point if present.
ALLOWED_OPERATING_POINT_POSITIONS = {
    1: [1],
    2: [1, 2],
    3: [1, 2, 3],
    4: [2, 3],
    5: [3, 4],
    6: [3, 4],
    7: [3, 4, 5],
    8: [4, 5, 6],
    9: [4, 5, 6],
    10: [4, 5, 6, 7],
    11: [5, 6, 7],
    12: [5, 6, 7, 8],
    13: [6, 7, 8, 9],
    14: [6, 7, 8, 9],
    15: [7, 8, 9, 10],
}


def approved_positions(op_count: int):
    """Return (positions_list, is_supported)."""
    if op_count in ALLOWED_OPERATING_POINT_POSITIONS:
        return ALLOWED_OPERATING_POINT_POSITIONS[op_count], True
    return [], False


FT_PER_M = 3.280839895
M_PER_FT = 0.3048


def m_to_ft(m):
    return None if m is None else round(m * FT_PER_M, 2)


def lph_to_m3h(lph):
    return None if lph is None else lph / 1000.0


def m3h_to_lph(m3h):
    return None if m3h is None else m3h * 1000.0


def m3h_to_lpm(m3h):
    return None if m3h is None else m3h * 16.6666666667


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def clean_str(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = s.replace("\n", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return s or None


def is_na(s: Optional[str]) -> bool:
    if s is None:
        return True
    return s.strip().lower() in NA_TOKENS


def parse_number(s: Optional[str]) -> Optional[float]:
    """Parse a printed numeric token to float, or None. Never guesses."""
    if is_na(s):
        return None
    s = s.strip().replace(",", "")
    # strip trailing annotations like '@ 26' or footnote markers
    m = re.match(r"^-?\d+(?:\.\d+)?$", s)
    if m:
        try:
            return float(s)
        except ValueError:
            return None
    return None


def parse_price(s: Optional[str]) -> Optional[int]:
    """Prices are printed as integers with optional commas. Returns int or None."""
    n = parse_number(s)
    if n is None:
        return None
    return int(round(n))


# ---- material description parsing (price side) -----------------------------
# Examples:
#   CORA 4C/08+XUMA DX(S)100-4/22
#   CORA 3AH/09+LX PLUS(S)100-5/22
#   CORA 2HHK/50+UMAI 100K-3.7/22 2.5 SQMM
#   BPD273/03+UMAI 150-3/22 1.5 SQMM DOL
#   UQDs152/06+UMAI 150-2/22 1.5 SQMM DOL.
#   UPFN 125/04+UMAI150-3/22-DOL
#   BPI 343/02A+UMAI 150-3/22 1.5 SQMM DOL-
#   MR 5 C- 50-40-37 DOL 2.5 sq.mm  (openwell, different grammar)

PUMP_FAMILY_RE = re.compile(
    r"^(?P<family>CORA(?:chrom)?|CORA75|UPFN|UPF|BPD[N]?|UQD[s]?|BPI|BPH[A]?|UPH[A]?|MR|MRV|VO|ULTRA\+?)",
    re.IGNORECASE,
)

# series/stage token like "4C/08", "343/02A", "273/03", "152/06", "125/04", "20C/10"
SERIES_STAGE_RE = re.compile(
    r"(?P<series>[0-9]+[A-Z]{0,3})\s*/\s*(?P<stage>[0-9]+[A-Z]{0,3})",
    re.IGNORECASE,
)

# motor token after '+' e.g. "XUMA DX(S)100-4/22", "UMAI 150-3/22", "UMAH150-14/23"
MOTOR_RE = re.compile(
    r"\+\s*(?P<motor>[A-Z][A-Z0-9 ()]*?)\s*-?\s*(?P<mrating>[0-9]+(?:\.[0-9]+)?)\s*/\s*(?P<mframe>[0-9]{2})",
    re.IGNORECASE,
)

CABLE_RE = re.compile(r"(?P<cable>[0-9]+(?:\.[0-9]+)?)\s*SQ\.?\s*MM", re.IGNORECASE)
START_RE = re.compile(r"\b(S\.?D|SD|DOL|ATS|S/D)\b", re.IGNORECASE)
SS_RE = re.compile(r"\bSS\b|CH\b|SS\s*NRV", re.IGNORECASE)
G3_RE = re.compile(r"G\s*3(?:\.0)?\"|G3\"|G 3", re.IGNORECASE)


def split_stage(stage_raw: Optional[str]):
    """Return (numeric:int|None, suffix:str|None, identity:str|None)."""
    if not stage_raw:
        return None, None, None
    s = stage_raw.strip()
    m = re.match(r"^0*(\d+)\s*([A-Za-z].*)?$", s)
    if not m:
        return None, None, s.upper()
    num = int(m.group(1))
    suffix = (m.group(2) or "").strip().upper() or None
    identity = f"{num}{suffix}" if suffix else f"{num}"
    return num, suffix, identity


def parse_material_desc(desc: Optional[str]) -> dict:
    """Best-effort structured parse of a price-list material description.

    Only extracts tokens that are literally present. Missing tokens -> None.
    """
    out = {
        "pump_family": None,
        "pump_series": None,
        "stage_raw": None,
        "stage_numeric": None,
        "stage_suffix": None,
        "stage_identity": None,
        "motor_family": None,
        "motor_rating_token": None,
        "motor_frame": None,
        "cable_size_mm2": None,
        "starting_method": None,
        "ss_variant": False,
        "g3_variant": False,
    }
    if not desc:
        return out
    d = desc.strip()

    fam = PUMP_FAMILY_RE.match(d)
    if fam:
        out["pump_family"] = fam.group("family").upper().replace("CORACHROM", "CORACHROM")

    ss = SERIES_STAGE_RE.search(d)
    if ss:
        out["pump_series"] = ss.group("series").upper()
        stage_raw = ss.group("stage").upper()
        out["stage_raw"] = stage_raw
        num, suf, ident = split_stage(stage_raw)
        out["stage_numeric"] = num
        out["stage_suffix"] = suf
        out["stage_identity"] = ident

    mo = MOTOR_RE.search(d)
    if mo:
        out["motor_family"] = clean_str(mo.group("motor"))
        out["motor_rating_token"] = mo.group("mrating")
        out["motor_frame"] = mo.group("mframe")

    cb = CABLE_RE.search(d)
    if cb:
        out["cable_size_mm2"] = float(cb.group("cable"))

    st = START_RE.search(d)
    if st:
        tok = st.group(1).upper().replace(".", "").replace("/", "")
        out["starting_method"] = {"SD": "S/D", "DOL": "DOL", "ATS": "ATS"}.get(tok, tok)

    out["ss_variant"] = bool(SS_RE.search(d))
    out["g3_variant"] = bool(G3_RE.search(d))
    return out
