import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { buildSnapshot, snapshotToZip } from '#lib/server/data/snapshot.ts';

/** Descarga un .zip con todos tus datos. */
export const GET: RequestHandler = () => {
	const now = new Date();
	const { zip } = snapshotToZip(buildSnapshot(db), 'export', now);
	const date = now.toISOString().slice(0, 10);
	return new Response(zip as Uint8Array<ArrayBuffer>, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="sensei-export-${date}.zip"`,
			'Cache-Control': 'no-store'
		}
	});
};
