// Ingest the extractor JSON outputs into SQLite. Idempotent: clears the
// data tables and reloads. Mapping generation is a separate step (db:mappings).
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite, schema, DB_PATH } from "./client";
import {
  techIdentity, priceIdentity, parseTitle, kwHpStage, splitStage,
  SERIES_STAGE_FAMILIES, normFamily, normMotor, phaseFromMotor,
} from "./identity";

migrate(db, { migrationsFolder: "./db/migrations" });

const TECH = JSON.parse(readFileSync("./extraction/output/technical_catalogue.json", "utf8"));
const PRICE = JSON.parse(readFileSync("./extraction/output/price_list.json", "utf8"));

// ---- reset ----
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
      const isSeriesStage = SERIES_STAGE_FAMILIES.has(normFamily(pt.pumpFamily) ?? "");
      const id = isSeriesStage ? techIdentity(t.title, meta, t.phase ?? null)
                               : { family: normFamily(pt.pumpFamily), series: null, stageId: null,
                                   motorNorm: normMotor(pt.motorFamilies[0]), hp: kh.hp, phase: t.phase ?? null,
                                   key: null, looseKey: null };
      const stage = splitStage(isSeriesStage ? kh.stageRaw : null);
      const pumpModel = isSeriesStage
        ? `${pt.pumpFamily} ${pt.pumpSeries ?? ""}`.trim()
        : (meta[0] ?? pt.pumpFamily ?? null);

      const v = insVariant.values({
        performanceTableId: tableRow.id, pumpFamily: normFamily(pt.pumpFamily),
        pumpSeries: pt.pumpSeries, pumpModel,
        motorFamily: pt.motorFamilies[0] ?? null, motorFamilyNormalized: id.motorNorm,
        motorRatingKw: kh.kw, motorRatingHp: kh.hp,
        stagesRaw: isSeriesStage ? kh.stageRaw : null,
        stagesNumeric: stage.num, stagesSuffix: stage.suffix, stageIdentity: id.stageId,
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
    const keyed = r.segment === "agricultural" ? id.key : null;
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
