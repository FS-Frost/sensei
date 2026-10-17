import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { State } from '#lib/server/srs/fsrs.ts';

export const load = () => {
	// Estado agregado por kanji: el peor de sus facetas (igual que statusOf).
	const rows = db.all<{ c: string; m: string; n: number; notReview: number; minStab: number | null }>(sql`
		select k.char as c, k.meanings_es as m,
			count(c.id) as n,
			sum(case when c.state != ${State.Review} then 1 else 0 end) as notReview,
			min(c.stability) as minStab
		from kanji k
		left join card c on c.item_type = 'kanji' and c.item_key = k.char
		where k.learn_order is not null
		group by k.char
		order by k.learn_order
	`);
	return {
		kanji: rows.map((r) => ({
			c: r.c,
			m: (JSON.parse(r.m) as string[])[0] ?? '',
			s: !r.n ? 0 : r.notReview ? 1 : (r.minStab ?? 0) >= 21 ? 3 : 2
		}))
	};
};
