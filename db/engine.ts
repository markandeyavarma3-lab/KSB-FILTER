// Deterministic selection engine (spec sections 6-13). Search by water flow
// (LPH) and motor depth (ft) only. Flow is matched first, restricted to the
// approved middle operating-point positions, then head/depth is evaluated.
// Price is attached AFTER technical ranking and never influences it.
import { db, schema } from "./client";
import { and, eq, isNotNull, gte, lte, SQL } from "drizzle-orm";

const M_PER_FT = 0.3048;
const FT_PER_M = 3.280839895;

export interface SearchParams {
  flowMinLph: number;
  flowMaxLph: number;
  depthMinFt: number;
  depthMaxFt: number;
  hpMin?: number | null;
  hpMax?: number | null;
  nearTolerancePct?: number; // default 5
  ranking?: "balanced" | "flow" | "head";
}

export interface PriceOption {
  inCode: string;
  description: string | null;
  landingPrice: number | null;
  singlePumpPrice: number | null;
  above50kPrice: number | null;
  priceStatus: string | null;
  mappingStatus: string | null;
  startingMethod: string | null;
  cableSizeMm2: number | null;
  ssVariant: boolean;
  g3Variant: boolean;
  motorFamily: string | null;
  pageIndex: number | null;
}

export function convertRequest(p: SearchParams) {
  const tol = p.nearTolerancePct ?? 5;
  const flowMinM3h = p.flowMinLph / 1000;
  const flowMaxM3h = p.flowMaxLph / 1000;
  const headMinM = p.depthMinFt * M_PER_FT;
  const headMaxM = p.depthMaxFt * M_PER_FT;
  return {
    flowMinLph: p.flowMinLph, flowMaxLph: p.flowMaxLph,
    flowMinM3h, flowMaxM3h,
    flowMinLpm: p.flowMinLph / 60, flowMaxLpm: p.flowMaxLph / 60,
    flowMidpointM3h: (flowMinM3h + flowMaxM3h) / 2,
    depthMinFt: p.depthMinFt, depthMaxFt: p.depthMaxFt,
    headMinM, headMaxM,
    headMinFt: p.depthMinFt, headMaxFt: p.depthMaxFt,
    headMidpointM: (headMinM + headMaxM) / 2,
    hpMin: p.hpMin ?? null, hpMax: p.hpMax ?? null,
    nearTolerancePercent: tol,
    ranking: p.ranking ?? "balanced",
  };
}

function missPct(value: number, lo: number, hi: number): number {
  if (value < lo) return ((lo - value) / lo) * 100;
  if (value > hi) return ((value - hi) / hi) * 100;
  return 0;
}

