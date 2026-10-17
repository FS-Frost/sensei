import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { validateTokens } from '../src/lib/server/gemini/texts.ts';
import { gradeQuiz } from '../src/lib/server/gemini/tutor.ts';

const db = openDb(':memory:').db;
db.insert(s.vocab)
	.values([
		{ id: 'jm:1', mainForm: '食べる', mainReading: 'たべる', kanjiForms: ['食べる'], kanaForms: ['たべる'], common: true },
		{ id: 'jm:2', mainForm: 'お茶', mainReading: 'おちゃ', kanjiForms: ['お茶'], kanaForms: ['おちゃ'], common: true }
	])
	.run();
db.insert(s.vocabForm)
	.values([
		{ form: '食べる', vocabId: 'jm:1' },
		{ form: 'お茶', vocabId: 'jm:2' }
	])
	.run();

test('valida lecturas con okurigana flexionado y prefijo en kana', () => {
	const out = validateTokens(
		db,
		[
			{ s: '食べた', r: 'たべた', b: '食べる' },
			{ s: '食べた', r: 'くべた', b: '食べる' },
			{ s: 'お茶', r: 'おちゃ', b: 'お茶' },
			{ s: 'を', r: '', b: 'を' },
			{ s: '謎', r: 'なぞ', b: '謎' }
		],
		new Set()
	);
	expect(out[0].v).toBe(true);
	expect(out[1].v).toBe(false);
	expect(out[2].v).toBe(true);
	expect(out[3].r).toBeUndefined();
	expect(out[4].v).toBeUndefined(); // sin datos en el diccionario
});

test('marca como legibles los tokens cuyos kanji domina', () => {
	const [t] = validateTokens(db, [{ s: '食べた', r: 'たべた', b: '食べる' }], new Set(['食']));
	expect(t.k).toBe(true);
});

test('gradeQuiz corrige cada tipo', () => {
	const res = gradeQuiz(
		{
			id: 'q',
			title: 't',
			questions: [
				{ id: '0', type: 'multiple_choice', prompt: '', options: ['a', 'b'], answer: 'b' },
				{ id: '1', type: 'reading', prompt: '', answer: 'やま' },
				{ id: '2', type: 'meaning', prompt: '', answer: 'montaña' },
				{ id: '3', type: 'fill_blank', prompt: '', answer: 'を' }
			]
		},
		[
			{ id: '0', answer: 'b' },
			{ id: '1', answer: 'ヤマ' },
			{ id: '2', answer: 'montana' },
			{ id: '3', answer: 'が' }
		]
	);
	expect(res.map((r) => r.correct)).toEqual([true, true, true, false]);
});
