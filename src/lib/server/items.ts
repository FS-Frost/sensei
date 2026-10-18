import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { DB } from './db/index.ts';
import * as s from './db/schema.ts';
import type { ComponentInfo, ItemStatus, ItemType, KanjiInfo, SimilarInfo, VocabInfo } from '../types.ts';
import { State } from './srs/fsrs.ts';
import { deinflect, posMatches, T } from '../deinflect.ts';

const MASTERED_DAYS = 21;

/** Estado agregado de un ítem a partir de sus tarjetas (el peor de sus facetas). */
export function statusOf(cards: { state: number; stability: number }[]): ItemStatus {
	if (!cards.length) return 'none';
	if (cards.some((c) => c.state !== State.Review)) return 'learning';
	if (cards.every((c) => c.stability >= MASTERED_DAYS)) return 'mastered';
	return 'review';
}

export function itemStatuses(db: DB, type: ItemType, keys: string[]): Map<string, ItemStatus> {
	const out = new Map<string, ItemStatus>();
	if (!keys.length) return out;
	const rows = db
		.select({ key: s.card.itemKey, state: s.card.state, stability: s.card.stability })
		.from(s.card)
		// La escritura es opcional: no empeora el estado del ítem (aprendiendo/repaso/dominado).
		.where(and(eq(s.card.itemType, type), inArray(s.card.itemKey, keys), ne(s.card.facet, 'writing')))
		.all();
	const grouped = new Map<string, { state: number; stability: number }[]>();
	for (const r of rows) grouped.set(r.key, [...(grouped.get(r.key) ?? []), r]);
	for (const k of keys) out.set(k, statusOf(grouped.get(k) ?? []));
	return out;
}

export function toVocabInfo(v: typeof s.vocab.$inferSelect): VocabInfo {
	return {
		id: v.id,
		mainForm: v.mainForm,
		mainReading: v.mainReading,
		kanjiForms: v.kanjiForms,
		kanaForms: v.kanaForms,
		common: v.common,
		pos: v.pos,
		glossesEs: v.glossesEs,
		glossesEn: v.glossesEn
	};
}

export function getKanjiInfo(db: DB, char: string, opts: { vocabLimit?: number } = {}): KanjiInfo | null {
	const k = db.select().from(s.kanji).where(eq(s.kanji.char, char)).get();
	if (!k) return null;
	const comps = db
		.select({ symbol: s.kanjiComponent.symbol, nameEs: s.component.nameEs })
		.from(s.kanjiComponent)
		.leftJoin(s.component, eq(s.component.symbol, s.kanjiComponent.symbol))
		.where(eq(s.kanjiComponent.kanji, char))
		.orderBy(s.kanjiComponent.position)
		.all();
	const compKanji = new Set(
		comps.length
			? db
					.select({ c: s.kanji.char })
					.from(s.kanji)
					.where(
						inArray(
							s.kanji.char,
							comps.map((c) => c.symbol)
						)
					)
					.all()
					.map((r) => r.c)
			: []
	);
	const kanjiMeaning = new Map(
		compKanji.size
			? db
					.select({ c: s.kanji.char, m: s.kanji.meaningsEs })
					.from(s.kanji)
					.where(inArray(s.kanji.char, [...compKanji]))
					.all()
					.map((r) => [r.c, r.m[0] ?? null])
			: []
	);
	const usedIn = db
		.select({ c: s.kanjiComponent.kanji })
		.from(s.kanjiComponent)
		.innerJoin(s.kanji, eq(s.kanji.char, s.kanjiComponent.kanji))
		.where(eq(s.kanjiComponent.symbol, char))
		.orderBy(s.kanji.learnOrder)
		.limit(24)
		.all()
		.map((r) => r.c);
	const vocabRows = db
		.select()
		.from(s.vocab)
		.innerJoin(s.vocabKanji, eq(s.vocabKanji.vocabId, s.vocab.id))
		.where(and(eq(s.vocabKanji.kanji, char), eq(s.vocab.common, true)))
		.orderBy(sql`length(${s.vocab.mainForm})`, s.vocab.id)
		.limit(opts.vocabLimit ?? 8)
		.all()
		.map((r) => toVocabInfo(r.vocab));
	const vStatus = itemStatuses(db, 'vocab', vocabRows.map((v) => v.id));
	return {
		...k,
		components: comps.map((c) => ({
			symbol: c.symbol,
			nameEs: c.nameEs ?? kanjiMeaning.get(c.symbol) ?? null,
			isKanji: compKanji.has(c.symbol)
		})),
		usedIn,
		vocab: vocabRows.map((v) => ({ ...v, status: vStatus.get(v.id) })),
		status: itemStatuses(db, 'kanji', [char]).get(char) ?? 'none'
	};
}

export function getComponentInfo(db: DB, symbol: string): ComponentInfo | null {
	const c = db.select().from(s.component).where(eq(s.component.symbol, symbol)).get();
	if (!c) return null;
	const usedIn = db
		.select({ c: s.kanjiComponent.kanji })
		.from(s.kanjiComponent)
		.innerJoin(s.kanji, eq(s.kanji.char, s.kanjiComponent.kanji))
		.where(eq(s.kanjiComponent.symbol, symbol))
		.orderBy(s.kanji.learnOrder)
		.limit(24)
		.all()
		.map((r) => r.c);
	return { symbol: c.symbol, nameEs: c.nameEs, strokes: c.strokes, usedIn };
}

