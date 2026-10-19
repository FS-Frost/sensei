import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { applyReview, buildReviewItem, ensureCard, gradeAnswer, gradeSpoken, isGiveUp } from '../src/lib/server/srs/service.ts';
import { Rating } from '../src/lib/server/srs/fsrs.ts';
import { meaningMatches, readingMatches } from '../src/lib/jp.ts';
import { acceptedRomaji } from '../src/lib/kana.ts';
import type { Facet, ItemType } from '../src/lib/types.ts';

let db: DB;

// 力 y 刀 comparten «fuerza»/«espada» con otros a propósito: los distractores no pueden ser sinónimos de la respuesta.
const KANJI = [
	{ char: '日', es: ['día', 'sol'], en: ['day', 'sun'], on: ['ニチ', 'ジツ'], kun: ['ひ', '-び'] },
	{ char: '目', es: ['ojo'], en: ['eye'], on: ['モク'], kun: ['め'] },
	{ char: '月', es: ['luna', 'mes'], en: ['moon', 'month'], on: ['ゲツ', 'ガツ'], kun: ['つき'] },
	{ char: '白', es: ['blanco'], en: ['white'], on: ['ハク'], kun: ['しろ'] },
	{ char: '田', es: ['arrozal'], en: ['rice field'], on: ['デン'], kun: ['た'] },
	{ char: '旦', es: ['sol', 'amanecer'], en: ['dawn'], on: ['タン'], kun: [] },
	{ char: '火', es: ['fuego'], en: ['fire'], on: ['カ'], kun: ['ひ'] },
	{ char: '食', es: ['comer'], en: ['eat'], on: ['ショク'], kun: ['た.べる'] }
];

beforeEach(() => {
	db = openDb(':memory:').db;
	db.insert(s.kanji)
		.values(KANJI.map((k, i) => ({ char: k.char, meaningsEs: k.es, meaningsEn: k.en, onReadings: k.on, kunReadings: k.kun, learnOrder: i })))
		.run();
	db.insert(s.similarKanji)
		.values([
			{ a: '日', b: '目', score: 0.9 },
			{ a: '日', b: '白', score: 0.8 },
			{ a: '日', b: '旦', score: 0.7 }
		])
		.run();
	db.insert(s.component)
		.values([
			{ symbol: '丶', nameEs: 'gota', learnOrder: 0 },
			{ symbol: '一', nameEs: 'uno', learnOrder: 1 },
			{ symbol: '口', nameEs: 'boca', learnOrder: 2 },
			{ symbol: '亠', nameEs: 'tapa', learnOrder: 3 },
			{ symbol: '水', nameEs: 'agua', learnOrder: 4 }
		])
		.run();
	const words = [
		{ id: 'jm:1', mainForm: '毎日', mainReading: 'まいにち', es: ['cada día'], k: ['日'] },
		{ id: 'jm:2', mainForm: '日曜日', mainReading: 'にちようび', es: ['domingo'], k: ['日'] },
		{ id: 'jm:3', mainForm: '今日', mainReading: 'きょう', es: ['hoy'], k: ['日'] },
		{ id: 'jm:4', mainForm: '明日', mainReading: 'あした', es: ['mañana'], k: ['日'] },
		{ id: 'jm:5', mainForm: '日記', mainReading: 'にっき', es: ['diario'], k: ['日'] },
		{ id: 'jm:6', mainForm: '本日', mainReading: 'ほんじつ', es: ['hoy', 'este día'], k: ['日'] }
	];
	db.insert(s.vocab)
		.values(words.map((w) => ({ id: w.id, mainForm: w.mainForm, mainReading: w.mainReading, kanaForms: [w.mainReading], kanjiForms: [w.mainForm], common: true, glossesEs: w.es, glossesEn: [] })))
		.run();
	db.insert(s.vocabKanji).values(words.flatMap((w) => w.k.map((k) => ({ vocabId: w.id, kanji: k })))).run();
});

function opts(type: ItemType, key: string, facet: Facet) {
	return buildReviewItem(db, { id: null, itemType: type, itemKey: key, facet });
}

