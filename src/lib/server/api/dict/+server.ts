import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { getComponentInfo, getKanjiInfo, itemStatuses, lookupInflected, similarTo } from '#lib/server/items.ts';
import { isKanjiChar } from '#lib/jp.ts';
import type { VocabInfo } from '#lib/types.ts';

/**
 * Búsqueda para el hover/tap del diccionario.
 * `q` = forma base sugerida (p. ej. el kanji); `b` = texto tal como aparece, que puede venir conjugado y con
 * kana de más («食べたのは»): se prueban sus prefijos de mayor a menor, deconjugando cada uno.
 */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);
		const b = (url.searchParams.get('b') ?? '').trim().slice(0, 40);
		if (!q && !b) return Response.json({ words: [] });
		let words: VocabInfo[] = [];
		const tried = new Set<string>();
		const candidates: string[] = [];
		if (b && b !== q) for (let n = [...b].length; n > 0; n--) candidates.push([...b].slice(0, n).join(''));
		candidates.push(q);
		for (const c of candidates) {
			if (!c || tried.has(c)) continue;
			tried.add(c);
			words = lookupInflected(db, c, 4);
			if (words.length) break;
		}
		const st = itemStatuses(db, 'vocab', words.map((w) => w.id));
		const single = [...q].length === 1;
		return Response.json({
			words: words.map((w) => ({ ...w, status: st.get(w.id) })),
			kanji: single && isKanjiChar(q) ? getKanjiInfo(db, q, { vocabLimit: 4 }) : null,
			similar: single && isKanjiChar(q) ? similarTo(db, q, { limit: 3 }) : [],
			component: single && !isKanjiChar(q) ? getComponentInfo(db, q) : null
		});
	});
