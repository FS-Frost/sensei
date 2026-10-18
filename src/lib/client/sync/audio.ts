// Señas por sonido (ultrasonido; el receptor también decodifica audible), sobre client/sound.ts (ggwave).
// El sonido es SEMIDÚPLEX: dos dispositivos emitiendo a la vez en la misma banda se tapan. Por eso el emparejamiento
// se hace por turnos (ver Pairing.svelte): el iniciador emite y luego calla escuchando; el otro responde en ese silencio.
import type { GGWave, Instance } from 'ggwave';
import { decodeChunk, encodeToBuffer, makeInstance, type ProtocolKey, type SoundProfile } from '../sound.ts';
// Vite empaqueta el procesador (y su import de frames.ts) como módulo aparte con hash: lo precachea el service worker.
import workletUrl from './capture.worklet.ts?worker&url';

let ctx: AudioContext | null = null;
export function audioContext() {
	ctx ??= new AudioContext();
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

export type Emitter = {
	/** Duración de una emisión (s). */
	readonly duration: number;
	/** Emite una vez; se resuelve al terminar (o al detener). */
	playOnce(): Promise<void>;
	readonly playing: boolean;
	setProtocol(p: ProtocolKey): void;
	stop(): void;
};

/** Emisor con el perfil de sonido del dispositivo (volumen, paso-alto, rampa; ver sound.ts). */
export async function createEmitter(text: string, profile: SoundProfile): Promise<Emitter> {
	const c = audioContext();
	const { g, inst } = await makeInstance(c);
	let buf = encodeToBuffer(c, g, inst, text, profile.protocol, profile.volume, profile);
	let src: AudioBufferSourceNode | null = null;
	let stopped = false;
	return {
		get duration() {
			return buf.duration;
		},
		get playing() {
			return !!src;
		},
		playOnce() {
			if (stopped || src) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const s = c.createBufferSource();
				s.buffer = buf;
				s.connect(c.destination);
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					clearTimeout(timer);
					if (src === s) src = null;
					resolve();
				};
				// Respaldo: si `onended` no llega (contexto sin salida de audio, pestaña en segundo plano…),
				// el turno no puede quedarse emitiendo para siempre.
				const timer = setTimeout(finish, buf.duration * 1000 + 400);
				s.onended = finish;
				src = s;
				if (c.state === 'suspended') void c.resume();
				s.start();
			});
		},
		setProtocol(p) {
			buf = encodeToBuffer(c, g, inst, text, p, profile.volume, profile);
		},
		stop() {
			stopped = true;
			try {
				src?.stop();
			} catch {
				/* ya terminó */
			}
			src = null;
			g.free(inst);
		}
	};
}

export type Capture = 'worklet' | 'script';
export type Listener = { stop(): void; readonly capture: Capture; readonly sampleRate: number };

const workletReady = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Carga el procesador de captura una vez por contexto; false si el navegador no tiene AudioWorklet. */
function loadWorklet(c: AudioContext) {
	let p = workletReady.get(c);
	if (!p) {
		p = (async () => {
			if (!c.audioWorklet) return false;
			try {
				await c.audioWorklet.addModule(workletUrl);
				return true;
			} catch (e) {
				console.warn('[sensei] AudioWorklet no disponible, se usa ScriptProcessor', e);
				return false;
			}
		})();
		workletReady.set(c, p);
	}
	return p;
}

/**
 * Escucha el micrófono sin procesado (cancelación de eco y ganancia automática borran los tonos) y decodifica con ggwave.
 * Captura con AudioWorklet (hilo de audio, sin pérdidas); respaldo: ScriptProcessor (obsoleto, hilo principal).
 * Medidor: banda 15-20 kHz.
 */
export async function listen(onText: (t: string) => void, onLevel?: (db: number) => void): Promise<Listener> {
	const c = audioContext();
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
	const { g, inst }: { g: GGWave; inst: Instance } = await makeInstance(c);
	const src = c.createMediaStreamSource(stream);
	const decode = (frame: Float32Array) => {
		const t = decodeChunk(g, inst, frame);
		if (t) onText(t);
	};
	// Los dos procesadores solo corren conectados a la salida: pasan por una ganancia 0 (silencio).
	const mute = c.createGain();
	mute.gain.value = 0;
	let node: AudioNode;
	let capture: Capture;
	if (await loadWorklet(c)) {
		const w = new AudioWorkletNode(c, 'sensei-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
		w.port.onmessage = (e: MessageEvent<Float32Array>) => decode(e.data);
		node = w;
		capture = 'worklet';
	} else {
		const sp = c.createScriptProcessor(1024, 1, 1);
		sp.onaudioprocess = (e) => decode(e.inputBuffer.getChannelData(0));
		node = sp;
		capture = 'script';
	}
	src.connect(node).connect(mute).connect(c.destination);
	let raf = 0;
	if (onLevel) {
		const analyser = c.createAnalyser();
		analyser.fftSize = 4096;
		src.connect(analyser);
		const bins = new Float32Array(analyser.frequencyBinCount);
		const hz = c.sampleRate / analyser.fftSize;
		const tick = () => {
			analyser.getFloatFrequencyData(bins);
			let max = -140;
			for (let i = Math.floor(15000 / hz); i < Math.min(bins.length, Math.ceil(20000 / hz)); i++) max = Math.max(max, bins[i]);
			onLevel(max);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}
	return {
		capture,
		sampleRate: c.sampleRate,
		stop() {
			cancelAnimationFrame(raf);
			if (node instanceof AudioWorkletNode) node.port.onmessage = null;
			node.disconnect();
			src.disconnect();
			stream.getTracks().forEach((t) => t.stop());
			g.free(inst);
		}
	};
}
