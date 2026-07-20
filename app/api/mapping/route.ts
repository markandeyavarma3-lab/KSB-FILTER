import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

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
  const m = schema.technicalPriceMappings;
  if (decision === "defer") {
    db.update(m).set({ manuallyReviewed: false, reviewNote: note ?? null, updatedAt: new Date().toISOString() })
      .where(eq(m.id, Number(id))).run();
  } else {
    const status = statusMap[decision];
    if (!status) return NextResponse.json({ error: "bad decision" }, { status: 400 });
    db.update(m).set({
      mappingStatus: status, mappingMethod: "manual", manuallyReviewed: true,
      reviewNote: note ?? null, updatedAt: new Date().toISOString(),
    }).where(eq(m.id, Number(id))).run();
  }
  return NextResponse.json({ ok: true });
}
