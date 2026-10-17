import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle, HttpError } from '#lib/server/http.ts';
import { MAX_UPLOAD } from '#lib/server/data/restore.ts';
import { applySync, markSynced } from '#lib/server/sync.ts';

/** Aplica el .zip recibido (cuerpo binario). `?peer=<id>` marca la sincronización con ese recordado. */
export const POST: RequestHandler = ({ request, url }) =>
	handle(async () => {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (!bytes.length) throw new HttpError(400, 'Nada que aplicar');
		if (bytes.length > MAX_UPLOAD) throw new HttpError(413, 'Los datos superan 50 MB');
		const r = await applySync(db, bytes);
		const peer = url.searchParams.get('peer');
		if (peer) markSynced(db, peer, r.hash);
		return Response.json(r);
	});
