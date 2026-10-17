import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { explainText } from '#lib/server/gemini/texts.ts';
import { trackCost } from '#lib/server/gemini/usage.ts';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ text?: string; image?: { mimeType: string; data: string } }>(request);
		const text = b.text?.trim().slice(0, 4000);
		if (!text && !b.image) throw new HttpError(400, 'Envía texto o una imagen');
		if (b.image) {
			if (!MIME.includes(b.image.mimeType)) throw new HttpError(400, 'Formato de imagen no soportado');
			if (b.image.data.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(413, 'Imagen demasiado grande (máx. 8 MB)');
		}
		const { result, cost } = await trackCost(() => explainText(db, { text, image: b.image }));
		return Response.json({ ...result, cost });
	});
