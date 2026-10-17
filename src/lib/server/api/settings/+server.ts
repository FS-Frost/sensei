import type { RequestHandler } from '#lib/server/router.ts';
import { db } from '#lib/server/db/index.ts';
import { body, handle } from '#lib/server/http.ts';
import { getSettings, updateSettings, type Settings } from '#lib/server/settings.ts';

export const GET: RequestHandler = () => handle(() => Response.json(getSettings(db)));

export const POST: RequestHandler = ({ request }) =>
	handle(async () => Response.json(updateSettings(db, await body<Partial<Settings>>(request))));
