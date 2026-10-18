// Kana en el servidor: estado del curso, «puerta» del hiragana para kanji y gramática, siguiente lección,
// tarjetas «ya sabidas» (diagnóstico) y relleno para quien ya estudiaba antes de que existiera el curso.
import { sql } from 'drizzle-orm';
import { one, type DB } from './db/index.ts';
import * as s from './db/schema.ts';
import { emptyCard, serialize, State, Rating } from './srs/fsrs.ts';
import { getSettings, updateSettings } from './settings.ts';
import type { Facet, ItemStatus, KanaInfo } from '../types.ts';
import {
	COURSE_KANA,
	HIRAGANA_CORE,
	KANA_ROWS,
	KANA_RULES,
	isSpecialKana,
	kanaEntry,
	kanaFormation,
	kanaSimilar,
	rowOf,
	type KanaScript
} from '../kanaCourse.ts';
import { HIRAGANA_BASIC, HIRAGANA_DAKUTEN, KATAKANA_BASIC, KATAKANA_DAKUTEN } from '../kana.ts';

const DAY = 86_400_000;
const MASTERED_DAYS = 21;

/** Lo que cubría el diagnóstico antiguo (básicos y dakuten de ambas escrituras). */
const LEGACY_SET = [...HIRAGANA_BASIC, ...HIRAGANA_DAKUTEN, ...KATAKANA_BASIC, ...KATAKANA_DAKUTEN];

/**
 * Antes del curso, el diagnóstico solo creaba tarjetas para los kana dudosos: los dominados no tenían tarjeta.
 * Para quien ya estudiaba (diagnóstico, test de nivel o kanji) y nunca pasó por el curso nuevo (ni lección de kana,
 * ni punto de partida, ni diagnóstico nuevo), esos kana cuentan como sabidos. Se calcula, no se escribe: así no
 * cambia la huella de los datos ni la sincronización entre dispositivos.
 */
export function legacyKnownKana(db: DB): Set<string> {
	const st = getSettings(db);
	if (st.kanaAssessed || st.startLevel) return new Set();
	const n =
		one<{ signals: number; lessons: number }>(
			sql`select (select count(*) from review_log where source in ('diagnostic', 'placement'))
				+ (select count(*) from card where item_type = 'kanji') as signals,
				(select count(*) from review_log where item_type = 'kana' and source = 'lesson') as lessons`,
			db
		) ?? { signals: 0, lessons: 0 };
	return n.signals && !n.lessons ? new Set(LEGACY_SET) : new Set();
}

/** Kana con tarjeta de lectura (aprendidos o diagnosticados), más los «sabidos de antes». */
export function taughtKana(db: DB): Set<string> {
	const cards = db.all<{ k: string }>(sql`select item_key as k from card where item_type = 'kana' and facet = 'reading'`).map((r) => r.k);
	return new Set([...cards, ...legacyKnownKana(db)]);
}

/** Estado de lectura de cada kana del curso (la tarjeta de lectura manda; la inversa y la escritura son de apoyo). */
export function kanaStatuses(db: DB): Record<string, ItemStatus> {
	const rows = db.all<{ k: string; state: number; stab: number }>(
		sql`select item_key as k, state, stability as stab from card where item_type = 'kana' and facet = 'reading'`
	);
	const by = new Map(rows.map((r) => [r.k, r]));
	const legacy = legacyKnownKana(db);
	return Object.fromEntries(
		COURSE_KANA.map((k) => {
			const r = by.get(k);
			const st: ItemStatus = !r
				? legacy.has(k)
					? 'review'
					: 'none'
				: r.state !== State.Review
					? 'learning'
					: r.stab >= MASTERED_DAYS
						? 'mastered'
						: 'review';
			return [k, st];
		})
	);
}

/**
 * Las lecciones de kanji y la gramática esperan a que el hiragana básico esté estudiado (todos con tarjeta).
 * Quien ya estudia kanji nunca queda bloqueado.
 */
export function hiraganaReady(db: DB): boolean {
	if ((one<{ n: number }>(sql`select count(*) as n from card where item_type = 'kanji'`, db)?.n ?? 0) > 0) return true;
	const t = taughtKana(db);
	return HIRAGANA_CORE.every((k) => t.has(k));
}

/** Hiragana básicos que faltan por estudiar. */
export function hiraganaLeft(db: DB): number {
	const t = taughtKana(db);
	return HIRAGANA_CORE.filter((k) => !t.has(k)).length;
}

/** Siguientes kana por enseñar, por filas completas (al menos una fila; no más de `max` salvo que la fila lo pida). */
export function nextKana(db: DB, max: number): string[] {
	if (max <= 0) return [];
	const t = taughtKana(db);
	const out: string[] = [];
	for (const row of KANA_ROWS) {
		const missing = row.chars.filter((c) => !t.has(c));
		if (!missing.length) continue;
		if (out.length && out.length + missing.length > max) break;
		out.push(...missing);
		if (out.length >= max) break;
	}
	return out;
}

