import { toRomaji } from 'wanakana';
import { COURSE_KANA, kanaKeyRomaji, SPECIAL_WORDS } from './kanaCourse.ts';

const HIRAGANA_BASIC = [
	...'あいうえお',
	...'かきくけこ',
	...'さしすせそ',
	...'たちつてと',
	...'なにぬねの',
	...'はひふへほ',
	...'まみむめも',
	...'やゆよ',
	...'らりるれろ',
	...'わをん'
];
const HIRAGANA_DAKUTEN = [...'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'];

const toKata = (h: string) => String.fromCharCode(h.charCodeAt(0) + 0x60);

export const KATAKANA_BASIC = HIRAGANA_BASIC.map(toKata);
export const KATAKANA_DAKUTEN = HIRAGANA_DAKUTEN.map(toKata);
export { HIRAGANA_BASIC, HIRAGANA_DAKUTEN };

/** Todo lo que se estudia como kana: básicos, dakuten, combinados (きゃ), っ/ッ, ー y katakana extendido (ファ). */
export const ALL_KANA = COURSE_KANA;

/** Romanizaciones alternativas aceptadas (Hepburn / Kunrei / Nihon-shiki). */
const ALTERNATIVES: Record<string, string[]> = {
	shi: ['si'],
	chi: ['ti'],
	tsu: ['tu'],
	fu: ['hu'],
	ji: ['zi', 'di', 'dji'],
	zu: ['du', 'dzu'],
	wo: ['o'],
	n: ['nn'],
	o: ['wo'],
	sha: ['sya'],
	shu: ['syu'],
	sho: ['syo'],
	cha: ['tya', 'cya'],
	chu: ['tyu', 'cyu'],
	cho: ['tyo', 'cyo'],
	ja: ['zya', 'jya'],
	ju: ['zyu', 'jyu'],
	jo: ['zyo', 'jyo'],
	vu: ['bu']
};

export function kanaRomaji(kana: string): string {
	return kanaKeyRomaji(kana);
}

const MACRON: Record<string, string> = { aa: 'ā', ii: 'ī', uu: 'ū', ee: 'ē', oo: 'ō', ou: 'ō' };

/**
 * Romaji aceptado para una palabra escrita en kana: la ー alarga la vocal anterior (コーヒー → koohii), la っ
 * duplica la consonante (きって → kitte). Acepta también vocales largas con macrón (kōhī), «o» por を y la
 * romanización Kunrei (si, ti, tu, hu, zi).
 */
export function wordRomaji(word: string): string[] {
	const parts = word.split('ー');
	let main = '';
	parts.forEach((p, i) => {
		main += toRomaji(p);
		if (i < parts.length - 1) main += main.match(/[aeiou](?=[^aeiou]*$)/)?.[0] ?? '';
	});
	const out = new Set([main]);
	out.add(main.replace(/aa|ii|uu|ee|oo|ou/g, (m) => MACRON[m]));
	if (main.includes('wo')) out.add(main.replace(/wo/g, 'o'));
	out.add(
		main
			.replace(/shi/g, 'si')
			.replace(/chi/g, 'ti')
			.replace(/tsu/g, 'tu')
			.replace(/fu/g, 'hu')
			.replace(/ji/g, 'zi')
			.replace(/sh/g, 'sy')
			.replace(/ch/g, 'ty')
			.replace(/j/g, 'zy')
	);
	return [...out];
}

export function acceptedRomaji(kana: string): string[] {
	// っ/ッ y ー se preguntan con palabras de ejemplo: vale el romaji de cualquiera de ellas.
	const words = SPECIAL_WORDS[kana];
	if (words) return [...new Set(words.flatMap((w) => wordRomaji(w.word)))];
	const main = kanaKeyRomaji(kana);
	const alts = ALTERNATIVES[main] ?? [];
	// を solo acepta 'o' como alternativa de 'wo'; お no acepta 'wo'.
	if (kana === 'お' || kana === 'オ') return [main];
	return [main, ...alts];
}

export function kanaScript(kana: string): 'hiragana' | 'katakana' {
	const c = kana.charCodeAt(0);
	return c >= 0x30a0 && c <= 0x30ff ? 'katakana' : 'hiragana';
}

/** Pares visualmente confundibles: se priorizan en el diagnóstico. */
export const CONFUSABLE_KANA: [string, string][] = [
	['シ', 'ツ'],
	['ソ', 'ン'],
	['ク', 'ケ'],
	['ナ', 'メ'],
	['ワ', 'ウ'],
	['フ', 'ヌ'],
	['ぬ', 'め'],
	['ね', 'れ'],
	['わ', 'れ'],
	['さ', 'ち'],
	['る', 'ろ'],
	['は', 'ほ'],
	['き', 'さ'],
	['あ', 'お'],
	['コ', 'ユ'],
	['ア', 'マ']
];
