import { sqliteTable, integer, text, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---- source documents & pages (traceability, spec section 30.1/30.2) -------
export const sourceDocuments = sqliteTable("source_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentType: text("document_type").notNull(), // technical_catalogue | price_list
  segment: text("segment"),
  fileName: text("file_name").notNull(),
  title: text("title"),
  edition: text("edition"),
  effectiveDate: text("effective_date"),
  period: text("period"),
  branch: text("branch"),
  confidential: integer("confidential", { mode: "boolean" }),
  checksum: text("checksum").notNull(),
  totalPages: integer("total_pages"),
  importedAt: text("imported_at"),
  parserVersion: text("parser_version"),
  active: integer("active", { mode: "boolean" }).default(true),
  verificationStatus: text("verification_status"),
});

// ---- price list versions (spec section 28) ---------------------------------
export const priceListVersions = sqliteTable("price_list_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceDocumentId: integer("source_document_id").references(() => sourceDocuments.id),
  effectiveDate: text("effective_date"),
  period: text("period"),
  branch: text("branch"),
  active: integer("active", { mode: "boolean" }).default(true),
  confidential: integer("confidential", { mode: "boolean" }),
  parserVersion: text("parser_version"),
  importedAt: text("imported_at"),
});

// ---- performance tables (spec section 30.5) --------------------------------
export const performanceTables = sqliteTable("performance_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceDocumentId: integer("source_document_id").references(() => sourceDocuments.id),
  pageIndex: integer("page_index").notNull(),         // 0-based pdf page
  printedPage: integer("printed_page"),               // 1-based
  title: text("title"),
  orientation: text("orientation"),                   // A | B | C
  categoryCode: text("category_code"),                // borewell_100 | radial | ...
  flowType: text("flow_type"),                        // radial | mixed | openwell | monobloc
  materialType: text("material_type"),                // ci | ss
  borewellDiameterMm: real("borewell_diameter_mm"),
  minWellDiameterMm: real("min_well_diameter_mm"),
  pumpFamily: text("pump_family"),
  pumpSeries: text("pump_series"),
  motorFamily: text("motor_family"),
  phase: integer("phase"),
  voltage: integer("voltage"),
  nominalSpeedRpm: real("nominal_speed_rpm"),
  rotorMaterial: text("rotor_material"),
  nrvSizeMm: real("nrv_size_mm"),
  operatingPointCount: integer("operating_point_count"),
  approvedPositions: text("approved_positions"),      // json array
  positionSupported: integer("position_supported", { mode: "boolean" }),
  verificationStatus: text("verification_status"),
});

// ---- motor / pump variants (spec section 30.6) -----------------------------
export const motorPumpVariants = sqliteTable("motor_pump_variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  performanceTableId: integer("performance_table_id").references(() => performanceTables.id),
  pumpFamily: text("pump_family"),
  pumpSeries: text("pump_series"),
  pumpModel: text("pump_model"),
  motorFamily: text("motor_family"),
  motorFamilyNormalized: text("motor_family_normalized"),
  motorRatingKw: real("motor_rating_kw"),
  motorRatingHp: real("motor_rating_hp"),
  stagesRaw: text("stages_raw"),
  stagesNumeric: integer("stages_numeric"),
  stagesSuffix: text("stages_suffix"),
  stageIdentity: text("stage_identity"),
  nrvSizeMm: real("nrv_size_mm"),
  cableSizeMm2: real("cable_size_mm2"),
  startingMethod: text("starting_method"),
  ratedCurrentA: real("rated_current_a"),
  phase: integer("phase"),
  voltage: integer("voltage"),
  identityKey: text("identity_key"),                  // normalized match key
  rawRowText: text("raw_row_text"),
  rowOrder: integer("row_order"),
  verificationStatus: text("verification_status"),
}, (t) => ({ idIdx: index("mpv_identity_idx").on(t.identityKey) }));

// ---- operating points (spec section 30.7) ----------------------------------
export const operatingPoints = sqliteTable("operating_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  motorPumpVariantId: integer("motor_pump_variant_id").references(() => motorPumpVariants.id),
  positionIndex: integer("position_index").notNull(),
  flowM3h: real("flow_m3h"),
  flowLph: real("flow_lph"),
  flowLpm: real("flow_lpm"),
  flowRaw: text("flow_raw"),
  headM: real("head_m"),
  headFt: real("head_ft"),
  headRaw: text("head_raw"),
  isApproved: integer("is_approved", { mode: "boolean" }),
  isMissing: integer("is_missing", { mode: "boolean" }),
  verificationStatus: text("verification_status"),
}, (t) => ({
  flowIdx: index("op_flow_idx").on(t.flowM3h),
  apprIdx: index("op_appr_idx").on(t.isApproved),
}));

