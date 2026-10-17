import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle } from '#lib/server/http.ts';
import { generateText, models } from '#lib/server/gemini/client.ts';
import { buildReviewItem } from '#lib/server/srs/service.ts';
import { getKanjiInfo, getVocabInfo } from '#lib/server/items.ts';
import type { Facet, ItemType } from '#lib/types.ts';

/** "¿Por qué fallé?": explicación breve del tutor tras un error en repaso. */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ itemType: ItemType; itemKey: string; facet: Facet; answer: string }>(request);
		const item = buildReviewItem(db, { id: null, itemType: b.itemType, itemKey: b.itemKey, facet: b.facet });
		let context = '';
		if (b.itemType === 'kanji') {
			const k = getKanjiInfo(db, b.itemKey, { vocabLimit: 3 });
			if (k)
				context = `Componentes: ${k.components.map((c) => `${c.symbol}(${c.nameEs ?? '?'})`).join(' ')}. Mnemotecnia: ${k.mnemonicMeaning ?? '—'}`;
		} else if (b.itemType === 'vocab') {
			const v = getVocabInfo(db, b.itemKey);
			if (v) context = `Palabra ${v.mainForm}【${v.mainReading}】: ${(v.glossesEs ?? v.glossesEn).join('; ')}`;
		}
		const text = await generateText({
			db,
			feature: 'why',
			model: models(db).flash,
			system:
				'Eres un tutor de lectura de japonés para hispanohablantes. Responde en español, máximo 4 frases, sin romaji. ' +
				'Usa {漢字|かんじ} para furigana.',
			contents:
				`Pregunta: ${item.label} de «${item.prompt}». Respuesta correcta: ${item.answers.join(' / ')}. ` +
				`El alumno respondió: «${b.answer}». ${context}\n` +
				'Explica por qué es incorrecto, con qué lo pudo confundir y un truco para recordarlo.',
			temperature: 0.5
		});
		return Response.json({ text });
	});
