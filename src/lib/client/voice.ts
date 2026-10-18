// Voz: grabar un mensaje para el tutor como WAV mono 16 kHz (Gemini no acepta el WebM de MediaRecorder de Chrome; el WAV
// funciona en todos los navegadores), con nivel en vivo y detección de silencio para el modo manos libres.
// La captura reutiliza el AudioWorklet de emparejar por sonido (sync/capture.worklet.ts), con respaldo ScriptProcessor.
import workletUrl from './sync/capture.worklet.ts?worker&url';
import { downsample, encodeWav, MAX_SECONDS, SilenceDetector, TARGET_RATE, toBase64, trimSilence } from './voice-core.ts';

export * from './voice-core.ts';

export type Recording = { wav: Uint8Array; base64: string; seconds: number; url: string };

export type Recorder = {
	/** Termina y devuelve el WAV (null si no se oyó nada). */
	stop(): Promise<Recording | null>;
	cancel(): void;
};

/**
 * Empieza a grabar. `onLevel` recibe el volumen (0-1) unas 20 veces por segundo; con `autoStop`, `onAutoStop` avisa
 * cuando el alumno terminó de hablar (silencio tras voz) o al llegar al máximo.
 */
export async function startRecording(opts: { onLevel?: (v: number) => void; autoStop?: boolean; onAutoStop?: () => void } = {}): Promise<Recorder> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
	const ctx = new AudioContext();
	if (ctx.state === 'suspended') await ctx.resume();
	const src = ctx.createMediaStreamSource(stream);
	const chunks: Float32Array[] = [];
	let total = 0;
	const maxSamples = MAX_SECONDS * ctx.sampleRate;
	const det = new SilenceDetector();
	let stopped = false;
	let lastLevel = 0;
	const onFrame = (f: Float32Array) => {
		if (stopped) return;
		chunks.push(new Float32Array(f));
		total += f.length;
		let sum = 0;
		for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
		const rms = Math.sqrt(sum / f.length);
		const now = performance.now();
		if (now - lastLevel > 50) {
			opts.onLevel?.(Math.min(1, rms * 6));
			lastLevel = now;
		}
		if ((opts.autoStop && det.push(rms, now)) || total >= maxSamples) opts.onAutoStop?.();
	};
	const mute = ctx.createGain();
	mute.gain.value = 0;
	let node: AudioNode;
	try {
		await ctx.audioWorklet.addModule(workletUrl);
		const w = new AudioWorkletNode(ctx, 'sensei-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
		w.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
		node = w;
	} catch {
		const sp = ctx.createScriptProcessor(1024, 1, 1);
		sp.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
		node = sp;
	}
	src.connect(node).connect(mute).connect(ctx.destination);

	const release = () => {
		stopped = true;
		node.disconnect();
		src.disconnect();
		stream.getTracks().forEach((t) => t.stop());
		void ctx.close();
	};
	return {
		async stop() {
			const rate = ctx.sampleRate;
			release();
			const all = new Float32Array(total);
			let o = 0;
			for (const c of chunks) {
				all.set(c, o);
				o += c.length;
			}
			const pcm = trimSilence(downsample(all, rate));
			if (pcm.length < TARGET_RATE * 0.3) return null; // menos de 0,3 s de voz: nada que enviar
			const wav = encodeWav(pcm);
			return { wav, base64: toBase64(wav), seconds: Math.round(pcm.length / TARGET_RATE), url: URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' })) };
		},
		cancel: release
	};
}

// ---------- Reconocimiento del navegador (repasos de lectura en voz alta) ----------

type SR = {
	lang: string;
	interimResults: boolean;
	maxAlternatives: number;
	onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
	onerror: ((e: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
};

export function speechRecognitionSupported() {
	return typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
}

/** Una frase en japonés con el reconocimiento del navegador (Chrome/Edge lo hacen en la nube). Devuelve alternativas. */
export function recognizeJapanese(): { result: Promise<string[]>; stop: () => void } {
	const Ctor = ((window as unknown as { SpeechRecognition?: new () => SR }).SpeechRecognition ??
		(window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition)!;
	const r = new Ctor();
	r.lang = 'ja-JP';
	r.interimResults = false;
	r.maxAlternatives = 5;
	const result = new Promise<string[]>((resolve, reject) => {
		let got: string[] = [];
		r.onresult = (e) => {
			const alts = e.results[0];
			got = Array.from({ length: alts.length }, (_, i) => alts[i].transcript.trim()).filter(Boolean);
		};
		r.onerror = (e) => (e.error === 'no-speech' ? resolve([]) : reject(new Error(e.error)));
		r.onend = () => resolve(got);
	});
	r.start();
	return { result, stop: () => r.stop() };
}
