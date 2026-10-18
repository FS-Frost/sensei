import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle } from '#lib/server/http.ts';
import { applyReview, ensureCard, recordConfusion } from '#lib/server/srs/service.ts';
import { acceptedRomaji, ALL_KANA, kanaScript } from '#lib/kana.ts';
import { knownCard, markKanaAssessed } from '#lib/server/kana.ts';

import { KANA_SLOW_MS as SLOW_MS } from '#lib/algoConstants.ts';

type Result = { kana: string; answer: string; ms: number };

/**
 * Resultado del diagnóstico. Lo dominado (correcto y rápido) queda como «ya sabido» (en repaso, verificado dentro de
 * unas semanas); lo dudoso o fallado entra a aprender. `skipped`: escrituras que el alumno no sabe (se cortó la
 * muestra por muchos fallos): no se crea nada, el curso de kana las enseñará desde cero.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const { results, skipped } = await body<{ results: Result[]; skipped?: ('hiragana' | 'katakana')[] }>(request);
		const skip = new Set(skipped ?? []);
		const weak: { kana: string; reason: 'wrong' | 'slow'; answer: string }[] = [];
		let known = 0;
		const now = Date.now();
		for (const r of results ?? []) {
			if (!ALL_KANA.includes(r.kana) || skip.has(kanaScript(r.kana))) continue;
			const answer = String(r.answer ?? '').trim().toLowerCase().replace(/[\s'-]/g, '');
			const correct = acceptedRomaji(r.kana).includes(answer);
			if (correct && r.ms < SLOW_MS) {
				if (knownCard(db, 'kana', r.kana, 'reading', 'diagnostic', now)) known++;
				continue;
			}
			weak.push({ kana: r.kana, reason: correct ? 'slow' : 'wrong', answer });
			const card = ensureCard(db, 'kana', r.kana, 'reading');
			applyReview(db, card.id, { correct, answer, durationMs: r.ms, source: 'diagnostic' });
			if (!correct) {
				const other = ALL_KANA.find((k) => kanaScript(k) === kanaScript(r.kana) && acceptedRomaji(k).includes(answer));
				if (other) recordConfusion(db, 'kana', r.kana, other);
			}
		}
		markKanaAssessed(db);
		return Response.json({ weak, known, total: results?.length ?? 0, skipped: [...skip] });
	});
