// ggwave: codificar en ultrasonido y decodificar en trozos de 1024 muestras, como hace el receptor con el micrófono.
import { expect, test } from 'bun:test';
import factory from 'ggwave';

test('ultrasonido: ida y vuelta de una clave de 43 caracteres y de unas señas WebRTC compactas, a 48 kHz', async () => {
	const g = await factory();
	g.disableLog();
	const p = g.getDefaultParameters();
	p.sampleRateInp = 48000;
	p.sampleRateOut = 48000;
	const tx = g.init(p);
	const rx = g.init(p);
	// Señas reales (oferta de Edge, 105 caracteres) además de la clave corta.
	const signal = 'S2~o~GaHc~pvnxPC/bX2QZvrLcP89HVTQC~dGgvm96GjRYFVds8qqUpV7AdyTW1Y0gOQU5P9aN9Z9I~192.168.100.5~60269~tn2sdh';
	for (const key of ['q8Zr0Kx3-_aB9c1DeFgHiJkLmNoPqRsTuVwXyZ01234', signal]) {
		await roundtrip(g, tx, rx, key);
	}
});

test('semidúplex: con las dos señales solapadas no se recupera la respuesta; por turnos, sí', async () => {
	const g = await factory();
	g.disableLog();
	const p = g.getDefaultParameters();
	p.sampleRateInp = 48000;
	p.sampleRateOut = 48000;
	const tx = g.init(p);
	const wave = (text: string) => {
		const v = g.encode(tx, text, g.ProtocolId.GGWAVE_PROTOCOL_ULTRASOUND_FAST, 50);
		return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
	};
	const offer = wave('S2~o~GaHc~pvnxPC/bX2QZvrLcP89HVTQC~dGgvm96GjRYFVds8qqUpV7AdyTW1Y0gOQU5P9aN9Z9I~192.168.100.5~60269~tn2sdh');
	const answer = wave('S2~a~f0/H~znPRQ1JZw9cC+BLSdjpoW+7N~RS9HlNe9sGELosiA1M4Y9PEh8LJfFjeQOqHUT8llZvc~192.168.100.5~52195~tn2sdj');
	/** Lo que oye el micrófono del PC: su propia oferta (más fuerte, está al lado) + la respuesta del móvil. */
	const heard = (answerAt: number) => {
		const mix = new Float32Array(Math.max(offer.length, answerAt + answer.length) + 24000);
		for (let i = 0; i < offer.length; i++) mix[i] += offer[i];
		for (let i = 0; i < answer.length; i++) mix[answerAt + i] += answer[i] * 0.4;
		const rx = g.init(p);
		const got: string[] = [];
		for (let i = 0; i + 1024 <= mix.length; i += 1024) {
			const r = g.decode(rx, new Int8Array(new Float32Array(mix.subarray(i, i + 1024)).buffer));
			if (r.length) got.push(new TextDecoder().decode(new Uint8Array(r)));
		}
		g.free(rx);
		return got.filter((t) => t.startsWith('S2~a~'));
	};
	expect(heard(Math.floor(offer.length * 0.3))).toHaveLength(0); // responde mientras el PC emite: se pierde
	expect(heard(offer.length + 4800)).toHaveLength(1); // responde en el silencio del PC: llega
});

async function roundtrip(g: Awaited<ReturnType<typeof factory>>, tx: number, rx: number, key: string) {
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
		console.log(`${proto} · ${key.length} car.: ${(samples.length / 48000).toFixed(1)} s`);
	}
}
