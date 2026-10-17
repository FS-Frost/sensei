import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { applyReview, ensureCard, gradeAnswer, recordConfusion } from '#lib/server/srs/service.ts';
import type { Facet, ItemType } from '#lib/types.ts';
import type { Grade } from '#lib/server/srs/fsrs.ts';

type Body = {
	itemType: ItemType;
	itemKey: string;
	facet: Facet;
	answer: string;
	/** El alumno marca su respuesta como correcta (errata, sinónimo válido). */
	override?: boolean;
	grade?: Grade;
	durationMs?: number;
	source?: 'review' | 'lesson';
};

/** Aplica la respuesta al SRS (crea la tarjeta si no existe, p. ej. en lecciones). */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<Body>(request);
		if (!b.itemType || !b.itemKey || !b.facet) throw new HttpError(400, 'Faltan campos');
		const graded = gradeAnswer(db, b.itemType, b.itemKey, b.facet, b.answer ?? '');
		const correct = graded.correct || !!b.override;
		const card = ensureCard(db, b.itemType, b.itemKey, b.facet);
		const res = applyReview(db, card.id, {
			correct,
			grade: b.grade,
			answer: b.answer,
			durationMs: b.durationMs,
			source: b.source === 'lesson' ? 'lesson' : 'review'
		});
		if (!correct && graded.confusedWith) recordConfusion(db, b.itemType, b.itemKey, graded.confusedWith);
		return Response.json({ ...res, correct, cardId: card.id });
	});
