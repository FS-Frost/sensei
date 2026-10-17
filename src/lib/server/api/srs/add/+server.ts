import type { RequestHandler } from '#lib/server/router.ts';
const randomUUID = () => crypto.randomUUID();
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { ensureCard, facetsFor } from '#lib/server/srs/service.ts';
import { lookupWord } from '#lib/server/items.ts';
import { isKanjiChar, kanjiIn } from '#lib/jp.ts';
import { GRAMMAR_BY_ID } from '#lib/grammar.ts';

type Body = { kanji?: string; vocabId?: string; word?: string; base?: string; reading?: string; gloss?: string; grammar?: string };

/**
 * Añade un ítem al SRS. Acepta un kanji, un id de vocabulario, o una palabra (se busca en el diccionario;
 * si no existe y viene con lectura y glosa —p. ej. desde el explicador— se crea como vocabulario propio).
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<Body>(request);
		if (b.grammar) {
			if (!GRAMMAR_BY_ID.has(b.grammar)) throw new HttpError(404, 'Punto de gramática desconocido');
			const c = ensureCard(db, 'grammar', b.grammar, 'meaning');
			return Response.json({ type: 'grammar', key: b.grammar, cards: [c.id] });
		}
		let type: 'kanji' | 'vocab';
		let key: string;
		if (b.kanji && [...b.kanji].length === 1 && isKanjiChar(b.kanji)) {
			type = 'kanji';
			key = b.kanji;
		} else if (b.vocabId) {
			type = 'vocab';
			key = b.vocabId;
		} else if (b.word) {
			const found = lookupWord(db, b.base || b.word, 1)[0] ?? lookupWord(db, b.word, 1)[0];
			if (found) {
				type = 'vocab';
				key = found.id;
			} else {
				if (!b.reading || !b.gloss) throw new HttpError(404, 'Palabra no encontrada en el diccionario');
				const form = b.base || b.word;
				key = `u:${randomUUID()}`;
				type = 'vocab';
				db.insert(s.vocab)
					.values({
						id: key,
						mainForm: form,
						mainReading: b.reading,
						kanjiForms: kanjiIn(form).length ? [form] : [],
						kanaForms: [b.reading],
						common: false,
						glossesEs: [b.gloss],
						glossesEsSource: 'user',
						glossesEn: [],
						source: 'user'
					})
					.run();
				db.insert(s.vocabForm).values([{ form, vocabId: key }, { form: b.reading, vocabId: key }]).onConflictDoNothing().run();
			}
		} else {
			throw new HttpError(400, 'Indica kanji, vocabId o word');
		}
		const cards = facetsFor(type).map((f) => ensureCard(db, type, key, f));
		return Response.json({ type, key, cards: cards.map((c) => c.id) });
	});
