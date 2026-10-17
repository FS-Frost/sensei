import type { RequestHandler } from '#lib/server/router.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { leeches, pauseCard } from '#lib/server/srs/service.ts';
import { regenerateMnemonic } from '#lib/server/gemini/enrich.ts';
import { similarTo } from '#lib/server/items.ts';
import { buildProfile } from '#lib/server/profile.ts';

/** Tarjetas que se resisten (sanguijuelas). */
export const GET: RequestHandler = () => handle(() => Response.json({ leeches: leeches(db) }));

/**
 * Tratamientos: `pause` (apartar N días), `mnemonic` (nueva mnemotecnia personalizada, solo kanji),
 * `similar` (kanji parecidos para practicar la diferencia).
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ cardId: number; action: 'pause' | 'mnemonic' | 'similar'; days?: number }>(request);
		const card = db.select().from(s.card).where(eq(s.card.id, Number(b.cardId))).get();
		if (!card) throw new HttpError(404, 'Tarjeta no encontrada');
		if (b.action === 'pause') {
			const days = Math.min(30, Math.max(1, Number(b.days ?? 7) || 7));
			return Response.json({ due: pauseCard(db, card.id, days) });
		}
		if (b.action === 'mnemonic') {
			if (card.itemType !== 'kanji') throw new HttpError(400, 'Solo para kanji');
			return Response.json(await regenerateMnemonic(db, card.itemKey, buildProfile(db).notes));
		}
		if (b.action === 'similar') {
			if (card.itemType !== 'kanji') return Response.json({ similar: [] });
			return Response.json({ similar: similarTo(db, card.itemKey, { limit: 4 }) });
		}
		throw new HttpError(400, 'Acción desconocida');
	});