export function getVocabInfo(db: DB, id: string, withSentences = false): VocabInfo | null {
	const v = db.select().from(s.vocab).where(eq(s.vocab.id, id)).get();
	if (!v) return null;
	const info = toVocabInfo(v);
	info.status = itemStatuses(db, 'vocab', [id]).get(id);
	if (withSentences) {
		info.sentences = db
			.select({ jp: s.sentence.jp, en: s.sentence.en, es: s.sentence.es })
			.from(s.sentence)
			.where(eq(s.sentence.vocabId, id))
			.limit(4)
			.all();
	}
	return info;
}

/** Busca palabras por forma exacta (kanji o kana). Prioriza las comunes. */
export function lookupWord(db: DB, form: string, limit = 5): VocabInfo[] {
	const rows = db
		.select()
		.from(s.vocab)
		.innerJoin(s.vocabForm, eq(s.vocabForm.vocabId, s.vocab.id))
		.where(eq(s.vocabForm.form, form))
		.orderBy(sql`${s.vocab.common} desc`, sql`${s.vocab.mainForm} = ${form} desc`)
		.limit(limit)
		.all();
	return rows.map((r) => toVocabInfo(r.vocab));
}

/**
 * Búsqueda tolerante a conjugaciones: forma exacta y, si no, deconjugando (見られなかった → 見る).
 * Las palabras encontradas por deconjugación llevan `inflection`.
 */
export function lookupInflected(db: DB, surface: string, limit = 5): VocabInfo[] {
	const exact = lookupWord(db, surface, limit);
	const out: VocabInfo[] = [...exact];
	const seen = new Set(exact.map((w) => w.id));
	for (const c of deinflect(surface)) {
		if (!c.reasons.length || out.length >= limit) continue;
		let found = lookupWord(db, c.term, limit).filter((w) => posMatches(w.pos, c.types));
		// 勉強する → 勉強 (sustantivo con する)
		if (!found.length && c.types & T.VS && c.term.endsWith('する') && c.term.length > 2)
			found = lookupWord(db, c.term.slice(0, -2), limit).filter((w) => w.pos.some((p) => p.startsWith('vs')));
		for (const w of found) {
			if (seen.has(w.id)) continue;
			seen.add(w.id);
			out.push({ ...w, inflection: { surface, reasons: c.reasons } });
		}
	}
	return out.slice(0, limit);
}

/** Kanji parecidos a `char` (por defecto solo los que ya tienen tarjeta: los que pueden confundirse). */
export function similarTo(db: DB, char: string, opts: { onlySeen?: boolean; limit?: number } = {}): SimilarInfo[] {
	const rows = db
		.select()
		.from(s.similarKanji)
		.where(or(eq(s.similarKanji.a, char), eq(s.similarKanji.b, char)))
		.orderBy(sql`${s.similarKanji.score} desc`)
		.limit(12)
		.all();
	const others = rows.map((r) => ({ char: r.a === char ? r.b : r.a, tip: r.tip }));
	if (!others.length) return [];
	const st = itemStatuses(db, 'kanji', others.map((o) => o.char));
	const meanings = new Map(
		db
			.select({ c: s.kanji.char, es: s.kanji.meaningsEs, en: s.kanji.meaningsEn })
			.from(s.kanji)
			.where(inArray(s.kanji.char, others.map((o) => o.char)))
			.all()
			.map((r) => [r.c, (r.es.length ? r.es : r.en)[0] ?? ''])
	);
	return others
		.map((o) => ({ char: o.char, tip: o.tip, meaning: meanings.get(o.char) ?? '', status: st.get(o.char) ?? 'none' }))
		.filter((o) => !opts.onlySeen || o.status !== 'none')
		.slice(0, opts.limit ?? 4);
}

/** Frase de ejemplo que contiene la palabra (minada por el usuario primero, luego Tatoeba). */
export function exampleFor(db: DB, vocabId: string, form: string): { jp: string; es: string | null } | null {
	const mined = db
		.select({ jp: s.minedSentence.jp, es: s.minedSentence.es })
		.from(s.minedSentence)
		.where(eq(s.minedSentence.vocabId, vocabId))
		.limit(1)
		.get();
	if (mined) return mined;
	const t = db
		.select({ jp: s.sentence.jp, es: s.sentence.es, en: s.sentence.en })
		.from(s.sentence)
		.where(and(eq(s.sentence.vocabId, vocabId), sql`instr(${s.sentence.jp}, ${form}) > 0`))
		.orderBy(sql`length(${s.sentence.jp})`)
		.limit(1)
		.get();
	return t ? { jp: t.jp, es: t.es ?? t.en } : null;
}

/** Kanji cuyo significado está aprendido (tarjeta de significado en Review). */
export function knownKanji(db: DB): string[] {
	return db
		.select({ c: s.card.itemKey })
		.from(s.card)
		.innerJoin(s.kanji, eq(s.kanji.char, s.card.itemKey))
		.where(and(eq(s.card.itemType, 'kanji'), eq(s.card.facet, 'meaning'), eq(s.card.state, State.Review)))
		.orderBy(s.kanji.learnOrder)
		.all()
		.map((r) => r.c);
}

/** Kanji cuya lectura se domina lo suficiente como para ocultar furigana (estabilidad ≥ 7 días). */
export function readableKanji(db: DB): Set<string> {
	return new Set(
		db
			.select({ c: s.card.itemKey })
			.from(s.card)
			.where(
				and(
					eq(s.card.itemType, 'kanji'),
					eq(s.card.facet, 'reading'),
					eq(s.card.state, State.Review),
					sql`${s.card.stability} >= 7`
				)
			)
			.all()
			.map((r) => r.c)
	);
}

/** Kanji con tarjeta (cualquiera): "vistos". */
export function seenKanji(db: DB): Set<string> {
	return new Set(
		db
			.selectDistinct({ c: s.card.itemKey })
			.from(s.card)
			.where(eq(s.card.itemType, 'kanji'))
			.all()
			.map((r) => r.c)
	);
}
