import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { MAX_UPLOAD, restoreFromZip } from '#lib/server/data/restore.ts';

/** Sube un .zip (campo `file`). `?dry=1` valida y devuelve qué se reemplazaría, sin tocar nada. */
export const POST: RequestHandler = ({ request, url }) =>
	handle(async () => {
		const form = await request.formData().catch(() => {
			throw new HttpError(400, 'Envía el archivo como formulario (campo «file»)');
		});
		const file = form.get('file');
		if (!(file instanceof File)) throw new HttpError(400, 'Falta el archivo');
		if (file.size > MAX_UPLOAD) throw new HttpError(413, 'El archivo supera 50 MB');
		const bytes = new Uint8Array(await file.arrayBuffer());
		return Response.json(await restoreFromZip(db, bytes, { dry: url.searchParams.has('dry'), backupKind: 'pre-import' }));
	});
