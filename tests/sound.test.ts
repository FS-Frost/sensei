// ggwave: codificar en ultrasonido y decodificar en trozos de 1024 muestras, como hace el receptor con el micrófono.
import { expect, test } from 'bun:test';
import factory from 'ggwave';
import {
	CAL_LEVELS,
	calMessage,
	DEFAULT_PROFILE,
	loadProfile,
	parseCal,
	recommendVolume,
	saveProfile,
	shapeSamples
} from '../src/lib/client/sound.ts';

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

/** Energía media de la señal en `f` (Goertzel sobre toda la señal). */
function power(x: Float32Array, fs: number, f: number) {
	const k = 2 * Math.cos((2 * Math.PI * f) / fs);
	let s1 = 0;
	let s2 = 0;
	for (let i = 0; i < x.length; i++) {
		const s0 = x[i] + k * s1 - s2;
		s2 = s1;
		s1 = s0;
	}
	return (s1 * s1 + s2 * s2 - k * s1 * s2) / x.length;
}
const band = (x: Float32Array, lo: number, hi: number, step = 100) => {
	let e = 0;
	for (let f = lo; f < hi; f += step) e += power(x, 48000, f);
	return e;
};

async function encoder() {
	const g = await factory();
	g.disableLog();
	const p = g.getDefaultParameters();
	p.sampleRateInp = 48000;
	p.sampleRateOut = 48000;
	const tx = g.init(p);
	const wave = (text: string, proto = 'GGWAVE_PROTOCOL_ULTRASOUND_FAST', volume = 50) => {
		const v = g.encode(tx, text, g.ProtocolId[proto], volume);
		return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
	};
	const decodeAll = (x: Float32Array) => {
		const rx = g.init(p);
		const audio = new Float32Array(x.length + 48000);
		audio.set(x, 24000);
		const got: string[] = [];
		for (let i = 0; i + 1024 <= audio.length; i += 1024) {
			const r = g.decode(rx, new Int8Array(new Float32Array(audio.subarray(i, i + 1024)).buffer));
			if (r.length) got.push(new TextDecoder().decode(new Uint8Array(r)));
		}
		g.free(rx);
		return got;
	};
	return { wave, decodeAll };
}

const SIGNAL = 'S2~o~GaHc~pvnxPC/bX2QZvrLcP89HVTQC~dGgvm96GjRYFVds8qqUpV7AdyTW1Y0gOQU5P9aN9Z9I~192.168.100.5~60269~tn2sdh';

test('la banda «ultrasónica» de ggwave es 15-19,5 kHz (lo que mide el medidor)', async () => {
	const { wave } = await encoder();
	const x = wave(SIGNAL);
	const inBand = band(x, 15000, 19600);
	const total = band(x, 100, 23900);
	expect(inBand / total).toBeGreaterThan(0.95);
	expect(band(x, 19700, 23900) / total).toBeLessThan(0.01);
});

test('suavizado (rampa + paso-alto): sigue decodificando y quita energía audible', async () => {
	const { wave, decodeAll } = await encoder();
	for (const proto of ['GGWAVE_PROTOCOL_ULTRASOUND_NORMAL', 'GGWAVE_PROTOCOL_ULTRASOUND_FAST', 'GGWAVE_PROTOCOL_ULTRASOUND_FASTEST']) {
		const raw = wave(SIGNAL, proto);
		for (const shape of [DEFAULT_PROFILE, { highpassHz: 15000, rampMs: 150 }]) {
			expect(decodeAll(shapeSamples(raw, 48000, shape))).toEqual([SIGNAL]);
		}
		// Lo audible (bajo 12 kHz) baja al menos 20 dB con el perfil por defecto.
		const before = band(raw, 100, 12000);
		const after = band(shapeSamples(raw, 48000, DEFAULT_PROFILE), 100, 12000);
		const inBand = band(shapeSamples(raw, 48000, DEFAULT_PROFILE), 15000, 19600) / band(raw, 15000, 19600);
		console.log(`${proto}: bajo 12 kHz ${(10 * Math.log10(after / before)).toFixed(1)} dB · banda ${(10 * Math.log10(inBand)).toFixed(1)} dB`);
		expect(after / before).toBeLessThan(0.01);
		expect(inBand).toBeGreaterThan(0.5); // la señal útil pierde menos de 3 dB
	}
	// Bordes: sin rampa empieza de golpe; con rampa, el primer y el último valor son 0.
	const x = shapeSamples(wave('hola'), 48000, { highpassHz: 0, rampMs: 30 });
	expect(x[0]).toBe(0);
	expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-6);
});

test('calibración: mensajes y volumen recomendado', async () => {
	const m = { kind: 'v', volume: 30, id: 'AB2C' } as const;
	expect(parseCal(calMessage(m))).toEqual(m);
	expect(parseCal('SC~v~300~AB2C')).toBeNull();
	expect(parseCal('S2~o~…')).toBeNull();
	// Desde 20 se oye todo: 20 + un escalón de margen = 30. El 5 suelto (casualidad) no cuenta.
	expect(recommendVolume([5, 20, 30, 40, 55, 70, 85, 100])).toBe(30);
	expect(recommendVolume([85, 100])).toBe(100);
	expect(recommendVolume([100])).toBe(100);
	expect(recommendVolume([30, 55])).toBe(55); // el máximo no llegó: el más alto oído, sin margen
	expect(recommendVolume([])).toBe(0);
	// Los niveles son cortos: toda la calibración cabe en ~25 s.
	const { wave, decodeAll } = await encoder();
	let total = 0;
	for (const v of CAL_LEVELS) {
		const x = shapeSamples(wave(calMessage({ kind: 'v', volume: v, id: 'AB2C' }), undefined, v), 48000, DEFAULT_PROFILE);
		total += x.length / 48000 + 0.7;
		if (v >= 20) expect(decodeAll(x)).toEqual([calMessage({ kind: 'v', volume: v, id: 'AB2C' })]);
	}
	console.log(`calibración: ${total.toFixed(1)} s`);
	expect(total).toBeLessThan(30);
});

test('perfil: valores dañados vuelven a rangos válidos', () => {
	const store = new Map<string, string>();
	const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
	const prev = (globalThis as { localStorage?: unknown }).localStorage;
	(globalThis as { localStorage?: unknown }).localStorage = ls;
	try {
		expect(loadProfile()).toEqual(DEFAULT_PROFILE);
		store.set('sensei.sound', JSON.stringify({ protocol: 'nope', volume: 900, highpassHz: -5, rampMs: 'x' }));
		expect(loadProfile()).toEqual({ protocol: 'ultra_fast', volume: 100, highpassHz: 0, rampMs: 0 });
		saveProfile({ ...DEFAULT_PROFILE, volume: 20 });
		expect(loadProfile().volume).toBe(20);
		store.set('sensei.sound', '{roto');
		expect(loadProfile()).toEqual(DEFAULT_PROFILE);
	} finally {
		(globalThis as { localStorage?: unknown }).localStorage = prev;
	}
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
