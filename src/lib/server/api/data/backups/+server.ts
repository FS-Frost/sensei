import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { createBackup } from '#lib/server/data/backups.ts';

/** Crea una copia manual ahora. */
export const POST: RequestHandler = () => handle(async () => Response.json(await createBackup(db, 'manual')));
