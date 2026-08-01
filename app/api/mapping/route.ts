import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET: list mappings joined with variant + price for the review screen.
export async function GET() {
  const m = schema.technicalPriceMappings, v = schema.motorPumpVariants, p = schema.priceRecords;
  const rows = db.select({
    id: m.id, status: m.mappingStatus, method: m.mappingMethod, confidence: m.confidence,
    reviewed: m.manuallyReviewed, note: m.reviewNote, matched: m.matchedFields, differing: m.differingFields,
    vId: v.id, vFamily: v.pumpFamily, vSeries: v.pumpSeries, vStage: v.stageIdentity,
    vHp: v.motorRatingHp, vPhase: v.phase, vModel: v.pumpModel, vKey: v.identityKey,
    tableId: v.performanceTableId,
    inCode: p.inCode, desc: p.materialDescriptionRaw, landing: p.landingPrice,
    single: p.singlePumpPrice, above: p.above50kPrice, pFamily: p.pumpFamily,
    pSeries: p.pumpSeries, pStage: p.stageIdentity, pMotor: p.motorFamily, pPage: p.pageIndex,
  }).from(m)
    .innerJoin(v, eq(m.motorPumpVariantId, v.id))
    .innerJoin(p, eq(m.priceRecordId, p.id))
    .all();

  // technical source page for each variant
  const tblPages = new Map(db.select({ id: schema.performanceTables.id, page: schema.performanceTables.pageIndex })
    .from(schema.performanceTables).all().map((t) => [t.id, t.page]));
  const out = rows.map((r) => ({ ...r, vPage: tblPages.get(r.tableId!) ?? null }));
  return NextResponse.json({ mappings: out });
}

// POST: record a manual decision (approve / reject / defer) — persisted so it
// survives re-import and re-running the mapping generator (spec section 27).
export async function POST(req: NextRequest) {
  const { id, decision, note } = await req.json();
  const statusMap: Record<string, string> = {
    approve: "MANUALLY_APPROVED", reject: "MANUALLY_REJECTED",
  };
  const m = schema.technicalPriceMappings, d = schema.mappingDecisions;
  const now = new Date().toISOString();

  // Resolve the durable business key for this mapping row. Decisions are stored
  // against (identity key, IN code) so they survive the loader rebuilding every
  // table with fresh row ids.
  const pair = db.select({
    identityKey: m.identityKey, inCode: schema.priceRecords.inCode,
    priceKey: schema.priceRecords.identityKey,
  })
    .from(m).innerJoin(schema.priceRecords, eq(m.priceRecordId, schema.priceRecords.id))
    .where(eq(m.id, Number(id))).get();
  if (!pair) return NextResponse.json({ error: "unknown mapping" }, { status: 404 });

  if (decision === "defer") {
    // Deferring must undo an earlier approve/reject completely, not just clear
    // the reviewed flag: leaving mappingStatus on MANUALLY_APPROVED would keep a
    // withdrawn decision counting as an operator-approved price. Restore the
    // status the generator would produce - exact when both identity keys agree,
    // otherwise a related-series suggestion.
    const isExact = pair.identityKey != null && pair.identityKey === pair.priceKey;
    db.update(m).set({
      mappingStatus: isExact ? "EXACT_AUTO_MATCH" : "SUGGESTED_RELATED_SERIES",
      mappingMethod: isExact ? "exact_automatic" : "suggested",
      confidence: isExact ? 1.0 : 0.6,
      manuallyReviewed: false, reviewNote: note ?? null, updatedAt: now,
    }).where(eq(m.id, Number(id))).run();
    if (pair.identityKey && pair.inCode) {
      db.delete(d).where(and(eq(d.identityKey, pair.identityKey), eq(d.inCode, pair.inCode))).run();
    }
  } else {
    const status = statusMap[decision];
    if (!status) return NextResponse.json({ error: "bad decision" }, { status: 400 });
    db.update(m).set({
      // confidence 1.0 matches what generate_mappings writes when it restores a
      // manual decision, so the row reads the same before and after a re-import.
      mappingStatus: status, mappingMethod: "manual", confidence: 1.0,
      manuallyReviewed: true, reviewNote: note ?? null, updatedAt: now,
    }).where(eq(m.id, Number(id))).run();
    if (pair.identityKey && pair.inCode) {
      db.insert(d).values({
        identityKey: pair.identityKey, inCode: pair.inCode,
        decision: status, note: note ?? null, decidedAt: now,
      }).onConflictDoUpdate({
        target: [d.identityKey, d.inCode],
        set: { decision: status, note: note ?? null, decidedAt: now },
      }).run();
    }
  }
  return NextResponse.json({ ok: true });
}
