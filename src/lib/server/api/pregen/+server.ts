import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { aheadStatus, pregenerateBatch } from '#lib/server/gemini/pregen.ts';
import { trackCost } from '#lib/server/gemini/usage.ts';

const MAX_AHEAD = 1000;
const BATCH = 8;
const ahead = (v: unknown) => Math.min(MAX_AHEAD, Math.max(1, Math.round(Number(v)) || 100));

/** Estado: de los próximos `?ahead=N` kanji por estudiar, cuántos ya tienen mnemotecnia, nombres y glosas. */
export const GET: RequestHandler = ({ url }) => handle(() => Response.json(aheadStatus(db, ahead(url.searchParams.get('ahead')))));

/**
 * Prepara la siguiente tanda (hasta 8 kanji) de los próximos `ahead`. El cliente repite hasta terminar o cancelar:
 * así se ve el progreso y el costo, y se puede retomar otro día sin repetir nada.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		if (!hasGemini()) throw new HttpError(503, 'Falta la API key de Gemini: añádela en Ajustes.');
		const b = await body<{ ahead?: number }>(request);
		const st = aheadStatus(db, ahead(b.ahead));
		const chars = st.nextKanji.slice(0, BATCH);
		const { result, cost } = await trackCost(() => pregenerateBatch(db, chars));
		return Response.json({ batch: result, cost, status: aheadStatus(db, ahead(b.ahead)) });
	});
