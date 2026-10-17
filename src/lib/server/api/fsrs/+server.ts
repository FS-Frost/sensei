import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { applyCalibration, calibrate, MIN_REVIEWS, reviewCount } from '#lib/server/srs/optimizer.ts';
import { createBackup } from '#lib/server/data/backups.ts';
import { getSettings } from '#lib/server/settings.ts';

export const GET: RequestHandler = () =>
	handle(() => {
		const st = getSettings(db);
		return Response.json({
			reviews: reviewCount(db),
			minReviews: MIN_REVIEWS,
			calibratedAt: st.fsrsCalibratedAt,
			custom: !!st.fsrsParams,
			retention: st.desiredRetention
		});
	});

/**
 * `{ action: 'compute' }` → calcula parámetros y compara la carga (no cambia nada).
 * `{ action: 'apply', params }` → guarda y reprograma todas las tarjetas (con copia previa).
 * `{ action: 'reset' }` → vuelve a los parámetros por defecto.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ action: 'compute' | 'apply' | 'reset'; params?: number[] }>(request);
		if (b.action === 'compute') {
			try {
				return Response.json(await calibrate(db));
			} catch (e) {
				throw new HttpError(409, e instanceof Error ? e.message : String(e));
			}
		}
		if (b.action === 'apply' || b.action === 'reset') {
			const params = b.action === 'reset' ? null : b.params;
			if (b.action === 'apply' && (!Array.isArray(params) || params.length < 17 || !params.every(Number.isFinite)))
				throw new HttpError(400, 'Parámetros inválidos');
			const backup = await createBackup(db, 'pre-reset');
			return Response.json({ ...applyCalibration(db, params ?? null), backup: backup.name });
		}
		throw new HttpError(400, 'Acción desconocida');
	});
