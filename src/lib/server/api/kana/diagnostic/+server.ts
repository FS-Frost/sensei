import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle } from '#lib/server/http.ts';
import { applyReview, ensureCard, recordConfusion } from '#lib/server/srs/service.ts';
import { acceptedRomaji, ALL_KANA, kanaScript } from '#lib/kana.ts';

/** Más lento que esto se considera "dudoso" y entra al SRS aunque sea correcto. */
const SLOW_MS = 4000;

type Result = { kana: string; answer: string; ms: number };

export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const { results } = await body<{ results: Result[] }>(request);
		const weak: { kana: string; reason: 'wrong' | 'slow'; answer: string }[] = [];
		for (const r of results ?? []) {
			if (!ALL_KANA.includes(r.kana)) continue;
			const answer = String(r.answer ?? '').trim().toLowerCase();
			const correct = acceptedRomaji(r.kana).includes(answer);
			if (correct && r.ms < SLOW_MS) continue;
			weak.push({ kana: r.kana, reason: correct ? 'slow' : 'wrong', answer });
			const card = ensureCard(db, 'kana', r.kana, 'reading');
			applyReview(db, card.id, { correct, answer, durationMs: r.ms, source: 'diagnostic' });
			if (!correct) {
				const other = ALL_KANA.find((k) => kanaScript(k) === kanaScript(r.kana) && acceptedRomaji(k).includes(answer));
				if (other) recordConfusion(db, 'kana', r.kana, other);
			}
		}
		return Response.json({ weak, total: results?.length ?? 0 });
	});