export function search(params: SearchParams) {
  const req = convertRequest(params);
  const tol = req.nearTolerancePercent / 100;

  // fetch approved, non-missing operating points whose flow is within the
  // requested band widened by tolerance; join variant + supported table.
  const op = schema.operatingPoints;
  const v = schema.motorPumpVariants;
  const t = schema.performanceTables;
  const flowLo = req.flowMinM3h * (1 - tol) - 1e-6;
  const flowHi = req.flowMaxM3h * (1 + tol) + 1e-6;

  const hpConds: SQL[] = [];
  if (req.hpMin != null) hpConds.push(gte(v.motorRatingHp, req.hpMin));
  if (req.hpMax != null) hpConds.push(lte(v.motorRatingHp, req.hpMax));
  if (hpConds.length) hpConds.unshift(isNotNull(v.motorRatingHp));

  const rows = db
    .select({
      opId: op.id, position: op.positionIndex, flowM3h: op.flowM3h,
      flowLph: op.flowLph, flowLpm: op.flowLpm, headM: op.headM, headFt: op.headFt,
      variantId: v.id, pumpFamily: v.pumpFamily, pumpModel: v.pumpModel,
      pumpSeries: v.pumpSeries, motorFamily: v.motorFamily, kw: v.motorRatingKw,
      hp: v.motorRatingHp, stageIdentity: v.stageIdentity, stagesNumeric: v.stagesNumeric,
      phase: v.phase, voltage: v.voltage, startingMethod: v.startingMethod,
      nrvSizeMm: v.nrvSizeMm, cableSizeMm2: v.cableSizeMm2, identityKey: v.identityKey,
      verification: v.verificationStatus,
      tableId: t.id, title: t.title, pageIndex: t.pageIndex, categoryCode: t.categoryCode,
      flowType: t.flowType, borewellMm: t.borewellDiameterMm, minWellMm: t.minWellDiameterMm,
      orientation: t.orientation, opCount: t.operatingPointCount,
      approvedPositions: t.approvedPositions, positionSupported: t.positionSupported,
      nominalSpeedRpm: t.nominalSpeedRpm, rotorMaterial: t.rotorMaterial,
    })
    .from(op)
    .innerJoin(v, eq(op.motorPumpVariantId, v.id))
    .innerJoin(t, eq(v.performanceTableId, t.id))
    .where(and(
      eq(op.isApproved, true), eq(op.isMissing, false),
      eq(t.positionSupported, true),
      isNotNull(op.flowM3h), isNotNull(op.headM),
      gte(op.flowM3h, flowLo), lte(op.flowM3h, flowHi),
      ...hpConds,
    ))
    .all();

  const flowHalf = Math.max((req.flowMaxM3h - req.flowMinM3h) / 2, req.flowMidpointM3h * 0.02, 1e-6);
  const headHalf = Math.max((req.headMaxM - req.headMinM) / 2, req.headMidpointM * 0.02, 1e-6);

  type Row = typeof rows[number];
  const valid: any[] = [], near: any[] = [], rejected: any[] = [];
  const variantIds = new Set<number>();

  for (const r of rows) {
    const flow = r.flowM3h!, head = r.headM!;
    const flowIn = flow >= req.flowMinM3h && flow <= req.flowMaxM3h;
    const headIn = head >= req.headMinM && head <= req.headMaxM;
    const fMiss = missPct(flow, req.flowMinM3h, req.flowMaxM3h);
    const hMiss = missPct(head, req.headMinM, req.headMaxM);

    const nFlow = Math.abs(flow - req.flowMidpointM3h) / flowHalf;
    const nHead = Math.abs(head - req.headMidpointM) / headHalf;
    const balanced = 0.5 * nFlow + 0.5 * nHead;

    const base = {
      variantId: r.variantId, opId: r.opId, position: r.position,
      operatingPointCount: r.opCount, approvedPositions: JSON.parse(r.approvedPositions || "[]"),
      category: r.categoryCode, flowType: r.flowType, pumpFamily: r.pumpFamily,
      pumpModel: r.pumpModel, pumpSeries: r.pumpSeries, motorFamily: r.motorFamily,
      kw: r.kw, hp: r.hp, stageIdentity: r.stageIdentity, phase: r.phase, voltage: r.voltage,
      startingMethod: r.startingMethod, borewellMm: r.borewellMm, minWellMm: r.minWellMm,
      nrvSizeMm: r.nrvSizeMm, cableSizeMm2: r.cableSizeMm2, nominalSpeedRpm: r.nominalSpeedRpm,
      rotorMaterial: r.rotorMaterial, title: r.title, pageIndex: r.pageIndex,
      orientation: r.orientation, verification: r.verification,
      flowM3h: round(flow, 3), flowLph: Math.round(flow * 1000), flowLpm: round(flow * 16.6666666667, 1),
      headM: round(head, 2), headFt: round(head * FT_PER_M, 1),
      flowMissPct: round(fMiss, 1), headMissPct: round(hMiss, 1),
      normFlowDistance: round(nFlow, 3), normHeadDistance: round(nHead, 3),
      balancedScore: round(balanced, 3),
    };

    if (flowIn && headIn) {
      valid.push({ ...base, matchStatus: "VALID" });
      variantIds.add(r.variantId);
    } else if (fMiss <= req.nearTolerancePercent && hMiss <= req.nearTolerancePercent) {
      const reason = [
        fMiss > 0 ? `Flow ${base.flowMissPct}% ${flow < req.flowMinM3h ? "below" : "above"} range` : null,
        hMiss > 0 ? `Head ${base.headMissPct}% ${head < req.headMinM ? "below" : "above"} range` : null,
      ].filter(Boolean).join("; ");
      near.push({ ...base, matchStatus: "NEAR_MATCH", reason });
      variantIds.add(r.variantId);
    } else {
      // Every remaining scanned row lands here, so scanned === valid + near + rejected always.
      // Two cases reach this branch: (a) flow matched exactly but head missed by more than
      // tolerance, or (b) flow only matched within the widened tolerance band (not exactly)
      // and head missed by more than tolerance too — previously these silently vanished.
      const flowNote = fMiss > 0
        ? `flow ${base.flowMissPct}% ${flow < req.flowMinM3h ? "below" : "above"} range`
        : "flow matched";
      rejected.push({
        ...base,
        matchStatus: head < req.headMinM ? "HEAD_BELOW_RANGE" : "HEAD_ABOVE_RANGE",
        reason: `Head ${base.headFt} ft outside ${req.headMinFt}-${req.headMaxFt} ft (${flowNote})`,
      });
    }
  }

  // ---- collapse duplicate technical rows -------------------------------
  // The catalogue sometimes has two motor_pump_variant rows for the same
  // hydraulic point that differ only in an electrical attribute (starting
  // method / cable size) which extraction didn't capture in a structured
  // column. Left alone, that produces two visually-identical result rows
  // for what a user would call one "technical combination" — each pointing
  // at the same purchasable price options, doubled. Collapse rows that
  // agree on every technical/hydraulic field into one, merging their price
  // options together (spec: "multiple purchasable price options per
  // technical combination are all shown" — one row, several options).
  let duplicateTechnicalRowsMerged = 0;
  function dedupeTechnical<T extends {
    variantId: number; pumpModel: string | null; stageIdentity: string | null;
    hp: number | null; phase: number | null; category: string | null;
    flowM3h: number; headM: number;
  }>(list: T[]): (T & { variantIds: number[] })[] {
    const map = new Map<string, T & { variantIds: number[] }>();
    for (const r of list) {
      const key = `${r.pumpModel}|${r.stageIdentity}|${r.hp}|${r.phase}|${r.category}|${r.flowM3h}|${r.headM}`;
      const existing = map.get(key);
      if (existing) {
        existing.variantIds.push(r.variantId);
        duplicateTechnicalRowsMerged++;
      } else {
        map.set(key, { ...r, variantIds: [r.variantId] });
      }
    }
    return [...map.values()];
  }
  const validDeduped = dedupeTechnical(valid);
  const nearDeduped = dedupeTechnical(near);
  const rejectedDeduped = dedupeTechnical(rejected);

  // ---- price attachment (after ranking is possible) ----
  const priceByVariant = attachPrices([...variantIds]);
  for (const list of [validDeduped, nearDeduped]) {
    for (const r of list) {
      const seen = new Set<string>();
      const opts: PriceOption[] = (r.variantIds as number[])
        .flatMap((vid: number) => priceByVariant.get(vid) ?? [])
        .filter((o: PriceOption) => (seen.has(o.inCode) ? false : (seen.add(o.inCode), true)))
        .sort((a: PriceOption, b: PriceOption) => {
          const al = a.landingPrice ?? Infinity, bl = b.landingPrice ?? Infinity;
          return al !== bl ? al - bl : a.inCode.localeCompare(b.inCode);
        });
      const landings = opts.map((o) => o.landingPrice).filter((x): x is number => x != null);
      r.priceOptions = opts;
      r.priceOptionCount = opts.length;
      r.lowestLandingPrice = landings.length ? Math.min(...landings) : null;
      r.priceStatus = opts.length === 0
        ? "NO_EXACT_PRICE_MATCH"
        : (landings.length || opts.some((o: PriceOption) => o.singlePumpPrice != null || o.above50kPrice != null)
          ? "PRICED" : "PRICE_RECORD_FOUND_VALUE_UNAVAILABLE");
    }
  }

  // ---- ranking ----
  const rankKey = req.ranking === "flow" ? "normFlowDistance"
    : req.ranking === "head" ? "normHeadDistance" : "balancedScore";
  validDeduped.sort((a, b) => a[rankKey] - b[rankKey]);
  nearDeduped.sort((a, b) => a.balancedScore - b.balancedScore);
  validDeduped.forEach((r, i) => (r.rank = i + 1));

  // ---- model summaries (aggregate valid ops by variant) ----
  const modelMap = new Map<number, any>();
  for (const r of validDeduped) {
    let m = modelMap.get(r.variantId);
    if (!m) {
      m = {
        variantId: r.variantId, category: r.category, pumpFamily: r.pumpFamily,
        pumpModel: r.pumpModel, motorFamily: r.motorFamily, hp: r.hp, kw: r.kw,
        stageIdentity: r.stageIdentity, phase: r.phase, startingMethod: r.startingMethod,
        borewellMm: r.borewellMm, minWellMm: r.minWellMm, pageIndex: r.pageIndex,
        validOpCount: 0, flowMin: Infinity, flowMax: -Infinity, headMin: Infinity, headMax: -Infinity,
        priceOptionCount: r.priceOptionCount, lowestLandingPrice: r.lowestLandingPrice,
        // carried so the model view can show and open the exact price-list page
        priceOptions: r.priceOptions,
        priceStatus: r.priceStatus, bestScore: r.balancedScore,
      };
      modelMap.set(r.variantId, m);
    }
    m.validOpCount++;
    m.flowMin = Math.min(m.flowMin, r.flowM3h); m.flowMax = Math.max(m.flowMax, r.flowM3h);
    m.headMin = Math.min(m.headMin, r.headM); m.headMax = Math.max(m.headMax, r.headM);
    m.bestScore = Math.min(m.bestScore, r.balancedScore);
  }
  const modelSummaries = [...modelMap.values()].sort((a, b) => a.bestScore - b.bestScore);
  modelSummaries.forEach((m, i) => (m.rank = i + 1));

  const priced = validDeduped.filter((r) => r.priceStatus === "PRICED");
  const unpriced = validDeduped.filter((r) => r.priceStatus !== "PRICED");

  return {
    request: req,
    statistics: {
      approvedOperatingPointsScanned: rows.length,
      validOperatingPoints: validDeduped.length,
      uniqueTechnicalModels: modelSummaries.length,
      nearMatches: nearDeduped.length,
      rejectedPoints: rejectedDeduped.length,
      duplicateTechnicalRowsMerged,
      pricedOperatingPoints: priced.length,
      unpricedOperatingPoints: unpriced.length,
    },
    validResults: validDeduped,
    nearMatches: nearDeduped,
    rejectedResults: rejectedDeduped.slice(0, 500),
    unpricedResults: unpriced,
    modelSummaries,
  };
}

