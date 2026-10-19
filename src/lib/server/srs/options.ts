import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Facet, ItemType } from '../../types.ts';
import { kanjiIn, meaningMatches, normalizeMeaning, normalizeReading, readingMatches } from '../../jp.ts';
import { acceptedRomaji, kanaScript } from '../../kana.ts';
import { COURSE_KANA, isSpecialKana, kanaSimilar, rowOf } from '../../kanaCourse.ts';
import { GRAMMAR } from '../../grammar.ts';
import { similarTo } from '../items.ts';

// Opciones para responder eligiendo: la correcta y 3 distractores plausibles (parecidos, confundidos, cercanos en el
// orden de estudio) que NO sean también una respuesta válida (sinónimos, homófonos). Sin 3 así, no hay opciones y se
// responde escribiendo.

const shuffle = <T>(a: T[]): T[] => {
	const o = [...a];
	for (let i = o.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[o[i], o[j]] = [o[j], o[i]];
	}
	return o;
};

/** Los 3 primeros candidatos (en orden de prioridad) que no son válidos ni repiten otra opción, más la correcta. */
function pick(correct: string, candidates: (string | undefined)[], valid: (x: string) => boolean, norm: (x: string) => string) {
	const seen = new Set([norm(correct)]);
	const out: string[] = [];
	for (const c of candidates) {
		if (!c) continue;
		const n = norm(c);
		if (!n || seen.has(n) || valid(c)) continue;
		seen.add(n);
		out.push(c);
		if (out.length === 3) return shuffle([correct, ...out]);
	}
	return undefined;
}

/** Kana de la misma escritura y tamaño, empezando por los parecidos (ソ/ン) y la misma fila: la confusión real. */
function kanaCandidates(key: string): string[] {
	const script = kanaScript(key);
	const len = [...key].length;
	const pool = COURSE_KANA.filter((k) => k !== key && kanaScript(k) === script && [...k].length === len && !isSpecialKana(k));
	const similar = kanaSimilar(key).map((x) => x.char).filter((k) => pool.includes(k));
	const row = (rowOf(key)?.chars ?? []).filter((k) => k !== key && pool.includes(k) && !similar.includes(k));
	return [...similar, ...shuffle(row), ...shuffle(pool)].filter((k, i, a) => a.indexOf(k) === i);
}

/** «¿Cuál es?» de un kana: la correcta y 3 kana parecidos. */
export function kanaOptions(key: string): string[] {
	return shuffle([key, ...kanaCandidates(key).slice(0, 3)]);
}

/** 3 distractores de puntos cercanos en el currículo + la correcta, mezclados. */
export function grammarOptions(id: string): string[] {
	const idx = GRAMMAR.findIndex((g) => g.id === id);
	if (idx < 0) return [];
	const near = GRAMMAR.filter((_, i) => i !== idx && Math.abs(i - idx) <= 12).map((g) => g.meaning);
	return shuffle([GRAMMAR[idx].meaning, ...shuffle(near).slice(0, 3)]);
}

function studiedKeys(db: DB, type: ItemType): Set<string> {
	return new Set(db.selectDistinct({ k: s.card.itemKey }).from(s.card).where(eq(s.card.itemType, type)).all().map((r) => r.k));
}

/** Primero lo ya estudiado (lo que de verdad se puede confundir), cada grupo mezclado. */
function studiedFirst<T>(rows: T[], isStudied: (r: T) => boolean): T[] {
	return [...shuffle(rows.filter(isStudied)), ...shuffle(rows.filter((r) => !isStudied(r)))];
}

const firstOf = (es: string[] | null, en: string[], spanish: boolean) => (spanish ? es?.[0] : en[0]);

