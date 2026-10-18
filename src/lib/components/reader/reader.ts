// Lector de la Biblioteca: preferencias por dispositivo, ventana de frases renderizadas y caracteres leídos.
// Lógica pura (testeada); el componente es Reader.svelte.
import type { JpToken } from '../../types.ts';

export type ReaderPrefs = {
	/** rem del texto. */
	size: number;
	line: number;
	font: 'serif' | 'sans';
	/** 縦書き: columnas de derecha a izquierda. */
	vertical: boolean;
	mode: 'paged' | 'scroll';
};

export const DEFAULT_READER: ReaderPrefs = { size: 1.3, line: 2.2, font: 'serif', vertical: false, mode: 'paged' };
const KEY = 'sensei.reader';

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);

export function loadReaderPrefs(): ReaderPrefs {
	try {
		const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReaderPrefs> | null;
		if (!r) return { ...DEFAULT_READER };
		return {
			size: clamp(r.size, 1, 2.2, DEFAULT_READER.size),
			line: clamp(r.line, 1.6, 3, DEFAULT_READER.line),
			font: r.font === 'sans' ? 'sans' : 'serif',
			vertical: r.vertical === true,
			mode: r.mode === 'scroll' ? 'scroll' : 'paged'
		};
	} catch {
		return { ...DEFAULT_READER };
	}
}

export function saveReaderPrefs(p: ReaderPrefs) {
	try {
		localStorage.setItem(KEY, JSON.stringify(p));
	} catch {
		/* sin almacenamiento */
	}
}

/** Frases que se renderizan: todas si son pocas; si no, una ventana alrededor de la actual (textos enormes en el móvil). */
export const WINDOW_ALL = 1500;
export function windowAround(i: number, total: number, before = 150, after = 450): [number, number] {
	if (total <= WINDOW_ALL) return [0, total];
	const lo = Math.max(0, i - before);
	return [lo, Math.min(total, Math.max(i + after, lo + before + after))];
}

/** Caracteres leídos entre dos frases (incluidas), sin espacios ni saltos. */
export function readChars(sentences: JpToken[][], from: number, to: number) {
	let n = 0;
	for (let i = Math.max(0, from); i <= Math.min(to, sentences.length - 1); i++)
		for (const t of sentences[i]) n += t.s.replace(/\s/g, '').length;
	return n;
}
