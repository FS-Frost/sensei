import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { summarizeSession } from '#lib/server/gemini/tutor.ts';

/** Cierra la sesión y guarda su resumen (memoria del tutor). */
export const POST: RequestHandler = ({ params }) =>
	handle(async () => Response.json({ summary: await summarizeSession(db, Number(params.id)) }));
