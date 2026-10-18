// Repasos de escritura: opcionales, entran poco a poco, se califican por trazos y no cambian el estado del ítem.
import { expect, test } from 'bun:test';
import { openDb } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { buildReviewItem, ensureCard, ensureWritingCards, gradeAnswer } from '../src/lib/server/srs/service.ts';
import { itemStatuses } from '../src/lib/server/items.ts';
import { updateSettings } from '../src/lib/server/settings.ts';

test('escritura: desactivada no crea nada; activada, N al día de los kanji en repaso; no toca el estado', () => {
	const db = openDb(':memory:').db;
	const chars = ['一', '二', '三', '四', '五', '六', '七'];
	db.insert(s.kanji).values(chars.map((c, i) => ({ char: c, meaningsEs: [`n${i}`], onReadings: ['イチ'], kunReadings: [], learnOrder: i }))).run();
	const now = new Date('2026-10-18T12:00:00');
	for (const c of chars) {
		const card = ensureCard(db, 'kanji', c, 'meaning', now);
		db.update(s.card).set({ state: 2, stability: 30 }).where(sqlId(card.id)).run();
	}
	expect(ensureWritingCards(db, now)).toBe(0);

	updateSettings(db, { writingReviews: true, newWritingPerDay: 3 });
	expect(ensureWritingCards(db, now)).toBe(3);
	expect(ensureWritingCards(db, now)).toBe(0); // cupo de hoy agotado
	const w = db.select().from(s.card).all().filter((c) => c.facet === 'writing').map((c) => c.itemKey);
	expect(w).toEqual(['一', '二', '三']); // en orden de aprendizaje

	// La tarjeta de escritura (nueva, en aprendizaje) no baja el estado de 一 de «dominado».
	expect(itemStatuses(db, 'kanji', ['一']).get('一')).toBe('mastered');

	const item = buildReviewItem(db, { id: 1, itemType: 'kanji', itemKey: '一', facet: 'writing' });
	expect(item.answerMode).toBe('trace');
	expect(item.prompt).toBe('n0');
	expect(item.label).toBe('Kanji · escritura');
	expect(gradeAnswer(db, 'kanji', '一', 'writing', '0').correct).toBe(true);
	expect(gradeAnswer(db, 'kanji', '一', 'writing', '5').correct).toBe(false);
});

import { eq } from 'drizzle-orm';
const sqlId = (id: number) => eq(s.card.id, id);
