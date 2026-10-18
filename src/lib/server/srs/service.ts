import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Facet, GradeResult, ItemType, ReviewItem } from '../../types.ts';
import { acceptedKanjiReadings, kanjiIn, meaningMatches, normalizeReading, readingMatches } from '../../jp.ts';
import { acceptedRomaji, kanaRomaji, kanaScript, ALL_KANA } from '../../kana.ts';
import { emptyCard, revive, schedule, serialize, Rating, State, type Grade, type SchedulerConfig } from './fsrs.ts';
import { GRAMMAR, GRAMMAR_BY_ID } from '../../grammar.ts';
import { exampleFor, similarTo } from '../items.ts';
import { dayStart, getSettings } from '../settings.ts';
import { writingGrade } from '../../strokes.ts';

/** Fallos acumulados a partir de los cuales una tarjeta se trata como «sanguijuela». */
export const LEECH_LAPSES = 6;

export function schedulerConfig(db: DB): SchedulerConfig {
	const st = getSettings(db);
	return { params: st.fsrsParams, retention: st.desiredRetention };
}

export type CardRow = typeof s.card.$inferSelect;

type Accepted = { accepted: string[]; display: string[] };

function kanjiRow(db: DB, char: string) {
	return db.select().from(s.kanji).where(eq(s.kanji.char, char)).get();
}

export function acceptedAnswers(db: DB, type: ItemType, key: string, facet: Facet): Accepted {
	if (type === 'kana') {
		const r = acceptedRomaji(key);
		return { accepted: r, display: [r[0]] };
	}
	if (type === 'component') {
		const c = db.select().from(s.component).where(eq(s.component.symbol, key)).get();
		const k = kanjiRow(db, key);
		const names = [c?.nameEs, ...(k?.meaningsEs ?? [])].filter((x): x is string => !!x);
		const display = names.length ? [names[0]] : ['?'];
		// "agua (gotas)" acepta también "agua" y "gotas".
		const accepted = names.flatMap((n) => [n, ...n.split(/[()]/).map((p) => p.trim())]).filter(Boolean);
		return { accepted, display };
	}
	if (type === 'kanji') {
		const k = kanjiRow(db, key);
		if (!k) return { accepted: [], display: [] };
		if (facet === 'writing') return { accepted: [key], display: [key] };
		if (facet === 'meaning') {
			const es = k.meaningsEs.length ? k.meaningsEs : k.meaningsEn;
			return { accepted: [...es, ...k.meaningsEn], display: es.slice(0, 4) };
		}
		return {
			accepted: acceptedKanjiReadings(k.onReadings, k.kunReadings),
			display: [...k.onReadings, ...k.kunReadings].slice(0, 6)
		};
	}
	if (type === 'grammar') {
		const g = GRAMMAR_BY_ID.get(key);
		return { accepted: g ? [g.meaning] : [], display: g ? [g.meaning] : [] };
	}
	if (type === 'sentence') {
		const m = db.select().from(s.minedSentence).where(eq(s.minedSentence.id, Number(key))).get();
		if (!m) return { accepted: [], display: [] };
		const v = m.vocabId ? db.select().from(s.vocab).where(eq(s.vocab.id, m.vocabId)).get() : undefined;
		// Lectura de la palabra objetivo tal como aparece (conjugada) y, de apoyo, las de su forma base.
		return { accepted: [m.targetReading, ...(m.target === v?.mainForm ? v.kanaForms : [])], display: [m.targetReading] };
	}
	const v = db.select().from(s.vocab).where(eq(s.vocab.id, key)).get();
	if (!v) return { accepted: [], display: [] };
	if (facet === 'meaning') {
		const es = v.glossesEs?.length ? v.glossesEs : v.glossesEn;
		return { accepted: [...es, ...v.glossesEn], display: es.slice(0, 4) };
	}
	return { accepted: v.kanaForms, display: [v.mainReading] };
}

const LABELS: Record<ItemType, string> = {
	kana: 'Kana',
	component: 'Componente',
	kanji: 'Kanji',
	vocab: 'Vocabulario',
	grammar: 'Gramática',
	sentence: 'Frase'
};

