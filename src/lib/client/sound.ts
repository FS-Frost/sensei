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

/** Codifica `text` y devuelve un AudioBuffer listo para reproducir. */
export function encodeToBuffer(ctx: AudioContext, g: GGWave, inst: Instance, text: string, protocol: ProtocolKey, volume: number) {
	const view = g.encode(inst, text, g.ProtocolId[PROTOCOLS[protocol].id], volume);
	// La vista apunta a memoria WASM: copiar antes de cualquier otra llamada.
	const bytes = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
	const samples = new Float32Array(bytes);
	const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
	buf.getChannelData(0).set(samples);
	return buf;
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
