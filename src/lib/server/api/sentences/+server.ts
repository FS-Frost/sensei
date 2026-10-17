import type { RequestHandler } from '#lib/server/router.ts';
import { desc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { mineSentence, MiningError } from '#lib/server/text/sentences.ts';
import { itemStatuses } from '#lib/server/items.ts';

export const GET: RequestHandler = () =>
	handle(() => {
		const rows = db.select().from(s.minedSentence).orderBy(desc(s.minedSentence.createdAt)).limit(300).all();
		const st = itemStatuses(db, 'sentence', rows.map((r) => String(r.id)));
		return Response.json({ sentences: rows.map((r) => ({ ...r, status: st.get(String(r.id)) })) });
	});

/** Guarda una frase como tarjeta en contexto: { jp, es?, target, targetReading?, vocabId?, source }. */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ jp: string; es?: string; target: string; targetReading?: string; vocabId?: string; source?: string }>(request);
		try {
			return Response.json(mineSentence(db, { ...b, source: b.source ?? 'manual' }));
		} catch (e) {
			if (e instanceof MiningError) throw new HttpError(400, e.message);
			throw e;
		}
	});
