// Sesión diaria: ritmo real, tope de repasos según el tiempo, orden de los bloques y resumen del día.
import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { dailyPlan, daySummary, pace, summaryText } from '../src/lib/server/daily.ts';

const now = new Date('2026-10-18T12:00:00');

function setup(due: number) {
	const db = openDb(':memory:').db;
	db.insert(s.kanji).values({ char: '山', meaningsEs: ['montaña'], onReadings: ['サン'], kunReadings: ['やま'], learnOrder: 0 }).run();
	if (due)
		db.insert(s.card)
			.values(
				Array.from({ length: due }, (_, i) => ({
					itemType: 'kana' as const,
					itemKey: `k${i}`,
					facet: 'reading' as const,
					state: 2,
					due: now.getTime() - 60_000,
					stability: 3,
					fsrs: {},
					createdAt: now.getTime() - 5 * 86_400_000
				}))
			)
			.run();
	return db;
}

test('sin historial: ritmo por defecto; con historial: la mediana real', () => {
	const db = setup(0);
	expect(pace(db, now.getTime()).fromHistory).toBe(false);
	db.insert(s.reviewLog)
		.values(
			[3000, 5000, 7000, 9000, 200000].map((d, i) => ({
				itemType: 'kana' as const,
				itemKey: 'a',
				correct: true,
				durationMs: d,
				source: 'review' as const,
				reviewedAt: now.getTime() - i * 60_000
			}))
		)
		.run();
	const p = pace(db, now.getTime());
	expect(p.fromHistory).toBe(true);
	expect(p.secsPerReview).toBe(7 + 3); // mediana 7 s (200 s se descarta) + 3 s de corrección
});

test('el tope de repasos depende del tiempo elegido y los bloques van en orden', () => {
	const db = setup(300);
	const short = dailyPlan(db, 10, now);
	const long = dailyPlan(db, 40, now);
	const n = (p: typeof short) => Number(p.steps[0].href.match(/limite=(\d+)/)![1]);
	expect(short.steps[0].id).toBe('review');
	expect(n(short)).toBeLessThan(n(long));
	expect(n(long)).toBeLessThan(300); // nunca 300 de golpe en una sesión
	expect(short.steps.at(-1)!.id).toBe('close');
	const ids = long.steps.map((x) => x.id);
	expect(ids.indexOf('review')).toBeLessThan(ids.indexOf('close'));
	// Sin API key en los tests: cierre local.
	expect(long.steps.at(-1)!.href).toBe('/hoy?resumen=1');
	expect(long.minutes).toBeLessThanOrEqual(40 + 2);
});

test('pocos pendientes: todos entran; sin kanji por aprender, la lección es de gramática', () => {
	const db = setup(5);
	expect(dailyPlan(db, 20, now).steps[0].href).toContain('limite=5');
	const empty = openDb(':memory:').db;
	const plan = dailyPlan(empty, 20, now);
	expect(plan.steps.map((x) => x.id)).toEqual(['lesson', 'close']);
	expect(plan.steps[0].detail).toBe('Un punto de gramática.');
});

test('resumen del día', () => {
	const db = setup(0);
	db.insert(s.reviewLog)
		.values([
			{ itemType: 'kana', itemKey: 'a', correct: true, durationMs: 4000, source: 'review', reviewedAt: now.getTime() - 1000 },
			{ itemType: 'kana', itemKey: 'b', correct: false, durationMs: 6000, source: 'review', reviewedAt: now.getTime() - 2000 }
		])
		.run();
	const sm = daySummary(db, now);
	expect(sm.reviews).toBe(2);
	expect(sm.accuracy).toBe(50);
	expect(summaryText(sm)).toContain('2 (50 % correctas)');
});
