import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { applyReview, dueCount, ensureCard, gradeAnswer, interleave } from '../src/lib/server/srs/service.ts';
import { State } from '../src/lib/server/srs/fsrs.ts';
import { lessonQuota, nextLesson, unlockedVocab } from '../src/lib/server/srs/lessons.ts';
import { updateSettings, dayStart } from '../src/lib/server/settings.ts';
import { knowAllKana } from './helpers.ts';

let db: DB;

function seed(db: DB) {
	db.insert(s.kanji)
		.values([
			{ char: '日', meaningsEs: ['día', 'sol'], meaningsEn: ['day', 'sun'], onReadings: ['ニチ'], kunReadings: ['ひ'], learnOrder: 0 },
			{ char: '本', meaningsEs: ['libro', 'origen'], meaningsEn: ['book'], onReadings: ['ホン'], kunReadings: ['もと'], learnOrder: 2 }
		])
		.run();
	db.insert(s.component).values({ symbol: '丶', nameEs: 'gota', learnOrder: 1 }).run();
	db.insert(s.vocab)
		.values({ id: 'jm:1', mainForm: '日本', mainReading: 'にほん', kanaForms: ['にほん', 'にっぽん'], kanjiForms: ['日本'], common: true, glossesEs: ['Japón'], glossesEn: ['Japan'] })
		.run();
	db.insert(s.vocabKanji).values([{ vocabId: 'jm:1', kanji: '日' }, { vocabId: 'jm:1', kanji: '本' }]).run();
	db.insert(s.vocabForm).values([{ form: '日本', vocabId: 'jm:1' }, { form: 'にほん', vocabId: 'jm:1' }]).run();
}

beforeEach(() => {
	db = openDb(':memory:').db;
	seed(db);
});

describe('corrección', () => {
	test('kanji: significado y lectura', () => {
		expect(gradeAnswer(db, 'kanji', '日', 'meaning', 'Sol').correct).toBe(true);
		expect(gradeAnswer(db, 'kanji', '日', 'reading', 'にち').correct).toBe(true);
		expect(gradeAnswer(db, 'kanji', '日', 'reading', 'ほん').correct).toBe(false);
	});

	test('detecta confusión con otro kanji ya estudiado', () => {
		ensureCard(db, 'kanji', '本', 'meaning');
		const r = gradeAnswer(db, 'kanji', '日', 'meaning', 'libro');
		expect(r.correct).toBe(false);
		expect(r.confusedWith).toBe('本');
	});

	test('kana: confusión dentro del mismo silabario', () => {
		const r = gradeAnswer(db, 'kana', 'シ', 'reading', 'tsu');
		expect(r.correct).toBe(false);
		expect(r.confusedWith).toBe('ツ');
	});

	test('vocabulario: acepta cualquier lectura listada', () => {
		expect(gradeAnswer(db, 'vocab', 'jm:1', 'reading', 'にっぽん').correct).toBe(true);
	});
});

describe('FSRS', () => {
	test('acierto programa a futuro; fallo deja la tarjeta pendiente pronto', () => {
		const now = new Date('2026-01-01T10:00:00');
		const c = ensureCard(db, 'kanji', '日', 'meaning', now);
		expect(c.state).toBe(State.New);
		const ok = applyReview(db, c.id, { correct: true, source: 'review' }, now);
		expect(ok.due).toBeGreaterThan(now.getTime());
		const bad = applyReview(db, c.id, { correct: false, source: 'review' }, new Date(ok.due));
		expect(bad.due - ok.due).toBeLessThan(86_400_000);
		expect(db.select().from(s.reviewLog).all().length).toBe(2);
	});

	test('dueCount cuenta tarjetas vencidas', () => {
		const now = new Date();
		ensureCard(db, 'kanji', '日', 'meaning', now);
		expect(dueCount(db, now.getTime())).toBe(1);
	});

	test('interleave no deja dos facetas del mismo ítem seguidas si se puede evitar', () => {
		const cards = [
			{ itemType: 'kanji', itemKey: 'A' },
			{ itemType: 'kanji', itemKey: 'A' },
			{ itemType: 'kanji', itemKey: 'B' },
			{ itemType: 'kanji', itemKey: 'C' }
		];
		for (let i = 0; i < 20; i++) {
			const out = interleave(cards);
			const adjacent = out.some((c, j) => j > 0 && c.itemKey === out[j - 1].itemKey);
			expect(adjacent).toBe(false);
		}
	});
});

describe('lecciones', () => {
	beforeEach(() => knowAllKana(db));

	test('respeta el orden componentes+kanji', () => {
		const { items } = nextLesson(db, 'kanji');
		expect(items.map((i) => i.key)).toEqual(['日', '丶', '本']);
	});

	test('cuota diaria y freno', () => {
		updateSettings(db, { newKanjiPerDay: 1 });
		const q = lessonQuota(db);
		expect(q.kanjiLeft).toBe(1);
		const { items } = nextLesson(db, 'kanji');
		expect(items.filter((i) => i.type === 'kanji').length).toBe(1);
	});

	test('el vocabulario se desbloquea cuando sus kanji están en repaso', () => {
		expect(unlockedVocab(db, 5)).toEqual([]);
		for (const k of ['日', '本']) {
			const c = ensureCard(db, 'kanji', k, 'meaning');
			db.update(s.card).set({ state: State.Review }).where(eqId(c.id)).run();
		}
		expect(unlockedVocab(db, 5)).toEqual(['jm:1']);
	});

	test('dayStart respeta la hora de corte', () => {
		const at3 = new Date('2026-03-10T03:00:00');
		const at5 = new Date('2026-03-10T05:00:00');
		expect(new Date(dayStart(at3, 4)).getDate()).toBe(9);
		expect(new Date(dayStart(at5, 4)).getDate()).toBe(10);
	});
});

import { eq } from 'drizzle-orm';
const eqId = (id: number) => eq(s.card.id, id);
