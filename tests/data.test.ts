import { describe, it, expect } from "vitest";
import { sqlite } from "@/db/client";

const one = (q: string) => (sqlite.prepare(q).get() as any).n as number;

// spec §9 authoritative map (mirrored here to validate what the loader stored)
const ALLOWED: Record<number, number[]> = {
  1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [2, 3], 5: [3, 4], 6: [3, 4], 7: [3, 4, 5],
  8: [4, 5, 6], 9: [4, 5, 6], 10: [4, 5, 6, 7], 11: [5, 6, 7], 12: [5, 6, 7, 8],
  13: [6, 7, 8, 9], 14: [6, 7, 8, 9], 15: [7, 8, 9, 10],
};

describe("extraction/load regression baseline", () => {
  it("table + variant + operating-point volumes hold", () => {
    expect(one("SELECT COUNT(*) n FROM performance_tables")).toBeGreaterThanOrEqual(115);
    expect(one("SELECT COUNT(*) n FROM motor_pump_variants")).toBeGreaterThanOrEqual(880);
    expect(one("SELECT COUNT(*) n FROM operating_points")).toBeGreaterThanOrEqual(7500);
  });
  it("agricultural price records and exact mappings hold", () => {
    // The agricultural count was once >=300 because the domestic RLX / TRDX /
    // TRLX / Oil-Filled CORA ranges were being labelled agricultural: they share
    // the CORA family name but are priced against the DOMESTIC booklet, and none
    // of their pumps appear in the agricultural chart. Excluding them dropped the
    // figure to ~258, which is the correct one - so the floor moved down while
    // the mapping floor moved UP, because fewer bogus rows now dilute it.
    expect(one("SELECT COUNT(*) n FROM price_records WHERE segment='agricultural'")).toBeGreaterThanOrEqual(250);
    expect(one("SELECT COUNT(*) n FROM technical_price_mappings WHERE mapping_status='EXACT_AUTO_MATCH'")).toBeGreaterThanOrEqual(160);
  });
  it("the domestic-only CORA motor ranges are never counted as agricultural", () => {
    expect(one(
      "SELECT COUNT(*) n FROM price_records WHERE segment='agricultural' AND category_raw IN ('RLX','TRDX','TRLX','Oil Filled')"
    )).toBe(0);
  });
});

describe("approved-position map is stored correctly (spec §9)", () => {
  it("every supported table's approved positions match the spec map", () => {
    const rows = sqlite.prepare(
      "SELECT id, operating_point_count c, approved_positions p FROM performance_tables WHERE position_supported=1"
    ).all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(ALLOWED[r.c], `table ${r.id} count ${r.c}`).toBeTruthy();
      expect(JSON.parse(r.p)).toEqual(ALLOWED[r.c]);
    }
  });
  it("no supported table exceeds 15 operating points", () => {
    expect(one("SELECT COUNT(*) n FROM performance_tables WHERE position_supported=1 AND operating_point_count>15")).toBe(0);
  });
  it("tables >15 points are flagged unsupported, not silently used", () => {
    expect(one("SELECT COUNT(*) n FROM performance_tables WHERE operating_point_count>15 AND position_supported=1")).toBe(0);
  });
});

describe("data integrity", () => {
  it("missing points have a null measured value (never 0); non-missing have both", () => {
    // orientation A missing -> head null; orientation B missing -> flow null.
    // So a missing point must NOT have both values present.
    expect(one("SELECT COUNT(*) n FROM operating_points WHERE is_missing=1 AND flow_m3h IS NOT NULL AND head_m IS NOT NULL")).toBe(0);
    // and a non-missing point must have both present (what the engine relies on).
    expect(one("SELECT COUNT(*) n FROM operating_points WHERE is_missing=0 AND (flow_m3h IS NULL OR head_m IS NULL)")).toBe(0);
  });
  it("unavailable prices are null, never 0", () => {
    expect(one("SELECT COUNT(*) n FROM price_records WHERE landing_price=0 OR single_pump_price=0 OR above_50k_price=0")).toBe(0);
  });
  it("stage suffixes survive on both sides (4A exists technical + price)", () => {
    expect(one("SELECT COUNT(*) n FROM motor_pump_variants WHERE stage_identity='4A'")).toBeGreaterThan(0);
    expect(one("SELECT COUNT(*) n FROM price_records WHERE stage_identity='4A' AND segment='agricultural'")).toBeGreaterThan(0);
  });
  it("stainless model names are readable, not bare motor frames", () => {
    // no CORAchrom variant should be named like '14 / 22'
    expect(one("SELECT COUNT(*) n FROM motor_pump_variants WHERE pump_family='CORACHROM' AND pump_model GLOB '*[0-9] / [0-9]*'")).toBe(0);
    expect(one("SELECT COUNT(*) n FROM motor_pump_variants WHERE pump_family='CORACHROM' AND pump_model LIKE 'CORAchrom%'")).toBeGreaterThan(0);
  });
});

describe("every purchasable option is linked, not just the exact one (spec §25)", () => {
  it("a booklet row keeps its related-series option even when an exact one exists", () => {
    // UQD 112/20 7.5HP is sold as UQD112/20 AND as UQDs112/20, at different
    // prices. Collecting related candidates only when the exact set was empty
    // silently dropped the second option.
    const n = one(
      `SELECT COUNT(DISTINCT m.price_record_id) n
         FROM technical_price_mappings m
         JOIN motor_pump_variants v ON v.id = m.motor_pump_variant_id
        WHERE v.identity_key = 'UQD|112|20|7.5|3'`
    );
    expect(n).toBeGreaterThanOrEqual(2);
  });
  it("those extra options are SUGGESTED, never silently auto-priced", () => {
    expect(one(
      `SELECT COUNT(*) n FROM technical_price_mappings m
         JOIN motor_pump_variants v ON v.id = m.motor_pump_variant_id
         JOIN price_records p ON p.id = m.price_record_id
        WHERE m.mapping_status = 'EXACT_AUTO_MATCH'
          AND v.pump_family <> p.pump_family
          AND NOT (v.pump_family = 'ULTRA' AND p.pump_family = 'ULTRA+')`
    )).toBe(0);
  });
});
