// Señas por sonido (ultrasonido; el receptor también decodifica audible), sobre client/sound.ts (ggwave).
// El sonido es SEMIDÚPLEX: dos dispositivos emitiendo a la vez en la misma banda se tapan. Por eso el emparejamiento
// se hace por turnos (ver Pairing.svelte): el iniciador emite y luego calla escuchando; el otro responde en ese silencio.
import type { GGWave, Instance } from 'ggwave';
import { decodeChunk, encodeToBuffer, makeInstance, type ProtocolKey } from '../sound.ts';

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

export async function createEmitter(text: string, protocol: ProtocolKey = 'ultra_fast', volume = 50): Promise<Emitter> {
	const c = audioContext();
	const { g, inst } = await makeInstance(c);
	let buf = encodeToBuffer(c, g, inst, text, protocol, volume);
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
			buf = encodeToBuffer(c, g, inst, text, p, volume);
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

export type Listener = { stop(): void };

/** Escucha el micrófono sin procesado (cancelación de eco y ganancia automática borran los tonos). */
export async function listen(onText: (t: string) => void, onLevel?: (db: number) => void): Promise<Listener> {
	const c = audioContext();
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
	const { g, inst }: { g: GGWave; inst: Instance } = await makeInstance(c);
	const src = c.createMediaStreamSource(stream);
	const node = c.createScriptProcessor(1024, 1, 1);
	node.onaudioprocess = (e) => {
		const t = decodeChunk(g, inst, e.inputBuffer.getChannelData(0));
		if (t) onText(t);
	};
	const mute = c.createGain();
	mute.gain.value = 0;
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
			for (let i = Math.floor(17000 / hz); i < Math.min(bins.length, Math.ceil(21000 / hz)); i++) max = Math.max(max, bins[i]);
			onLevel(max);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}
	return {
		stop() {
			cancelAnimationFrame(raf);
			node.disconnect();
			src.disconnect();
			stream.getTracks().forEach((t) => t.stop());
			g.free(inst);
		}
	};
}
