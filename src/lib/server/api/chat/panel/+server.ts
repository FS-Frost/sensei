import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { PANEL_CONTINUE_MS, panelSession } from '#lib/server/gemini/tutor.ts';

/** Sesión del panel lateral a continuar (actividad en las últimas 3 h) o null. */
export const GET: RequestHandler = () =>
	handle(() => Response.json({ session: panelSession(db), continueMs: PANEL_CONTINUE_MS }));
