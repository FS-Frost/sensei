import { db, one } from '#lib/server/db/index.ts';
import { getSettings } from '#lib/server/settings.ts';
import { readableKanji } from '#lib/server/items.ts';
import { dueCount } from '#lib/server/srs/service.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { sql } from 'drizzle-orm';

export const load = () => {
	const st = getSettings(db);
	const imported = (one<{ n: number }>(sql`select count(*) as n from kanji`)?.n ?? 0) > 0;
	return {
		furigana: st.furigana,
		ttsEnabled: st.ttsEnabled,
		fontVariety: st.fontVariety,
		readable: [...readableKanji(db)].join(''),
		due: dueCount(db),
		gemini: hasGemini(),
		imported
	};
};
