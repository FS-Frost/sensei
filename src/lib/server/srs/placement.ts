// Test de nivel de kanji: para quien ya sabe algunos, evita lecciones de lo que domina.
// Se muestrean kanji por franjas del orden de aprendizaje; lo que se confirma pasa a «en repaso» con
// repasos repartidos en las próximas 2 semanas (así se verifica sin saturar).
import { sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { emptyCard, serialize, State, Rating } from './fsrs.ts';
import { meaningMatches } from '../../jp.ts';

/** Franjas por posición en el orden de aprendizaje de kanji (no por learn_order, que incluye componentes). */
export const BANDS: [number, number][] = [
	[0, 50],
	[50, 100],
	[100, 200],
	[200, 350],
	[350, 600],
	[600, 1000],
	[1000, 1500],
	[1500, 2100],
	[2100, 2700]
];
export const PER_BAND = 5;

type Ranked = { char: string; rank: number; meanings: string[]; en: string[] };

function ranked(db: DB): Ranked[] {
	return db
		.all<{ char: string; es: string; en: string }>(
			sql`select char, meanings_es as es, meanings_en as en from kanji where learn_order is not null order by learn_order`
		)
		.map((r, i) => ({ char: r.char, rank: i, meanings: JSON.parse(r.es), en: JSON.parse(r.en) }));
}

export function sampleBand(db: DB, band: number) {
	const [lo, hi] = BANDS[band] ?? BANDS[0];
	const pool = ranked(db).filter((k) => k.rank >= lo && k.rank < hi);
	const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, PER_BAND);
	return { band, range: [lo, hi] as [number, number], kanji: picked.map((k) => k.char) };
}

export function checkPlacement(db: DB, char: string, answer: string) {
	const k = ranked(db).find((x) => x.char === char);
	if (!k) return { correct: false, answers: [] };
	const accepted = [...k.meanings, ...k.en];
	return { correct: meaningMatches(answer, accepted), answers: (k.meanings.length ? k.meanings : k.en).slice(0, 3) };
}

/**
 * Marca como conocidos los kanji con posición < `upTo` y los confirmados sueltos, más sus componentes.
 * No toca ítems que ya tienen tarjeta.
 */
export function applyPlacement(db: DB, upTo: number, confirmed: string[], now = Date.now()) {
	const all = ranked(db);
	const chars = new Set([...all.filter((k) => k.rank < upTo).map((k) => k.char), ...confirmed]);
	const comps = new Set(
		chars.size
			? db
					.all<{ s: string }>(
						sql`select distinct kc.symbol as s from kanji_component kc join component c on c.symbol = kc.symbol
						    where c.learn_order is not null and kc.kanji in ${[...chars]}`
					)
					.map((r) => r.s)
			: []
	);
	const existing = new Set(
		db
			.all<{ t: string; k: string; f: string }>(sql`select item_type as t, item_key as k, facet as f from card`)
			.map((r) => `${r.t}|${r.k}|${r.f}`)
	);
	let created = 0;
	const make = (type: 'kanji' | 'component', key: string, facet: 'meaning' | 'reading') => {
		if (existing.has(`${type}|${key}|${facet}`)) return;
		const c = emptyCard(new Date(now));
		const due = now + (1 + Math.floor(Math.random() * 14)) * 86_400_000;
		c.state = State.Review;
		c.stability = 10;
		c.difficulty = 5;
		c.reps = 1;
		c.scheduled_days = Math.round((due - now) / 86_400_000);
		c.last_review = new Date(now);
		c.due = new Date(due);
		const row = db
			.insert(s.card)
			// createdAt en el pasado: no consume el cupo de lecciones de hoy.
			.values({ itemType: type, itemKey: key, facet, state: c.state, due, stability: 10, fsrs: serialize(c), createdAt: now - 2 * 86_400_000 })
			.returning({ id: s.card.id })
			.get();
		db.insert(s.reviewLog)
			.values({ cardId: row.id, itemType: type, itemKey: key, facet, rating: Rating.Good, correct: true, source: 'placement', reviewedAt: now })
			.run();
		created++;
	};
	db.transaction(() => {
		for (const sym of comps) make('component', sym, 'meaning');
		for (const k of chars) {
			make('kanji', k, 'meaning');
			make('kanji', k, 'reading');
		}
	});
	return { kanji: chars.size, components: comps.size, cards: created };
}
