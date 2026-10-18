// Voz (lógica pura, testeada en Bun): WAV, diezmado, recorte de silencio y detector de fin de frase. La grabación está en voice.ts.

export const TARGET_RATE = 16000;
export const MAX_SECONDS = 60;

/** Diezma a 16 kHz promediando (antialias simple, de sobra para voz). */
export function downsample(input: Float32Array, from: number, to = TARGET_RATE): Float32Array {
	if (from === to) return input;
	const ratio = from / to;
	const out = new Float32Array(Math.floor(input.length / ratio));
	for (let i = 0; i < out.length; i++) {
		const a = Math.floor(i * ratio);
		const b = Math.min(input.length, Math.floor((i + 1) * ratio));
		let sum = 0;
		for (let j = a; j < b; j++) sum += input[j];
		out[i] = b > a ? sum / (b - a) : 0;
	}
	return out;
}

/** WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
	const buf = new ArrayBuffer(44 + samples.length * 2);
	const v = new DataView(buf);
	const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, 'RIFF');
	v.setUint32(4, 36 + samples.length * 2, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, rate, true);
	v.setUint32(28, rate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	str(36, 'data');
	v.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const x = Math.max(-1, Math.min(1, samples[i]));
		v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
	}
	return new Uint8Array(buf);
}

export function toBase64(bytes: Uint8Array) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** Recorta silencio al principio y al final (no pagar segundos de nada). */
export function trimSilence(x: Float32Array, rate = TARGET_RATE, threshold = 0.015): Float32Array {
	const win = Math.floor(rate * 0.02);
	const loud = (i: number) => {
		let m = 0;
		for (let j = i; j < Math.min(x.length, i + win); j++) m = Math.max(m, Math.abs(x[j]));
		return m > threshold;
	};
	let a = 0;
	while (a < x.length && !loud(a)) a += win;
	let b = x.length;
	while (b > a && !loud(Math.max(0, b - win))) b -= win;
	const pad = Math.floor(rate * 0.15);
	return x.subarray(Math.max(0, a - pad), Math.min(x.length, b + pad));
}

/** Detector de fin de frase: hubo voz y luego `silenceMs` de silencio. */
export class SilenceDetector {
	private voiced = false;
	private quietSince = 0;
	constructor(
		private silenceMs = 1300,
		private threshold = 0.03
	) {}
	/** Devuelve true cuando conviene parar. */
	push(rms: number, now: number) {
		if (rms > this.threshold) {
			this.voiced = true;
			this.quietSince = 0;
			return false;
		}
		if (!this.voiced) return false;
		if (!this.quietSince) this.quietSince = now;
		return now - this.quietSince >= this.silenceMs;
	}
}

