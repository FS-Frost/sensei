// Acumula los cuantos de audio (128 muestras en un AudioWorklet) en tramas del tamaño que espera ggwave (1024).
// Puro: lo usan el procesador (capture.worklet.ts) y los tests.

export class FrameAccumulator {
	private buf: Float32Array;
	private n = 0;

	constructor(readonly size = 1024) {
		this.buf = new Float32Array(size);
	}

	/** Añade muestras; devuelve las tramas completas (copias nuevas, transferibles). */
	push(samples: Float32Array): Float32Array[] {
		const out: Float32Array[] = [];
		let i = 0;
		while (i < samples.length) {
			const take = Math.min(this.size - this.n, samples.length - i);
			this.buf.set(samples.subarray(i, i + take), this.n);
			this.n += take;
			i += take;
			if (this.n === this.size) {
				out.push(this.buf);
				this.buf = new Float32Array(this.size);
				this.n = 0;
			}
		}
		return out;
	}
}
