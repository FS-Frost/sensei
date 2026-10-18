// Pista de gramática: integridad del contenido curado (ids, significados únicos, furigana bien formada y completa,
// desbloqueo creciente). Ver docs/grammar-expansion.md.
import { expect, test } from 'bun:test';
import { GRAMMAR } from '../src/lib/grammar.ts';

const KANJI = /[㐀-䶿一-鿿々]/;
const KANA_ONLY = /^[ぁ-ゖァ-ヺー・]+$/;

test('cantidad, ids estables y significados únicos (se usan como distractores)', () => {
	expect(GRAMMAR.length).toBeGreaterThanOrEqual(170);
	const ids = GRAMMAR.map((g) => g.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	const meanings = GRAMMAR.map((g) => g.meaning.trim().toLowerCase());
	const dup = meanings.filter((m, i) => meanings.indexOf(m) !== i);
	expect(dup).toEqual([]);
});

test('ejemplos: furigana {漢字|かな} bien formada y TODO kanji con lectura', () => {
	const problems: string[] = [];
	for (const g of GRAMMAR) {
		expect(g.examples.length).toBeGreaterThan(0);
		for (const ex of g.examples) {
			expect(ex.es.trim().length).toBeGreaterThan(0);
			for (const m of ex.jp.matchAll(/\{([^|{}]+)\|([^{}]+)\}/g)) {
				if (!KANJI.test(m[1])) problems.push(`${g.id}: «${m[1]}» con furigana pero sin kanji`);
				if (!KANA_ONLY.test(m[2])) problems.push(`${g.id}: lectura «${m[2]}» no es solo kana`);
			}
			// Fuera de las llaves no puede quedar ningún kanji: el alumno aún no los conoce todos.
			const bare = ex.jp.replace(/\{[^{}]*\}/g, '');
			if (KANJI.test(bare)) problems.push(`${g.id}: kanji sin furigana en «${ex.jp}»`);
			if (/[{}|]/.test(bare)) problems.push(`${g.id}: llaves mal cerradas en «${ex.jp}»`);
		}
	}
	expect(problems).toEqual([]);
});

test('niveles: 7, desbloqueo creciente dentro de cada nivel y hasta ~1700 kanji', () => {
	expect(new Set(GRAMMAR.map((g) => g.level))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
	for (let i = 1; i < GRAMMAR.length; i++)
		if (GRAMMAR[i].level === GRAMMAR[i - 1].level) expect(GRAMMAR[i].unlockAt).toBeGreaterThan(GRAMMAR[i - 1].unlockAt);
	expect(GRAMMAR[0].unlockAt).toBe(0);
	expect(Math.max(...GRAMMAR.map((g) => g.unlockAt))).toBeLessThan(2000);
});
