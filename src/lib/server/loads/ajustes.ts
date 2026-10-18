import { db } from '#lib/server/db/index.ts';
import { getInternal, getSettings } from '#lib/server/settings.ts';
import { config } from '#lib/server/config.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { BRAKE_HALF, BRAKE_STOP } from '#lib/server/srs/lessons.ts';
import { goalStatus, MILESTONES } from '#lib/server/guide.ts';
import { knownKanji } from '#lib/server/items.ts';
import { MIN_REVIEWS, reviewCount } from '#lib/server/srs/optimizer.ts';
import { effectivePrices } from '#lib/server/gemini/pricing.ts';
import { mixCost, projectCost, roleUsage } from '#lib/server/gemini/usage.ts';
import { PRESETS } from '#lib/modelPresets.ts';

/**
 * Cuánto habría costado cada perfil de modelos: con tu uso real de 30 días (`usd`) o, sin uso, el costo de la mezcla
 * típica por rol (`mix`, solo para comparar perfiles entre sí). Sin red: precios y uso están en la base.
 */
function presetCosts() {
	const prices = effectivePrices(getSettings(db).modelPrices);
	const usage = { pro: roleUsage(db, 'pro', 30), flash: roleUsage(db, 'flash', 30) };
	const hasUsage = usage.pro.length + usage.flash.length > 0;
	return PRESETS.map((p) => {
		const real = hasUsage ? [projectCost(prices, p.pro, usage.pro), projectCost(prices, p.flash, usage.flash)] : null;
		// Sin uso: el rol pro pesa más (tutor y lecturas generan mucho más que las tareas cortas).
		const a = mixCost(prices, p.pro);
		const b = mixCost(prices, p.flash);
		return {
			id: p.id,
			usd: real && real[0] != null && real[1] != null ? real[0] + real[1] : null,
			mix: a != null && b != null ? 0.8 * a + 0.2 * b : null
		};
	});
}

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
	fsrs: { reviews: reviewCount(db), minReviews: MIN_REVIEWS },
	presetCosts: presetCosts()
});
