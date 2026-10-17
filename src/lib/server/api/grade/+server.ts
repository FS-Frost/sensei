import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { gradeAnswer } from '#lib/server/srs/service.ts';
import type { Facet, ItemType } from '#lib/types.ts';

const TYPES: ItemType[] = ['kana', 'component', 'kanji', 'vocab', 'grammar', 'sentence'];

export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ itemType: ItemType; itemKey: string; facet: Facet; answer: string }>(request);
		if (!TYPES.includes(b.itemType)) throw new HttpError(400, 'itemType inválido');
		return Response.json(gradeAnswer(db, b.itemType, String(b.itemKey), b.facet, String(b.answer ?? '')));
	});
