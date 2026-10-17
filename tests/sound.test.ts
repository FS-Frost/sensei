// ggwave: codificar en ultrasonido y decodificar en trozos de 1024 muestras, como hace el receptor con el micrófono.
import { expect, test } from 'bun:test';
import factory from 'ggwave';

test('ultrasonido: ida y vuelta de una clave de 43 caracteres a 48 kHz', async () => {
	const g = await factory();
	g.disableLog();
	const p = g.getDefaultParameters();
	p.sampleRateInp = 48000;
	p.sampleRateOut = 48000;
	const tx = g.init(p);
	const rx = g.init(p);
	const key = 'q8Zr0Kx3-_aB9c1DeFgHiJkLmNoPqRsTuVwXyZ01234';
	for (const proto of ['GGWAVE_PROTOCOL_ULTRASOUND_FAST', 'GGWAVE_PROTOCOL_ULTRASOUND_FASTEST']) {
		const view = g.encode(tx, key, g.ProtocolId[proto], 50);
		const samples = new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
		// Silencio antes y después, como en una grabación real.
		const audio = new Float32Array(samples.length + 48000);
		audio.set(samples, 24000);
		let got: string | null = null;
		for (let i = 0; i + 1024 <= audio.length && !got; i += 1024) {
			const chunk = new Float32Array(audio.subarray(i, i + 1024));
			const res = g.decode(rx, new Int8Array(chunk.buffer));
			if (res.length) got = new TextDecoder().decode(new Uint8Array(res));
		}
		expect(got).toBe(key);
		console.log(`${proto}: ${(samples.length / 48000).toFixed(1)} s`);
	}
});
