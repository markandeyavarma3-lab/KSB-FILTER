import { describe, it, expect } from "vitest";
import { search, convertRequest } from "@/db/engine";

describe("unit conversions (spec §6)", () => {
  const c = convertRequest({ flowMinLph: 30000, flowMaxLph: 40000, depthMinFt: 100, depthMaxFt: 200 });
  it("LPH -> m3/hr", () => { expect(c.flowMinM3h).toBe(30); expect(c.flowMaxM3h).toBe(40); });
  it("LPH -> LPM", () => { expect(c.flowMinLpm).toBeCloseTo(500, 5); expect(c.flowMaxLpm).toBeCloseTo(666.667, 2); });
  it("ft -> m head", () => { expect(c.headMinM).toBeCloseTo(30.48, 3); expect(c.headMaxM).toBeCloseTo(60.96, 3); });
  it("midpoints", () => { expect(c.flowMidpointM3h).toBe(35); expect(c.headMidpointM).toBeCloseTo(45.72, 3); });
  it("default near tolerance is 5%", () => expect(c.nearTolerancePercent).toBe(5));
});

describe("search — technical correctness (spec §7-13)", () => {
  const r = search({ flowMinLph: 30000, flowMaxLph: 40000, depthMinFt: 100, depthMaxFt: 200, nearTolerancePct: 5 });

  it("returns valid results", () => expect(r.validResults.length).toBeGreaterThan(0));

  it("every VALID result has flow AND head strictly within the requested range", () => {
    for (const v of r.validResults) {
      expect(v.flowM3h).toBeGreaterThanOrEqual(r.request.flowMinM3h);
      expect(v.flowM3h).toBeLessThanOrEqual(r.request.flowMaxM3h);
      expect(v.headM).toBeGreaterThanOrEqual(r.request.headMinM);
      expect(v.headM).toBeLessThanOrEqual(r.request.headMaxM);
    }
  });

  it("every result sits on one of its table's approved positions (spec §9)", () => {
    for (const v of [...r.validResults, ...r.nearMatches]) {
      expect(v.approvedPositions).toContain(v.position);
    }
  });

  it("valid results are ranked by ascending balanced score (spec §13)", () => {
    for (let i = 1; i < r.validResults.length; i++) {
      expect(r.validResults[i].balancedScore).toBeGreaterThanOrEqual(r.validResults[i - 1].balancedScore);
    }
  });

  it("near matches are outside range but within tolerance, never in the valid list", () => {
    const validIds = new Set(r.validResults.map((v: any) => v.opId));
    for (const n of r.nearMatches) {
      expect(validIds.has(n.opId)).toBe(false);
      expect(Math.max(n.flowMissPct, n.headMissPct)).toBeLessThanOrEqual(5 + 1e-9);
    }
  });

  it("priced results expose Landing/Single/Above but never an LP field (spec §19)", () => {
    const priced = r.validResults.find((v: any) => v.priceStatus === "PRICED");
    expect(priced).toBeTruthy();
    for (const o of priced!.priceOptions) {
      expect(o).not.toHaveProperty("lpRaw");
      expect(o).not.toHaveProperty("lp");
      expect("landingPrice" in o && "singlePumpPrice" in o && "above50kPrice" in o).toBe(true);
    }
  });

  it("unavailable prices are null, never zero (spec §20)", () => {
    for (const v of r.validResults) for (const o of v.priceOptions) {
      for (const k of ["landingPrice", "singlePumpPrice", "above50kPrice"] as const) {
        if (o[k] != null) expect(o[k]).toBeGreaterThan(0);
      }
    }
  });

  it("technically valid results remain even when unpriced (spec §26)", () => {
    expect(r.unpricedResults.every((u: any) => u.matchStatus === "VALID")).toBe(true);
  });

  it("rejected input: max < min flow is caught by convert? engine still runs but 0 valid", () => {
    const empty = search({ flowMinLph: 999999, flowMaxLph: 1000000, depthMinFt: 5, depthMaxFt: 6 });
    expect(empty.validResults.length).toBe(0);
  });
});
