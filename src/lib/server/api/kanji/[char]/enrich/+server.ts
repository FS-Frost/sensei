import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { getKanjiInfo } from '#lib/server/items.ts';
import { ensureComponentNames, ensureGlossesEs, ensureMnemonics } from '#lib/server/gemini/enrich.ts';

/** Genera (y cachea) nombres de componentes, mnemotecnias y glosas en español para un kanji. */
export const POST: RequestHandler = ({ params }) =>
	handle(async () => {
		const k = getKanjiInfo(db, params.char, { vocabLimit: 12 });
		if (!k) throw new HttpError(404, 'Kanji no encontrado');
		await ensureComponentNames(db, k.components.map((c) => c.symbol));
		await ensureMnemonics(db, [k.char]);
		await ensureGlossesEs(db, k.vocab.map((v) => v.id));
		return Response.json({ ok: true });
	});
