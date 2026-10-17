import type { RequestHandler } from '#lib/server/router.ts';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as s from '#lib/server/db/schema.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { deleteSession, getSessionMessages, renameSession, turnIncomplete, type UserInput } from '#lib/server/gemini/tutor.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';
import { turnStream } from '#lib/server/gemini/stream.ts';
import { canUndo } from '#lib/server/gemini/actions.ts';
import { sessionCosts } from '#lib/server/gemini/usage.ts';
import type { UiBlock } from '#lib/types.ts';

function sessionOr404(id: number) {
	const sess = db.select().from(s.session).where(eq(s.session.id, id)).get();
	if (!sess) throw new HttpError(404, 'Sesión no encontrada');
	return sess;
}

export const GET: RequestHandler = ({ params }) =>
	handle(() => {
		const session = sessionOr404(Number(params.id));
		const messages = getSessionMessages(db, session.id)
			.map((m) => ({
				id: m.id,
				role: m.role,
				ui: (m.ui as UiBlock[]).filter((b) => b.type !== 'pending')
			}))
			.filter((m) => m.ui.length);
		// Qué acciones admiten «Deshacer» (el cliente lo necesita para pintar el botón).
		const undoable = Object.fromEntries(
			db
				.select({ id: s.tutorAction.id, name: s.tutorAction.name })
				.from(s.tutorAction)
				.where(eq(s.tutorAction.sessionId, session.id))
				.all()
				.map((a) => [a.id, canUndo(a.name)])
		);
		return Response.json({
			session,
			messages,
			undoable,
			incomplete: turnIncomplete(db, session.id),
			costUsd: sessionCosts(db, [session.id]).get(session.id) ?? 0
		});
	});

/** Renombrar: `{ title }`. Un título puesto a mano no lo pisa el resumen. */
export const PATCH: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const session = sessionOr404(Number(params.id));
		const { title } = await body<{ title: string }>(request);
		if (!title?.trim()) throw new HttpError(400, 'Título vacío');
		renameSession(db, session.id, title);
		return Response.json({ ok: true });
	});

export const DELETE: RequestHandler = ({ params }) =>
	handle(() => {
		const session = sessionOr404(Number(params.id));
		deleteSession(db, session.id);
		return new Response(null, { status: 204 });
	});

/** Turno del tutor por SSE: eventos `data: {json}\n\n`. */
export const POST: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const session = sessionOr404(Number(params.id));
		if (!hasGemini()) throw new HttpError(503, 'Falta la API key de Gemini: añádela en Ajustes.');
		return turnStream(db, session.id, await body<UserInput>(request));
	});