/** 3 distractores de puntos cercanos en el currículo + la correcta, mezclados. */
function grammarOptions(id: string): string[] {
	const idx = GRAMMAR.findIndex((g) => g.id === id);
	if (idx < 0) return [];
	const near = GRAMMAR.filter((_, i) => i !== idx && Math.abs(i - idx) <= 12).map((g) => g.meaning);
	const pool = [...near].sort(() => Math.random() - 0.5).slice(0, 3);
	return [GRAMMAR[idx].meaning, ...pool].sort(() => Math.random() - 0.5);
}

export function buildReviewItem(db: DB, c: { id: number | null; itemType: ItemType; itemKey: string; facet: Facet }): ReviewItem {
	const { display } = acceptedAnswers(db, c.itemType, c.itemKey, c.facet);
	let prompt = c.itemKey;
	let extra: ReviewItem['extra'];
	let options: string[] | undefined;
	let highlight: string | undefined;
	if (c.itemType === 'vocab') {
		const v = db.select().from(s.vocab).where(eq(s.vocab.id, c.itemKey)).get();
		prompt = v?.mainForm ?? c.itemKey;
		extra = {
			reading: v?.mainReading,
			meaning: (v?.glossesEs ?? v?.glossesEn ?? []).slice(0, 3).join('; '),
			example: v ? exampleFor(db, v.id, v.mainForm) : null
		};
	} else if (c.itemType === 'kanji' && c.facet === 'writing') {
		// Escritura: se muestra el significado y la lectura; el alumno traza el kanji.
		const k = kanjiRow(db, c.itemKey);
		const meanings = (k?.meaningsEs.length ? k.meaningsEs : (k?.meaningsEn ?? [])).slice(0, 3).join('; ');
		const readings = [...(k?.kunReadings ?? []), ...(k?.onReadings ?? [])].slice(0, 3).join('、');
		prompt = meanings || c.itemKey;
		extra = { meaning: meanings, reading: readings, mnemonic: k?.mnemonicMeaning };
	} else if (c.itemType === 'kanji') {
		const k = kanjiRow(db, c.itemKey);
		extra = {
			reading: [...(k?.onReadings ?? []), ...(k?.kunReadings ?? [])].slice(0, 4).join('、'),
			meaning: (k?.meaningsEs.length ? k.meaningsEs : (k?.meaningsEn ?? [])).slice(0, 3).join('; '),
			mnemonic: c.facet === 'meaning' ? k?.mnemonicMeaning : k?.mnemonicReading,
			similar: similarTo(db, c.itemKey, { onlySeen: true, limit: 3 }).map((x) => ({ char: x.char, tip: x.tip }))
		};
	} else if (c.itemType === 'grammar') {
		const g = GRAMMAR_BY_ID.get(c.itemKey);
		const ex = g?.examples[Math.floor(Math.random() * (g?.examples.length ?? 1))];
		prompt = ex?.jp ?? g?.pattern ?? c.itemKey;
		highlight = g?.pattern;
		options = grammarOptions(c.itemKey);
		extra = { explanation: g ? `${g.pattern}: ${g.explanation}` : undefined, meaning: ex?.es };
	} else if (c.itemType === 'sentence') {
		const m = db.select().from(s.minedSentence).where(eq(s.minedSentence.id, Number(c.itemKey))).get();
		prompt = m?.jp ?? '';
		highlight = m?.target;
		extra = { meaning: m?.es ?? undefined, reading: m?.targetReading };
	}
	const answerMode =
		c.facet === 'writing'
			? 'trace'
			: c.itemType === 'kana'
				? 'romaji'
				: c.itemType === 'grammar'
					? 'choice'
					: c.facet === 'reading'
						? 'kana'
						: 'meaning';
	const facetLabel =
		c.facet === 'writing'
			? 'escritura'
			: c.itemType === 'kana'
			? 'romaji'
			: c.itemType === 'grammar'
				? '¿qué expresa?'
				: c.itemType === 'sentence'
					? 'lectura de la palabra marcada'
					: c.facet === 'meaning'
						? 'significado'
						: 'lectura';
	return {
		cardId: c.id,
		itemType: c.itemType,
		itemKey: c.itemKey,
		facet: c.facet,
		prompt,
		answerMode,
		label: `${LABELS[c.itemType]} · ${facetLabel}`,
		answers: display,
		options,
		highlight,
		extra
	};
}

