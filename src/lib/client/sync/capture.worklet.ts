// Procesador de audio (AudioWorklet): junta el micrófono en tramas de 1024 muestras y las manda a la página,
// que las decodifica con ggwave. Corre en el hilo de audio: no se pierden trozos aunque la página vaya lenta.
import { FrameAccumulator } from './frames.ts';

declare abstract class AudioWorkletProcessor {
	readonly port: MessagePort;
	abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class CaptureProcessor extends AudioWorkletProcessor {
	private acc = new FrameAccumulator(1024);

	process(inputs: Float32Array[][]) {
		const ch = inputs[0]?.[0];
		if (ch) for (const frame of this.acc.push(ch)) this.port.postMessage(frame, [frame.buffer]);
		return true; // seguir vivo aunque haya silencio
	}
}

registerProcessor('sensei-capture', CaptureProcessor);
