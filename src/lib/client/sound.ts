// Experimento: emparejar por sonido (ultrasonido) con ggwave. Ver /lab/ultrasonido y docs/sync-qr.md.
import type { GGWave, Instance } from 'ggwave';

export const PROTOCOLS = {
	ultra_normal: { id: 'GGWAVE_PROTOCOL_ULTRASOUND_NORMAL', label: 'Ultrasonido · normal' },
	ultra_fast: { id: 'GGWAVE_PROTOCOL_ULTRASOUND_FAST', label: 'Ultrasonido · rápido' },
	ultra_fastest: { id: 'GGWAVE_PROTOCOL_ULTRASOUND_FASTEST', label: 'Ultrasonido · máximo' },
	audible_fast: { id: 'GGWAVE_PROTOCOL_AUDIBLE_FAST', label: 'Audible · rápido (referencia)' }
} as const;
export type ProtocolKey = keyof typeof PROTOCOLS;

let lib: Promise<GGWave> | null = null;

/** Carga ggwave (150 KB con WASM incrustado) solo cuando se usa. */
export function loadGGWave() {
	lib ??= import('ggwave').then(async (m) => {
		const g = await (m.default ?? (m as unknown as () => Promise<GGWave>))();
		g.disableLog();
		return g;
	});
	return lib;
}

/** Una instancia por AudioContext (la frecuencia de muestreo del dispositivo: 44,1 o 48 kHz). */
export async function makeInstance(ctx: AudioContext): Promise<{ g: GGWave; inst: Instance }> {
	const g = await loadGGWave();
	const p = g.getDefaultParameters();
	p.sampleRateInp = ctx.sampleRate;
	p.sampleRateOut = ctx.sampleRate;
	return { g, inst: g.init(p) };
}

/** Codifica `text` y devuelve un AudioBuffer listo para reproducir (suavizado con `shape` si se da). */
export function encodeToBuffer(
	ctx: AudioContext,
	g: GGWave,
	inst: Instance,
	text: string,
	protocol: ProtocolKey,
	volume: number,
	shape?: Shape
) {
	const view = g.encode(inst, text, g.ProtocolId[PROTOCOLS[protocol].id], volume);
	// La vista apunta a memoria WASM: copiar antes de cualquier otra llamada.
	const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
	let samples = new Float32Array(bytes);
	if (shape && !protocol.startsWith('audible')) samples = shapeSamples(samples, ctx.sampleRate, shape);
	const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
	buf.getChannelData(0).set(samples);
	return buf;
}

// ---------- Perfil de sonido: que el ultrasonido no se oiga ni moleste ----------
// Lo audible de una emisión «ultrasónica» (banda 15-19,5 kHz) sale sobre todo de los saltos bruscos: el arranque y el final
// (clic) y cada cambio de tono (salpica energía hacia abajo). La rampa suaviza los bordes y el paso-alto quita lo que cae
// por debajo de la banda. Todo es del lado que EMITE: el receptor decodifica cualquier protocolo, así que cada dispositivo
// puede tener su propio perfil.

export type Shape = {
	/** Corte del filtro paso-alto (Hz); 0 = sin filtro. */
	highpassHz: number;
	/** Rampa de entrada y salida (ms); 0 = sin rampa. */
	rampMs: number;
};
export type SoundProfile = Shape & { protocol: ProtocolKey; volume: number };

export const DEFAULT_PROFILE: SoundProfile = { protocol: 'ultra_fast', volume: 50, highpassHz: 14000, rampMs: 30 };
const PROFILE_KEY = 'sensei.sound';

/** Perfil de este dispositivo (localStorage; si falta o está dañado, el de por defecto). */
export function loadProfile(): SoundProfile {
	try {
		const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<SoundProfile> | null;
		if (!raw) return { ...DEFAULT_PROFILE };
		const p = { ...DEFAULT_PROFILE, ...raw };
		if (!(p.protocol in PROTOCOLS)) p.protocol = DEFAULT_PROFILE.protocol;
		p.volume = clamp(Number(p.volume) || DEFAULT_PROFILE.volume, 1, 100);
		p.highpassHz = clamp(Number(p.highpassHz) || 0, 0, 16000);
		p.rampMs = clamp(Number(p.rampMs) || 0, 0, 200);
		return p;
	} catch {
		return { ...DEFAULT_PROFILE };
	}
}

export function saveProfile(p: SoundProfile) {
	try {
		localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
	} catch {
		/* almacenamiento bloqueado: se usa solo en esta visita */
	}
}

export function resetProfile() {
	try {
		localStorage.removeItem(PROFILE_KEY);
	} catch {
		/* nada que borrar */
	}
	return { ...DEFAULT_PROFILE };
}

