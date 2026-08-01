import { describe, it, expect } from "vitest";
import {
  splitStage, normSeries, normFamily, looseFamily, kwHpStage, parseTitle,
  techIdentity, priceIdentity, phaseFromMotor, monosubKey, ultraKey, ultraLooseKey,
} from "@/db/identity";

describe("splitStage — suffixes are preserved (spec §23)", () => {
  it("04A -> num 4, suffix A, identity 4A", () => {
    expect(splitStage("04A")).toEqual({ num: 4, suffix: "A", identity: "4A" });
  });
  it("bare 4 stays 4 (not 4A)", () => {
    expect(splitStage("4").identity).toBe("4");
  });
  it("12M1 keeps its full suffix", () => {
    expect(splitStage("12M1").identity).toBe("12M1");
  });
  it("4 !== 4A", () => {
    expect(splitStage("4").identity).not.toBe(splitStage("4A").identity);
  });
});

describe("normSeries — numeric-series letters belong to the stage (spec §24)", () => {
  it("BPD 242A -> series 242", () => expect(normSeries("BPD", "242A")).toBe("242"));
  it("UQD 152 -> 152", () => expect(normSeries("UQD", "152")).toBe("152"));
  it("CORA 1C keeps the letter", () => expect(normSeries("CORA", "1C")).toBe("1C"));
  it("CORA 2AH keeps letters", () => expect(normSeries("CORA", "2AH")).toBe("2AH"));
});

describe("looseFamily — related-series only", () => {
  it("UQDS -> UQD", () => expect(looseFamily("UQDS")).toBe("UQD"));
  it("BPD unchanged", () => expect(looseFamily("BPD")).toBe("BPD"));
});

describe("kwHpStage — finds kW/HP pair then the stage cell", () => {
  it("CORA 1C borewell row", () => {
    const r = kwHpStage(["0.75 / 22", "0.75", "1.0", "21", "32", "1.5", "2.4"]);
    expect(r).toMatchObject({ kw: 0.75, hp: 1.0, stageRaw: "21" });
  });
  it("radial row with dual current columns", () => {
    const r = kwHpStage(["2 / 22", "2.20", "3.0", "10", "50", "1.5", "DOL", "5.8", "5.8"]);
    expect(r).toMatchObject({ hp: 3.0, stageRaw: "10" });
  });
  it("never rounds HP (7.5 stays 7.5)", () => {
    const r = kwHpStage(["6 / 22", "5.50", "7.5", "4", "65"]);
    expect(r.hp).toBe(7.5);
  });
});

describe("parseTitle", () => {
  it("borewell CORA", () => {
    const t = parseTitle("CORA 1C + UMAI 100 : 100 mm Borewell Submersible Pumpset");
    expect(t.pumpFamily).toBe("CORA");
    expect(t.pumpSeries).toBe("1C");
    expect(t.pumpToken).toBe("CORA 1C");
    expect(t.borewellMm).toBe(100);
    expect(t.motorFamilies[0]).toMatch(/UMAI/);
  });
  it("stainless model token is readable", () => {
    const t = parseTitle("CORAchrom 150-17A + UMA 150 : 150 mm Borewell Submersible Pumpset");
    expect(t.pumpFamily).toBe("CORACHROM");
    expect(t.pumpSeries).toBe("17A");
    expect(t.pumpToken).toBe("CORAchrom 150-17A");
  });
  it("flow type from title", () => {
    expect(parseTitle("UQD 112 + UMAI 150 (Radial Flow) : 150 mm ...").flowType).toBe("radial");
    expect(parseTitle("BPD 242A + UMAI 150 (Mixed Flow) : 150 mm ...").flowType).toBe("mixed");
  });
});

describe("techIdentity ↔ priceIdentity produce equal keys for a real pair", () => {
  it("BPD 242A / stage 4A / 5 HP / 3ph", () => {
    // technical booklet: 'BPD 242A' title, meta row for the 4A pump
    const tech = techIdentity(
      "BPD 242A + UMAI 150 (Mixed Flow) : 150 mm Borewell Submersible Pumpset",
      ["3 / 22", "3.70", "5.0", "4A", "65", "1.5", "DOL", "9.5", "9.5"],
      3,
    );
    // price list: 'BPD242/04A+UMAI 150-3/22'
    const price = priceIdentity({
      pumpFamily: "BPD", pumpSeries: "242", stageIdentity: "4A",
      motorFamily: "UMAI 150", hp: 5, phase: 3,
    });
    expect(tech.key).toBe("BPD|242|4A|5|3");
    expect(tech.key).toBe(price.key);
  });
  it("bare 4 does NOT match 4A", () => {
    const a = priceIdentity({ pumpFamily: "BPD", pumpSeries: "242", stageIdentity: "4", motorFamily: null, hp: 5, phase: 3 });
    const b = priceIdentity({ pumpFamily: "BPD", pumpSeries: "242", stageIdentity: "4A", motorFamily: null, hp: 5, phase: 3 });
    expect(a.key).not.toBe(b.key);
  });
});

describe("phaseFromMotor convention", () => {
  it("(S) motors are single phase", () => expect(phaseFromMotor("XUMA DX(S)100", null)).toBe(1));
  it("UMAI is three phase", () => expect(phaseFromMotor("UMAI 150", null)).toBe(3));
});

