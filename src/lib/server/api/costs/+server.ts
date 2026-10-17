import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { getSettings, updateSettings } from '#lib/server/settings.ts';
import { models } from '#lib/server/gemini/client.ts';
import { DEFAULT_PRICES, effectivePrices, normalizePrices, priceKey, type ModelPrices } from '#lib/server/gemini/pricing.ts';
import { costReport, FEATURES, recomputeCosts, type CostRange } from '#lib/server/gemini/usage.ts';

const RANGES: CostRange[] = [7, 30, 90, 0];

function pricesInfo() {
	const st = getSettings(db);
	const prices = effectivePrices(st.modelPrices);
	const m = models(db);
	return {
		prices,
		defaults: DEFAULT_PRICES,
		custom: st.modelPrices != null,
		// Modelos configurados ahora y para qué se usa cada uno.
		configured: [
			{ role: 'pro', model: m.pro, priced: !!priceKey(prices, m.pro) },
			{ role: 'flash', model: m.flash, priced: !!priceKey(prices, m.flash) }
		],
		budget: st.monthlyBudgetUsd,
		hardStop: st.budgetHardStop
	};
}

export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const r = Number(url.searchParams.get('range') ?? 30) as CostRange;
		const range = RANGES.includes(r) ? r : 30;
		return Response.json({ report: costReport(db, range), ...pricesInfo(), features: FEATURES });
	});

/**
 * `{ prices }` guarda la tabla (null = volver a los de por defecto), `{ budget }` el presupuesto mensual (null = sin),
 * `{ recompute: true }` recalcula el historial con los precios actuales.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ prices?: ModelPrices | null; budget?: number | null; hardStop?: boolean; recompute?: boolean }>(request);
		if ('hardStop' in b) updateSettings(db, { budgetHardStop: !!b.hardStop });
		if ('prices' in b) {
			let prices: ModelPrices | null = null;
			if (b.prices) {
				try {
					prices = normalizePrices(b.prices);
				} catch (e) {
					throw new HttpError(400, e instanceof Error ? e.message : 'Precios inválidos');
				}
			}
			updateSettings(db, { modelPrices: prices });
		}
		if ('budget' in b) {
			const n = b.budget == null ? null : Number(b.budget);
			if (n != null && (!Number.isFinite(n) || n < 0)) throw new HttpError(400, 'Presupuesto inválido');
			updateSettings(db, { monthlyBudgetUsd: n || null });
		}
		const recomputed = b.recompute ? recomputeCosts(db) : null;
		return Response.json({ ok: true, recomputed, ...pricesInfo() });
	});