/** Kanji candidatos a distractor de `key`: parecidos, confundidos y vecinos en el orden de estudio. */
function kanjiCandidates(db: DB, key: string): string[] {
	const similar = similarTo(db, key, { limit: 8 }).map((x) => x.char);
	const confused = db
		.all<{ a: string; b: string }>(
			sql`select a, b from confusion where kind = 'kanji' and (a = ${key} or b = ${key}) order by count desc limit 8`
		)
		.map((r) => (r.a === key ? r.b : r.a));
	const order = db.select({ o: s.kanji.learnOrder }).from(s.kanji).where(eq(s.kanji.char, key)).get()?.o ?? null;
	const near =
		order == null
			? []
			: db
					.select({ c: s.kanji.char })
					.from(s.kanji)
					.where(and(ne(s.kanji.char, key), sql`${s.kanji.learnOrder} between ${order - 40} and ${order + 40}`))
					.all()
					.map((r) => r.c);
	const seen = studiedKeys(db, 'kanji');
	return [...similar, ...confused, ...studiedFirst(near, (c) => seen.has(c))].filter((c, i, a) => c !== key && a.indexOf(c) === i);
}

const kunFull = (r: string) => normalizeReading(r.replace(/-/g, ''));

/** Vocabulario que comparte kanji con `form` (sin `exclude`), lo estudiado primero. */
function vocabSharingKanji(db: DB, form: string, exclude: string | null) {
	const ks = kanjiIn(form);
	if (!ks.length) return [];
	const rows = db
		.selectDistinct({ id: s.vocab.id, reading: s.vocab.mainReading, es: s.vocab.glossesEs, en: s.vocab.glossesEn })
		.from(s.vocabKanji)
		.innerJoin(s.vocab, eq(s.vocab.id, s.vocabKanji.vocabId))
		.where(and(inArray(s.vocabKanji.kanji, ks), exclude ? ne(s.vocab.id, exclude) : undefined))
		.orderBy(sql`${s.vocab.common} desc`)
		.limit(80)
		.all();
	const seen = studiedKeys(db, 'vocab');
	return studiedFirst(rows, (r) => seen.has(r.id));
}

/** Vocabulario ya estudiado y, de relleno, palabras con kanji que ya estudiaste. */
function vocabPool(db: DB, exclude: string | null, spanish: boolean) {
	const studied = db
		.select({ id: s.vocab.id, reading: s.vocab.mainReading, es: s.vocab.glossesEs, en: s.vocab.glossesEn })
		.from(s.vocab)
		.where(inArray(s.vocab.id, db.selectDistinct({ k: s.card.itemKey }).from(s.card).where(eq(s.card.itemType, 'vocab'))))
		.limit(300)
		.all();
	const fill = db.all<{ id: string; reading: string; es: string | null; en: string }>(sql`
		select distinct v.id as id, v.main_reading as reading, v.glosses_es as es, v.glosses_en as en
		from card c join vocab_kanji vk on vk.kanji = c.item_key join vocab v on v.id = vk.vocab_id
		where c.item_type = 'kanji' and c.facet = 'meaning' and v.common = 1 ${spanish ? sql`and v.glosses_es is not null` : sql``}
		limit 120`);
	const parse = (x: string | null) => (x ? (JSON.parse(x) as string[]) : null);
	return [
		...shuffle(studied),
		...shuffle(fill.map((r) => ({ id: r.id, reading: r.reading, es: parse(r.es), en: parse(r.en) ?? [] })))
	].filter((r) => r.id !== exclude);
}

/** Lecturas de largo parecido primero (una más larga o más corta delata la respuesta). */
const byLength = (target: string, xs: string[]) => {
	const len = [...target].length;
	return [...xs.filter((x) => Math.abs([...x].length - len) <= 1), ...xs.filter((x) => Math.abs([...x].length - len) > 1)];
};

/**
 * Opciones para un ítem que se responde escribiendo (las de kana inverso y gramática las da `buildReviewItem`).
 * `display` y `accepted` vienen de `acceptedAnswers`. undefined = sin opciones (no hay 3 distractores seguros).
 */
