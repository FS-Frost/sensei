// Reinicio de progreso (todo / por tipo / por ítem), memoria del tutor y contenido generado.
// Siempre se puede pedir antes una vista previa (`dry`) con lo que se borraría.
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { one, type DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemType } from '../../types.ts';
import { RADICAL_NAMES_ES } from '../import/radicals.ts';

/**
 * Grupos de progreso. "kanji" arrastra componentes, vocabulario y frases (dependen de los kanji);
 * "vocab" arrastra las frases (son tarjetas de palabras en contexto).
 */
export type ProgressGroup = 'kana' | 'kanji' | 'vocab' | 'grammar' | 'sentence';
export const GROUP_TYPES: Record<ProgressGroup, ItemType[]> = {
	kana: ['kana'],
	kanji: ['component', 'kanji', 'vocab', 'sentence'],
	vocab: ['vocab', 'sentence'],
	grammar: ['grammar'],
	sentence: ['sentence']
};

export type ResetRequest = {
	/** 'all' o una lista de grupos. 'all' incluye además lecturas cronometradas y la cola de estudio. */
	progress?: 'all' | ProgressGroup[];
	/** Un ítem concreto (desde su ficha). */
	item?: { type: ItemType; key: string };
	tutor?: boolean;
	generated?: boolean;
	/** Textos de la biblioteca (y sus lecturas). */
	library?: boolean;
	/** Registro de uso y costo de Gemini. */
	usage?: boolean;
};

export type ResetPreview = {
	cards: number;
	reviews: number;
	confusions: number;
	minedSentences: number;
	readings: number;
	sessions: number;
	notes: number;
	reports: number;
	texts: number;
	library: number;
	mnemonics: number;
	translations: number;
	usage: number;
};

const ALL_TYPES: ItemType[] = ['kana', 'component', 'kanji', 'vocab', 'grammar', 'sentence'];

function progressTypes(req: ResetRequest): ItemType[] {
	if (!req.progress) return [];
	if (req.progress === 'all') return ALL_TYPES;
	return [...new Set(req.progress.flatMap((g) => GROUP_TYPES[g] ?? []))];
}

function count(db: DB, table: SQLiteTable, where?: SQL) {
	return one<{ n: number }>(sql`select count(*) as n from ${table} ${where ? sql`where ${where}` : sql``}`, db)?.n ?? 0;
}

function conditions(req: ResetRequest) {
	const types = progressTypes(req);
	const cardW: SQL[] = [];
	const logW: SQL[] = [];
	const confW: SQL[] = [];
	if (types.length) {
		cardW.push(inArray(s.card.itemType, types));
		logW.push(inArray(s.reviewLog.itemType, types));
		confW.push(inArray(s.confusion.kind, types));
	}
	if (req.item) {
		const { type, key } = req.item;
		cardW.push(and(eq(s.card.itemType, type), eq(s.card.itemKey, key))!);
		logW.push(and(eq(s.reviewLog.itemType, type), eq(s.reviewLog.itemKey, key))!);
		confW.push(and(eq(s.confusion.kind, type), or(eq(s.confusion.a, key), eq(s.confusion.b, key)))!);
	}
	// Frases minadas: se borran con su tarjeta (grupo que incluye 'sentence' o el ítem concreto).
	let mined: SQL | undefined;
	if (types.includes('sentence')) mined = sql`1 = 1`;
	else if (req.item?.type === 'sentence') mined = eq(s.minedSentence.id, Number(req.item.key));
	return { card: or(...cardW), log: or(...logW), conf: or(...confW), any: cardW.length > 0, mined };
}

