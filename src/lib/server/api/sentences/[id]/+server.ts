import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { handle } from '#lib/server/http.ts';
import { deleteMined } from '#lib/server/text/sentences.ts';

export const DELETE: RequestHandler = ({ params }) =>
	handle(() => {
		deleteMined(db, Number(params.id));
		return new Response(null, { status: 204 });
	});
