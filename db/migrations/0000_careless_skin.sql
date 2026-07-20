CREATE TABLE `extraction_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_document_id` integer,
	`page_index` integer,
	`target_type` text,
	`target_id` integer,
	`issue_type` text,
	`severity` text,
	`description` text,
	`source_context` text,
	`status` text DEFAULT 'open',
	`resolution_note` text
);
--> statement-breakpoint
CREATE TABLE `motor_pump_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performance_table_id` integer,
	`pump_family` text,
	`pump_series` text,
	`pump_model` text,
	`motor_family` text,
	`motor_family_normalized` text,
	`motor_rating_kw` real,
	`motor_rating_hp` real,
	`stages_raw` text,
	`stages_numeric` integer,
	`stages_suffix` text,
	`stage_identity` text,
	`nrv_size_mm` real,
	`cable_size_mm2` real,
	`starting_method` text,
	`rated_current_a` real,
	`phase` integer,
	`voltage` integer,
	`identity_key` text,
	`raw_row_text` text,
	`row_order` integer,
	`verification_status` text,
	FOREIGN KEY (`performance_table_id`) REFERENCES `performance_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mpv_identity_idx` ON `motor_pump_variants` (`identity_key`);--> statement-breakpoint
CREATE TABLE `operating_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`motor_pump_variant_id` integer,
	`position_index` integer NOT NULL,
	`flow_m3h` real,
	`flow_lph` real,
	`flow_lpm` real,
	`flow_raw` text,
	`head_m` real,
	`head_ft` real,
	`head_raw` text,
	`is_approved` integer,
	`is_missing` integer,
	`verification_status` text,
	FOREIGN KEY (`motor_pump_variant_id`) REFERENCES `motor_pump_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `op_flow_idx` ON `operating_points` (`flow_m3h`);--> statement-breakpoint
CREATE INDEX `op_appr_idx` ON `operating_points` (`is_approved`);--> statement-breakpoint
CREATE TABLE `performance_tables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_document_id` integer,
	`page_index` integer NOT NULL,
	`printed_page` integer,
	`title` text,
	`orientation` text,
	`category_code` text,
	`flow_type` text,
	`material_type` text,
	`borewell_diameter_mm` real,
	`min_well_diameter_mm` real,
	`pump_family` text,
	`pump_series` text,
	`motor_family` text,
	`phase` integer,
	`voltage` integer,
	`nominal_speed_rpm` real,
	`rotor_material` text,
	`nrv_size_mm` real,
	`operating_point_count` integer,
	`approved_positions` text,
	`position_supported` integer,
	`verification_status` text,
	FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `price_list_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_document_id` integer,
	`effective_date` text,
	`period` text,
	`branch` text,
	`active` integer DEFAULT true,
	`confidential` integer,
	`parser_version` text,
	`imported_at` text,
	FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `price_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`price_list_version_id` integer,
	`page_index` integer,
	`layout` text,
	`segment` text,
	`category_raw` text,
	`in_code` text NOT NULL,
	`material_description_raw` text,
	`pump_family` text,
	`pump_series` text,
	`stages_numeric` integer,
	`stages_suffix` text,
	`stage_identity` text,
	`motor_family` text,
	`motor_family_normalized` text,
	`hp` real,
	`phase` integer,
	`starting_method` text,
	`cable_size_mm2` real,
	`ss_variant` integer,
	`g3_variant` integer,
	`outlet_variant` text,
	`identity_key` text,
	`lp_raw` text,
	`landing_price` integer,
	`single_pump_price` integer,
	`above_50k_price` integer,
	`price_status` text,
	`verification_status` text,
	`issue` text,
	FOREIGN KEY (`price_list_version_id`) REFERENCES `price_list_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pr_identity_idx` ON `price_records` (`identity_key`);--> statement-breakpoint
CREATE INDEX `pr_code_idx` ON `price_records` (`in_code`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_type` text NOT NULL,
	`segment` text,
	`file_name` text NOT NULL,
	`title` text,
	`edition` text,
	`effective_date` text,
	`period` text,
	`branch` text,
	`confidential` integer,
	`checksum` text NOT NULL,
	`total_pages` integer,
	`imported_at` text,
	`parser_version` text,
	`active` integer DEFAULT true,
	`verification_status` text
);
--> statement-breakpoint
CREATE TABLE `technical_price_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`motor_pump_variant_id` integer,
	`price_record_id` integer,
	`identity_key` text,
	`mapping_status` text,
	`mapping_method` text,
	`confidence` real,
	`matched_fields` text,
	`differing_fields` text,
	`manually_reviewed` integer DEFAULT false,
	`review_note` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`motor_pump_variant_id`) REFERENCES `motor_pump_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tpm_mpv_idx` ON `technical_price_mappings` (`motor_pump_variant_id`);--> statement-breakpoint
CREATE INDEX `tpm_status_idx` ON `technical_price_mappings` (`mapping_status`);