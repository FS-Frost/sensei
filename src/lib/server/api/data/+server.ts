import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { buildSnapshot, countSnapshot } from '#lib/server/data/snapshot.ts';
import { KIND_LABELS, listBackups, RETENTION_DAYS } from '#lib/server/data/backups.ts';

/** Resumen para la página Datos: conteos actuales y copias disponibles. */
export const GET: RequestHandler = () =>
	handle(async () =>
		Response.json({
			current: countSnapshot(buildSnapshot(db)),
			backups: (await listBackups()).map((b) => ({ ...b, label: KIND_LABELS[b.kind] })),
			retentionDays: RETENTION_DAYS
		})
	);
