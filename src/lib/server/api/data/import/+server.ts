import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { MAX_UPLOAD, restoreFromZip } from '#lib/server/data/restore.ts';
import { SECTIONS, type Section } from '#lib/server/data/snapshot.ts';

/**
 * Sube un .zip (campo `file`). `?dry=1` valida y devuelve qué trae por sección, sin tocar nada.
 * Campos opcionales: `sections` (JSON, las secciones a reemplazar; por defecto todas las que trae) y
 * `keyPassword` (aplica la API key cifrada; con `dry` solo comprueba la contraseña).
 */
export const POST: RequestHandler = ({ request, url }) =>
	handle(async () => {
		const form = await request.formData().catch(() => {
			throw new HttpError(400, 'Envía el archivo como formulario (campo «file»)');
		});
		const file = form.get('file');
		if (!(file instanceof File)) throw new HttpError(400, 'Falta el archivo');
		if (file.size > MAX_UPLOAD) throw new HttpError(413, 'El archivo supera 50 MB');
		let sections: Section[] | undefined;
		const rawSections = form.get('sections');
		if (typeof rawSections === 'string') {
			try {
				sections = (JSON.parse(rawSections) as string[]).filter((x): x is Section => (SECTIONS as readonly string[]).includes(x));
			} catch {
				throw new HttpError(400, 'Secciones inválidas');
			}
		}
		const keyPassword = form.get('keyPassword');
		const bytes = new Uint8Array(await file.arrayBuffer());
		return Response.json(
			await restoreFromZip(db, bytes, {
				dry: url.searchParams.has('dry'),
				backupKind: 'pre-import',
				sections,
				keyPassword: typeof keyPassword === 'string' ? keyPassword : undefined
			})
		);
	});
