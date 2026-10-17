import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { nextLesson, type LessonKind } from '#lib/server/srs/lessons.ts';
import {
	ensureComponentNames,
	ensureGlossesEs,
	ensureMnemonics,
	ensureSentencesEs,
	ensureSimilarTips
} from '#lib/server/gemini/enrich.ts';
import { errorMessage } from '#lib/server/gemini/client.ts';
import { buildReviewItem } from '#lib/server/srs/service.ts';
import { facetsFor } from '#lib/server/srs/service.ts';

export const GET: RequestHandler = ({ url }) =>
	handle(async () => {
		const kind = (url.searchParams.get('kind') ?? 'auto') as LessonKind;
		let { items, quota } = nextLesson(db, kind);

		// Enriquecer con Gemini (nombres, mnemotecnias, glosas). Si falla, la lección sigue con lo que hay.
		let warning: string | null = null;
		try {
			const comps = [
				...new Set(items.flatMap((i) => (i.type === 'component' ? [i.key] : i.type === 'kanji' ? i.kanji.components.map((c) => c.symbol) : [])))
			];
			await ensureComponentNames(db, comps);
			await ensureMnemonics(db, items.filter((i) => i.type === 'kanji').map((i) => i.key));
			const vocabIds = items.filter((i) => i.type === 'vocab').map((i) => i.key);
			const kanjiVocab = items.flatMap((i) => (i.type === 'kanji' ? i.kanji.vocab.map((v) => v.id) : []));
			await ensureGlossesEs(db, [...vocabIds, ...kanjiVocab]);
			await ensureSentencesEs(db, vocabIds);
			await ensureSimilarTips(
				db,
				items.flatMap((i) => (i.type === 'kanji' ? i.similar.map((x) => ({ a: i.key, b: x.char })) : []))
			);
			({ items, quota } = nextLesson(db, kind)); // recargar con lo generado
		} catch (e) {
			warning = `Gemini no disponible: ${errorMessage(e)}`;
		}

		const quiz = items.flatMap((i) =>
			facetsFor(i.type).map((facet) => buildReviewItem(db, { id: null, itemType: i.type, itemKey: i.key, facet }))
		);
		return Response.json({ items, quiz, quota, warning });
	});
