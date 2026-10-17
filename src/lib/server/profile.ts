import { desc, eq, gte, sql } from 'drizzle-orm';
import { GRAMMAR_BY_ID } from '../grammar.ts';
import type { DB } from './db/index.ts';
import * as s from './db/schema.ts';
import { dueCount, leeches } from './srs/service.ts';
import { State } from './srs/fsrs.ts';

export type LearnerProfile = {
	counts: Record<string, { learning: number; review: number; mastered: number }>;
	due: number;
	accuracy7d: number | null;
	reviews7d: number;
	streakDays: number;
	weakItems: { type: string; key: string; display: string; fails: number }[];
	confusions: { kind: string; a: string; b: string; count: number }[];
	notes: string[];
	recentSummaries: string[];
	/** Patrones de gramática ya estudiados. */
	grammar: string[];
	/** Ítems con muchos fallos acumulados. */
	leeches: string[];
};

const DAY = 86_400_000;

export function streak(db: DB, now = Date.now()): number {
	const rows = db.all<{ d: string }>(sql`
		select distinct date(reviewed_at / 1000, 'unixepoch', 'localtime') as d
		from review_log order by d desc limit 400
	`);
	const days = new Set(rows.map((r) => r.d));
	const fmt = (t: number) => {
		const d = new Date(t);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	let n = 0;
	let t = now;
	// Si hoy aún no estudió, la racha cuenta desde ayer.
	if (!days.has(fmt(t))) t -= DAY;
	while (days.has(fmt(t))) {
		n++;
		t -= DAY;
	}
	return n;
}

export function weakItems(db: DB, limit = 10, now = Date.now()) {
	const rows = db.all<{ type: string; key: string; fails: number }>(sql`
		select item_type as type, item_key as key, sum(case when correct = 0 then 1 else 0 end) as fails
		from review_log where reviewed_at >= ${now - 30 * DAY}
		group by item_type, item_key having fails > 0
		order by fails desc limit ${limit}
	`);
	const vocabIds = rows.filter((r) => r.type === 'vocab').map((r) => r.key);
	const forms = new Map(
		vocabIds.length
			? db.all<{ id: string; f: string }>(sql`select id, main_form as f from vocab where id in ${vocabIds}`).map((r) => [r.id, r.f])
			: []
	);
	return rows.map((r) => ({ ...r, display: r.type === 'vocab' ? (forms.get(r.key) ?? r.key) : r.key }));
}

export function buildProfile(db: DB, now = Date.now()): LearnerProfile {
	const statRows = db.all<{ t: string; learning: number; review: number; mastered: number }>(sql`
		select item_type as t,
			count(distinct case when state != ${State.Review} then item_key end) as learning,
			count(distinct case when state = ${State.Review} and stability < 21 then item_key end) as review,
			count(distinct case when state = ${State.Review} and stability >= 21 then item_key end) as mastered
		from card group by item_type
	`);
	const counts: LearnerProfile['counts'] = {};
	for (const r of statRows) counts[r.t] = { learning: r.learning, review: r.review, mastered: r.mastered };

	const acc = db
		.select({ n: sql<number>`count(*)`, ok: sql<number>`sum(${s.reviewLog.correct})` })
		.from(s.reviewLog)
		.where(gte(s.reviewLog.reviewedAt, now - 7 * DAY))
		.get();

	return {
		counts,
		due: dueCount(db, now),
		accuracy7d: acc && acc.n ? Math.round((acc.ok / acc.n) * 100) : null,
		reviews7d: acc?.n ?? 0,
		streakDays: streak(db, now),
		weakItems: weakItems(db, 10, now),
		confusions: db
			.select({ kind: s.confusion.kind, a: s.confusion.a, b: s.confusion.b, count: s.confusion.count })
			.from(s.confusion)
			.orderBy(desc(s.confusion.count), desc(s.confusion.lastAt))
			.limit(10)
			.all(),
		notes: db
			.select({ n: s.learnerNote.note })
			.from(s.learnerNote)
			.orderBy(desc(s.learnerNote.createdAt))
			.limit(15)
			.all()
			.map((r) => r.n),
		recentSummaries: db
			.select({ t: s.sessionSummary.summary })
			.from(s.sessionSummary)
			.orderBy(desc(s.sessionSummary.createdAt))
			.limit(3)
			.all()
			.map((r) => r.t),
		grammar: db
			.select({ k: s.card.itemKey })
			.from(s.card)
			.where(eq(s.card.itemType, 'grammar'))
			.all()
			.map((r) => GRAMMAR_BY_ID.get(r.k)?.pattern)
			.filter((x): x is string => !!x),
		leeches: leeches(db, 10).map((l) => l.display)
	};
}

export function addNote(db: DB, note: string) {
	db.insert(s.learnerNote).values({ note: note.slice(0, 500), createdAt: Date.now() }).run();
}
