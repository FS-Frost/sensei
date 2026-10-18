import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { BUDGETS, dailyPlan, daySummary, summaryText } from '#lib/server/daily.ts';

/** Plan de la sesión de hoy (`?min=10|20|40`) y resumen de lo hecho. */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const min = Number(url.searchParams.get('min'));
		const budget = (BUDGETS as readonly number[]).includes(min) ? min : 20;
		const summary = daySummary(db);
		return Response.json({ plan: dailyPlan(db, budget), summary, summaryText: summaryText(summary) });
	});
