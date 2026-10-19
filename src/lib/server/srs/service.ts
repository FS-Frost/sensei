import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { AnswerVia, Facet, GradeResult, ItemType, ReviewItem } from '../../types.ts';
import { acceptedKanjiReadings, kanjiIn, meaningMatches, normalizeMeaning, normalizeReading, readingMatches } from '../../jp.ts';
import { acceptedRomaji, kanaRomaji, kanaScript, ALL_KANA, wordRomaji } from '../../kana.ts';
import { COURSE_KANA, isSpecialKana, kanaEntry, kanaSimilar, SPECIAL_WORDS } from '../../kanaCourse.ts';
import { grammarOptions, kanaOptions, optionsFor } from './options.ts';
import { emptyCard, revive, schedule, serialize, Rating, State, type Grade, type SchedulerConfig } from './fsrs.ts';
import { GRAMMAR_BY_ID } from '../../grammar.ts';
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
		// Inversa y escritura: la respuesta es el propio kana.
		if (facet === 'meaning' || facet === 'writing') return { accepted: [key], display: [key] };
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

export function buildReviewItem(db: DB, c: { id: number | null; itemType: ItemType; itemKey: string; facet: Facet }): ReviewItem {
	const { accepted, display: shown } = acceptedAnswers(db, c.itemType, c.itemKey, c.facet);
	let display = shown;
	let prompt = c.itemKey;
	let extra: ReviewItem['extra'];
	let options: string[] | undefined;
	let highlight: string | undefined;
	if (c.itemType === 'kana') {
		const e = kanaEntry(c.itemKey);
		const similar = kanaSimilar(c.itemKey);
		extra = {
			mnemonic: e.mnemonic,
			similar: similar.length ? similar.map((x) => ({ char: x.char, tip: x.tip })) : undefined
		};
		if (c.facet === 'reading' && isSpecialKana(c.itemKey)) {
			// っ/ー: se lee una palabra entera; la respuesta mostrada es la de esa palabra.
			const words = SPECIAL_WORDS[c.itemKey];
			const w = words[Math.floor(Math.random() * words.length)];
			prompt = w.word;
			display = [wordRomaji(w.word)[0]];
			extra.meaning = w.es;
		} else if (c.facet === 'meaning') {
			// Inversa: se ve (y se oye) el sonido; se elige el kana entre parecidos.
			prompt = e.romaji;
			options = kanaOptions(c.itemKey);
		} else if (c.facet === 'writing') {
			prompt = e.romaji;
			extra.reading = e.romaji;
		}
		if (e.example && c.facet !== 'reading') extra.meaning = `${e.example.word}: ${e.example.es}`;
	} else if (c.itemType === 'vocab') {
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
				? c.facet === 'meaning'
					? 'choice'
					: 'romaji'
				: c.itemType === 'grammar'
					? 'choice'
					: c.facet === 'reading'
						? 'kana'
						: 'meaning';
	// Opciones también donde se escribe: el cliente decide si las muestra (ajuste `answerStyle` o el botón de la sesión).
	if (!options && answerMode !== 'trace') options = optionsFor(db, c.itemType, c.itemKey, c.facet, display, accepted);
	const facetLabel =
		c.facet === 'writing'
			? 'escritura'
			: c.itemType === 'kana'
			? c.facet === 'meaning'
				? '¿cuál es?'
				: isSpecialKana(c.itemKey)
					? 'lee la palabra en romaji'
					: 'romaji'
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
	if (type === 'kana' && facet === 'meaning') {
		const a = answer.trim();
		return { correct: a === key, answers: display, confusedWith: a && a !== key ? a : null };
	}
	if (type === 'kana') {
		const a = answer.trim().toLowerCase().replace(/[\s'-]/g, '');
		const correct = accepted.includes(a);
		let confusedWith: string | null = null;
		if (!correct && a) {
			const script = kanaScript(key);
			confusedWith = ALL_KANA.find((k) => kanaScript(k) === script && acceptedRomaji(k).includes(a)) ?? null;
		}
		return { correct, answers: display, confusedWith };
	}
	let correct = facet === 'meaning' ? meaningMatches(answer, accepted) : readingMatches(answer, accepted);
	// Respuesta por voz: el reconocimiento puede devolver la palabra en kanji. Si es exactamente lo que se pregunta, se
	// pronunció bien (en un kanji suelto, cualquiera de sus lecturas cuenta igual que escribiéndola).
	if (!correct && facet === 'reading' && kanjiIn(answer).length) {
		const said = answer.trim().replace(/[。、！？!?\s]/g, '');
		if (type === 'vocab') {
			const v = db.select().from(s.vocab).where(eq(s.vocab.id, key)).get();
			correct = !!v && (said === v.mainForm || v.kanjiForms.includes(said));
		} else if (type === 'kanji') correct = said === key;
		else if (type === 'sentence') {
			const m = db.select({ t: s.minedSentence.target }).from(s.minedSentence).where(eq(s.minedSentence.id, Number(key))).get();
			correct = !!m && said === m.t;
		}
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

/** «No sé» dicho en voz alta: en español (significados) o en japonés (lecturas, el reconocedor está en ja-JP). */
const GIVE_UP = new Set(['no se', 'no lo se', 'ni idea', 'paso', 'わからない', 'わかりません', '分からない', '分かりません', '判らない', 'しらない', '知らない', '知りません', 'パス']);

export function isGiveUp(said: string): boolean {
	const x = said.trim().replace(/[。、！？!?¡¿.,\s]/g, '');
	return GIVE_UP.has(x) || GIVE_UP.has(normalizeMeaning(said));
}

/**
 * Corrige una respuesta por voz: el reconocedor da varias alternativas y basta con que una sea correcta (la que se
 * escuchó primero puede ser un homófono en kanji). «No sé» cuenta como fallo sin respuesta.
 */
export function gradeSpoken(db: DB, type: ItemType, key: string, facet: Facet, alternatives: string[]): GradeResult {
	const alts = alternatives.map((a) => a.trim()).filter(Boolean);
	if (alts.some(isGiveUp)) return { ...gradeAnswer(db, type, key, facet, ''), heard: '', gaveUp: true };
	for (const a of alts) {
		const r = gradeAnswer(db, type, key, facet, a);
		if (r.correct) return { ...r, heard: a };
	}
	const heard = alts[0] ?? '';
	return { ...gradeAnswer(db, type, key, facet, heard), heard };
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

export function facetsFor(type: ItemType, key?: string): Facet[] {
	// Kana: lectura e inversa (っ y ー, solo lectura). Sin clave, la faceta base.
	if (type === 'kana') return key && !isSpecialKana(key) ? ['reading', 'meaning'] : ['reading'];
	if (type === 'sentence') return ['reading'];
	if (type === 'component' || type === 'grammar') return ['meaning'];
	return ['meaning', 'reading'];
}

export type ReviewInput = {
	correct: boolean;
	grade?: Grade;
	answer?: string;
	durationMs?: number;
	source: 'review' | 'lesson' | 'quiz' | 'diagnostic';
	via?: AnswerVia;
};

export function applyReview(db: DB, cardId: number, input: ReviewInput, now = new Date()) {
	const row = db.select().from(s.card).where(eq(s.card.id, cardId)).get();
	if (!row) throw new Error(`Tarjeta ${cardId} no existe`);
	let grade: Grade = input.correct ? (input.grade && input.grade !== Rating.Again ? input.grade : Rating.Good) : Rating.Again;
	// Elegir entre opciones es reconocer, no recordar: un acierto así no basta para «Fácil».
	if (input.via === 'choice' && grade === Rating.Easy) grade = Rating.Good;
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
				via: input.via ?? null,
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
	// Primero los kana (un solo carácter, en orden del curso) que ya lees con soltura; luego los kanji.
	const kanaRows = db.all<{ k: string }>(sql`
		select c.item_key as k from card c
		where c.item_type = 'kana' and c.facet = 'reading' and c.state = ${State.Review}
			and not exists (select 1 from card w where w.item_type = 'kana' and w.item_key = c.item_key and w.facet = 'writing')`);
	const order = new Map(COURSE_KANA.map((k, i) => [k, i]));
	const kana = kanaRows
		.map((r) => r.k)
		.filter((k) => [...k].length === 1 && !isSpecialKana(k) && order.has(k))
		.sort((a, b) => order.get(a)! - order.get(b)!)
		.slice(0, left);
	for (const k of kana) ensureCard(db, 'kana', k, 'writing', now);
	const rest = left - kana.length;
	if (rest <= 0) return kana.length;
	const next = db.all<{ k: string }>(sql`
		select c.item_key as k from card c join kanji k on k.char = c.item_key
		where c.item_type = 'kanji' and c.facet = 'meaning' and c.state = ${State.Review}
			and not exists (select 1 from card w where w.item_type = 'kanji' and w.item_key = c.item_key and w.facet = 'writing')
		order by coalesce(k.learn_order, 99999), c.created_at
		limit ${rest}`);
	for (const { k } of next) ensureCard(db, 'kanji', k, 'writing', now);
	return kana.length + next.length;
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

export { State, Rating, normalizeReading, kanaRomaji, kanaOptions };
