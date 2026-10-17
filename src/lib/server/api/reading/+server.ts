import type { RequestHandler } from '#lib/server/router.ts';
import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { generateGradedReading, type ReadingLength, type ReadingStyle } from '#lib/server/gemini/texts.ts';
import { trackCost } from '#lib/server/gemini/usage.ts';

const STYLES: ReadingStyle[] = ['manga', 'novela', 'cartel', 'juego', 'web', 'noticia'];
const LENGTHS: ReadingLength[] = ['corto', 'medio', 'largo'];

export const GET: RequestHandler = () =>
	handle(() =>
		Response.json({
			readings: db
				.select({ id: s.generatedText.id, params: s.generatedText.params, content: s.generatedText.content, createdAt: s.generatedText.createdAt })
				.from(s.generatedText)
				.where(eq(s.generatedText.kind, 'reading'))
				.orderBy(desc(s.generatedText.createdAt))
				.limit(20)
				.all()
				.map((r) => ({ id: r.id, params: r.params, title: (r.content as { title?: string }).title ?? '', createdAt: r.createdAt }))
		})
	);

export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ style: ReadingStyle; length: ReadingLength; topic?: string }>(request);
		if (!STYLES.includes(b.style) || !LENGTHS.includes(b.length)) throw new HttpError(400, 'Parámetros inválidos');
		const { result, cost } = await trackCost(() =>
			generateGradedReading(db, { style: b.style, length: b.length, topic: b.topic?.slice(0, 200) })
		);
		return Response.json({ ...result, cost });
	});
