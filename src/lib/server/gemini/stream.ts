// SSE para los turnos del tutor (compartido por /api/chat/[id] y /api/chat/start).
import type { DB } from '../db/index.ts';
import { errorMessage } from './client.ts';
import { runTurn, type TutorEvent, type UserInput } from './tutor.ts';

export function turnStream(db: DB, sessionId: number, input: UserInput, prelude: TutorEvent[] = []) {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (ev: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
			try {
				for (const ev of prelude) send(ev);
				for await (const ev of runTurn(db, sessionId, input)) send(ev);
			} catch (e) {
				console.error('[tutor]', e);
				send({ type: 'error', message: errorMessage(e) });
				send({ type: 'done' });
			} finally {
				controller.close();
			}
		}
	});
	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }
	});
}
