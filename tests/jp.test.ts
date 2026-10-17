import { describe, expect, test } from 'bun:test';
import { acceptedKanjiReadings, meaningMatches, normalizeReading, readingMatches, kanjiIn } from '../src/lib/jp.ts';
import { acceptedRomaji } from '../src/lib/kana.ts';

describe('lecturas', () => {
	test('katakana y hiragana son equivalentes', () => {
		expect(normalizeReading('ニチ')).toBe('にち');
		expect(readingMatches('にち', ['ニチ'])).toBe(true);
	});

	test('kun con okurigana acepta raíz y forma completa', () => {
		const acc = acceptedKanjiReadings(['ジョウ'], ['うえ', 'あ.げる', '-あ.がる']);
		expect(acc).toContain('じょう');
		expect(acc).toContain('あ');
		expect(acc).toContain('あげる');
		expect(acc).toContain('あがる');
	});

	test('respuesta vacía nunca es correcta', () => {
		expect(readingMatches('', ['あ'])).toBe(false);
	});
});

describe('significados', () => {
	test('ignora tildes, mayúsculas y artículos', () => {
		expect(meaningMatches('Montaña', ['montaña'])).toBe(true);
		expect(meaningMatches('la montana', ['montaña'])).toBe(true);
	});

	test('tolera erratas leves en palabras largas', () => {
		expect(meaningMatches('asosiación', ['asociación'])).toBe(true);
		expect(meaningMatches('sol', ['día'])).toBe(false);
	});

	test('palabras cortas exigen coincidencia exacta', () => {
		expect(meaningMatches('dia', ['día'])).toBe(true);
		expect(meaningMatches('dio', ['día'])).toBe(false);
	});

	test('acepta cualquier acepción separada por ;', () => {
		expect(meaningMatches('reunión', ['asociación; reunión'])).toBe(true);
	});
});

describe('kana', () => {
	test('romanizaciones alternativas', () => {
		expect(acceptedRomaji('し')).toEqual(['shi', 'si']);
		expect(acceptedRomaji('ツ')).toContain('tu');
		expect(acceptedRomaji('を')).toContain('o');
		expect(acceptedRomaji('お')).toEqual(['o']);
	});

	test('kanjiIn extrae kanji únicos', () => {
		expect(kanjiIn('日本の日々')).toEqual(['日', '本']);
	});
});
