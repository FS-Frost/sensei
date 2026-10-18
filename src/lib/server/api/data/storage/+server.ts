import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { integrityCheck, pruneAllButNewest, storageReport, vacuum } from '#lib/server/data/storage.ts';

/** Tamaños de la base y de las copias (Datos → Almacenamiento). */
export const GET: RequestHandler = () => handle(async () => Response.json(await storageReport(db)));

/** `{ action: 'integrity' | 'vacuum' | 'prune-backups' }`. */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const { action } = (await request.json()) as { action?: string };
		if (action === 'integrity') return Response.json(integrityCheck(db));
		if (action === 'vacuum') return Response.json(await vacuum(db));
		if (action === 'prune-backups') return Response.json(await pruneAllButNewest());
		throw new HttpError(400, 'Acción desconocida');
	});
