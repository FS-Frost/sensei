import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { GrammarPoint, ItemType, LessonItem } from '../../types.ts';
import { getComponentInfo, getKanjiInfo, getVocabInfo, knownKanji, similarTo } from '../items.ts';
import { dayStart, getSettings } from '../settings.ts';
import { dueCount } from './service.ts';
import { State } from './fsrs.ts';
import { GRAMMAR } from '../../grammar.ts';

const BATCH = 5;
const MAX_COMPONENTS = 8;

/** Umbrales del freno automático: con muchos repasos pendientes se reducen o paran las lecciones. */
export const BRAKE_HALF = 80;
export const BRAKE_STOP = 150;

export type Brake = 'none' | 'half' | 'stop';

export type LessonQuota = {
	kanjiLearnedToday: number;
	vocabLearnedToday: number;
	grammarLearnedToday: number;
	kanjiLeft: number;
	vocabLeft: number;
	grammarLeft: number;
	due: number;
	brake: Brake;
	kanjiAvailable: number;
	vocabAvailable: number;
	grammarAvailable: number;
	/** Ítems en la cola de estudio (p. ej. plan de un texto de la biblioteca). */
	queued: number;
};

function learnedToday(db: DB, type: ItemType, since: number) {
	return (
		db
			.select({ n: sql<number>`count(distinct ${s.card.itemKey})` })
			.from(s.card)
			.where(and(eq(s.card.itemType, type), gte(s.card.createdAt, since)))
			.get()?.n ?? 0
	);
}

/** Quita de la cola lo que ya tiene tarjeta. */
function cleanQueue(db: DB) {
	db.run(sql`delete from study_queue where exists (
		select 1 from card c where c.item_type = study_queue.item_type and c.item_key = study_queue.item_key)`);
}

export function lessonQuota(db: DB, now = new Date()): LessonQuota {
	cleanQueue(db);
	const settings = getSettings(db);
	const start = dayStart(now, settings.dayStartHour);
	const due = dueCount(db, now.getTime());
	const brake: Brake = due >= BRAKE_STOP ? 'stop' : due >= BRAKE_HALF ? 'half' : 'none';
	const factor = brake === 'stop' ? 0 : brake === 'half' ? 0.5 : 1;
	const kanjiLearnedToday = learnedToday(db, 'kanji', start);
	const vocabLearnedToday = learnedToday(db, 'vocab', start);
	const grammarLearnedToday = learnedToday(db, 'grammar', start);
	const kanjiLeft = Math.max(0, Math.floor(settings.newKanjiPerDay * factor) - kanjiLearnedToday);
	const vocabLeft = Math.max(0, Math.floor(settings.newVocabPerDay * factor) - vocabLearnedToday);
	const grammarLeft = Math.max(0, Math.floor(settings.newGrammarPerDay * factor) - grammarLearnedToday);
	return {
		kanjiLearnedToday,
		vocabLearnedToday,
		grammarLearnedToday,
		kanjiLeft,
		vocabLeft,
		grammarLeft,
		due,
		brake,
		kanjiAvailable: kanjiLeft > 0 ? 1 : 0,
		vocabAvailable: vocabLeft > 0 ? unlockedVocab(db, 1).length : 0,
		grammarAvailable: grammarLeft > 0 ? unlockedGrammar(db, 1).length : 0,
		queued: db.get<[number]>(sql`select count(*) from study_queue`)?.[0] ?? 0
	};
}

/** Siguientes ítems de la secuencia componentes+kanji sin tarjeta. */
function nextSequence(db: DB, limit: number) {
	return db.all<{ t: 'kanji' | 'component'; k: string; o: number }>(sql`
		select * from (
			select 'kanji' as t, char as k, learn_order as o from kanji
			where learn_order is not null
				and not exists (select 1 from card where item_type = 'kanji' and item_key = kanji.char)
			union all
			select 'component' as t, symbol as k, learn_order as o from component
			where learn_order is not null
				and not exists (select 1 from card where item_type = 'component' and item_key = component.symbol)
		) order by o limit ${limit}
	`);
}

/** Kanji en cola (plan de un texto), en orden de aprendizaje. */
function queuedKanji(db: DB): string[] {
	return db
		.all<{ k: string }>(
			sql`select q.item_key as k from study_queue q join kanji on kanji.char = q.item_key
			    where q.item_type = 'kanji' order by kanji.learn_order, q.added_at`
		)
		.map((r) => r.k);
}

/** Componentes enseñables de un kanji que aún no tienen tarjeta. */
function missingComponents(db: DB, char: string): string[] {
	return db
		.all<{ s: string }>(
			sql`select kc.symbol as s from kanji_component kc join component c on c.symbol = kc.symbol
			    where kc.kanji = ${char} and c.learn_order is not null
			      and not exists (select 1 from card where item_type = 'component' and item_key = kc.symbol)
			    order by c.learn_order`
		)
		.map((r) => r.s);
}

/**
 * Vocabulario para lecciones: primero el de la cola (plan de un texto: no espera al desbloqueo),
 * luego el común cuyos kanji ya tienen el significado en Review.
 */
