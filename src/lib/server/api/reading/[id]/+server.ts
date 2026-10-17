import type { RequestHandler } from '#lib/server/router.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { nextRereadAt, readsOf } from '#lib/server/text/library.ts';

export const GET: RequestHandler = ({ params }) =>
	handle(() => {
		const row = db.select().from(s.generatedText).where(eq(s.generatedText.id, Number(params.id))).get();
		if (!row) throw new HttpError(404, 'No encontrado');
		const reads = readsOf(db, row.kind === 'speed' ? 'speed' : 'graded', row.id);
		return Response.json({ id: row.id, kind: row.kind, content: row.content, reads, nextReread: nextRereadAt(reads) });
	});
