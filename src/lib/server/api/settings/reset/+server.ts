import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { resetSettings } from '#lib/server/settings.ts';
import { createBackup } from '#lib/server/data/backups.ts';

/** Ajustes del servidor a valores por defecto (el cliente borra además tema y voz de este dispositivo). */
export const POST: RequestHandler = () =>
	handle(async () => {
		const backup = await createBackup(db, 'pre-reset');
		return Response.json({ settings: resetSettings(db), backup: backup.name });
	});
