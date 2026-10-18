import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { getComponentInfo, getKanjiInfo, similarTo } from '#lib/server/items.ts';
import {
	ensureComponentExplanations,
	ensureComponentNames,
	ensureGlossesEs,
	ensureMnemonics,
	ensureSentencesEs,
	ensureSimilarTips
} from '#lib/server/gemini/enrich.ts';
import { componentsToExplain, wordsFor } from '#lib/server/gemini/pregen.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';

/**
 * Genera (y cachea) para un kanji lo mismo que su lección: nombres y explicaciones de sus componentes,
 * mnemotecnias, glosas y frases de su vocabulario y consejos de kanji parecidos.
 * Para un componente (que no es kanji), su nombre y su explicación. Cada paso salta lo que ya existe.
 */
export const POST: RequestHandler = ({ params }) =>
	handle(async () => {
		// Sin key cada paso se saltaría en silencio: mejor decirlo.
		if (!hasGemini()) throw new HttpError(400, 'Falta la API key de Gemini: añádela en Ajustes.');
		const k = getKanjiInfo(db, params.char, { vocabLimit: 12 });
		if (!k) {
			if (!getComponentInfo(db, params.char)) throw new HttpError(404, 'Kanji no encontrado');
			await ensureComponentNames(db, [params.char]);
			await ensureComponentExplanations(db, [params.char]);
			return Response.json({ ok: true });
		}
		const symbols = k.components.map((c) => c.symbol);
		await ensureComponentNames(db, symbols);
		await ensureComponentExplanations(db, componentsToExplain(db, symbols));
		await ensureMnemonics(db, [k.char]);
		const words = [...new Set([...k.vocab.map((v) => v.id), ...wordsFor(db, [k.char])])];
		await ensureGlossesEs(db, words);
		await ensureSentencesEs(db, wordsFor(db, [k.char]));
		await ensureSimilarTips(
			db,
			similarTo(db, k.char, { limit: 6 }).map((x) => ({ a: k.char, b: x.char }))
		);
		return Response.json({ ok: true });
	});