/** Resumen legible de un perfil, p. ej. «Ultrasonido · rápido · vol 50 · filtro 14.0 kHz · rampa 30 ms». */
export function describeProfile(p: SoundProfile) {
	const audible = p.protocol.startsWith('audible');
	return [
		PROTOCOLS[p.protocol].label,
		`vol ${p.volume}`,
		...(audible ? [] : [p.highpassHz ? `filtro ${(p.highpassHz / 1000).toFixed(1)} kHz` : 'sin filtro', p.rampMs ? `rampa ${p.rampMs} ms` : 'sin rampa'])
	].join(' · ');
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Rampa (medio coseno) en los bordes y paso-alto Butterworth de 8.º orden (cuatro biquads: corta abrupto, ~-1 dB a 15 kHz
 * con corte en 14 kHz). Devuelve una copia.
 */
export function shapeSamples(x: Float32Array, sampleRate: number, { highpassHz, rampMs }: Shape) {
	const y = new Float32Array(x);
	const n = Math.min(Math.floor(y.length / 2), Math.round((rampMs / 1000) * sampleRate));
	for (let i = 0; i < n; i++) {
		const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
		y[i] *= g;
		y[y.length - 1 - i] *= g;
	}
	if (highpassHz > 0 && highpassHz < sampleRate / 2) {
		for (const q of [0.5098, 0.6013, 0.9, 2.5629]) highpass(y, sampleRate, highpassHz, q);
	}
	return y;
}

/** Biquad paso-alto (RBJ) en el sitio. */
function highpass(y: Float32Array, fs: number, f0: number, q: number) {
	const w = (2 * Math.PI * f0) / fs;
	const cos = Math.cos(w);
	const alpha = Math.sin(w) / (2 * q);
	const a0 = 1 + alpha;
	const b0 = (1 + cos) / 2 / a0;
	const b1 = -(1 + cos) / a0;
	const a1 = (-2 * cos) / a0;
	const a2 = (1 - alpha) / a0;
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < y.length; i++) {
		const x0 = y[i];
		const out = b0 * x0 + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = out;
		y[i] = out;
	}
}

// ---------- Calibración del volumen (dos dispositivos, por turnos) ----------
// El que calibra emite el mismo mensaje corto a volúmenes crecientes («SC~v~<vol>~<id>»); el otro anota cuáles oyó y,
// al terminar, emite el resultado («SC~r~<vol>~<id>»), que el primero guarda como su volumen.

export const CAL_LEVELS = [5, 10, 15, 20, 30, 40, 55, 70, 85, 100] as const;

export type CalMessage = { kind: 'v' | 'r'; volume: number; id: string };

export function calMessage(m: CalMessage) {
	return `SC~${m.kind}~${m.volume}~${m.id}`;
}

export function parseCal(text: string): CalMessage | null {
	const m = /^SC~([vr])~(\d{1,3})~([A-Z0-9]{4})$/.exec(text);
	if (!m) return null;
	const volume = Number(m[2]);
	if (volume < 0 || volume > 100) return null;
	return { kind: m[1] as 'v' | 'r', volume, id: m[3] };
}

/**
 * Volumen recomendado a partir de los niveles oídos: el menor nivel desde el cual se oyeron TODOS los siguientes
 * (descarta aciertos sueltos), más un escalón de margen. 0 si no llegó ninguno.
 */
export function recommendVolume(heard: Iterable<number>, levels: readonly number[] = CAL_LEVELS) {
	const got = new Set(heard);
	let min = -1;
	for (let i = levels.length - 1; i >= 0 && got.has(levels[i]); i--) min = i;
	if (min < 0) {
		// Ni siquiera el más alto, pero quizá algunos sueltos: el más alto oído, sin margen.
		const any = levels.filter((l) => got.has(l));
		return any.length ? any[any.length - 1] : 0;
	}
	return levels[Math.min(levels.length - 1, min + 1)];
}

/** Decodifica un trozo de micrófono (float32); devuelve el texto o null. */
export function decodeChunk(g: GGWave, inst: Instance, chunk: Float32Array): string | null {
	const copy = new Float32Array(chunk);
	const res = g.decode(inst, new Int8Array(copy.buffer));
	if (!res || res.length === 0) return null;
	return new TextDecoder().decode(new Uint8Array(res));
}

/** Código de prueba: corto (6) o del tamaño real de una clave de emparejamiento (base64url de 32 bytes = 43). */
export function randomPayload(kind: 'short' | 'key') {
	if (kind === 'short') {
		const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => A[b % A.length]).join('');
	}
	const b = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
