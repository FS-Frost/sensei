import type { RequestHandler } from '#lib/server/router.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { deleteBackup, isBackupName, readBackup } from '#lib/server/data/backups.ts';

async function bytesOr404(name: string) {
	if (!isBackupName(name)) throw new HttpError(400, 'Nombre de copia inválido');
	const bytes = await readBackup(name);
	if (!bytes) throw new HttpError(404, 'La copia no existe');
	return bytes;
}

export const GET: RequestHandler = ({ params }) =>
	handle(async () => {
		const bytes = await bytesOr404(params.name);
		return new Response(bytes as Uint8Array<ArrayBuffer>, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${params.name}"`
			}
		});
	});

export const DELETE: RequestHandler = ({ params }) =>
	handle(async () => {
		await bytesOr404(params.name);
		await deleteBackup(params.name);
		return new Response(null, { status: 204 });
	});
