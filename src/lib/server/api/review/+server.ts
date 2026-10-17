import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { buildReviewItem, dueCards, interleave } from '#lib/server/srs/service.ts';

/** Repasos pendientes ahora, mezclados. */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 100) || 100);
		const type = url.searchParams.get('type');
		const cards = dueCards(db, Date.now(), 1000).filter((c) => !type || c.itemType === type);
		const items = interleave(cards.slice(0, limit)).map((c) => buildReviewItem(db, c));
		return Response.json({ items, total: cards.length });
	});
