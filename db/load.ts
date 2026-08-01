// Ingest the extractor JSON outputs into SQLite. Idempotent: clears the
// data tables and reloads. Mapping generation is a separate step (db:mappings).
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite, schema, DB_PATH } from "./client";
import {
  techIdentity, priceIdentity, parseTitle, kwHpStage, splitStage, monosubKey, MONOSUB_PRICE_PHASE, ultraKey,
  SERIES_STAGE_FAMILIES, normFamily, normMotor, phaseFromMotor,
} from "./identity";

migrate(db, { migrationsFolder: "./db/migrations" });

const TECH = JSON.parse(readFileSync("./extraction/output/technical_catalogue.json", "utf8"));
const PRICE = JSON.parse(readFileSync("./extraction/output/price_list.json", "utf8"));

// ---- reset ----
// NOTE: schema.mappingDecisions is deliberately absent from this list. It holds
// the operator's manual approve/reject decisions, which must outlive a re-import
// (spec section 27). Adding it here would silently discard that review work.
for (const t of [
  schema.technicalPriceMappings, schema.operatingPoints, schema.motorPumpVariants,
  schema.performanceTables, schema.priceRecords, schema.priceListVersions,
  schema.sourceDocuments, schema.extractionIssues,
]) db.delete(t).run();

const now = new Date().toISOString();

// ---- source documents ----
const techDoc = db.insert(schema.sourceDocuments).values({
  documentType: "technical_catalogue", segment: "agricultural",
  fileName: TECH.file_name, title: "Agricultural Pumps Performance Booklet 2025",
  edition: "2025", checksum: TECH.checksum, totalPages: TECH.total_pages,
  importedAt: now, parserVersion: TECH.parser_version, active: true,
  verificationStatus: "AUTO_HIGH_CONFIDENCE",
}).returning({ id: schema.sourceDocuments.id }).get();

const priceDoc = db.insert(schema.sourceDocuments).values({
  documentType: "price_list", segment: "mixed", fileName: PRICE.file_name,
  title: "Confidential Price List", effectiveDate: PRICE.effective_date,
  period: PRICE.period, branch: PRICE.branch, confidential: !!PRICE.confidential,
  checksum: PRICE.checksum, totalPages: PRICE.total_pages, importedAt: now,
  parserVersion: PRICE.parser_version, active: true,
  verificationStatus: "AUTO_HIGH_CONFIDENCE",
}).returning({ id: schema.sourceDocuments.id }).get();

const version = db.insert(schema.priceListVersions).values({
  sourceDocumentId: priceDoc.id, effectiveDate: PRICE.effective_date,
  period: PRICE.period, branch: PRICE.branch, active: true,
  confidential: !!PRICE.confidential, parserVersion: PRICE.parser_version, importedAt: now,
}).returning({ id: schema.priceListVersions.id }).get();

// ---- category classifier for a table (display) ----
function categoryCode(t: any): string {
  const pt = parseTitle(t.title);
  const ft = pt.flowType;
  const bore = pt.borewellMm;
  if (/CORAchrom/i.test(t.title || "")) return "stainless_steel";
  if (ft === "monobloc") return "monobloc";
  if (ft === "openwell") return "openwell";
  if (bore) return `borewell_${bore}`;
  if (/VO |MRV|MREG/i.test(t.title || "")) return "vertical_openwell";
  return "other";
}

// ---- technical load ----
const insTable = db.insert(schema.performanceTables);
const insVariant = db.insert(schema.motorPumpVariants);
const insOp = db.insert(schema.operatingPoints);

