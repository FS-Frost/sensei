// Señas por sonido: emitir en bucle y escuchar (ultrasonido; el receptor también decodifica audible).
// Sobre client/sound.ts (ggwave), lo mismo que validó el laboratorio /lab/ultrasonido.
import type { GGWave, Instance } from 'ggwave';
import { decodeChunk, encodeToBuffer, makeInstance, type ProtocolKey } from '../sound.ts';

let ctx: AudioContext | null = null;
export function audioContext() {
	ctx ??= new AudioContext();
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

export type Emitter = { stop(): void; setProtocol(p: ProtocolKey): void; readonly count: number };

/** Emite `text` en bucle (pausa 1,2 s) hasta `stop()`. */
export async function emitLoop(text: string, protocol: ProtocolKey = 'ultra_fast', volume = 50): Promise<Emitter> {
	const c = audioContext();
	const { g, inst } = await makeInstance(c);
	let current = protocol;
	let buf = encodeToBuffer(c, g, inst, text, current, volume);
	let on = true;
	let src: AudioBufferSourceNode | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let count = 0;
	const play = () => {
		if (!on) return;
		src = c.createBufferSource();
		src.buffer = buf;
		src.connect(c.destination);
		src.onended = () => {
			if (on) timer = setTimeout(play, 1200);
		};
		src.start();
		count++;
	};
	play();
	return {
		get count() {
			return count;
		},
		setProtocol(p) {
			current = p;
			buf = encodeToBuffer(c, g, inst, text, current, volume);
		},
		stop() {
			on = false;
			if (timer) clearTimeout(timer);
			try {
				src?.stop();
			} catch {
				/* ya terminó */
			}
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
