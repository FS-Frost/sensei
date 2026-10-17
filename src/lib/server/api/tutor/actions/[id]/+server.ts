import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle, HttpError } from '#lib/server/http.ts';
import { ActionError, canUndo, confirmAction, rejectAction, undoAction } from '#lib/server/gemini/actions.ts';

/** `{ op: 'confirm' | 'reject' | 'undo' }` sobre una acción del tutor. El resultado se le comunica en el siguiente turno. */
export const POST: RequestHandler = ({ params, request }) =>
	handle(async () => {
		const { op } = await body<{ op: 'confirm' | 'reject' | 'undo' }>(request);
		const id = Number(params.id);
		try {
			const row = op === 'confirm' ? await confirmAction(db, id) : op === 'reject' ? rejectAction(db, id) : op === 'undo' ? undoAction(db, id) : null;
			if (!row) throw new HttpError(400, 'Operación inválida');
			return Response.json({ id: row.id, status: row.status, result: row.result, undoable: canUndo(row.name) && !!row.undo });
		} catch (e) {
			if (e instanceof ActionError) throw new HttpError(409, e.message);
			throw e;
		}
	});
