// Tipos mínimos de ggwave 0.4 (data-over-sound, WASM incrustado). Ver node_modules/ggwave/emscripten.cpp.
declare module 'ggwave' {
	export type Instance = number;
	export type Parameters = {
		payloadLength: number;
		sampleRateInp: number;
		sampleRateOut: number;
		sampleRate: number;
		samplesPerFrame: number;
		soundMarkerThreshold: number;
		sampleFormatInp: unknown;
		sampleFormatOut: unknown;
		operatingMode: number;
	};
	type EnumValue = { value: number };
	export type GGWave = {
		getDefaultParameters(): Parameters;
		init(p: Parameters): Instance;
		free(i: Instance): void;
		/** Devuelve una vista sobre la memoria WASM (copiar antes de la siguiente llamada). */
		encode(i: Instance, data: string, protocol: EnumValue, volume: number): Int8Array;
		decode(i: Instance, data: Int8Array | Uint8Array): Int8Array;
		disableLog(): void;
		ProtocolId: Record<string, EnumValue>;
		SampleFormat: Record<string, EnumValue>;
	};
	const factory: () => Promise<GGWave>;
	export default factory;
}
