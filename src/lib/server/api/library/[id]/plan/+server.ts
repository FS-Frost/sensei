import type { RequestHandler } from '#lib/server/router.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { analyzeText } from '#lib/server/text/analyze.ts';
import { enqueue } from '#lib/server/srs/lessons.ts';
import { updateSettings } from '#lib/server/settings.ts';
import { knownKanji } from '#lib/server/items.ts';

/**
 * Convierte el plan del texto en cola de estudio: sus palabras clave (y los kanji que necesitan) entran primero en
 * las próximas lecciones. Opcional `goalDate` (yyyy-mm-dd): objetivo «leer este texto» = todos sus kanji.
 */
export const POST: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const t = db.select().from(s.libraryText).where(eq(s.libraryText.id, Number(params.id))).get();
		if (!t) throw new HttpError(404, 'Texto no encontrado');
		const b = await body<{ words?: string[]; goalDate?: string }>(request).catch(() => ({}) as { words?: string[]; goalDate?: string });
		const { stats } = analyzeText(db, t.content);
		const words = b.words?.length ? b.words.filter((w) => stats.unknownWords.some((u) => u.id === w)) : stats.plan.words;
		const wordKanji = stats.unknownWords.filter((u) => words.includes(u.id)).flatMap((u) => u.kanji);
		const kanji = [...new Set(wordKanji)].filter((k) => stats.unknownKanji.some((u) => u.char === k));
		enqueue(
			db,
			[...kanji.map((k) => ({ type: 'kanji' as const, key: k })), ...words.map((w) => ({ type: 'vocab' as const, key: w }))],
			t.id
		);
		let goal = null;
		if (b.goalDate) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(b.goalDate)) throw new HttpError(400, 'Fecha inválida');
			const target = knownKanji(db).length + stats.unknownKanji.length;
			goal = updateSettings(db, { goal: { label: `Leer «${t.title}»`, kanji: target, date: b.goalDate, textId: t.id } }).goal;
			// Todos los kanji del texto, por frecuencia en el texto, a la cola.
			enqueue(db, stats.unknownKanji.map((u) => ({ type: 'kanji' as const, key: u.char })), t.id);
		}
		return Response.json({ queuedWords: words.length, queuedKanji: kanji.length, goal });
	});