/** Kana nuevos estudiados hoy (por lección: las tarjetas «ya sabidas» se crean con fecha pasada). */
export function kanaLearnedToday(db: DB, since: number): number {
	return one<{ n: number }>(sql`select count(distinct item_key) as n from card where item_type = 'kana' and created_at >= ${since}`, db)?.n ?? 0;
}

export function kanaInfo(db: DB, key: string, statuses: Record<string, ItemStatus> = kanaStatuses(db)): KanaInfo {
	const e = kanaEntry(key);
	const row = rowOf(key);
	const first = row && row.chars[0] === key;
	return {
		char: key,
		romaji: e.romaji,
		script: row?.script ?? 'hiragana',
		row: row?.title ?? '',
		group: row?.group ?? 'basic',
		mnemonic: e.mnemonic ?? null,
		formation: kanaFormation(key),
		example: e.example ?? null,
		similar: kanaSimilar(key),
		// La regla del grupo, con el primer kana de su fila.
		rule: first && row.group !== 'basic' ? KANA_RULES[row.group] : null,
		traceable: [...key].length === 1 && !isSpecialKana(key),
		status: statuses[key] ?? 'none'
	};
}

/** Facetas de un kana: lectura (kana → romaji) e inversa (sonido → elegir el kana). っ y ー, solo lectura. */
export function kanaFacets(key: string): Facet[] {
	return isSpecialKana(key) ? ['reading'] : ['reading', 'meaning'];
}

/**
 * Tarjeta «ya sabida»: en repaso con estabilidad alta y el primer repaso repartido en las próximas semanas
 * (así se verifica sin saturar). No toca la que ya existe. Fecha de creación en el pasado: no gasta cupo.
 */
export function knownCard(db: DB, type: 'kana', key: string, facet: Facet, source: 'diagnostic' | 'placement', now = Date.now()) {
	const exists = one<{ n: number }>(
		sql`select count(*) as n from card where item_type = ${type} and item_key = ${key} and facet = ${facet}`,
		db
	)?.n;
	if (exists) return false;
	const c = emptyCard(new Date(now));
	const due = now + (7 + Math.floor(Math.random() * 34)) * DAY;
	c.state = State.Review;
	c.stability = 30;
	c.difficulty = 4;
	c.reps = 1;
	c.scheduled_days = Math.round((due - now) / DAY);
	c.last_review = new Date(now);
	c.due = new Date(due);
	const row = db
		.insert(s.card)
		.values({ itemType: type, itemKey: key, facet, state: c.state, due, stability: 30, fsrs: serialize(c), createdAt: now - 2 * DAY })
		.returning({ id: s.card.id })
		.get();
	db.insert(s.reviewLog)
		.values({ cardId: row.id, itemType: type, itemKey: key, facet, rating: Rating.Good, correct: true, source, reviewedAt: now })
		.run();
	return true;
}

/**
 * El alumno pasó por la evaluación nueva: lo que no tenga tarjeta ya no cuenta como «sabido de antes».
 * Es un ajuste (no interno): viaja en las copias y al sincronizar.
 */
export function markKanaAssessed(db: DB) {
	if (!getSettings(db).kanaAssessed) updateSettings(db, { kanaAssessed: true });
}

/** Resumen del nivel de kana (para el tutor, Inicio y la página de kana). */
export function kanaProgress(db: DB) {
	const st = kanaStatuses(db);
	const of = (script: KanaScript, basicOnly: boolean) =>
		KANA_ROWS.filter((r) => r.script === script && (!basicOnly || r.group === 'basic')).flatMap((r) => r.chars);
	const count = (keys: string[]) => ({
		total: keys.length,
		taught: keys.filter((k) => st[k] !== 'none').length,
		solid: keys.filter((k) => st[k] === 'review' || st[k] === 'mastered').length
	});
	return {
		hiragana: count(of('hiragana', false)),
		hiraganaBasic: count(of('hiragana', true)),
		katakana: count(of('katakana', false)),
		katakanaBasic: count(of('katakana', true))
	};
}

/**
 * Kana que aún no lees con soltura (sin tarjeta o con lectura poco estable): bajo ellos se muestra romaji de apoyo.
 * Por carácter: un kana pequeño (ゃ, っ, ー…) cuenta como sabido si lo está algún kana del curso que lo contiene.
 */
export function weakKanaChars(db: DB): string {
	const rows = db.all<{ k: string; state: number; stab: number }>(
		sql`select item_key as k, state, stability as stab from card where item_type = 'kana' and facet = 'reading'`
	);
	const solid = new Set<string>();
	for (const r of rows) if (r.state === State.Review && r.stab >= 7) for (const ch of r.k) solid.add(ch);
	for (const k of legacyKnownKana(db)) for (const ch of k) solid.add(ch);
	const all = new Set(COURSE_KANA.flatMap((k) => [...k]));
	return [...all].filter((ch) => !solid.has(ch)).join('');
}
