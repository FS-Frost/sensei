import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { generateGradedReading, type ReadingStyle } from '#lib/server/gemini/texts.ts';
import { offlineSpeedText } from '#lib/server/text/sentences.ts';
import { analyzeText } from '#lib/server/text/analyze.ts';
import { speedHistory } from '#lib/server/text/library.ts';

/** Historial de velocidad. */
export const GET: RequestHandler = () => handle(() => Response.json({ history: speedHistory(db) }));

/**
 * Nuevo texto para el reto de velocidad (~300 caracteres a tu nivel).
 * Con Gemini: lectura graduada; sin Gemini: frases de Tatoeba con solo kanji conocidos.
 */
export const POST: RequestHandler = () =>
	handle(async () => {
		if (hasGemini()) {
			const styles: ReadingStyle[] = ['manga', 'novela', 'web', 'juego'];
			const { id, reading } = await generateGradedReading(db, {
				style: styles[Math.floor(Math.random() * styles.length)],
				length: 'medio'
			});
			return Response.json({ id, title: reading.title, lines: reading.lines.map((l) => l.tokens), source: 'gemini' });
		}
		const off = offlineSpeedText(db);
		if (!off) throw new HttpError(409, 'Aún no conoces suficientes kanji para un reto sin IA (mínimo ~15).');
		const row = db
			.insert(s.generatedText)
			.values({ kind: 'speed', params: {}, content: { title: 'Reto de velocidad', sentences: off.sentences }, createdAt: Date.now() })
			.returning({ id: s.generatedText.id })
			.get();
		return Response.json({
			id: row.id,
			title: 'Reto de velocidad',
			lines: off.sentences.map((x) => analyzeText(db, x.jp).tokens),
			source: 'tatoeba'
		});
	});
