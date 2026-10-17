import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs';

export { Rating, State };
export type { Grade };

export type SchedulerConfig = { params: number[] | null; retention: number };

const DEFAULT: SchedulerConfig = { params: null, retention: 0.9 };
const cache = new Map<string, FSRS>();

/** Planificador FSRS para unos parámetros (personalizados o por defecto) y una retención objetivo. Memoizado. */
export function schedulerFor(cfg: SchedulerConfig = DEFAULT, fuzz = true): FSRS {
	const key = `${cfg.retention}|${fuzz}|${cfg.params?.join(',') ?? 'default'}`;
	let s = cache.get(key);
	if (!s) {
		s = fsrs(
			generatorParameters({
				enable_fuzz: fuzz,
				request_retention: cfg.retention,
				...(cfg.params ? { w: cfg.params } : {})
			})
		);
		cache.set(key, s);
	}
	return s;
}

export type StoredCard = Record<string, unknown>;

export function serialize(card: Card): StoredCard {
	return {
		...card,
		due: card.due.toISOString(),
		last_review: card.last_review ? card.last_review.toISOString() : null
	};
}

export function revive(stored: StoredCard): Card {
	return {
		...(stored as unknown as Card),
		due: new Date(stored.due as string),
		last_review: stored.last_review ? new Date(stored.last_review as string) : undefined
	} as Card;
}

export function emptyCard(now: Date): Card {
	return createEmptyCard(now);
}

export function schedule(card: Card, grade: Grade, now: Date, cfg: SchedulerConfig = DEFAULT) {
	return schedulerFor(cfg).next(card, now, grade);
}
