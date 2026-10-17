ALTER TABLE `component` ADD `name_source` text;--> statement-breakpoint
ALTER TABLE `vocab` ADD `glosses_es_source` text;--> statement-breakpoint
-- Relleno: lo existente se asume del diccionario (no hay forma de distinguir traducciones previas de Gemini).
UPDATE `vocab` SET `glosses_es_source` = CASE WHEN `id` LIKE 'u:%' THEN 'user' ELSE 'jmdict' END WHERE `glosses_es` IS NOT NULL;--> statement-breakpoint
UPDATE `component` SET `name_source` = 'static' WHERE `name_es` IS NOT NULL;