// Sustituto de @open-spaced-repetition/binding (nativo, solo Node/Bun) para el navegador:
// misma API mínima que usa srs/optimizer.ts, implementada con fsrs-browser (fsrs-rs en WebAssembly).
// vite.config.ts lo usa como alias; en Bun (tests) se usa el binding real.
import init, { Fsrs } from 'fsrs-browser';
import wasmUrl from 'fsrs-browser/fsrs_browser_bg.wasm?url';

export class FSRSBindingReview {
	constructor(
		readonly rating: number,
		readonly deltaT: number
	) {}
}

export class FSRSBindingItem {
	constructor(readonly reviews: FSRSBindingReview[]) {}
}

let ready: Promise<unknown> | null = null;

export async function computeParameters(items: FSRSBindingItem[], opts: { enableShortTerm?: boolean } = {}) {
	ready ??= init({ module_or_path: wasmUrl });
	await ready;
	const ratings: number[] = [];
	const deltas: number[] = [];
	const lengths: number[] = [];
	for (const it of items) {
		lengths.push(it.reviews.length);
		for (const r of it.reviews) {
			ratings.push(r.rating);
			deltas.push(r.deltaT);
		}
	}
	const fsrs = new Fsrs();
	let params: number[];
	try {
		params = [
			...fsrs.computeParameters(new Uint32Array(ratings), new Uint32Array(deltas), new Uint32Array(lengths), null, opts.enableShortTerm ?? true)
		];
	} catch (e) {
		// Un pánico de Rust deja el objeto «prestado»: no se libera (lo recoge el GC) y el módulo se reinicia la próxima vez.
		ready = null;
		const msg = e instanceof Error ? e.message : String(e);
		if (/NotEnoughData/i.test(msg)) throw new Error('Aún no hay suficientes repasos espaciados para calibrar.');
		throw e;
	}
	fsrs.free();
	return params;
}
