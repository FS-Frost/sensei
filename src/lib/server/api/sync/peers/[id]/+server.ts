import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { forgetPeer, markSynced, renamePeer, syncState } from '#lib/server/sync.ts';

/** `{ name }` renombra; `{ synced: true }` guarda el hash actual como «sincronizado con él». */
export const PATCH: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const b = await body<{ name?: string; synced?: boolean }>(request);
		try {
			let p = b.name !== undefined ? renamePeer(db, params.id, b.name) : null;
			if (b.synced) p = markSynced(db, params.id, syncState(db).hash);
			if (!p) throw new Error('Dispositivo no encontrado');
			const { key: _k, ...rest } = p;
			return Response.json(rest);
		} catch (e) {
			throw new HttpError(404, e instanceof Error ? e.message : String(e));
		}
	});

export const DELETE: RequestHandler = ({ params }) =>
	handle(() => {
		forgetPeer(db, params.id);
		return new Response(null, { status: 204 });
	});
