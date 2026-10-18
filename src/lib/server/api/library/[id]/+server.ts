import type { RequestHandler } from '#lib/server/router.ts';
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
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
		// Capítulos: los textos importados juntos (un EPUB, un texto largo troceado) comparten `created_at`.
		const sibling = (dir: 'prev' | 'next') =>
			db
				.select({ id: s.libraryText.id, title: s.libraryText.title })
				.from(s.libraryText)
				.where(and(eq(s.libraryText.createdAt, t.createdAt), dir === 'next' ? gt(s.libraryText.id, t.id) : lt(s.libraryText.id, t.id)))
				.orderBy(dir === 'next' ? asc(s.libraryText.id) : desc(s.libraryText.id))
				.limit(1)
				.get() ?? null;
		return Response.json({
			text: { id: t.id, title: t.title, origin: t.origin, createdAt: t.createdAt, truncated: t.content.length > stats.chars },
			tokens,
			stats,
			reads,
			nextReread: nextRereadAt(reads),
			queued,
			position: t.position ?? 0,
			bookmarks: t.bookmarks ?? [],
			prev: sibling('prev'),
			next: sibling('next')
		});
	});

/** Lector: guardar la posición (`{ position }`) o los marcadores (`{ bookmarks }`). */
export const PATCH: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const t = textOr404(Number(params.id));
		const b = await body<{ position?: number; bookmarks?: { sentence: number; note?: string; at?: number }[] }>(request);
		const set: Partial<typeof s.libraryText.$inferInsert> = {};
		if (b.position != null) set.position = Math.max(0, Math.floor(Number(b.position) || 0));
		if (Array.isArray(b.bookmarks))
			set.bookmarks = b.bookmarks
				.slice(0, 200)
				.map((x) => ({ sentence: Math.max(0, Math.floor(Number(x.sentence) || 0)), note: String(x.note ?? '').slice(0, 300), at: Number(x.at) || Date.now() }))
				.sort((a, c) => a.sentence - c.sentence);
		if (Object.keys(set).length) db.update(s.libraryText).set(set).where(eq(s.libraryText.id, t.id)).run();
		return new Response(null, { status: 204 });
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
