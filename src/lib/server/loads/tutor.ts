import { redirect, type ServerLoadEvent } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { listSessions } from '#lib/server/gemini/tutor.ts';
import { isMode } from '#lib/tutorModes.ts';

export const load = ({ url }: ServerLoadEvent) => {
	// Compatibilidad con enlaces antiguos (?nuevo=modo): ya no se crea nada hasta el primer mensaje.
	const nuevo = url.searchParams.get('nuevo');
	if (nuevo && isMode(nuevo)) redirect(303, `/tutor/nueva?modo=${nuevo}`);
	return { sessions: listSessions(db) };
};
