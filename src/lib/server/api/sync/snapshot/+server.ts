import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { syncZip } from '#lib/server/sync.ts';

/** El .zip a enviar al otro dispositivo, con su hash en `X-Sensei-Hash`. */
export const GET: RequestHandler = () =>
	handle(() => {
		const { zip, hash } = syncZip(db);
		return new Response(zip as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/zip', 'X-Sensei-Hash': hash } });
	});
