import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { logReading, nextRereadAt, readsOf, type TextKind } from '#lib/server/text/library.ts';

const KINDS: TextKind[] = ['graded', 'library', 'speed'];

/** Registra una lectura cronometrada (relectura espaciada y velocidad). */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ textKind: TextKind; textId: number; chars: number; durationMs: number; furigana: string; comprehension?: number }>(
			request
		);
		if (!KINDS.includes(b.textKind)) throw new HttpError(400, 'Tipo inválido');
		const chars = Math.max(1, Math.round(Number(b.chars)));
		const durationMs = Math.round(Number(b.durationMs));
		if (!Number.isFinite(durationMs) || durationMs < 3000) throw new HttpError(400, 'Lectura demasiado corta para medir');
		const row = logReading(db, {
			textKind: b.textKind,
			textId: Number(b.textId),
			chars,
			durationMs,
			furigana: String(b.furigana ?? 'adaptive'),
			comprehension: b.comprehension ?? null
		});
		const reads = readsOf(db, b.textKind, Number(b.textId));
		return Response.json({ log: row, reads, nextReread: nextRereadAt(reads) });
	});