export function previewReset(db: DB, req: ResetRequest): ResetPreview {
	const c = conditions(req);
	const all = req.progress === 'all';
	return {
		cards: c.any ? count(db, s.card, c.card) : 0,
		reviews: c.any ? count(db, s.reviewLog, c.log) : 0,
		confusions: c.any ? count(db, s.confusion, c.conf) : 0,
		minedSentences: c.mined ? count(db, s.minedSentence, c.mined) : 0,
		readings: all ? count(db, s.readingLog) : req.library ? count(db, s.readingLog, sql`${s.readingLog.textKind} = 'library'`) : 0,
		sessions: req.tutor ? count(db, s.session) : 0,
		notes: req.tutor ? count(db, s.learnerNote) : 0,
		reports: req.tutor ? count(db, s.weeklyReport) : 0,
		library: req.library ? count(db, s.libraryText) : 0,
		texts: req.generated ? count(db, s.generatedText) : 0,
		mnemonics: req.generated
			? count(db, s.kanji, sql`${s.kanji.mnemonicMeaning} is not null and coalesce(${s.kanji.mnemonicSource}, 'gemini') != 'pregen'`)
			: 0,
		translations: req.generated
			? count(db, s.vocab, sql`${s.vocab.glossesEsSource} = 'gemini'`) +
				count(db, s.sentence, sql`${s.sentence.es} is not null and coalesce(${s.sentence.esSource}, 'gemini') != 'pregen'`) +
				count(db, s.component, sql`${s.component.nameSource} = 'gemini'`)
			: 0,
		usage: req.usage ? count(db, s.geminiUsage) : 0
	};
}

export function applyReset(db: DB, req: ResetRequest) {
	const c = conditions(req);
	db.transaction((tx) => {
		if (c.any) {
			tx.delete(s.card).where(c.card).run();
			tx.delete(s.reviewLog).where(c.log).run();
			tx.delete(s.confusion).where(c.conf).run();
		}
		if (c.mined) tx.delete(s.minedSentence).where(c.mined).run();
		if (req.progress === 'all') {
			tx.delete(s.readingLog).run();
			tx.delete(s.studyQueue).run();
		}
		if (req.library) {
			tx.delete(s.readingLog).where(eq(s.readingLog.textKind, 'library')).run();
			tx.run(sql`delete from study_queue where source_text_id is not null`);
			tx.delete(s.libraryText).run();
		}
		if (req.tutor) {
			tx.delete(s.message).run();
			tx.delete(s.sessionSummary).run();
			tx.delete(s.session).run();
			tx.delete(s.learnerNote).run();
			tx.delete(s.weeklyReport).run();
			tx.delete(s.tutorAction).run();
		}
		if (req.usage) tx.delete(s.geminiUsage).run();
		if (req.generated) {
			tx.delete(s.generatedText).run();
			// Lo pregenerado (viene con el diccionario) se conserva: no lo pagó el alumno ni se recupera reiniciando.
			const notPregen = (col: typeof s.kanji.mnemonicSource | typeof s.sentence.esSource | typeof s.similarKanji.tipSource) =>
				sql`coalesce(${col}, 'gemini') != 'pregen'`;
			tx.update(s.kanji).set({ mnemonicMeaning: null, mnemonicReading: null, mnemonicSource: null }).where(notPregen(s.kanji.mnemonicSource)).run();
			tx.update(s.vocab)
				.set({ glossesEs: null, glossesEsSource: null })
				.where(eq(s.vocab.glossesEsSource, 'gemini'))
				.run();
			tx.update(s.sentence).set({ es: null, esSource: null }).where(notPregen(s.sentence.esSource)).run();
			tx.update(s.similarKanji).set({ tip: null, tipSource: null }).where(notPregen(s.similarKanji.tipSource)).run();
			// Componentes nombrados por Gemini: volver al nombre estático o al significado del kanji.
			const named = tx.select({ symbol: s.component.symbol }).from(s.component).where(eq(s.component.nameSource, 'gemini')).all();
			for (const { symbol } of named) {
				const k = tx.select({ m: s.kanji.meaningsEs }).from(s.kanji).where(eq(s.kanji.char, symbol)).get();
				const stat = RADICAL_NAMES_ES[symbol];
				const fromKanji = k?.m[0];
				tx.update(s.component)
					.set({
						nameEs: stat ?? fromKanji ?? null,
						nameSource: stat ? 'static' : fromKanji ? 'kanji' : null
					})
					.where(eq(s.component.symbol, symbol))
					.run();
			}
		}
	});
}

export function isEmptyRequest(req: ResetRequest) {
	return (
		!req.item &&
		!req.tutor &&
		!req.generated &&
		!req.library &&
		!req.usage &&
		(!req.progress || (Array.isArray(req.progress) && !req.progress.length))
	);
}
