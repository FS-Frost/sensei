import { sql } from 'drizzle-orm';
import { db, one } from '#lib/server/db/index.ts';
import { getSettings } from '#lib/server/settings.ts';
import { hasGemini } from '#lib/server/gemini/client.ts';

export const load = () => ({
	settings: getSettings(db),
	gemini: hasGemini(),
	diagDone: (one<{ n: number }>(sql`select count(*) as n from review_log where source = 'diagnostic'`)?.n ?? 0) > 0
});
