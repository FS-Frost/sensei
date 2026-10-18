// Estado global del cliente (runes).
import type { FuriganaMode, PromptFont } from '../types.ts';

export const prefs = $state({
	furigana: 'adaptive' as FuriganaMode,
	ttsEnabled: true,
	fontVariety: true,
	readable: new Set<string>(),
	/** Kana que aún no lees con soltura: bajo ellos se muestra romaji de apoyo (KanaHint). */
	weakKana: new Set<string>(),
	/** Exigencia al corregir la escritura (KanjiTrace). */
	writingStrictness: 'normal' as 'relaxed' | 'normal' | 'strict'
});

export function setPrefs(p: {
	furigana: FuriganaMode;
	ttsEnabled: boolean;
	fontVariety: boolean;
	readable: string;
	weakKana?: string;
	writingStrictness?: 'relaxed' | 'normal' | 'strict';
}) {
	prefs.writingStrictness = p.writingStrictness ?? 'normal';
	prefs.furigana = p.furigana;
	prefs.ttsEnabled = p.ttsEnabled;
	prefs.fontVariety = p.fontVariety;
	prefs.readable = new Set([...p.readable]);
	prefs.weakKana = new Set([...(p.weakKana ?? '')]);
}

const FONTS: PromptFont[] = ['gothic', 'mincho', 'kyokasho', 'maru', 'brush', 'manga'];

/** Fuente para un enunciado: aleatoria si la variedad está activa (la gótica sale más a menudo, es la base). */
export function pickFont(): PromptFont {
	if (!prefs.fontVariety) return 'gothic';
	return Math.random() < 0.35 ? 'gothic' : FONTS[1 + Math.floor(Math.random() * (FONTS.length - 1))];
}

export const FONT_LABELS: Record<PromptFont, string> = {
	gothic: 'gótica',
	mincho: 'mincho (libros)',
	kyokasho: 'de libro de texto',
	maru: 'redondeada',
	brush: 'pincel',
	manga: 'títulos de manga'
};

/** Clase CSS del contenedor según el modo de furigana. */
export function furiganaClass(mode: FuriganaMode) {
	return mode === 'always' ? 'show-furigana' : mode === 'never' ? 'hide-furigana' : '';
}

/** Popover del diccionario. */
export const lookup = $state({
	open: false,
	q: '',
	b: '',
	x: 0,
	y: 0
});

export function openLookup(q: string, b: string, rect: DOMRect) {
	lookup.q = q;
	lookup.b = b;
	lookup.x = rect.left + rect.width / 2;
	lookup.y = rect.bottom;
	lookup.open = true;
}

export function closeLookup() {
	lookup.open = false;
}
