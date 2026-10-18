// Generar por adelantado el contenido de los próximos kanji (por tandas, incremental y reanudable).
// Lo usan la app («Preparar por adelantado», con la key del alumno) y scripts/pregen.ts (para publicarlo con el
// diccionario). Cada tanda salta lo que ya existe: repetir no gasta. Ver docs/pregenerated-content.md.
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { ensureComponentNames, ensureGlossesEs, ensureMnemonics, ensureSentencesEs, ensureSimilarTips } from './enrich.ts';
import { kanjiInOrder } from '../data/pregen.ts';

/** Palabras por kanji para las que se preparan glosas y frases (las más comunes primero). */
export const WORDS_PER_KANJI = 4;

/** Vocabulario principal de unos kanji: palabras comunes que los contienen, las más cortas primero. */
export function wordsFor(db: DB, chars: string[], perKanji = WORDS_PER_KANJI): string[] {
	const out = new Set<string>();
	for (const c of chars) {
		const rows = db.all<{ id: string }>(sql`
			select v.id from vocab_kanji vk join vocab v on v.id = vk.vocab_id
			where vk.kanji = ${c} and v.common = 1 and v.id like 'jm:%'
			order by length(v.main_form), v.id limit ${perKanji}`);
		for (const r of rows) out.add(r.id);
	}
	return [...out];
}

/** Los próximos `count` kanji que aún no estudias (sin tarjeta), en orden de aprendizaje. */
export function kanjiAhead(db: DB, count: number): string[] {
	return db
		.all<{ c: string }>(
			sql`select char as c from kanji where learn_order is not null
				and not exists (select 1 from card where item_type = 'kanji' and item_key = kanji.char)
				order by learn_order limit ${count}`
		)
		.map((r) => r.c);
}

/** De los próximos `count` kanji por estudiar, cuántos ya tienen su contenido preparado y cuáles faltan. */
export function aheadStatus(db: DB, count: number): PregenStatus {
	const chars = kanjiAhead(db, count);
	const ready = new Set(
		chars.length
			? db.select({ c: s.kanji.char }).from(s.kanji).where(and(inArray(s.kanji.char, chars), isNotNull(s.kanji.mnemonicMeaning))).all().map((r) => r.c)
			: []
	);
	return { total: chars.length, done: ready.size, nextKanji: chars.filter((c) => !ready.has(c)) };
}

export type PregenStatus = { total: number; done: number; nextKanji: string[] };

/** Cuántos de los próximos `count` kanji (en orden) ya tienen mnemotecnia. */
export function pregenStatus(db: DB, count: number): PregenStatus {
	const chars = kanjiInOrder(db, count);
	const done = chars.length
		? db.select({ c: s.kanji.char }).from(s.kanji).where(and(inArray(s.kanji.char, chars), isNotNull(s.kanji.mnemonicMeaning))).all().length
		: 0;
	const missing = chars.length
		? new Set(db.select({ c: s.kanji.char }).from(s.kanji).where(and(inArray(s.kanji.char, chars), isNull(s.kanji.mnemonicMeaning))).all().map((r) => r.c))
		: new Set<string>();
	return { total: chars.length, done, nextKanji: chars.filter((c) => missing.has(c)) };
}

/**
 * Una tanda: nombres de sus componentes → mnemotecnias (usan esos nombres) → consejos de parecidos → glosas y frases
 * de su vocabulario principal. Las funciones de enrich.ts saltan lo que ya existe.
 */
export async function pregenerateBatch(db: DB, chars: string[]) {
	if (!chars.length) return { kanji: 0 };
	const symbols = db
		.selectDistinct({ symbol: s.kanjiComponent.symbol })
		.from(s.kanjiComponent)
		.where(inArray(s.kanjiComponent.kanji, chars))
		.all()
		.map((r) => r.symbol);
	await ensureComponentNames(db, symbols);
	await ensureMnemonics(db, chars);
	const pairs = db.all<{ a: string; b: string }>(sql`
		select a, b from similar_kanji
		where (a in (${sql.join(chars.map((c) => sql`${c}`), sql`, `)}) or b in (${sql.join(chars.map((c) => sql`${c}`), sql`, `)}))
			and tip is null
		order by score desc limit ${chars.length * 2}`);
	await ensureSimilarTips(db, pairs);
	const words = wordsFor(db, chars);
	await ensureGlossesEs(db, words);
	await ensureSentencesEs(db, words);
	return { kanji: chars.length, components: symbols.length, words: words.length, pairs: pairs.length };
}
