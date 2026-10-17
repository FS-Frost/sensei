import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { isBackupName, readBackup } from '#lib/server/data/backups.ts';
import { restoreFromZip } from '#lib/server/data/restore.ts';

/** Restaura una copia (reemplaza el estado actual; antes guarda una copia «pre-restore»). `?dry=1` = vista previa. */
export const POST: RequestHandler = ({ params, url }) =>
	handle(async () => {
		if (!isBackupName(params.name)) throw new HttpError(400, 'Nombre de copia inválido');
		const bytes = await readBackup(params.name);
		if (!bytes) throw new HttpError(404, 'La copia no existe');
		return Response.json(await restoreFromZip(db, bytes, { dry: url.searchParams.has('dry'), backupKind: 'pre-restore' }));
	});
