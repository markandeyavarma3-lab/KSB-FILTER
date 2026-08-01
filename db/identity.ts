// Shared, deterministic identity normalization used by both the loader and the
// mapping generator. No fuzzy matching for auto-links (spec section 22): an
// exact automatic match requires family + series + stage + motor + hp + phase.
// A "loose" key (family base without a trailing related-series letter) drives
// SUGGESTED_RELATED_SERIES candidates only (spec section 24) — never auto-linked.

export const HP_SET = new Set([
  0.5, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 7.5, 10, 12.5, 15, 17.5, 20, 25, 30, 33, 41, 52, 60, 75,
]);

// families whose price identity is (series + stage); the rest are model-coded.
export const SERIES_STAGE_FAMILIES = new Set([
  "CORA", "UQD", "UPFN", "UPF", "BPD", "BPDN", "BPC", "UPC",
  "BPI", "BPH", "BPHA", "UPH", "UPHA",
]);

// Monosub R openwell pumpsets (booklet title "Monosub R (MR)" / "MONOSUB RV")
// are model-coded, not series+stage: the purchasable identity is the HP plus the
// casing designation "<discharge>-<suction>-<impeller>", e.g. "MR 3 C- 60-50-21".
//
// The booklet writes one row for two build variants ("MR 3 A / 3 C- 60-50-21");
// the price list lists them individually. The A/C letter is therefore left OUT
// of the key so every purchasable build for a performance row surfaces as a
// separate price option (spec section 25) with its own description.
const MONOSUB_DIMS = /(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/;
const MONOSUB_HP = /^MR\s*(?:\(\s*[ST]\s*\))?\s*(\d+(?:\.\d+)?)/i;

export function monosubKey(
  designation: string | null | undefined,
  phase: number | null,
): string | null {
  if (!designation) return null;
  const d = designation.match(MONOSUB_DIMS);
  const h = designation.match(MONOSUB_HP);
  if (!d || !h) return null;
  const dims = `${+d[1]}-${+d[2]}-${+d[3]}`;
  return `MR|${dims}|${parseFloat(h[1])}|${phase ?? "*"}`;
}

// Price rows for Monosub R carry no phase column. Every dimensioned MR row in
// the H2-2026 list is a three-phase set: they quote three-phase starting methods
// (DOL / SD), and each one resolves to a three-phase booklet designation. The
// single-phase stock ("MR(S)10CX 10M CABLE") carries no casing designation at
// all, so it never reaches this path.
export const MONOSUB_PRICE_PHASE = 3;

// ULTRA+ monobloc pumpsets are model-coded too. Their designation is
// "<model> <size>" - e.g. "ULTRA+ 526 3025" is model 526 on an 80x65 mm
// (3.0"x2.5") casing - optionally prefixed "(GS)" for the slow-speed range and
// suffixed "I" for the ISI-marked build. The booklet and the price list write
// the same designation; the price list simply adds its own "GP" marker, which
// carries no engineering meaning and is ignored.
//
// The ISI / FF markers ARE part of the identity: the booklet lists ISI and
// non-ISI builds as separate rows with different curves, so dropping the marker
// would let an ISI price attach to a non-ISI pump.
const ULTRA_DESIGN = /^ULTRA\s*\+?\s*(\(\s*GS\s*\)\s*)?(\d{3,4})\s*[- ]\s*(\d{4,6})\b/i;

export function ultraKey(
  designation: string | null | undefined,
  hp: number | null,
  phase: number | null,
): string | null {
  if (!designation) return null;
  const s = designation.toUpperCase().replace(/\s+/g, " ").trim();
  const m = s.match(ULTRA_DESIGN);
  if (!m || hp == null) return null;
  const gs = m[1] ? "GS" : "";
  // build markers, as standalone tokens so "GP I" -> ISI but "GP" alone does not
  const tokens = s.split(/[\s-]+/);
  const isi = tokens.includes("I") ? "I" : "";
  const ff = tokens.includes("FF") ? "FF" : "";
  return `ULTRA+|${gs}${m[2]}|${m[3]}|${isi}${ff}|${hp}|${phase ?? "*"}`;
}

export function normMotor(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

export function normFamily(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toUpperCase().replace(/[^A-Z+]/g, "");
}

// UQDs -> UQD ; keeps everything else. Only used for suggested candidates.
export function looseFamily(fam: string | null): string | null {
  if (!fam) return null;
  return fam.replace(/S$/, "");
}

// CORA series are alphanumeric (1C, 2AH, 4C) and kept as-is. Every other
// series-stage family uses a numeric series (60, 152, 242, 302); any trailing
// letter there belongs to the stage, not the series (booklet 'BPD 242A' vs
// price 'BPD242/04A' both reduce to series 242).
export function normSeries(family: string | null, series: string | null): string | null {
  if (!series) return null;
  const s = series.toUpperCase();
  if (family && family.toUpperCase().startsWith("CORA")) return s;
  const digits = s.replace(/[^0-9]/g, "");
  return digits || s;
}

export function splitStage(raw: string | null | undefined) {
  if (!raw) return { num: null as number | null, suffix: null as string | null, identity: null as string | null };
  const s = raw.trim();
  const m = s.match(/^0*(\d+)\s*([A-Za-z].*)?$/);
  if (!m) return { num: null, suffix: null, identity: s.toUpperCase() };
  const num = parseInt(m[1], 10);
  const suffix = (m[2] || "").trim().toUpperCase() || null;
  return { num, suffix, identity: suffix ? `${num}${suffix}` : `${num}` };
}

// Find the (kW, HP, stage) triple in an orientation-A metadata cell list.
// kW/HP is the adjacent numeric pair with HP/kW in [1.28,1.5] and HP in HP_SET;
// the stage is the cell immediately after HP. Robust to leading motor-id
// columns ("0.75 / 22", or dual "10 / 23" + "10 / 22").
export function kwHpStage(metaCells: string[]) {
  const nums = metaCells.map((c) => {
    const t = c.trim();
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  });
  for (let i = 0; i < metaCells.length - 1; i++) {
    const a = nums[i], b = nums[i + 1];
    if (a != null && b != null && a > 0 && HP_SET.has(b)) {
      const r = b / a;
      if (r >= 1.28 && r <= 1.5) {
        const stageRaw = (metaCells[i + 2] ?? "").trim() || null;
        return { kw: a, hp: b, stageRaw };
      }
    }
  }
  return { kw: null as number | null, hp: null as number | null, stageRaw: null as string | null };
}

// Parse a technical table title: "<PUMP> + <MOTOR>[ / <MOTOR2>] (<flow>) : <n> mm ..."
export function parseTitle(title: string | null | undefined) {
  const out = {
    pumpFamily: null as string | null,
    pumpSeries: null as string | null,
    pumpToken: null as string | null,   // human-readable model, e.g. "CORAchrom 150-17A"
    motorFamilies: [] as string[],
    flowType: null as string | null,
    borewellMm: null as number | null,
  };
  if (!title) return out;
  const t = title.trim();

  const bore = t.match(/(\d+)\s*mm\s*Borewell/i);
  if (bore) out.borewellMm = parseInt(bore[1], 10);
  if (/radial/i.test(t)) out.flowType = "radial";
  else if (/mixed/i.test(t)) out.flowType = "mixed";
  else if (/openwell/i.test(t)) out.flowType = "openwell";
  else if (/monobloc/i.test(t)) out.flowType = "monobloc";
  else if (out.borewellMm) out.flowType = "radial";

  const pumpPart = t.split(/\s*:\s*|\s+\|\s+/)[0];
  const plusSplit = pumpPart.split(/\s*\+\s*/);
  const pumpToken = plusSplit[0].trim();
  out.pumpToken = pumpToken || null;
  // motors after '+'
  if (plusSplit[1]) {
    for (const mm of plusSplit[1].split("/")) {
      const cleaned = mm.replace(/\(.*?flow.*?\)/i, "").trim();
      if (cleaned) out.motorFamilies.push(cleaned);
    }
  }
  // Monosub R titles name the range in words ("Monosub R (MR)", "MONOSUB RV"),
  // so the family never appears as a leading token and the generic matcher below
  // cannot see it. Resolve those first: RV is the vertical multistage range.
  const monosub = pumpToken.match(/^MONOSUB\s*R\s*V\b/i) ? "MRV"
    : /^MONOSUB\s*R\b/i.test(pumpToken) ? "MR"
    : null;
  if (monosub) {
    out.pumpFamily = monosub;
    return out;
  }

  // family + series from the pump token
  const fam = pumpToken.match(/^(CORAchrom|CORA75|CORA|UQD|UPFN|UPF|BPDN|BPD|BPC|UPC|BPHA|BPH|BPI|UPHA|UPH|MRV|MREG|MR|VO|ULTRA\+?)/i);
  if (fam) {
    out.pumpFamily = fam[1].toUpperCase();
    const rest = pumpToken.slice(fam[1].length).trim();
    // series = first alnum token (skip a leading borewell size like "100-")
    const s = rest.match(/(\d+)\s*-\s*(\d+[A-Z]*)/) || rest.match(/([0-9]+[A-Z]{0,3})/i);
    if (s) out.pumpSeries = (s[2] || s[1]).toUpperCase();
  }
  return out;
}

export interface Identity {
  family: string | null;
  series: string | null;
  stageId: string | null;
  motorNorm: string | null;
  hp: number | null;
  phase: number | null;
  key: string | null;       // exact identity key
  looseKey: string | null;  // family-base key for suggested related-series
}

function buildKeys(id: Omit<Identity, "key" | "looseKey">): Pick<Identity, "key" | "looseKey"> {
  const { family, series, stageId, hp, phase } = id;
  if (!family || !series || !stageId || hp == null) return { key: null, looseKey: null };
  // Identity = family + series + stage + hp + phase. Motor / cable / NRV /
  // starting are NOT in the key: per spec section 25 they distinguish multiple
  // purchasable price OPTIONS for the same technical combination, and title
  // parsing of the motor string is too noisy to hard-gate on. Motor is still
  // recorded per option and shown as a matched/differing field.
  const tail = `${series}|${stageId}|${hp}|${phase ?? "*"}`;
  return {
    key: `${family}|${tail}`,
    looseKey: `${looseFamily(family)}|${tail}`,
  };
}

// Technical side: from parsed title + one variant's meta cells + table phase.
export function techIdentity(
  title: string | null,
  metaCells: string[],
  tablePhase: number | null,
): Identity {
  const pt = parseTitle(title);
  const { hp, stageRaw } = kwHpStage(metaCells);
  const stage = splitStage(stageRaw);
  const motorNorm = pt.motorFamilies.length ? normMotor(pt.motorFamilies[0]) : null;
  const base = {
    family: normFamily(pt.pumpFamily),
    series: normSeries(normFamily(pt.pumpFamily), pt.pumpSeries),
    stageId: stage.identity,
    motorNorm,
    hp,
    phase: tablePhase,
  };
  return { ...base, ...buildKeys(base) };
}

// Price side: from already-parsed price-record fields.
export function priceIdentity(rec: {
  pumpFamily: string | null;
  pumpSeries: string | null;
  stageIdentity: string | null;
  motorFamily: string | null;
  hp: number | null;
  phase: number | null;
}): Identity {
  const base = {
    family: normFamily(rec.pumpFamily),
    series: normSeries(normFamily(rec.pumpFamily), rec.pumpSeries),
    stageId: rec.stageIdentity,
    motorNorm: normMotor(rec.motorFamily),
    hp: rec.hp,
    phase: rec.phase,
  };
  return { ...base, ...buildKeys(base) };
}

// derive phase from motor family naming when not otherwise known
export function phaseFromMotor(motor: string | null, category: string | null): number | null {
  const hay = `${motor ?? ""} ${category ?? ""}`.toUpperCase();
  if (/1\s*PH|\(S\)|SINGLE/.test(hay)) return 1;
  if (/3\s*PH|UMAI|UMAH|UMN|HBC|THREE/.test(hay)) return 3;
  return null;
}