/** Corrige una respuesta y detecta confusiones con otros ítems. */
export function gradeAnswer(db: DB, type: ItemType, key: string, facet: Facet, answer: string): GradeResult {
	const { accepted, display } = acceptedAnswers(db, type, key, facet);
	if (type === 'grammar') return { correct: accepted.includes(answer.trim()), answers: display };
	// Escritura: el cliente compara los trazos (strokes.ts) y manda cuántos falló.
	if (facet === 'writing') return { correct: writingGrade(Number(answer) || 0).correct, answers: display };
	if (type === 'kana') {
		const a = answer.trim().toLowerCase();
		const correct = accepted.includes(a);
		let confusedWith: string | null = null;
		if (!correct && a) {
			const script = kanaScript(key);
			confusedWith = ALL_KANA.find((k) => kanaScript(k) === script && acceptedRomaji(k).includes(a)) ?? null;
		}
		return { correct, answers: display, confusedWith };
	}
	let correct = facet === 'meaning' ? meaningMatches(answer, accepted) : readingMatches(answer, accepted);
	// Respuesta por voz: el reconocimiento puede devolver la palabra en kanji. Si es exactamente la palabra, se pronunció bien.
	if (!correct && facet === 'reading' && type === 'vocab' && kanjiIn(answer).length) {
		const v = db.select().from(s.vocab).where(eq(s.vocab.id, key)).get();
		const said = answer.trim().replace(/[。、！？!?\s]/g, '');
		correct = !!v && (said === v.mainForm || v.kanjiForms.includes(said));
	}
	if (correct) return { correct, answers: display };

	let confusedWith: string | null = null;
	let nearMiss = false;
	if (type === 'kanji' && facet === 'meaning' && answer.trim()) {
		// ¿Respondió el significado de otro kanji ya estudiado?
		const seen = db
			.select({ c: s.kanji.char, es: s.kanji.meaningsEs, en: s.kanji.meaningsEn })
			.from(s.kanji)
			.innerJoin(s.card, and(eq(s.card.itemType, 'kanji'), eq(s.card.itemKey, s.kanji.char), eq(s.card.facet, 'meaning')))
			.all();
		confusedWith = seen.find((k) => k.c !== key && meaningMatches(answer, [...k.es, ...k.en]))?.c ?? null;
	}
	if (type === 'vocab' && facet === 'reading') {
		// Lectura de un kanji suelto en vez de la de la palabra: aviso, no fallo.
		const v = db.select().from(s.vocab).where(eq(s.vocab.id, key)).get();
		const ks = v ? kanjiIn(v.mainForm) : [];
		if (ks.length === 1) {
			const k = kanjiRow(db, ks[0]);
			if (k && readingMatches(answer, acceptedKanjiReadings(k.onReadings, k.kunReadings))) nearMiss = true;
		}
	}
	return { correct, answers: display, confusedWith, nearMiss };
}

export function recordConfusion(db: DB, kind: ItemType, a: string, b: string, now = Date.now()) {
	const [x, y] = a < b ? [a, b] : [b, a];
	db.insert(s.confusion)
		.values({ kind, a: x, b: y, count: 1, lastAt: now })
		.onConflictDoUpdate({
			target: [s.confusion.kind, s.confusion.a, s.confusion.b],
			set: { count: sql`${s.confusion.count} + 1`, lastAt: now }
		})
		.run();
}

export function ensureCard(db: DB, type: ItemType, key: string, facet: Facet, now = new Date()): CardRow {
	const existing = db
		.select()
		.from(s.card)
		.where(and(eq(s.card.itemType, type), eq(s.card.itemKey, key), eq(s.card.facet, facet)))
		.get();
	if (existing) return existing;
	const c = emptyCard(now);
	return db
		.insert(s.card)
		.values({
			itemType: type,
			itemKey: key,
			facet,
			state: c.state,
			due: c.due.getTime(),
			stability: c.stability,
			fsrs: serialize(c),
			createdAt: now.getTime()
		})
		.returning()
		.get();
}