describe('opciones', () => {
	test('kanji: 4 únicas, una sola correcta, sinónimos fuera (旦 también es «sol»)', () => {
		for (let i = 0; i < 20; i++) {
			const it = opts('kanji', '日', 'meaning');
			expect(it.answerMode).toBe('meaning');
			expect(it.options).toHaveLength(4);
			expect(new Set(it.options).size).toBe(4);
			expect(it.options!.filter((o) => gradeAnswer(db, 'kanji', '日', 'meaning', o).correct)).toHaveLength(1);
			expect(it.options).not.toContain('sol');
		}
	});

	test('kanji: lecturas en hiragana y ninguna otra válida (火 también se lee ひ)', () => {
		for (let i = 0; i < 20; i++) {
			const it = opts('kanji', '日', 'reading');
			expect(it.options).toHaveLength(4);
			expect(it.options!.every((o) => /^[぀-ゟ]+$/.test(o))).toBe(true);
			expect(it.options!.filter((o) => gradeAnswer(db, 'kanji', '日', 'reading', o).correct)).toHaveLength(1);
		}
		// Kun con okurigana: la opción correcta es la forma completa.
		const it = opts('kanji', '食', 'reading');
		expect(it.options).toContain('しょく');
	});

	test('vocabulario: significado y lectura, sin homónimos (本日 también es «hoy»)', () => {
		for (let i = 0; i < 20; i++) {
			const m = opts('vocab', 'jm:3', 'meaning');
			expect(m.options).toHaveLength(4);
			expect(m.options!.filter((o) => meaningMatches(o, ['hoy'])).length).toBe(1);
			const r = opts('vocab', 'jm:1', 'reading');
			expect(r.options).toHaveLength(4);
			expect(r.options!.filter((o) => readingMatches(o, ['まいにち']))).toHaveLength(1);
		}
	});

	test('componente y kana (romaji, con las alternativas de cada kana)', () => {
		const c = opts('component', '口', 'meaning');
		expect(c.options).toHaveLength(4);
		expect(c.options).toContain('boca');
		for (let i = 0; i < 20; i++) {
			const k = opts('kana', 'じ', 'reading');
			expect(k.options).toHaveLength(4);
			expect(k.options!.filter((o) => acceptedRomaji('じ').includes(o))).toHaveLength(1);
		}
	});

	test('sin 3 distractores seguros no hay opciones: se responde escribiendo', () => {
		const lone = openDb(':memory:').db;
		lone.insert(s.kanji).values({ char: '日', meaningsEs: ['día'], meaningsEn: ['day'], onReadings: ['ニチ'], kunReadings: [], learnOrder: 0 }).run();
		expect(buildReviewItem(lone, { id: null, itemType: 'kanji', itemKey: '日', facet: 'meaning' }).options).toBeUndefined();
		// っ se lee dentro de una palabra al azar; la escritura se traza.
		expect(opts('kana', 'っ', 'reading').options).toBeUndefined();
		expect(opts('kanji', '日', 'writing').options).toBeUndefined();
	});
});

describe('nota y forma de responder', () => {
	test('con opciones, «Fácil» cuenta como «Bien»; se guarda cómo se respondió', () => {
		const c = ensureCard(db, 'kanji', '日', 'meaning');
		applyReview(db, c.id, { correct: true, grade: Rating.Easy, source: 'review', via: 'choice' });
		const c2 = ensureCard(db, 'kanji', '目', 'meaning');
		applyReview(db, c2.id, { correct: true, grade: Rating.Easy, source: 'review', via: 'typed' });
		const logs = db.select({ k: s.reviewLog.itemKey, rating: s.reviewLog.rating, via: s.reviewLog.via }).from(s.reviewLog).all();
		expect(logs).toEqual([
			{ k: '日', rating: Rating.Good, via: 'choice' },
			{ k: '目', rating: Rating.Easy, via: 'typed' }
		]);
	});
});

describe('voz', () => {
	test('basta una alternativa correcta; kanji suelto o palabra dichos en kanji cuentan', () => {
		const r = gradeSpoken(db, 'kanji', '日', 'reading', ['火', 'ひ']);
		expect(r.correct).toBe(true);
		expect(r.heard).toBe('ひ');
		expect(gradeSpoken(db, 'kanji', '日', 'reading', ['日']).correct).toBe(true);
		expect(gradeSpoken(db, 'vocab', 'jm:1', 'reading', ['毎日']).correct).toBe(true);
		expect(gradeSpoken(db, 'kanji', '日', 'meaning', ['soy', 'sol']).correct).toBe(true);
		const bad = gradeSpoken(db, 'kanji', '日', 'reading', ['め', 'もく']);
		expect(bad.correct).toBe(false);
		expect(bad.heard).toBe('め');
	});

	test('«no sé» en español o japonés: fallo sin respuesta', () => {
		expect(isGiveUp('No sé.')).toBe(true);
		expect(isGiveUp('ni idea')).toBe(true);
		expect(isGiveUp('わからない')).toBe(true);
		expect(isGiveUp('分かりません。')).toBe(true);
		expect(isGiveUp('nose')).toBe(false);
		const r = gradeSpoken(db, 'kanji', '日', 'meaning', ['no sé', 'nose']);
		expect(r).toMatchObject({ correct: false, gaveUp: true, heard: '' });
	});
});
