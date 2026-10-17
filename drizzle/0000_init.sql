CREATE TABLE `card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_type` text NOT NULL,
	`item_key` text NOT NULL,
	`facet` text NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`fsrs` text NOT NULL,
	`created_at` integer NOT NULL,
	`suspended` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_item` ON `card` (`item_type`,`item_key`,`facet`);--> statement-breakpoint
CREATE INDEX `card_due` ON `card` (`due`);--> statement-breakpoint
CREATE INDEX `card_created` ON `card` (`created_at`);--> statement-breakpoint
CREATE TABLE `component` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name_es` text,
	`strokes` integer,
	`learn_order` integer
);
--> statement-breakpoint
CREATE INDEX `component_learn_order` ON `component` (`learn_order`);--> statement-breakpoint
CREATE TABLE `confusion` (
	`kind` text NOT NULL,
	`a` text NOT NULL,
	`b` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `a`, `b`)
);
--> statement-breakpoint
CREATE TABLE `generated_text` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`params` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kanji` (
	`char` text PRIMARY KEY NOT NULL,
	`meanings_es` text DEFAULT '[]' NOT NULL,
	`meanings_en` text DEFAULT '[]' NOT NULL,
	`on_readings` text DEFAULT '[]' NOT NULL,
	`kun_readings` text DEFAULT '[]' NOT NULL,
	`strokes` integer,
	`grade` integer,
	`freq` integer,
	`jlpt` integer,
	`learn_order` integer,
	`mnemonic_meaning` text,
	`mnemonic_reading` text
);
--> statement-breakpoint
CREATE INDEX `kanji_learn_order` ON `kanji` (`learn_order`);--> statement-breakpoint
CREATE TABLE `kanji_component` (
	`kanji` text NOT NULL,
	`symbol` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`kanji`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `kc_symbol` ON `kanji_component` (`symbol`);--> statement-breakpoint
CREATE TABLE `learner_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`ui` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_session` ON `message` (`session_id`);--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer,
	`item_type` text NOT NULL,
	`item_key` text NOT NULL,
	`facet` text,
	`rating` integer,
	`correct` integer NOT NULL,
	`answer` text,
	`duration_ms` integer,
	`source` text NOT NULL,
	`reviewed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rl_time` ON `review_log` (`reviewed_at`);--> statement-breakpoint
CREATE INDEX `rl_item` ON `review_log` (`item_type`,`item_key`);--> statement-breakpoint
CREATE TABLE `sentence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vocab_id` text,
	`jp` text NOT NULL,
	`en` text,
	`es` text,
	`source` text DEFAULT 'tatoeba' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sentence_vocab` ON `sentence` (`vocab_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`title` text,
	`started_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`summarized` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_summary` (
	`session_id` integer PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vocab` (
	`id` text PRIMARY KEY NOT NULL,
	`main_form` text NOT NULL,
	`main_reading` text NOT NULL,
	`kanji_forms` text DEFAULT '[]' NOT NULL,
	`kana_forms` text DEFAULT '[]' NOT NULL,
	`common` integer DEFAULT false NOT NULL,
	`pos` text DEFAULT '[]' NOT NULL,
	`glosses_en` text DEFAULT '[]' NOT NULL,
	`glosses_es` text,
	`source` text DEFAULT 'jmdict' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vocab_form` (
	`form` text NOT NULL,
	`vocab_id` text NOT NULL,
	PRIMARY KEY(`form`, `vocab_id`)
);
--> statement-breakpoint
CREATE INDEX `vf_vocab` ON `vocab_form` (`vocab_id`);--> statement-breakpoint
CREATE TABLE `vocab_kanji` (
	`vocab_id` text NOT NULL,
	`kanji` text NOT NULL,
	PRIMARY KEY(`vocab_id`, `kanji`)
);
--> statement-breakpoint
CREATE INDEX `vk_kanji` ON `vocab_kanji` (`kanji`);