let nVar = 0, nOp = 0, nKeyed = 0;
const loadTech = sqlite.transaction(() => {
  for (const t of TECH.tables) {
    const pt = parseTitle(t.title);
    const tableRow = insTable.values({
      sourceDocumentId: techDoc.id, pageIndex: t.page_index, printedPage: t.page_index + 1,
      title: t.title, orientation: t.orientation, categoryCode: categoryCode(t),
      flowType: pt.flowType, materialType: /CORAchrom/i.test(t.title || "") ? "ss" : "ci",
      borewellDiameterMm: pt.borewellMm, minWellDiameterMm: t.min_well_diameter_mm ?? null,
      pumpFamily: normFamily(pt.pumpFamily), pumpSeries: pt.pumpSeries,
      motorFamily: pt.motorFamilies[0] ?? null, phase: t.phase ?? null, voltage: t.voltage ?? null,
      nominalSpeedRpm: t.nominal_speed_rpm ?? null, rotorMaterial: t.rotor_material ?? null,
      nrvSizeMm: t.nrv_size_mm ?? null, operatingPointCount: t.operating_point_count ?? null,
      approvedPositions: JSON.stringify(t.approved_positions ?? []),
      positionSupported: t.position_supported ?? true,
      verificationStatus: t.position_supported === false ? "NEEDS_REVIEW" : "AUTO_HIGH_CONFIDENCE",
    }).returning({ id: schema.performanceTables.id }).get();

    let rowOrder = 0;
    for (const row of t.parsed_rows) {
      const meta: string[] = row.meta_cells ?? [];
      const kh = kwHpStage(meta);
      const fam = normFamily(pt.pumpFamily) ?? "";
      const isSeriesStage = SERIES_STAGE_FAMILIES.has(fam);
      // stainless CORAchrom: not a priced series-stage family, but the cell after
      // HP IS a real stage and the title carries the readable model name.
      const isStainless = fam.startsWith("CORACHROM") || fam === "CORA75";
      const id = isSeriesStage ? techIdentity(t.title, meta, t.phase ?? null)
                               : { family: fam || null, series: pt.pumpSeries, stageId: null,
                                   motorNorm: normMotor(pt.motorFamilies[0]), hp: kh.hp, phase: t.phase ?? null,
                                   key: null, looseKey: null };
      // display stage: series-stage families + stainless read it from the meta row
      const stage = splitStage((isSeriesStage || isStainless) ? kh.stageRaw : null);
      const stageIdDisp = isSeriesStage ? id.stageId : stage.identity;
      // model name: "family series" for series-stage; the title's pump token for
      // stainless or when meta[0] is a bare motor-frame code (e.g. "14 / 22");
      // otherwise meta[0] which is already a real model (VO/MR/ULTRA).
      const frameJunk = /^\d+(?:\.\d+)?\s*\/\s*\d+$/.test((meta[0] ?? "").trim());
      const pumpModel = isSeriesStage
        ? `${pt.pumpFamily} ${pt.pumpSeries ?? ""}`.trim()
        : (isStainless || frameJunk || !meta[0]) ? (pt.pumpToken ?? pt.pumpFamily ?? null)
        : meta[0];

      // Monosub R is model-coded: its identity comes from the casing designation
      // in the row itself ("MR 3 A / 3 C- 60-50-21"), not from series+stage.
      if (fam === "MR") id.key = monosubKey(pumpModel, t.phase ?? null);
      // ULTRA+ monoblocs are model-coded as "<model> <size>" in the row text.
      if (fam === "ULTRA" || fam === "ULTRA+") {
        id.key = ultraKey(row.meta_raw ?? meta[0], kh.hp, t.phase ?? null);
      }

      const v = insVariant.values({
        performanceTableId: tableRow.id, pumpFamily: normFamily(pt.pumpFamily),
        pumpSeries: pt.pumpSeries, pumpModel,
        motorFamily: pt.motorFamilies[0] ?? null, motorFamilyNormalized: id.motorNorm,
        motorRatingKw: kh.kw, motorRatingHp: kh.hp,
        stagesRaw: (isSeriesStage || isStainless) ? kh.stageRaw : null,
        stagesNumeric: stage.num, stagesSuffix: stage.suffix, stageIdentity: stageIdDisp,
        nrvSizeMm: t.nrv_size_mm ?? null, startingMethod: t.starting_method_panel ?? null,
        phase: t.phase ?? null, voltage: t.voltage ?? null,
        identityKey: id.key, rawRowText: row.meta_raw, rowOrder: rowOrder++,
        verificationStatus: "AUTO_HIGH_CONFIDENCE",
      }).returning({ id: schema.motorPumpVariants.id }).get();
      nVar++; if (id.key) nKeyed++;

      for (const op of row.operating_points) {
        insOp.values({
          motorPumpVariantId: v.id, positionIndex: op.position,
          flowM3h: op.flow_m3h, flowLph: op.flow_lph, flowLpm: op.flow_lpm, flowRaw: op.flow_raw,
          headM: op.head_m, headFt: op.head_ft, headRaw: op.head_raw,
          isApproved: !!op.is_approved, isMissing: !!op.is_missing,
          verificationStatus: op.is_missing ? "MISSING_VALUE" : "AUTO_HIGH_CONFIDENCE",
        }).run();
        nOp++;
      }
    }
  }
});
loadTech();

// ---- price load ----
let nPrice = 0, nPriceKeyed = 0;
const loadPrice = sqlite.transaction(() => {
  for (const r of PRICE.records) {
    const phase = r.phase ?? phaseFromMotor(r.motor_family, r.category_raw);
    const id = priceIdentity({
      pumpFamily: r.pump_family, pumpSeries: r.pump_series, stageIdentity: r.stage_identity,
      motorFamily: r.motor_family, hp: r.hp, phase,
    });
    // Monosub R price rows are model-coded too; match the loader's technical key.
    const fam = normFamily(r.pump_family);
    const monosub = fam === "MR"
      ? monosubKey(r.material_description_raw, MONOSUB_PRICE_PHASE)
      : null;
    // ULTRA+ is three-phase throughout the agricultural booklet (415 V); the
    // single-phase "ULTRA + S" range carries no model/size designation.
    const ultra = (fam === "ULTRA" || fam === "ULTRA+")
      ? ultraKey(r.material_description_raw, r.hp, 3)
      : null;
    const keyed = r.segment === "agricultural" ? (monosub ?? ultra ?? id.key) : null;
    db.insert(schema.priceRecords).values({
      priceListVersionId: version.id, pageIndex: r.page_index, layout: r.layout,
      segment: r.segment, categoryRaw: r.category_raw, inCode: r.in_code,
      materialDescriptionRaw: r.material_description_raw, pumpFamily: normFamily(r.pump_family),
      pumpSeries: r.pump_series, stagesNumeric: r.stage_numeric, stagesSuffix: r.stage_suffix,
      stageIdentity: r.stage_identity, motorFamily: r.motor_family,
      motorFamilyNormalized: normMotor(r.motor_family), hp: r.hp, phase,
      startingMethod: r.starting_method, cableSizeMm2: r.cable_size_mm2,
      ssVariant: !!r.ss_variant, g3Variant: !!r.g3_variant,
      identityKey: keyed, lpRaw: r.lp_raw, landingPrice: r.landing_price,
      singlePumpPrice: r.single_pump_price, above50kPrice: r.above_50k_price,
      priceStatus: r.price_status, verificationStatus: r.verification_status,
      issue: r.issue ?? null,
    }).run();
    nPrice++; if (keyed) nPriceKeyed++;
  }
});
loadPrice();

console.error(`tables=${TECH.tables.length} variants=${nVar} (keyed=${nKeyed}) operating_points=${nOp}`);
console.error(`price_records=${nPrice} (agri keyed=${nPriceKeyed})`);
console.error(`-> ${DB_PATH}`);
