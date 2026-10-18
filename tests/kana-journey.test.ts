// Viaje de kana desde cero: las lecciones empiezan por filas de hiragana, los kanji y la gramática esperan al hiragana
// básico, «sabidos de antes» para quien ya estudiaba, repaso inverso por opciones, palabras con っ/ー, romaji de apoyo.
import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { lessonQuota, nextLesson } from '../src/lib/server/srs/lessons.ts';
import { buildReviewItem, ensureCard, ensureWritingCards, gradeAnswer } from '../src/lib/server/srs/service.ts';
import { hiraganaReady, kanaProgress, knownCard, legacyKnownKana, markKanaAssessed, nextKana, weakKanaChars } from '../src/lib/server/kana.ts';
import { HIRAGANA_CORE, KANA_ROWS } from '../src/lib/kanaCourse.ts';
import { updateSettings } from '../src/lib/server/settings.ts';
import { journey } from '../src/lib/server/guide.ts';

function base() {
	const db = openDb(':memory:').db;
	db.insert(s.kanji).values({ char: '日', meaningsEs: ['sol'], onReadings: ['ニチ'], kunReadings: ['ひ'], learnOrder: 0 }).run();
	return db;
}

test('desde cero: la lección es de kana por filas completas y los kanji esperan al hiragana', () => {
	const db = base();
	const q = lessonQuota(db);
	expect(q.kanjiLocked).toBe(true);
	expect(q.kanjiLeft).toBe(0);
	expect(q.grammarLeft).toBe(0);
	expect(q.hiraganaLeft).toBe(46);
	const { items } = nextLesson(db, 'auto');
	expect(items.map((i) => i.key)).toEqual([...'あいうえおかきくけこ']);
	expect(items[0].type).toBe('kana');
	if (items[0].type === 'kana') {
		expect(items[0].kana.mnemonic).toBeTruthy();
		expect(items[0].kana.example?.word).toBe('あめ');
	}
	expect(nextLesson(db, 'kanji').items).toEqual([]);
	// Estudiado el hiragana básico (con tarjeta), se abren los kanji.
	for (const k of HIRAGANA_CORE) ensureCard(db, 'kana', k, 'reading');
	expect(hiraganaReady(db)).toBe(true);
	expect(lessonQuota(db).kanjiLocked).toBe(false);
	// El curso sigue con dakuten, en filas.
	expect(nextKana(db, 10)).toEqual([...'がぎぐげござじずぜぞ']);
});

test('quien ya estudiaba antes del curso: los kana del diagnóstico antiguo cuentan como sabidos (sin escribir nada)', () => {
	const db = base();
	expect(legacyKnownKana(db).size).toBe(0);
	ensureCard(db, 'kanji', '日', 'meaning');
	expect(legacyKnownKana(db).has('あ')).toBe(true);
	const cards = db.select().from(s.card).all().length;
	// Lo siguiente del curso son los combinados (きゃ…), no las vocales.
	expect(nextKana(db, 6)[0]).toBe('きゃ');
	expect(db.select().from(s.card).all().length).toBe(cards);
	expect(kanaProgress(db).hiraganaBasic.solid).toBe(46);
	// Tras el diagnóstico nuevo, solo cuenta lo que tiene tarjeta.
	markKanaAssessed(db);
	expect(legacyKnownKana(db).size).toBe(0);
});

test('repaso: lectura, inversa por opciones y palabras con っ / ー', () => {
	const db = base();
	const r = buildReviewItem(db, { id: null, itemType: 'kana', itemKey: 'ソ', facet: 'reading' });
	expect(r.answerMode).toBe('romaji');
	expect(r.extra?.mnemonic).toBeTruthy();
	expect(r.extra?.similar?.map((x) => x.char)).toContain('ン');

	const inv = buildReviewItem(db, { id: null, itemType: 'kana', itemKey: 'ソ', facet: 'meaning' });
	expect(inv.answerMode).toBe('choice');
	expect(inv.prompt).toBe('so');
	expect(inv.options).toContain('ソ');
	expect(inv.options).toContain('ン'); // el parecido entra siempre
	expect(new Set(inv.options).size).toBe(4);
	expect(gradeAnswer(db, 'kana', 'ソ', 'meaning', 'ソ').correct).toBe(true);
	expect(gradeAnswer(db, 'kana', 'ソ', 'meaning', 'ン')).toMatchObject({ correct: false, confusedWith: 'ン' });

	const tsu = buildReviewItem(db, { id: null, itemType: 'kana', itemKey: 'っ', facet: 'reading' });
	expect([...tsu.prompt].length).toBeGreaterThan(1); // se lee una palabra entera
	expect(gradeAnswer(db, 'kana', 'っ', 'reading', tsu.answers[0]).correct).toBe(true);
	expect(gradeAnswer(db, 'kana', 'ー', 'reading', 'kōhī').correct).toBe(true);
	expect(gradeAnswer(db, 'kana', 'きゃ', 'reading', 'kya').correct).toBe(true);
});

test('romaji de apoyo: se muestra bajo los kana que aún no lees con soltura', () => {
	const db = base();
	expect(weakKanaChars(db)).toContain('あ');
	markKanaAssessed(db); // como hace la API del diagnóstico
	knownCard(db, 'kana', 'あ', 'reading', 'diagnostic');
	knownCard(db, 'kana', 'きゃ', 'reading', 'diagnostic');
	const weak = weakKanaChars(db);
	expect(weak).not.toContain('あ');
	expect(weak).not.toContain('ゃ');
	expect(weak).toContain('い');
});

test('escritura (opcional) empieza por los kana que ya lees; hitos de hiragana y katakana', () => {
	const db = base();
	markKanaAssessed(db);
	for (const k of KANA_ROWS[0].chars) knownCard(db, 'kana', k, 'reading', 'diagnostic');
	updateSettings(db, { writingReviews: true, newWritingPerDay: 3 });
	expect(ensureWritingCards(db)).toBe(3);
	const w = db.select().from(s.card).all().filter((c) => c.facet === 'writing');
	expect(w.map((c) => c.itemKey)).toEqual(['あ', 'い', 'う']);
	const item = buildReviewItem(db, { id: null, itemType: 'kana', itemKey: 'あ', facet: 'writing' });
	expect(item.answerMode).toBe('trace');
	expect(item.prompt).toBe('a');

	const j = journey(db);
	expect(j.milestones[0]).toMatchObject({ id: 'hira', reached: false });
	expect(j.next?.id).toBe('hira');
	for (const k of HIRAGANA_CORE) knownCard(db, 'kana', k, 'reading', 'diagnostic');
	expect(journey(db).milestones[0].reached).toBe(true);
	expect(journey(db).next?.id).toBe('kata');
});
