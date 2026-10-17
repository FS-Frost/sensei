import { db } from '#lib/server/db/index.ts';
import { getInternal, getSettings } from '#lib/server/settings.ts';
import { config } from '#lib/server/config.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { BRAKE_HALF, BRAKE_STOP } from '#lib/server/srs/lessons.ts';
import { goalStatus, MILESTONES } from '#lib/server/guide.ts';
import { knownKanji } from '#lib/server/items.ts';
import { MIN_REVIEWS, reviewCount } from '#lib/server/srs/optimizer.ts';

/** «AIza…X1y2»: suficiente para reconocerla sin mostrarla entera. */
function mask(key: string) {
	return key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '';
}

export const load = () => ({
	settings: getSettings(db),
	env: {
		modelPro: config.modelPro,
		modelFlash: config.modelFlash,
		gemini: hasGemini(),
		apiKey: mask(config.geminiApiKey)
	},
	dict: { version: getInternal(db, 'dictVersion'), variant: getInternal(db, 'dictVariant') ?? 'common' },
	brake: { half: BRAKE_HALF, stop: BRAKE_STOP },
	goal: goalStatus(db),
	milestones: MILESTONES.filter((m) => m.kanji > 0),
	known: knownKanji(db).length,
	fsrs: { reviews: reviewCount(db), minReviews: MIN_REVIEWS }
});
