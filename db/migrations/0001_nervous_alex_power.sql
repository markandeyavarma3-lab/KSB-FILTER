CREATE TABLE `mapping_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_key` text NOT NULL,
	`in_code` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`decided_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `md_pair_idx` ON `mapping_decisions` (`identity_key`,`in_code`);