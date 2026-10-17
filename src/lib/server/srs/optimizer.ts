// Calibración de FSRS con TU historial: parámetros personalizados (fsrs-rs vía binding nativo).
import { asc, eq, isNotNull } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { emptyCard, revive, schedulerFor, serialize, Rating, type Grade, type SchedulerConfig } from './fsrs.ts';
import { getSettings, updateSettings } from '../settings.ts';

/** Mínimo de repasos para que la calibración tenga sentido (por debajo, los parámetros por defecto son mejores). */
export const MIN_REVIEWS = 400;
const DAY = 86_400_000;

type Log = { cardId: number; rating: number; at: number };

/**
 * Historial por tarjeta. Se excluyen las tarjetas creadas por el test de nivel: su estado inicial no viene de
 * repasos reales, así que reproducirlas desde cero las haría retroceder.
 */
function historyByCard(db: DB): Map<number, Log[]> {
	const rows = db
		.select({ cardId: s.reviewLog.cardId, rating: s.reviewLog.rating, at: s.reviewLog.reviewedAt, source: s.reviewLog.source })
		.from(s.reviewLog)
		.where(isNotNull(s.reviewLog.cardId))
		.orderBy(asc(s.reviewLog.reviewedAt))
		.all();
	const placed = new Set(rows.filter((r) => r.source === 'placement').map((r) => r.cardId));
	const out = new Map<number, Log[]>();
	for (const r of rows) {
		if (!r.cardId || !r.rating || placed.has(r.cardId)) continue;
		const list = out.get(r.cardId) ?? [];
		list.push({ cardId: r.cardId, rating: r.rating, at: r.at });
		out.set(r.cardId, list);
	}
	return out;
}

export function reviewCount(db: DB) {
	let n = 0;
	for (const l of historyByCard(db).values()) n += l.length;
	return n;
}

/** Repasos previstos en los próximos `days` días si respondes todo «Bien» (comparación justa entre parámetros). */
function workload(cards: { fsrs: Record<string, unknown> }[], cfg: SchedulerConfig, days = 30, now = Date.now()) {
	const sched = schedulerFor(cfg, false);
	const end = now + days * DAY;
	let total = 0;
	for (const c of cards) {
		let card = revive(c.fsrs);
		let guard = 0;
		while (card.due.getTime() <= end && guard++ < 60) {
			total++;
			const at = new Date(Math.max(card.due.getTime(), now));
			card = sched.next(card, at, Rating.Good).card;
		}
	}
	return total;
}

/** Reconstruye una tarjeta reproduciendo su historial con otros parámetros. */
function replay(logs: Log[], cfg: SchedulerConfig) {
	const sched = schedulerFor(cfg, false);
	let card = emptyCard(new Date(logs[0].at));
	for (const l of logs) card = sched.next(card, new Date(l.at), l.rating as Grade).card;
	return card;
}

export type Calibration = {
	reviews: number;
	params: number[];
	retention: number;
	workloadBefore: number;
	workloadAfter: number;
};

export async function calibrate(db: DB): Promise<Calibration> {
	const { FSRSBindingItem, FSRSBindingReview, computeParameters } = await import('@open-spaced-repetition/binding');
	const hist = historyByCard(db);
	const reviews = [...hist.values()].reduce((a, l) => a + l.length, 0);
	if (reviews < MIN_REVIEWS) throw new Error(`Hacen falta al menos ${MIN_REVIEWS} repasos (tienes ${reviews}).`);

	// Un ítem por prefijo de historial con al menos un intervalo > 0 días (formato de fsrs-rs).
	const items: InstanceType<typeof FSRSBindingItem>[] = [];
	for (const logs of hist.values()) {
		const revs = logs.map(
			(l, i) => new FSRSBindingReview(l.rating, i === 0 ? 0 : Math.max(0, Math.floor((l.at - logs[i - 1].at) / DAY)))
		);
		for (let k = 2; k <= revs.length; k++) {
			const slice = revs.slice(0, k);
			if (slice.slice(1).some((r) => r.deltaT > 0)) items.push(new FSRSBindingItem(slice));
		}
	}
	if (items.length < 50) throw new Error('Aún no hay suficientes repasos espaciados (de días distintos) para calibrar.');
	const params = [...(await computeParameters(items, { enableShortTerm: true }))].map((x) => Math.round(x * 10000) / 10000);

	const st = getSettings(db);
	const cards = db.select({ id: s.card.id, fsrs: s.card.fsrs }).from(s.card).all();
	const before = workload(cards, { params: st.fsrsParams, retention: st.desiredRetention });
	const replayed = cards.map((c) => {
		const logs = hist.get(c.id);
		return { fsrs: logs?.length ? serialize(replay(logs, { params, retention: st.desiredRetention })) : c.fsrs };
	});
	const after = workload(replayed, { params, retention: st.desiredRetention });
	return { reviews, params, retention: st.desiredRetention, workloadBefore: before, workloadAfter: after };
}

/** Guarda los parámetros y reprograma todas las tarjetas con su historial. */
export function applyCalibration(db: DB, params: number[] | null) {
	const st = updateSettings(db, { fsrsParams: params, fsrsCalibratedAt: params ? Date.now() : null });
	const cfg: SchedulerConfig = { params: st.fsrsParams, retention: st.desiredRetention };
	const hist = historyByCard(db);
	let updated = 0;
	db.transaction((tx) => {
		for (const [cardId, logs] of hist) {
			const card = replay(logs, cfg);
			tx.update(s.card)
				.set({ fsrs: serialize(card), due: card.due.getTime(), state: card.state, stability: card.stability })
				.where(eq(s.card.id, cardId))
				.run();
			updated++;
		}
	});
	return { updated };
}
