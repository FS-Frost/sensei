import { toRomaji } from 'wanakana';

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

export const ALL_KANA = [...HIRAGANA_BASIC, ...HIRAGANA_DAKUTEN, ...KATAKANA_BASIC, ...KATAKANA_DAKUTEN];

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
	o: ['wo']
};

export function kanaRomaji(kana: string): string {
	return toRomaji(kana);
}

export function acceptedRomaji(kana: string): string[] {
	const main = toRomaji(kana);
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
