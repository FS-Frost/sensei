import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { stateFor } from '#lib/server/sync.ts';

/** Estado de este dispositivo para el saludo. `?peer=<id>`: además, si mis datos cambiaron desde la última vez con él. */
export const GET: RequestHandler = ({ url }) => handle(() => Response.json(stateFor(db, url.searchParams.get('peer'))));
