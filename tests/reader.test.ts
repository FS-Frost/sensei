// Lector: ventana de frases, caracteres leídos, preferencias y posición/marcadores guardados en el texto.
import { expect, test } from 'bun:test';
import { DEFAULT_READER, loadReaderPrefs, readChars, saveReaderPrefs, windowAround, WINDOW_ALL } from '../src/lib/components/reader/reader.ts';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { buildSnapshot, applySnapshot } from '../src/lib/server/data/snapshot.ts';

test('ventana: todo si es corto; alrededor de la frase actual si es enorme', () => {
	expect(windowAround(10, 200)).toEqual([0, 200]);
	const [lo, hi] = windowAround(5000, 10000);
	expect(lo).toBeLessThanOrEqual(5000);
	expect(hi).toBeGreaterThan(5000);
	expect(hi - lo).toBeLessThan(WINDOW_ALL);
	expect(windowAround(0, 10000)[0]).toBe(0);
});

test('caracteres leídos entre dos frases, sin espacios', () => {
	const sents = [[{ s: '猫が' }, { s: '好き。' }], [{ s: ' 犬\n' }], [{ s: '鳥。' }]] as never;
	expect(readChars(sents, 0, 0)).toBe(5);
	expect(readChars(sents, 0, 2)).toBe(8);
	expect(readChars(sents, 1, 99)).toBe(3);
});

test('preferencias: valores fuera de rango vuelven a los válidos', () => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	};
	expect(loadReaderPrefs()).toEqual(DEFAULT_READER);
	store.set('sensei.reader', JSON.stringify({ size: 99, line: 'x', font: 'sans', vertical: true, mode: 'raro' }));
	expect(loadReaderPrefs()).toEqual({ size: 2.2, line: DEFAULT_READER.line, font: 'sans', vertical: true, mode: 'paged' });
	saveReaderPrefs({ ...DEFAULT_READER, mode: 'scroll' });
	expect(loadReaderPrefs().mode).toBe('scroll');
});

test('posición y marcadores viajan con la exportación', () => {
	const a = openDb(':memory:').db;
	a.insert(s.libraryText)
		.values({ title: 'Cap. 1', content: '猫。', origin: 'paste', createdAt: 1, position: 42, bookmarks: [{ sentence: 7, note: 'ojo', at: 2 }] })
		.run();
	const b = openDb(':memory:').db;
	applySnapshot(b, buildSnapshot(a));
	const t = b.select().from(s.libraryText).get()!;
	expect(t.position).toBe(42);
	expect(t.bookmarks).toEqual([{ sentence: 7, note: 'ojo', at: 2 }]);
});
