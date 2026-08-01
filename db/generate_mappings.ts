// Generate technical<->price mappings (spec section 22/24/27). Deterministic:
//  - EXACT_AUTO_MATCH: identity keys equal (family+series+stage+motor+hp+phase)
//  - SUGGESTED_RELATED_SERIES: loose keys equal but exact family differs
//                              (e.g. UQD vs UQDs) -> requires manual review
// Manual review decisions are preserved across re-runs AND across a full
// re-import: they live in mapping_decisions, keyed by (technical identity key,
// price IN code) rather than by row id, because the loader rebuilds every table
// and reassigns ids.
import { db, sqlite, schema } from "./client";
import { looseFamily } from "./identity";
import { eq, and, isNotNull } from "drizzle-orm";

const now = new Date().toISOString();

// Restore manual decisions by business key. Keyed on identity + IN code so the
// decision survives re-extraction, which is the whole point of section 27.
const decisions = db.select().from(schema.mappingDecisions).all();
const decisionByPair = new Map(decisions.map((d) => [`${d.identityKey}::${d.inCode}`, d]));

db.delete(schema.technicalPriceMappings).run();

const variants = db.select().from(schema.motorPumpVariants)
  .where(isNotNull(schema.motorPumpVariants.identityKey)).all();
const prices = db.select().from(schema.priceRecords)
  .where(and(eq(schema.priceRecords.segment, "agricultural"),
             isNotNull(schema.priceRecords.identityKey))).all();

// index price records by exact key and by loose key
const byExact = new Map<string, typeof prices>();
const byLoose = new Map<string, typeof prices>();
for (const p of prices) {
  const exact = p.identityKey!;
  const loose = looseKeyOf(exact);
  (byExact.get(exact) ?? byExact.set(exact, []).get(exact)!).push(p);
  (byLoose.get(loose) ?? byLoose.set(loose, []).get(loose)!).push(p);
}
function looseKeyOf(key: string): string {
  const [fam, ...rest] = key.split("|");
  return [looseFamily(fam), ...rest].join("|");
}

// ULTRA+ key with the model number dropped (range prefix kept). Only ULTRA+
// keys have this shape, so anything else returns null and is unaffected.
function ultraLooseOf(key: string): string | null {
  const p = key.split("|");
  if (p[0] !== "ULTRA+" || p.length !== 6) return null;
  p[1] = /^GS/.test(p[1]) ? "GS" : "";
  return p.join("|");
}
const byUltraLoose = new Map<string, typeof prices>();
for (const p of prices) {
  const lk = p.identityKey ? ultraLooseOf(p.identityKey) : null;
  if (lk) (byUltraLoose.get(lk) ?? byUltraLoose.set(lk, []).get(lk)!).push(p);
}

// Some booklet tables publish ONE performance curve for two pump series and say
// so in the title ("CORA 7C & 7D + UMAI 100"); the two differ only in NRV size.
// parseTitle keeps the first series, so the second one would never find its
// prices. Map each table to its sibling series so those rows match too - the
// booklet is explicit that the curve covers both, so these are exact matches.
const tableTitles = new Map(db.select({ id: schema.performanceTables.id, title: schema.performanceTables.title })
  .from(schema.performanceTables).all().map((t) => [t.id, t.title ?? ""]));

function siblingSeries(tableId: number | null, series: string | null): string | null {
  if (tableId == null || !series) return null;
  const m = tableTitles.get(tableId)?.match(/\b([0-9]+[A-Z]{1,3})\s*&\s*([0-9]+[A-Z]{1,3})\b/i);
  if (!m) return null;
  const [a, b] = [m[1].toUpperCase(), m[2].toUpperCase()];
  if (series.toUpperCase() === a) return b;
  if (series.toUpperCase() === b) return a;
  return null;
}

let nExact = 0, nSuggest = 0, nMulti = 0;
const linkedVariants = new Set<number>();
const ins = sqlite.transaction(() => {
  for (const v of variants) {
    const key = v.identityKey!;
    // a combined "A & B" table serves both series, so both key variants are exact
    const sib = siblingSeries(v.performanceTableId, v.pumpSeries);
    const sibKey = sib ? key.split("|").map((part, i) => (i === 1 ? sib : part)).join("|") : null;
    const exact = [...(byExact.get(key) ?? []), ...(sibKey ? byExact.get(sibKey) ?? [] : [])];
    let candidates = exact;
    let status = "EXACT_AUTO_MATCH";
    let method = "exact_automatic";
    let confidence = 1.0;

    if (candidates.length === 0) {
      // related-series suggestion via loose key, excluding same-exact-family
      const loose = byLoose.get(looseKeyOf(key)) ?? [];
      candidates = loose.filter((p) => p.identityKey !== key);
      if (candidates.length === 0) {
        // ULTRA+ whose model number differs between the two documents: same
        // range, casing and HP, so suggest it for review (never auto-link).
        const lk = ultraLooseOf(key);
        candidates = lk ? (byUltraLoose.get(lk) ?? []).filter((p) => p.identityKey !== key) : [];
        if (candidates.length === 0) continue;
      }
      status = "SUGGESTED_RELATED_SERIES";
      method = "suggested";
      confidence = 0.6;
    }
    if (candidates.length > 1 && status === "EXACT_AUTO_MATCH") nMulti++;

    for (const p of candidates) {
      const kept = p.inCode ? decisionByPair.get(`${key}::${p.inCode}`) : undefined;
      db.insert(schema.technicalPriceMappings).values({
        motorPumpVariantId: v.id, priceRecordId: p.id, identityKey: key,
        mappingStatus: kept ? kept.decision : status,
        mappingMethod: kept ? "manual" : method,
        confidence: kept ? 1.0 : confidence,
        matchedFields: JSON.stringify(["family?", "series", "stage", "motor", "hp", "phase"]),
        differingFields: status === "SUGGESTED_RELATED_SERIES" ? JSON.stringify(["family_suffix"]) : "[]",
        manuallyReviewed: kept ? true : false,
        reviewNote: kept?.note ?? null,
        createdAt: now, updatedAt: now,
      }).run();
      linkedVariants.add(v.id);
      if (status === "EXACT_AUTO_MATCH") nExact++; else nSuggest++;
    }
  }
});
ins();

const keyedVariants = variants.length;
console.error(`keyed_variants=${keyedVariants} linked=${linkedVariants.size}`);
console.error(`exact_option_links=${nExact} suggested_links=${nSuggest} multi_option_exact=${nMulti}`);
console.error(`agri_price_keyed=${prices.length}`);
