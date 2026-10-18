// AudioWorklet: los cuantos de 128 muestras se juntan en tramas de 1024 sin perder ni duplicar muestras.
import { expect, test } from 'bun:test';
import { FrameAccumulator } from '../src/lib/client/sync/frames.ts';

test('tramas exactas de 1024, en orden, con entradas de cualquier tamaño', () => {
	for (const chunk of [128, 100, 1024, 3000, 1]) {
		const acc = new FrameAccumulator(1024);
		const total = 5000;
		const src = Float32Array.from({ length: total }, (_, i) => i);
		const frames: Float32Array[] = [];
		for (let i = 0; i < total; i += chunk) frames.push(...acc.push(src.subarray(i, Math.min(total, i + chunk))));
		expect(frames).toHaveLength(Math.floor(total / 1024));
		const flat = frames.flatMap((f) => [...f]);
		expect(flat).toEqual([...src.subarray(0, flat.length)]);
	}
});

test('cada trama es una copia nueva (se puede transferir sin romper la siguiente)', () => {
	const acc = new FrameAccumulator(4);
	const [a] = acc.push(Float32Array.from([1, 2, 3, 4]));
	const [b] = acc.push(Float32Array.from([5, 6, 7, 8]));
	expect(a).not.toBe(b);
	expect([...a]).toEqual([1, 2, 3, 4]);
	expect([...b]).toEqual([5, 6, 7, 8]);
});
