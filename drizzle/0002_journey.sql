CREATE TABLE `library_text` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_opened_at` integer
);
--> statement-breakpoint
CREATE TABLE `mined_sentence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jp` text NOT NULL,
	`es` text,
	`target` text NOT NULL,
	`target_reading` text NOT NULL,
	`vocab_id` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text_kind` text NOT NULL,
	`text_id` integer NOT NULL,
	`chars` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`cpm` real NOT NULL,
	`furigana` text NOT NULL,
	`comprehension` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reading_log_text` ON `reading_log` (`text_kind`,`text_id`);--> statement-breakpoint
CREATE INDEX `reading_log_time` ON `reading_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `similar_kanji` (
	`a` text NOT NULL,
	`b` text NOT NULL,
	`score` real NOT NULL,
	`tip` text,
	PRIMARY KEY(`a`, `b`)
);
--> statement-breakpoint
CREATE INDEX `similar_b` ON `similar_kanji` (`b`);--> statement-breakpoint
CREATE TABLE `study_queue` (
	`item_type` text NOT NULL,
	`item_key` text NOT NULL,
	`source_text_id` integer,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`item_type`, `item_key`)
);
--> statement-breakpoint
CREATE TABLE `weekly_report` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` integer NOT NULL,
	`metrics` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
