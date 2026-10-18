import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { upcomingDue } from '#lib/server/srs/service.ts';

/** Vencimientos de los próximos 8 días: la página los deja al service worker para el recordatorio y la insignia. */
export const GET: RequestHandler = () => handle(() => Response.json({ due: upcomingDue(db, Date.now() + 8 * 86_400_000) }));
