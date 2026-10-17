import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { applyPlacement, BANDS, checkPlacement, sampleBand } from '#lib/server/srs/placement.ts';
import { createBackup } from '#lib/server/data/backups.ts';

/** `?band=N` → 5 kanji de esa franja. */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const band = Number(url.searchParams.get('band') ?? 0);
		if (!Number.isInteger(band) || band < 0 || band >= BANDS.length) throw new HttpError(400, 'Franja inválida');
		return Response.json({ ...sampleBand(db, band), bands: BANDS.length });
	});

/**
 * `{ action: 'check', char, answer }` → corrige.
 * `{ action: 'apply', upTo, confirmed }` → marca como conocidos (con copia previa).
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ action: 'check' | 'apply'; char?: string; answer?: string; upTo?: number; confirmed?: string[] }>(request);
		if (b.action === 'check') return Response.json(checkPlacement(db, String(b.char ?? ''), String(b.answer ?? '')));
		if (b.action === 'apply') {
			const upTo = Math.max(0, Math.min(3000, Math.round(Number(b.upTo ?? 0))));
			const confirmed = (b.confirmed ?? []).filter((c) => typeof c === 'string').slice(0, 500);
			const backup = await createBackup(db, 'pre-reset');
			return Response.json({ ...applyPlacement(db, upTo, confirmed), backup: backup.name });
		}
		throw new HttpError(400, 'Acción desconocida');
	});
