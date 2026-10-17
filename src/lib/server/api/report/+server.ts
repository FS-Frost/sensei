import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { generateWeeklyReport, listReports, weekMetrics } from '#lib/server/report.ts';
import { trackCost } from '#lib/server/gemini/usage.ts';

export const GET: RequestHandler = () =>
	handle(() => Response.json({ reports: listReports(db), current: weekMetrics(db) }));

/** Genera el informe de la semana (con el tutor si hay Gemini; si no, uno local). */
export const POST: RequestHandler = () =>
	handle(async () => {
		const { result, cost } = await trackCost(() => generateWeeklyReport(db));
		return Response.json({ ...result, cost });
	});
