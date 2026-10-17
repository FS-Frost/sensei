CREATE TABLE `gemini_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`model` text NOT NULL,
	`feature` text NOT NULL,
	`session_id` integer,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`thoughts_tokens` integer DEFAULT 0 NOT NULL,
	`tool_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`image_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`ok` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gemini_usage_at` ON `gemini_usage` (`at`);--> statement-breakpoint
CREATE INDEX `gemini_usage_session` ON `gemini_usage` (`session_id`);