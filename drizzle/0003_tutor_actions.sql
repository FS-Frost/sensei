CREATE TABLE `tutor_action` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`name` text NOT NULL,
	`args` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`result` text,
	`undo` text,
	`created_at` integer NOT NULL,
	`reported` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tutor_action_session` ON `tutor_action` (`session_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `title_source` text;--> statement-breakpoint
ALTER TABLE `session` ADD `origin` text DEFAULT 'page' NOT NULL;--> statement-breakpoint
-- Sesiones que nunca tuvieron mensajes: ya no se crean (creación perezosa); se limpian las existentes.
DELETE FROM `session_summary` WHERE `session_id` IN (SELECT `id` FROM `session` WHERE NOT EXISTS (SELECT 1 FROM `message` WHERE `message`.`session_id` = `session`.`id`));--> statement-breakpoint
DELETE FROM `session` WHERE NOT EXISTS (SELECT 1 FROM `message` WHERE `message`.`session_id` = `session`.`id`);--> statement-breakpoint
UPDATE `session` SET `title_source` = 'summary' WHERE `summarized` = 1 AND `id` IN (SELECT `session_id` FROM `session_summary`);