export function facetsFor(type: ItemType): Facet[] {
	if (type === 'kana' || type === 'sentence') return ['reading'];
	if (type === 'component' || type === 'grammar') return ['meaning'];
	return ['meaning', 'reading'];
}

export type ReviewInput = {
	correct: boolean;
	grade?: Grade;
	answer?: string;
	durationMs?: number;
	source: 'review' | 'lesson' | 'quiz' | 'diagnostic';
};

export function applyReview(db: DB, cardId: number, input: ReviewInput, now = new Date()) {
	const row = db.select().from(s.card).where(eq(s.card.id, cardId)).get();
	if (!row) throw new Error(`Tarjeta ${cardId} no existe`);
	const grade: Grade = input.correct ? (input.grade && input.grade !== Rating.Again ? input.grade : Rating.Good) : Rating.Again;
	const { card } = schedule(revive(row.fsrs), grade, now, schedulerConfig(db));
	const leech = !input.correct && card.lapses >= LEECH_LAPSES;
	db.transaction((tx) => {
		tx.update(s.card)
			.set({ state: card.state, due: card.due.getTime(), stability: card.stability, fsrs: serialize(card) })
			.where(eq(s.card.id, cardId))
			.run();
		tx.insert(s.reviewLog)
			.values({
				cardId,
				itemType: row.itemType,
				itemKey: row.itemKey,
				facet: row.facet,
				rating: grade,
				correct: input.correct,
				answer: input.answer ?? null,
				durationMs: input.durationMs ?? null,
				source: input.source,
				reviewedAt: now.getTime()
			})
			.run();
	});
	return { due: card.due.getTime(), state: card.state, stability: card.stability, leech };
}

/**
 * Repasos de escritura (si están activados): cada día entran hasta `newWritingPerDay` kanji nuevos, en orden de
 * aprendizaje, de los que ya reconoces (significado en repaso). Así la carga crece poco a poco.
 */
export function ensureWritingCards(db: DB, now = new Date()) {
	const st = getSettings(db);
	if (!st.writingReviews) return 0;
	const start = dayStart(now, st.dayStartHour);
	const today =
		db.get<[number]>(sql`select count(*) from card where facet = 'writing' and created_at >= ${start}`)?.[0] ?? 0;
	const left = st.newWritingPerDay - today;
	if (left <= 0) return 0;
	const next = db.all<{ k: string }>(sql`
		select c.item_key as k from card c join kanji k on k.char = c.item_key
		where c.item_type = 'kanji' and c.facet = 'meaning' and c.state = ${State.Review}
			and not exists (select 1 from card w where w.item_type = 'kanji' and w.item_key = c.item_key and w.facet = 'writing')
		order by coalesce(k.learn_order, 99999), c.created_at
		limit ${left}`);
	for (const { k } of next) ensureCard(db, 'kanji', k, 'writing', now);
	return next.length;
}

/** Tarjetas «sanguijuela»: muchos fallos acumulados. Repetirlas igual no funciona; hay que cambiar de estrategia. */
export function leeches(db: DB, limit = 30) {
	return db
		.all<{ id: number; type: ItemType; key: string; facet: Facet; lapses: number; due: number }>(
			sql`select id, item_type as type, item_key as key, facet, json_extract(fsrs, '$.lapses') as lapses, due
			    from card where json_extract(fsrs, '$.lapses') >= ${LEECH_LAPSES} and suspended = 0
			    order by lapses desc limit ${limit}`
		)
		.map((c) => ({ ...c, display: c.type === 'vocab' ? (db.select({ f: s.vocab.mainForm }).from(s.vocab).where(eq(s.vocab.id, c.key)).get()?.f ?? c.key) : c.type === 'grammar' ? (GRAMMAR_BY_ID.get(c.key)?.pattern ?? c.key) : c.key }));
}