export function optionsFor(db: DB, type: ItemType, key: string, facet: Facet, display: string[], accepted: string[]): string[] | undefined {
	if (facet === 'writing' || !display.length) return undefined;
	const meaning = (correct: string, cands: (string | undefined)[]) =>
		pick(correct, cands, (x) => meaningMatches(x, accepted) || meaningMatches(correct, [x]), normalizeMeaning);
	const reading = (correct: string, cands: (string | undefined)[]) =>
		pick(correct, cands, (x) => readingMatches(x, accepted), normalizeReading);

	if (type === 'kana') {
		// っ/ー se leen dentro de una palabra al azar: sin opciones.
		if (facet !== 'reading' || isSpecialKana(key)) return undefined;
		return pick(acceptedRomaji(key)[0], kanaCandidates(key).map((k) => acceptedRomaji(k)[0]), (x) => accepted.includes(x), (x) => x);
	}
	if (type === 'kanji') {
		const chars = kanjiCandidates(db, key);
		if (!chars.length) return undefined;
		const rows = new Map(
			db
				.select({ c: s.kanji.char, es: s.kanji.meaningsEs, en: s.kanji.meaningsEn, on: s.kanji.onReadings, kun: s.kanji.kunReadings })
				.from(s.kanji)
				.where(inArray(s.kanji.char, chars))
				.all()
				.map((r) => [r.c, r])
		);
		const ordered = chars.map((c) => rows.get(c)).filter((r) => !!r);
		if (facet === 'meaning') {
			const target = db.select({ es: s.kanji.meaningsEs }).from(s.kanji).where(eq(s.kanji.char, key)).get();
			const spanish = !!target?.es.length;
			return meaning(display[0], ordered.map((r) => firstOf(r.es.length ? r.es : null, r.en, spanish)));
		}
		// Lecturas siempre en hiragana (on en katakana delataría el tipo); de cada kanji, la primera que no sea válida.
		const correct = normalizeReading(display[0]);
		const isOn = /[゠-ヿ]/.test(display[0]);
		return reading(
			correct,
			ordered.map((r) => {
				const all = isOn ? [...r.on.map(normalizeReading), ...r.kun.map(kunFull)] : [...r.kun.map(kunFull), ...r.on.map(normalizeReading)];
				return all.find((x) => x && !readingMatches(x, accepted));
			})
		);
	}
	if (type === 'component') {
		const order = db.select({ o: s.component.learnOrder }).from(s.component).where(eq(s.component.symbol, key)).get()?.o ?? 0;
		const rows = db
			.select({ sym: s.component.symbol, name: s.component.nameEs })
			.from(s.component)
			.where(and(ne(s.component.symbol, key), sql`${s.component.nameEs} is not null`))
			.orderBy(sql`abs(coalesce(${s.component.learnOrder}, 99999) - ${order})`)
			.limit(40)
			.all();
		const seen = studiedKeys(db, 'component');
		return meaning(display[0], studiedFirst(rows, (r) => seen.has(r.sym)).map((r) => r.name ?? undefined));
	}
	if (type === 'vocab') {
		const v = db.select().from(s.vocab).where(eq(s.vocab.id, key)).get();
		if (!v) return undefined;
		const spanish = !!v.glossesEs?.length;
		const near = vocabSharingKanji(db, v.mainForm, v.id);
		const pool = vocabPool(db, v.id, spanish);
		if (facet === 'meaning') return meaning(display[0], [...near, ...pool].map((r) => firstOf(r.es?.length ? r.es : null, r.en, spanish)));
		return reading(display[0], [...near.map((r) => r.reading), ...byLength(display[0], pool.map((r) => r.reading))]);
	}
	if (type === 'sentence') {
		const m = db.select().from(s.minedSentence).where(eq(s.minedSentence.id, Number(key))).get();
		if (!m) return undefined;
		const near = vocabSharingKanji(db, m.target, m.vocabId).map((r) => r.reading);
		const others = db
			.select({ r: s.minedSentence.targetReading })
			.from(s.minedSentence)
			.where(ne(s.minedSentence.id, m.id))
			.limit(100)
			.all()
			.map((x) => x.r);
		const pool = vocabPool(db, m.vocabId, false).map((r) => r.reading);
		return reading(display[0], [...near, ...byLength(display[0], shuffle([...others, ...pool]))]);
	}
	return undefined;
}
