import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { config } from '#lib/server/config.ts';
import { isCompatibleModel, listModels, models, type ModelInfo } from '#lib/server/gemini/client.ts';
import { getSettings } from '#lib/server/settings.ts';
import { effectivePrices, priceSummary } from '#lib/server/gemini/pricing.ts';
import { mixCost, projectCost, roleUsage } from '#lib/server/gemini/usage.ts';

type Role = 'pro' | 'flash';
const ROLES: Role[] = ['pro', 'flash'];
const DAYS = 30;

/**
 * Modelos disponibles para la API key con lo necesario para elegir: límites, razonamiento, precio vigente
 * y próximo tramo, y por rol: costo de tu uso real de 30 días repreciado con ese modelo (el cliente calcula
 * la relación frente al modelo elegido en el formulario).
 */
export const GET: RequestHandler = () =>
	handle(async () => {
		const prices = effectivePrices(getSettings(db).modelPrices);
		const current = models(db);
		const list: ModelInfo[] = [...(await listModels())];
		// Los configurados aparecen aunque la API no los liste (p. ej. escritos a mano).
		for (const id of new Set([current.pro, current.flash]))
			if (!list.some((m) => m.id === id))
				list.push({ id, displayName: id, description: '', inputLimit: null, outputLimit: null, thinking: null, compatible: isCompatibleModel(id) });

		const usage = Object.fromEntries(ROLES.map((r) => [r, roleUsage(db, r, DAYS)])) as Record<Role, ReturnType<typeof roleUsage>>;
		// Tu uso real del rol repreciado con cada modelo (o la mezcla típica si aún no hay uso).
		const cost = (role: Role, model: string) =>
			usage[role].length ? projectCost(prices, model, usage[role]) : mixCost(prices, model);

		const out = list.map((m) => {
			const p = priceSummary(prices, m.id);
			const roles = Object.fromEntries(
				ROLES.map((r) => {
					// `usd` sirve para comparar (el cliente lo divide por el del modelo elegido en el formulario);
					// `estimate` solo con uso real, para mostrar «≈ $X».
					const usd = cost(r, m.id);
					return [r, { usd, estimate: usage[r].length ? usd : null }];
				})
			) as Record<Role, { usd: number | null; estimate: number | null }>;
			return { ...m, price: p ? { key: p.key, now: p.now, next: p.next } : null, roles };
		});

		return Response.json({
			models: out,
			current,
			env: { pro: config.modelPro, flash: config.modelFlash },
			days: DAYS,
			usageCalls: { pro: usage.pro.length, flash: usage.flash.length }
		});
	});
