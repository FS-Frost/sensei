// QR: generar (uqr, SVG) y escanear con la cámara (BarcodeDetector nativo o jsQR cargado bajo demanda).
import { renderSVG } from 'uqr';

export function qrSvg(text: string) {
	return renderSVG(text, { ecc: 'L', border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

async function makeDecoder(): Promise<(c: HTMLCanvasElement) => Promise<string | null>> {
	const BD = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
	if (BD) {
		try {
			const d = new BD({ formats: ['qr_code'] });
			return async (c) => (await d.detect(c))[0]?.rawValue ?? null;
		} catch {
			/* sin soporte de QR: jsQR */
		}
	}
	const jsQR = (await import('jsqr')).default;
	return async (c) => {
		const ctx = c.getContext('2d', { willReadFrequently: true })!;
		const img = ctx.getImageData(0, 0, c.width, c.height);
		return jsQR(img.data, img.width, img.height)?.data ?? null;
	};
}

/** Escanea desde la cámara trasera hasta leer un QR. `video` muestra la vista previa. */
export async function scanQr(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
	const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
	try {
		video.srcObject = stream;
		await video.play();
		const decode = await makeDecoder();
		const canvas = document.createElement('canvas');
		while (!signal.aborted) {
			if (video.videoWidth) {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				canvas.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0);
				const text = await decode(canvas);
				if (text) return text;
			}
			await new Promise((r) => setTimeout(r, 200));
		}
		throw new DOMException('Escaneo cancelado', 'AbortError');
	} finally {
		stream.getTracks().forEach((t) => t.stop());
		video.srcObject = null;
	}
}
