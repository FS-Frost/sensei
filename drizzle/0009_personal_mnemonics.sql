-- Mnemotecnias hechas a medida por el tutor (acción confirmada «Nueva mnemotecnia», con los intereses del alumno):
-- origen `personal`, para no publicarlas nunca como contenido pregenerado. Las de «tarjetas que se resisten» no dejan
-- registro; las detecta scripts/pregen-import.ts por las tarjetas con muchos fallos.
UPDATE `kanji` SET `mnemonic_source` = 'personal'
WHERE `mnemonic_meaning` IS NOT NULL
	AND coalesce(`mnemonic_source`, 'gemini') = 'gemini'
	AND `char` IN (
		SELECT json_extract(`args`, '$.kanji') FROM `tutor_action`
		WHERE `name` = 'regenerate_mnemonic' AND `status` = 'confirmed'
	);
