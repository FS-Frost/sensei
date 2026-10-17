import { sql } from 'drizzle-orm';
import { db, one } from '#lib/server/db/index.ts';
import { buildProfile } from '#lib/server/profile.ts';
import { forecast, leeches } from '#lib/server/srs/service.ts';
import { speedHistory } from '#lib/server/text/library.ts';
import { dayStart, getSettings } from '#lib/server/settings.ts';

const DAY = 86_400_000;

export const load = () => {
	const now = new Date();
	const start = dayStart(now, getSettings(db).dayStartHour);
	const from = start - 29 * DAY;
	const rows = db.all<{ t: number; correct: number; source: string }>(sql`
		select reviewed_at as t, correct, source from review_log where reviewed_at >= ${from}
	`);
	const reviews = Array(30).fill(0);
	const accuracy: (number | null)[] = Array(30).fill(null);
	const ok = Array(30).fill(0);
	for (const r of rows) {
		const i = Math.floor((r.t - from) / DAY);
		if (i < 0 || i >= 30) continue;
		reviews[i]++;
		ok[i] += r.correct ? 1 : 0;
	}
	for (let i = 0; i < 30; i++) accuracy[i] = reviews[i] ? Math.round((ok[i] / reviews[i]) * 100) : null;
	const labels = Array.from({ length: 30 }, (_, i) =>
		new Date(from + i * DAY).toLocaleDateString('es', { day: 'numeric', month: 'short' })
	);
	const fc = forecast(db, start, 14);
	const bySource = db.all<{ source: string; n: number; ok: number }>(sql`
		select source, count(*) as n, sum(correct) as ok from review_log group by source
	`);
	const byType = db.all<{ t: string; n: number; ok: number }>(sql`
		select item_type as t, count(*) as n, sum(correct) as ok from review_log
		where reviewed_at >= ${from} group by item_type
	`);
	const totals = one<{ cards: number; reviews: number; minutes: number }>(sql`
		select (select count(*) from card) as cards,
			(select count(*) from review_log) as reviews,
			(select coalesce(sum(duration_ms), 0) / 60000 from review_log) as minutes
	`);
	return {
		profile: buildProfile(db, now.getTime()),
		daily: { labels, reviews, accuracy },
		forecast: {
			labels: Array.from({ length: 14 }, (_, i) =>
				i === 0 ? 'hoy' : new Date(start + i * DAY).toLocaleDateString('es', { day: 'numeric', month: 'short' })
			),
			values: fc
		},
		bySource,
		byType,
		totals,
		leeches: leeches(db, 50),
		speed: speedHistory(db, 20).map((r) => ({ cpm: Math.round(r.cpm), at: r.createdAt }))
	};
};
