import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { applyReview, ensureCard, gradeAnswer, gradeSpoken, recordConfusion } from '#lib/server/srs/service.ts';
import type { AnswerVia, Facet, ItemType } from '#lib/types.ts';
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
	/** Cómo se respondió; con opciones la nota no pasa de «Bien». */
	via?: AnswerVia;
	/** Por voz: alternativas del reconocedor (se corrige con ellas, no con `answer`). */
	alternatives?: string[];
};

const VIAS: AnswerVia[] = ['typed', 'choice', 'voice', 'trace'];

/** Aplica la respuesta al SRS (crea la tarjeta si no existe, p. ej. en lecciones). */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<Body>(request);
		if (!b.itemType || !b.itemKey || !b.facet) throw new HttpError(400, 'Faltan campos');
		const spoken = Array.isArray(b.alternatives);
		const graded = spoken
			? gradeSpoken(db, b.itemType, b.itemKey, b.facet, b.alternatives!.map(String).slice(0, 10))
			: gradeAnswer(db, b.itemType, b.itemKey, b.facet, b.answer ?? '');
		const correct = graded.correct || !!b.override;
		const card = ensureCard(db, b.itemType, b.itemKey, b.facet);
		const res = applyReview(db, card.id, {
			correct,
			grade: b.grade,
			answer: spoken ? graded.heard : b.answer,
			durationMs: b.durationMs,
			source: b.source === 'lesson' ? 'lesson' : 'review',
			via: b.facet === 'writing' ? 'trace' : spoken ? 'voice' : b.via && VIAS.includes(b.via) ? b.via : undefined
		});
		if (!correct && graded.confusedWith) recordConfusion(db, b.itemType, b.itemKey, graded.confusedWith);
		return Response.json({ ...res, correct, cardId: card.id });
	});