// ---- price records (spec section 30.9) -------------------------------------
export const priceRecords = sqliteTable("price_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  priceListVersionId: integer("price_list_version_id").references(() => priceListVersions.id),
  pageIndex: integer("page_index"),
  layout: text("layout"),
  segment: text("segment"),                           // agricultural | domestic | ambiguous
  categoryRaw: text("category_raw"),
  inCode: text("in_code").notNull(),
  materialDescriptionRaw: text("material_description_raw"),
  pumpFamily: text("pump_family"),
  pumpSeries: text("pump_series"),
  stagesNumeric: integer("stages_numeric"),
  stagesSuffix: text("stages_suffix"),
  stageIdentity: text("stage_identity"),
  motorFamily: text("motor_family"),
  motorFamilyNormalized: text("motor_family_normalized"),
  hp: real("hp"),
  phase: integer("phase"),
  startingMethod: text("starting_method"),
  cableSizeMm2: real("cable_size_mm2"),
  ssVariant: integer("ss_variant", { mode: "boolean" }),
  g3Variant: integer("g3_variant", { mode: "boolean" }),
  outletVariant: text("outlet_variant"),
  identityKey: text("identity_key"),
  lpRaw: text("lp_raw"),                               // audit only, never displayed
  landingPrice: integer("landing_price"),
  singlePumpPrice: integer("single_pump_price"),
  above50kPrice: integer("above_50k_price"),
  priceStatus: text("price_status"),
  verificationStatus: text("verification_status"),
  issue: text("issue"),
}, (t) => ({
  idIdx: index("pr_identity_idx").on(t.identityKey),
  codeIdx: index("pr_code_idx").on(t.inCode),
}));

// ---- technical <-> price mappings (spec section 30.10) ---------------------
export const technicalPriceMappings = sqliteTable("technical_price_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  motorPumpVariantId: integer("motor_pump_variant_id").references(() => motorPumpVariants.id),
  priceRecordId: integer("price_record_id").references(() => priceRecords.id),
  identityKey: text("identity_key"),
  mappingStatus: text("mapping_status"),   // EXACT_AUTO_MATCH | SUGGESTED_RELATED_SERIES | ...
  mappingMethod: text("mapping_method"),   // exact_automatic | suggested | manual
  confidence: real("confidence"),
  matchedFields: text("matched_fields"),   // json
  differingFields: text("differing_fields"),
  manuallyReviewed: integer("manually_reviewed", { mode: "boolean" }).default(false),
  reviewNote: text("review_note"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
}, (t) => ({
  mpvIdx: index("tpm_mpv_idx").on(t.motorPumpVariantId),
  statusIdx: index("tpm_status_idx").on(t.mappingStatus),
}));

// Durable record of manual review decisions (spec section 27).
//
// technical_price_mappings is rebuilt from scratch on every import, and row ids
// are reassigned, so a decision cannot be stored against them. Decisions are
// keyed here by the BUSINESS identity of the pair - the technical identity key
// plus the price IN code - both of which are stable across re-extraction. This
// table is deliberately never cleared by the loader.
export const mappingDecisions = sqliteTable("mapping_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  identityKey: text("identity_key").notNull(),   // technical variant identity
  inCode: text("in_code").notNull(),             // price record IN code
  decision: text("decision").notNull(),          // MANUALLY_APPROVED | MANUALLY_REJECTED
  note: text("note"),
  decidedAt: text("decided_at"),
}, (t) => ({
  pairIdx: uniqueIndex("md_pair_idx").on(t.identityKey, t.inCode),
}));

// ---- extraction issues / data quality (spec section 30.11) -----------------
export const extractionIssues = sqliteTable("extraction_issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceDocumentId: integer("source_document_id"),
  pageIndex: integer("page_index"),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  issueType: text("issue_type"),
  severity: text("severity"),
  description: text("description"),
  sourceContext: text("source_context"),
  status: text("status").default("open"),
  resolutionNote: text("resolution_note"),
});
