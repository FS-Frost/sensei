import type { RequestHandler } from '#lib/server/router.ts';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { analyzeText } from '#lib/server/text/analyze.ts';
import { nextRereadAt, readsOf } from '#lib/server/text/library.ts';

function textOr404(id: number) {
	const t = db.select().from(s.libraryText).where(eq(s.libraryText.id, id)).get();
	if (!t) throw new HttpError(404, 'Texto no encontrado');
	return t;
}

/** Texto analizado (tokens con lectura y estado) + cobertura + plan + historial de lecturas. */
export const GET: RequestHandler = ({ params }) =>
	handle(() => {
		const t = textOr404(Number(params.id));
		db.update(s.libraryText).set({ lastOpenedAt: Date.now() }).where(eq(s.libraryText.id, t.id)).run();
		const { tokens, stats } = analyzeText(db, t.content);
		const reads = readsOf(db, 'library', t.id);
		const queued = db
			.select({ t: s.studyQueue.itemType, k: s.studyQueue.itemKey })
			.from(s.studyQueue)
			.where(eq(s.studyQueue.sourceTextId, t.id))
			.all().length;
		return Response.json({
			text: { id: t.id, title: t.title, origin: t.origin, createdAt: t.createdAt, truncated: t.content.length > stats.chars },
			tokens,
			stats,
			reads,
			nextReread: nextRereadAt(reads),
			queued
		});
	});

export const DELETE: RequestHandler = ({ params }) =>
	handle(() => {
		const t = textOr404(Number(params.id));
		db.transaction((tx) => {
			tx.delete(s.readingLog).where(and(eq(s.readingLog.textKind, 'library'), eq(s.readingLog.textId, t.id))).run();
			tx.run(sql`update study_queue set source_text_id = null where source_text_id = ${t.id}`);
			tx.delete(s.libraryText).where(eq(s.libraryText.id, t.id)).run();
		});
		return new Response(null, { status: 204 });
	});