function attachPrices(variantIds: number[]): Map<number, PriceOption[]> {
  const out = new Map<number, PriceOption[]>();
  if (variantIds.length === 0) return out;
  const m = schema.technicalPriceMappings;
  const p = schema.priceRecords;
  const rows = db
    .select({
      variantId: m.motorPumpVariantId, mappingStatus: m.mappingStatus,
      inCode: p.inCode, desc: p.materialDescriptionRaw, landing: p.landingPrice,
      single: p.singlePumpPrice, above: p.above50kPrice, status: p.priceStatus,
      starting: p.startingMethod, cable: p.cableSizeMm2, ss: p.ssVariant, g3: p.g3Variant,
      motor: p.motorFamily, page: p.pageIndex,
    })
    .from(m).innerJoin(p, eq(m.priceRecordId, p.id))
    .all();
  const wanted = new Set(variantIds);
  for (const r of rows) {
    if (r.variantId == null || !wanted.has(r.variantId)) continue;
    if (r.mappingStatus === "MANUALLY_REJECTED") continue; // review decision honoured
    const opt: PriceOption = {
      inCode: r.inCode, description: r.desc, landingPrice: r.landing,
      singlePumpPrice: r.single, above50kPrice: r.above, priceStatus: r.status,
      mappingStatus: r.mappingStatus, startingMethod: r.starting, cableSizeMm2: r.cable,
      ssVariant: !!r.ss, g3Variant: !!r.g3, motorFamily: r.motor, pageIndex: r.page,
    };
    (out.get(r.variantId) ?? out.set(r.variantId, []).get(r.variantId)!).push(opt);
  }
  // order options: available landing first (asc), then unavailable, then IN code
  for (const opts of out.values()) {
    opts.sort((a, b) => {
      const al = a.landingPrice ?? Infinity, bl = b.landingPrice ?? Infinity;
      if (al !== bl) return al - bl;
      return a.inCode.localeCompare(b.inCode);
    });
  }
  return out;
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