/** Aparta una tarjeta unos días (sin perder su historial). */
export function pauseCard(db: DB, cardId: number, days: number, now = Date.now()) {
	const row = db.select().from(s.card).where(eq(s.card.id, cardId)).get();
	if (!row) throw new Error('Tarjeta no encontrada');
	const due = now + days * 86_400_000;
	const c = revive(row.fsrs);
	c.due = new Date(due);
	db.update(s.card).set({ due, fsrs: serialize(c) }).where(eq(s.card.id, cardId)).run();
	return due;
}

export function cardFor(db: DB, type: ItemType, key: string, facet: Facet) {
	return db
		.select()
		.from(s.card)
		.where(and(eq(s.card.itemType, type), eq(s.card.itemKey, key), eq(s.card.facet, facet)))
		.get();
}

/** Registra una respuesta sin tarjeta (quiz del tutor sobre un ítem no estudiado). */
export function logAnswer(db: DB, type: ItemType, key: string, correct: boolean, answer: string | null, source: 'quiz', now = Date.now()) {
	db.insert(s.reviewLog)
		.values({ itemType: type, itemKey: key, correct, answer, source, reviewedAt: now })
		.run();
}

export function dueCards(db: DB, now = Date.now(), limit = 200): CardRow[] {
	return db
		.select()
		.from(s.card)
		.where(and(lte(s.card.due, now), eq(s.card.suspended, false)))
		.orderBy(asc(s.card.due))
		.limit(limit)
		.all();
}

export function dueCount(db: DB, until = Date.now()): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(s.card)
			.where(and(lte(s.card.due, until), eq(s.card.suspended, false)))
			.get()?.n ?? 0
	);
}

/** Vencimientos (ms, ordenados) de las tarjetas activas que vencen hasta `until` (para el recordatorio del service worker). */
export function upcomingDue(db: DB, until: number, limit = 3000): number[] {
	return db
		.select({ due: s.card.due })
		.from(s.card)
		.where(and(lte(s.card.due, until), eq(s.card.suspended, false)))
		.orderBy(asc(s.card.due))
		.limit(limit)
		.all()
		.map((r) => r.due);
}

/** Mezcla tarjetas evitando que dos facetas del mismo ítem queden seguidas. */
export function interleave<T extends { itemType: string; itemKey: string }>(cards: T[]): T[] {
	const id = (c: T) => `${c.itemType}:${c.itemKey}`;
	const pool = [...cards];
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	const remaining = new Map<string, number>();
	for (const c of pool) remaining.set(id(c), (remaining.get(id(c)) ?? 0) + 1);
	const out: T[] = [];
	while (pool.length) {
		const prev = out.length ? id(out[out.length - 1]) : null;
		// Entre los que no repiten el anterior, el ítem con más tarjetas pendientes (evita atascarse al final).
		let best = -1;
		for (let i = 0; i < pool.length; i++) {
			if (id(pool[i]) === prev) continue;
			if (best < 0 || remaining.get(id(pool[i]))! > remaining.get(id(pool[best]))!) best = i;
		}
		if (best < 0) best = 0;
		const [c] = pool.splice(best, 1);
		remaining.set(id(c), remaining.get(id(c))! - 1);
		out.push(c);
	}
	return out;
}

/** Previsión de repasos por día (próximos `days` días, desde el inicio del día actual). */
export function forecast(db: DB, start: number, days: number): number[] {
	const end = start + days * 86_400_000;
	const rows = db
		.select({ due: s.card.due })
		.from(s.card)
		.where(and(lte(s.card.due, end), eq(s.card.suspended, false)))
		.all();
	const out = Array(days).fill(0);
	for (const r of rows) {
		const idx = Math.max(0, Math.floor((r.due - start) / 86_400_000));
		if (idx < days) out[idx]++;
	}
	return out;
}

export function cardsByKeys(db: DB, type: ItemType, keys: string[]) {
	if (!keys.length) return [];
	return db.select().from(s.card).where(and(eq(s.card.itemType, type), inArray(s.card.itemKey, keys))).all();
}

export { State, Rating, normalizeReading, kanaRomaji };