export function unlockedVocab(db: DB, limit: number): string[] {
	const queued = db
		.all<{ id: string }>(
			sql`select item_key as id from study_queue where item_type = 'vocab'
			    and not exists (select 1 from card c where c.item_type = 'vocab' and c.item_key = study_queue.item_key)
			    order by added_at limit ${limit}`
		)
		.map((r) => r.id);
	if (queued.length >= limit) return queued;
	const rest = db
		.all<{ id: string }>(
			sql`
		select v.id from vocab v
		where v.common = 1
			and exists (select 1 from vocab_kanji vk where vk.vocab_id = v.id)
			and not exists (
				select 1 from vocab_kanji vk
				where vk.vocab_id = v.id and not exists (
					select 1 from card c
					where c.item_type = 'kanji' and c.item_key = vk.kanji and c.facet = 'meaning'
						and c.state = ${State.Review}
				)
			)
			and not exists (select 1 from card c where c.item_type = 'vocab' and c.item_key = v.id)
		order by
			(select max(k.learn_order) from vocab_kanji vk join kanji k on k.char = vk.kanji where vk.vocab_id = v.id),
			length(v.main_form),
			v.id
		limit ${limit}
	`
		)
		.map((r) => r.id)
		.filter((id) => !queued.includes(id));
	return [...queued, ...rest].slice(0, limit);
}

/** Puntos de gramática desbloqueados (por kanji aprendidos) y aún sin tarjeta, en orden del currículo. */
export function unlockedGrammar(db: DB, limit: number): GrammarPoint[] {
	const known = knownKanji(db).length;
	const have = new Set(
		db
			.select({ k: s.card.itemKey })
			.from(s.card)
			.where(eq(s.card.itemType, 'grammar'))
			.all()
			.map((r) => r.k)
	);
	return GRAMMAR.filter((g) => g.unlockAt <= known && !have.has(g.id)).slice(0, limit);
}

/** Puntos de gramática ya estudiados (para lecturas graduadas y el tutor). */
export function knownGrammar(db: DB): GrammarPoint[] {
	const have = new Set(
		db
			.select({ k: s.card.itemKey })
			.from(s.card)
			.where(eq(s.card.itemType, 'grammar'))
			.all()
			.map((r) => r.k)
	);
	return GRAMMAR.filter((g) => have.has(g.id));
}

export type LessonKind = 'auto' | 'kanji' | 'vocab' | 'grammar';

function kanjiItem(db: DB, char: string): LessonItem | null {
	const kanji = getKanjiInfo(db, char, { vocabLimit: 4 });
	// Kanji parecidos YA estudiados: es al aprender el segundo cuando hay que contrastar.
	return kanji ? { type: 'kanji', key: char, kanji, similar: similarTo(db, char, { onlySeen: true, limit: 3 }) } : null;
}

export function nextLesson(db: DB, kind: LessonKind = 'auto', now = new Date()) {
	const quota = lessonQuota(db, now);
	const items: LessonItem[] = [];

	if ((kind === 'auto' || kind === 'kanji') && quota.kanjiLeft > 0) {
		const maxKanji = Math.min(BATCH, quota.kanjiLeft);
		let kanjiCount = 0;
		let compCount = 0;
		const used = new Set<string>();
		const pushComponent = (sym: string) => {
			if (used.has(`c:${sym}`) || compCount >= MAX_COMPONENTS) return;
			const component = getComponentInfo(db, sym);
			if (component) {
				items.push({ type: 'component', key: sym, component });
				used.add(`c:${sym}`);
				compCount++;
			}
		};
		// 1) Kanji priorizados por la cola, cada uno precedido de sus componentes pendientes.
		for (const k of queuedKanji(db)) {
			if (kanjiCount >= maxKanji) break;
			missingComponents(db, k).forEach(pushComponent);
			const it = kanjiItem(db, k);
			if (it) {
				items.push(it);
				used.add(`k:${k}`);
				kanjiCount++;
			}
		}
		// 2) Secuencia normal (componentes + frecuencia).
		if (kanjiCount < maxKanji) {
			for (const row of nextSequence(db, 80)) {
				if (row.t === 'component') pushComponent(row.k);
				else {
					if (kanjiCount >= maxKanji) break;
					if (used.has(`k:${row.k}`)) continue;
					const it = kanjiItem(db, row.k);
					if (it) {
						items.push(it);
						kanjiCount++;
					}
				}
			}
		}
		// Componentes sueltos al final del lote sin su kanji: se verán con él.
		while (items.length && items[items.length - 1].type === 'component' && kanjiCount > 0) items.pop();
	}

	if (!items.length && (kind === 'auto' || kind === 'vocab') && quota.vocabLeft > 0) {
		for (const id of unlockedVocab(db, Math.min(BATCH, quota.vocabLeft))) {
			const vocab = getVocabInfo(db, id, true);
			if (vocab) items.push({ type: 'vocab', key: id, vocab });
		}
	}

	if (!items.length && (kind === 'auto' || kind === 'grammar') && quota.grammarLeft > 0) {
		for (const g of unlockedGrammar(db, Math.min(3, quota.grammarLeft))) items.push({ type: 'grammar', key: g.id, grammar: g });
	}

	return { items, quota };
}

/** Añade ítems a la cola de estudio (no duplica; ignora los que ya tienen tarjeta). */
export function enqueue(db: DB, items: { type: ItemType; key: string }[], sourceTextId: number | null = null) {
	const now = Date.now();
	for (const it of items)
		db.insert(s.studyQueue)
			.values({ itemType: it.type, itemKey: it.key, sourceTextId, addedAt: now })
			.onConflictDoNothing()
			.run();
	cleanQueue(db);
}
