import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { resolveItem } from '#lib/server/gemini/actions.ts';
import { enqueue } from '#lib/server/srs/lessons.ts';
import { ensureCard } from '#lib/server/srs/service.ts';

/**
 * «＋ A mi próxima lección» desde una ficha del chat: `{ item }` (kanji, palabra o id/patrón de gramática).
 * La gramática no usa cola: se crea su tarjeta.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const { item } = await body<{ item: string }>(request);
		const it = resolveItem(db, item);
		if (!it) throw new HttpError(404, 'No encontrado');
		if (it.type === 'grammar') ensureCard(db, 'grammar', it.key, 'meaning');
		else enqueue(db, [{ type: it.type, key: it.key }]);
		return Response.json({ ok: true, type: it.type, display: it.display });
	});
