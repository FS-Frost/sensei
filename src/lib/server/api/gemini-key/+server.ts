import type { RequestHandler } from '#lib/server/router.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { setInternal } from '#lib/server/settings.ts';
import { config, setGeminiApiKey } from '#lib/server/config.ts';
import { listModels } from '#lib/server/gemini/client.ts';

/**
 * Guarda la API key de Gemini en la base del navegador (valor interno `_geminiApiKey`: nunca se exporta).
 * Antes la prueba listando modelos; si Google la rechaza, no se guarda.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const { key } = await body<{ key: string }>(request);
		const k = String(key ?? '').trim();
		if (!/^[\w-]{20,}$/.test(k)) throw new HttpError(400, 'Eso no parece una API key de Gemini');
		const previous = config.geminiApiKey;
		setGeminiApiKey(k);
		try {
			const models = await listModels();
			setInternal(db, 'geminiApiKey', k);
			return Response.json({ ok: true, models: models.length });
		} catch (e) {
			setGeminiApiKey(previous);
			throw e;
		}
	});

export const DELETE: RequestHandler = () =>
	handle(() => {
		db.delete(s.setting).where(eq(s.setting.key, '_geminiApiKey')).run();
		setGeminiApiKey('');
		return new Response(null, { status: 204 });
	});
