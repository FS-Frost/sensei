import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { listPeers, upsertPeer } from '#lib/server/sync.ts';

/** Dispositivos recordados (sin la clave). */
export const GET: RequestHandler = () =>
	handle(() => Response.json({ peers: listPeers(db).map(({ key: _k, ...p }) => p) }));

/** Recordar (o actualizar) un dispositivo: `{ id, name, key }`. */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		const b = await body<{ id: string; name: string; key: string }>(request);
		try {
			const { key: _k, ...p } = upsertPeer(db, b);
			return Response.json(p);
		} catch (e) {
			throw new HttpError(400, e instanceof Error ? e.message : String(e));
		}
	});
