// Curso de kana: datos completos y coherentes, romaji aceptado (combinados, extendidos, っ, ー) y palabras de ejemplo.
import { expect, test } from 'bun:test';
import { isKana } from 'wanakana';
import { COURSE_KANA, HIRAGANA_CORE, KANA_ROWS, KANA_SIMILAR, kanaEntry, kanaFormation, SPECIAL_WORDS } from '../src/lib/kanaCourse.ts';
import { acceptedRomaji, HIRAGANA_BASIC, KATAKANA_BASIC, wordRomaji } from '../src/lib/kana.ts';

test('filas: sin repetidos, 46 hiragana básicos y todos los básicos con mnemotecnia y ejemplo', () => {
	expect(new Set(COURSE_KANA).size).toBe(COURSE_KANA.length);
	expect(HIRAGANA_CORE).toEqual(HIRAGANA_BASIC);
	for (const k of [...HIRAGANA_BASIC, ...KATAKANA_BASIC]) {
		const e = kanaEntry(k);
		expect(e.mnemonic, k).toBeTruthy();
		if (k !== 'ヲ') expect(e.example, k).toBeTruthy();
	}
	// Todo ejemplo va solo en kana.
	for (const k of COURSE_KANA) {
		const ex = kanaEntry(k).example;
		if (ex) expect(isKana(ex.word), `${k}: ${ex.word}`).toBe(true);
	}
	for (const p of KANA_SIMILAR) {
		expect(COURSE_KANA, p.a).toContain(p.a);
		expect(COURSE_KANA, p.b).toContain(p.b);
	}
	expect(KANA_ROWS.find((r) => r.id === 'h-kya')!.chars).toEqual(['きゃ', 'きゅ', 'きょ', 'ぎゃ', 'ぎゅ', 'ぎょ']);
});

test('romaji: básicos, combinados y extendidos (Hepburn y alternativas)', () => {
	expect(acceptedRomaji('し')).toEqual(['shi', 'si']);
	expect(acceptedRomaji('きゃ')[0]).toBe('kya');
	expect(acceptedRomaji('しょ')).toEqual(['sho', 'syo']);
	expect(acceptedRomaji('ちゃ')).toContain('tya');
	expect(acceptedRomaji('じゅ')).toEqual(['ju', 'zyu', 'jyu']);
	expect(acceptedRomaji('ぢ')[0]).toBe('ji');
	expect(acceptedRomaji('を')).toEqual(['wo', 'o']);
	expect(acceptedRomaji('ファ')[0]).toBe('fa');
	expect(acceptedRomaji('ティ')[0]).toBe('ti');
	expect(acceptedRomaji('シェ')[0]).toBe('she');
	expect(acceptedRomaji('ヴ')).toContain('vu');
	// Todos los kana del curso tienen un romaji no vacío.
	for (const k of COURSE_KANA) expect(acceptedRomaji(k)[0], k).toMatch(/^[a-z-]+$/);
});

test('palabras: ー alarga la vocal, っ duplica la consonante, macrones y を', () => {
	expect(wordRomaji('コーヒー')).toContain('koohii');
	expect(wordRomaji('コーヒー')).toContain('kōhī');
	expect(wordRomaji('きって')[0]).toBe('kitte');
	expect(wordRomaji('サッカー')[0]).toBe('sakkaa');
	expect(wordRomaji('ほんをよむ')).toContain('honoyomu');
	expect(wordRomaji('しゃしん')).toContain('syasin');
	expect(acceptedRomaji('っ')).toContain('gakkou');
	expect(acceptedRomaji('ー')).toContain('keeki');
	for (const list of Object.values(SPECIAL_WORDS)) for (const w of list) expect(isKana(w.word)).toBe(true);
});

test('formación de derivados', () => {
	expect(kanaFormation('が')).toBe('か + ゛');
	expect(kanaFormation('ぱ')).toBe('は + ゜');
	expect(kanaFormation('きゃ')).toBe('き + ゃ pequeña');
	expect(kanaFormation('あ')).toBeNull();
});
