// Contenido pregenerado: se aplica sin pisar nada, se recoge estable, NO se exporta y sobrevive a «reiniciar generado».
import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { applyPregen, collectGenerated, emptyPregen, kanjiInOrder } from '../src/lib/server/data/pregen.ts';
import { buildSnapshot } from '../src/lib/server/data/snapshot.ts';
import { applyReset } from '../src/lib/server/data/reset.ts';
import { aheadStatus, kanjiAhead, wordsFor } from '../src/lib/server/gemini/pregen.ts';
import { eq } from 'drizzle-orm';

function base() {
	const db = openDb(':memory:').db;
	db.insert(s.kanji)
		.values([
			{ char: '日', meaningsEs: ['sol'], learnOrder: 0 },
			{ char: '月', meaningsEs: ['luna'], learnOrder: 1 },
			{ char: '目', meaningsEs: ['ojo'], learnOrder: 2 }
		])
		.run();
	db.insert(s.component).values({ symbol: '日', nameEs: null }).run();
	db.insert(s.kanjiComponent).values({ kanji: '日', symbol: '日', position: 0 }).run();
	db.insert(s.vocab)
		.values([
			{ id: 'jm:1', mainForm: '日', mainReading: 'ひ', common: true, glossesEn: ['sun'] },
			{ id: 'jm:2', mainForm: '毎日', mainReading: 'まいにち', common: true, glossesEn: ['every day'], glossesEs: ['cada día'], glossesEsSource: 'jmdict' }
		])
		.run();
	db.insert(s.vocabKanji).values([{ vocabId: 'jm:1', kanji: '日' }, { vocabId: 'jm:2', kanji: '日' }]).run();
	db.insert(s.sentence).values({ vocabId: 'jm:1', jp: '日が昇る。', en: 'The sun rises.' }).run();
	db.insert(s.similarKanji).values({ a: '日', b: '目', score: 0.8 }).run();
	return db;
}

const CONTENT = {
	...emptyPregen(),
	kanji: ['日'],
	mnemonics: [{ char: '日', meaning: 'Un **sol** en una ventana.', reading: 'ひ' }],
	componentNames: [{ symbol: '日', name: 'sol' }],
	glosses: [
		{ id: 'jm:1', glosses: ['sol', 'día'] },
		{ id: 'jm:2', glosses: ['NO DEBE PISAR'] }
	],
	sentences: [{ vocabId: 'jm:1', jp: '日が昇る。', es: 'Sale el sol.' }],
	similarTips: [{ a: '日', b: '目', tip: '目 tiene una raya más.' }]
};

test('aplicar: rellena con origen pregen sin pisar JMdict; recoger devuelve lo mismo, estable', () => {
	const db = base();
	expect(applyPregen(db, CONTENT)).toBe(5);
	expect(applyPregen(db, CONTENT)).toBe(0); // idempotente
	const k = db.select().from(s.kanji).where(eq(s.kanji.char, '日')).get()!;
	expect(k.mnemonicSource).toBe('pregen');
	expect(db.select().from(s.vocab).where(eq(s.vocab.id, 'jm:2')).get()!.glossesEs).toEqual(['cada día']);
	const got = collectGenerated(db, ['日']);
	expect(got.mnemonics).toEqual(CONTENT.mnemonics);
	expect(got.glosses).toEqual([{ id: 'jm:1', glosses: ['sol', 'día'] }]);
	expect(got.similarTips).toEqual(CONTENT.similarTips);
	expect(JSON.stringify(collectGenerated(db, ['日']))).toBe(JSON.stringify(got));
});

test('lo pregenerado no se exporta y sobrevive a «reiniciar contenido generado»', () => {
	const db = base();
	applyPregen(db, CONTENT);
	const snap = buildSnapshot(db);
	expect(snap.content.mnemonics).toEqual([]);
	expect(snap.content.componentNames).toEqual([]);
	expect(snap.content.glosses).toEqual([]);
	expect(snap.content.sentences).toEqual([]);
	expect(snap.content.similarTips).toEqual([]);
	applyReset(db, { generated: true });
	expect(db.select().from(s.kanji).where(eq(s.kanji.char, '日')).get()!.mnemonicMeaning).toContain('sol');
	expect(db.select().from(s.sentence).get()!.es).toBe('Sale el sol.');
});

test('orden y «por adelantado»: los próximos sin estudiar y cuáles faltan', () => {
	const db = base();
	expect(kanjiInOrder(db, 2)).toEqual(['日', '月']);
	expect(kanjiInOrder(db, 2, 1)).toEqual(['月', '目']);
	db.insert(s.card).values({ itemType: 'kanji', itemKey: '日', facet: 'meaning', due: 0, fsrs: {}, createdAt: 0 }).run();
	expect(kanjiAhead(db, 5)).toEqual(['月', '目']);
	applyPregen(db, { ...CONTENT, mnemonics: [{ char: '月', meaning: 'luna', reading: null }] });
	expect(aheadStatus(db, 5)).toEqual({ total: 2, done: 1, nextKanji: ['目'] });
	expect(wordsFor(db, ['日']).sort()).toEqual(['jm:1', 'jm:2']);
});
