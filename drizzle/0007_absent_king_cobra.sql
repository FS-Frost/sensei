ALTER TABLE `kanji` ADD `mnemonic_source` text;--> statement-breakpoint
ALTER TABLE `sentence` ADD `es_source` text;--> statement-breakpoint
ALTER TABLE `similar_kanji` ADD `tip_source` text;