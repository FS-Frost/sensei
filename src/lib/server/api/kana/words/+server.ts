import type { RequestHandler } from '#lib/server/router.ts';
import { sql } from 'drizzle-orm';
import { isKana } from 'wanakana';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { taughtKana } from '#lib/server/kana.ts';
import { wordRomaji } from '#lib/kana.ts';

/**
 * Práctica de lectura sin IA: palabras comunes escritas solo en kana y solo con los kana que ya estudiaste
 * (`?n=` cuántas, 10 por defecto). Sirve desde las primeras filas: leer palabras reales da soltura antes que los kanji.
 */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const n = Math.min(30, Math.max(1, Number(url.searchParams.get('n')) || 10));
		const chars = new Set([...taughtKana(db)].flatMap((k) => [...k]));
		const rows = db.all<{ id: string; f: string; es: string | null; en: string }>(
			sql`select id, main_form as f, glosses_es as es, glosses_en as en from vocab
			    where common = 1 and main_form = main_reading and length(main_form) between 2 and 6`
		);
		const fits = rows.filter((r) => isKana(r.f) && [...r.f].every((c) => chars.has(c)));
		const picked = fits.sort(() => Math.random() - 0.5).slice(0, n);
		return Response.json({
			available: fits.length,
			words: picked.map((r) => {
				const gl = (r.es ? (JSON.parse(r.es) as string[]) : []).concat(JSON.parse(r.en) as string[]);
				return { id: r.id, word: r.f, romaji: wordRomaji(r.f), meaning: gl.slice(0, 2).join('; ') };
			})
		});
	});
