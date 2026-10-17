import { toHiragana, toRomaji, isKana, isKanji as wkIsKanji } from 'wanakana';

/** true si el carácter es un kanji (CJK Unified Ideographs + extensión A + 々). */
export function isKanjiChar(ch: string): boolean {
	return wkIsKanji(ch) || ch === '々';
}

export function hasKanji(s: string): boolean {
	return [...s].some(isKanjiChar);
}

export function kanjiIn(s: string): string[] {
	return [...new Set([...s].filter((c) => isKanjiChar(c) && c !== '々'))];
}

/** Normaliza una lectura para comparar: katakana → hiragana, sin espacios ni puntos/guiones. */
export function normalizeReading(s: string): string {
	return toHiragana(s.trim().replace(/[\s.\-・－]/g, ''), { passRomaji: false });
}

/** Lecturas aceptables de un kanji: on'yomi (en hiragana) y kun'yomi (raíz antes del punto y completa). */
export function acceptedKanjiReadings(on: string[], kun: string[]): string[] {
	const out = new Set<string>();
	for (const r of on) out.add(normalizeReading(r));
	for (const r of kun) {
		const clean = r.replace(/-/g, '');
		const [stem] = clean.split('.');
		out.add(normalizeReading(stem));
		out.add(normalizeReading(clean.replace('.', '')));
	}
	out.delete('');
	return [...out];
}

/** Normaliza texto en español para comparar significados. */
export function normalizeMeaning(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\(.*?\)/g, '')
		.replace(/^(el|la|los|las|un|una|unos|unas|to|a|an|the)\s+/, '')
		.replace(/[^a-z0-9ñ ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (!m) return n;
	if (!n) return m;
	let prev = Array.from({ length: n + 1 }, (_, i) => i);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[n];
}

/** ¿La respuesta coincide con algún significado aceptado? Tolera tildes, artículos y erratas leves. */
export function meaningMatches(answer: string, accepted: string[]): boolean {
	const a = normalizeMeaning(answer);
	if (!a) return false;
	for (const raw of accepted) {
		// "agua; líquido" → varias opciones
		for (const part of raw.split(/[;,/]/)) {
			const m = normalizeMeaning(part);
			if (!m) continue;
			if (a === m) return true;
			const tol = m.length <= 4 ? 0 : m.length <= 8 ? 1 : 2;
			if (levenshtein(a, m) <= tol) return true;
		}
	}
	return false;
}

export function readingMatches(answer: string, accepted: string[]): boolean {
	const a = normalizeReading(answer);
	return a.length > 0 && accepted.some((r) => normalizeReading(r) === a);
}

export { toHiragana, toRomaji, isKana };
