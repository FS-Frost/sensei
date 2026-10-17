import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { listSessions } from '#lib/server/gemini/tutor.ts';

/** Sesiones (solo las que tienen mensajes), con nº de mensajes. */
export const GET: RequestHandler = () => handle(() => Response.json({ sessions: listSessions(db) }));
