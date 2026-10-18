import { db } from '#lib/server/db/index.ts';
import { journey } from '#lib/server/guide.ts';
import { BRAKE_HALF, BRAKE_STOP } from '#lib/server/srs/lessons.ts';
import { RETENTION_DAYS } from '#lib/server/data/backups.ts';
import { LEECH_LAPSES } from '#lib/server/srs/service.ts';
import { MIN_REVIEWS } from '#lib/server/srs/optimizer.ts';
import { BANDS, PER_BAND } from '#lib/server/srs/placement.ts';
import { REREAD_DAYS } from '#lib/server/text/library.ts';
import { DEFAULT_SETTINGS, getSettings } from '#lib/server/settings.ts';
import { HIRAGANA_CORE } from '#lib/kanaCourse.ts';

export const load = () => {
	const st = getSettings(db);
	return {
		journey: journey(db),
		brake: { half: BRAKE_HALF, stop: BRAKE_STOP },
		retentionDays: RETENTION_DAYS,
		// Números reales de los algoritmos para «Cómo funciona por dentro» (nada escrito a mano en la Guía).
		algo: {
			leechLapses: LEECH_LAPSES,
			minReviews: MIN_REVIEWS,
			bands: BANDS.length,
			perBand: PER_BAND,
			lastBand: BANDS.at(-1)![1],
			rereadDays: REREAD_DAYS,
			defaultRetention: DEFAULT_SETTINGS.desiredRetention,
			retention: st.desiredRetention,
			hiraganaCore: HIRAGANA_CORE.length,
			kanaPerDay: st.newKanaPerDay,
			kanjiPerDay: st.newKanjiPerDay
		}
	};
};
