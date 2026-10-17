import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { createSession, MODE_LABELS, summarizePending, type UserInput } from '#lib/server/gemini/tutor.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { turnStream } from '#lib/server/gemini/stream.ts';
import type { ChatMode } from '#lib/types.ts';

/**
 * Primer mensaje de una conversación: crea la sesión (nunca se guardan sesiones vacías) y responde por SSE.
 * El primer evento es `{ type: 'session', id }`.
 */
export const POST: RequestHandler = ({ request }) =>
	handle(async () => {
		if (!hasGemini()) throw new HttpError(503, 'Falta la API key de Gemini: añádela en Ajustes.');
		const b = await body<UserInput & { mode: ChatMode; origin?: 'page' | 'panel' }>(request);
		if (!(b.mode in MODE_LABELS)) throw new HttpError(400, 'Modo inválido');
		if (!b.text?.trim()) throw new HttpError(400, 'Escribe un mensaje');
		const session = createSession(db, b.mode, b.origin === 'panel' ? 'panel' : 'page');
		// Memoria: resumir en segundo plano las sesiones anteriores inactivas.
		void summarizePending(db, session.id);
		return turnStream(db, session.id, { text: b.text, context: b.context ?? null }, [{ type: 'session', id: session.id }]);
	});