describe("Monosub R — model-coded identity (openwell, spec §9/§22)", () => {
  it("recognises the Monosub R family from its worded title", () => {
    expect(parseTitle("Monosub R (MR) : Horizontal Openwell Submersible Pumpset").pumpFamily).toBe("MR");
  });
  it("recognises the vertical multistage range separately", () => {
    expect(parseTitle("MONOSUB RV : Vertical Multistage Openwell Submersible Pumpset").pumpFamily).toBe("MRV");
  });
  it("single-phase Monosub R titles still resolve to MR", () => {
    expect(parseTitle("Monosub R (S) : Openwell Submersible Pumpset").pumpFamily).toBe("MR");
  });

  it("booklet A/C dual designation and the price row agree on one key", () => {
    // "MR 3 A / 3 C- 60-50-21" (booklet) must equal "MR 3 C- 60-50-21" (price)
    expect(monosubKey("MR 3 A / 3 C- 60-50-21", 3)).toBe(monosubKey("MR 3 C- 60-50-21 DOL 1.5 sq.mm", 3));
  });
  it("builds hp + casing designation into the key", () => {
    expect(monosubKey("MR 5 C- 90-75-18 DOL 2.5 sq.mm", 3)).toBe("MR|90-75-18|5|3");
  });
  it("keeps phase in the key so a 1-phase row never takes a 3-phase price", () => {
    expect(monosubKey("MR (S) 5 C- 60-50-34", 1)).not.toBe(monosubKey("MR 5 C- 60-50-34 DOL 2.5 sq.mm", 3));
  });
  it("different casing sizes never collide", () => {
    expect(monosubKey("MR 3 C- 50-40-25", 3)).not.toBe(monosubKey("MR 3 C- 50-40-29", 3));
  });
  it("stock rows without a casing designation stay unkeyed", () => {
    expect(monosubKey("MR(S)10CX 10M CABLE", 3)).toBeNull();
    expect(monosubKey("MR(T) SS 15X 3 MTR", 3)).toBeNull();
  });
});

describe("ULTRA+ monobloc — model-coded identity", () => {
  it("booklet row and price row agree on one key", () => {
    // booklet "ULTRA+ 526 3025 ..."  vs  price "ULTRA+ 526 3025 GP"
    expect(ultraKey("ULTRA+ 526 3025 3.70 5.0 80 65 8.3", 5, 3))
      .toBe(ultraKey("ULTRA+ 526 3025 GP", 5, 3));
  });
  it("the price list's GP marker carries no engineering meaning", () => {
    expect(ultraKey("ULTRA+ 526 3025 GP", 5, 3)).toBe("ULTRA+|526|3025||5|3");
  });
  it("keeps the (GS) slow-speed range distinct from the standard range", () => {
    expect(ultraKey("ULTRA+ (GS) 311 100100", 3, 3)).not.toBe(ultraKey("ULTRA+ 311 100100", 3, 3));
  });
  it("an ISI build never takes a non-ISI price", () => {
    expect(ultraKey("ULTRA+ 524 3025 I", 5, 3)).not.toBe(ultraKey("ULTRA+ 524 3025", 5, 3));
  });
  it("near-miss model numbers do NOT collide (211 vs 212)", () => {
    expect(ultraKey("ULTRA+ (GS) 211 8080", 2, 3)).not.toBe(ultraKey("ULTRA+ (GS) 212 8080", 2, 3));
  });
  it("different casing sizes never collide", () => {
    expect(ultraKey("ULTRA+ 1034 4040", 10, 3)).not.toBe(ultraKey("ULTRA+ 1034 4030", 10, 3));
  });
  it("rows without a model/size designation stay unkeyed", () => {
    expect(ultraKey("ULTRA", 5, 3)).toBeNull();
  });
});

describe("ULTRA+ model-number drift between the two documents", () => {
  it("(GS) 211 and (GS) 212 reconcile once the model number is dropped", () => {
    // price list prints 211, booklet prints 212; casing 8080 and 2.0 HP agree
    expect(ultraLooseKey("ULTRA+ (GS) 211 8080", 2, 3))
      .toBe(ultraLooseKey("ULTRA+ (GS) 212 8080 1.50 2.0 80 80 3.9", 2, 3));
  });
  it("but they are NOT an exact match — must stay a suggestion", () => {
    expect(ultraKey("ULTRA+ (GS) 211 8080", 2, 3)).not.toBe(ultraKey("ULTRA+ (GS) 212 8080", 2, 3));
  });
  it("the slow-speed (GS) range never reconciles with the standard range", () => {
    expect(ultraLooseKey("ULTRA+ (GS) 513 100100", 5, 3))
      .not.toBe(ultraLooseKey("ULTRA+ 513 100100", 5, 3));
  });
  it("a different casing still never reconciles", () => {
    expect(ultraLooseKey("ULTRA+ (GS) 811 150150", 7.5, 3))
      .not.toBe(ultraLooseKey("ULTRA+ (GS) 810 100100", 7.5, 3));
  });
  it("a different HP still never reconciles", () => {
    expect(ultraLooseKey("ULTRA+ (GS) 513 100100", 5, 3))
      .not.toBe(ultraLooseKey("ULTRA+ (GS) 515 100100", 3, 3));
  });
});
