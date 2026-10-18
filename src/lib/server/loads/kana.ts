import { sql } from 'drizzle-orm';
import { db, one } from '#lib/server/db/index.ts';
import { getSettings } from '#lib/server/settings.ts';
import { hiraganaReady, kanaProgress, kanaStatuses } from '#lib/server/kana.ts';
import { KANA_ROWS, kanaKeyRomaji } from '#lib/kanaCourse.ts';

export const load = () => {
	const st = getSettings(db);
	return {
		rows: KANA_ROWS.map((r) => ({ ...r, romaji: r.chars.map(kanaKeyRomaji) })),
		statuses: kanaStatuses(db),
		progress: kanaProgress(db),
		hiraganaReady: hiraganaReady(db),
		startLevel: st.startLevel,
		placementDone: (one<{ n: number }>(sql`select count(*) as n from review_log where source = 'placement'`)?.n ?? 0) > 0
	};
};
