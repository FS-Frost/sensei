import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { buildSnapshot, SECTIONS, snapshotToZip, type Section, type ZipExtras } from '#lib/server/data/snapshot.ts';
import { sealSecret, SecretError } from '#lib/server/data/secret.ts';
import { currentDict } from '#lib/server/data/dictionary.ts';
import { getInternal } from '#lib/server/settings.ts';

function zipResponse(extras: ZipExtras) {
	const now = new Date();
	const { zip } = snapshotToZip(buildSnapshot(db), 'export', now, { ...extras, dict: currentDict(db) });
	const date = now.toISOString().slice(0, 10);
	const partial = extras.sections && extras.sections.length < SECTIONS.length;
	return new Response(zip as Uint8Array<ArrayBuffer>, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="sensei-export${partial ? '-parcial' : ''}-${date}.zip"`,
			'Cache-Control': 'no-store'
		}
	});
}

/** Descarga un .zip con todos tus datos (sin extras). */
export const GET: RequestHandler = () => zipResponse({});

/**
 * Exportación con opciones: `sections` (por defecto todas), `device` (preferencias de este dispositivo, las manda
 * la página) y `keyPassword` (incluye la API key de Gemini cifrada con esa contraseña).
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ sections?: string[]; device?: Record<string, string>; keyPassword?: string }>(request);
		const sections = (b.sections ?? [...SECTIONS]).filter((x): x is Section => (SECTIONS as readonly string[]).includes(x));
		const device = b.device && typeof b.device === 'object' ? b.device : undefined;
		if (!sections.length && !device && b.keyPassword === undefined) throw new HttpError(400, 'Elige al menos una sección');
		let secret: ZipExtras['secret'];
		if (b.keyPassword !== undefined) {
			const key = getInternal(db, 'geminiApiKey');
			if (!key) throw new HttpError(400, 'No hay API key de Gemini guardada en este dispositivo');
			try {
				secret = { geminiApiKey: await sealSecret(key, String(b.keyPassword)) };
			} catch (e) {
				if (e instanceof SecretError) throw new HttpError(400, e.message);
				throw e;
			}
		}
		return zipResponse({ sections, device, secret });
	});
