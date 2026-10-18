// Contenido pregenerado: mnemotecnias, nombres de componentes, glosas, frases y consejos de kanji parecidos que se
// publican CON el diccionario (content/pregen.json → scripts/build-dict.ts), para empezar sin gastar ni key.
// Aquí solo el formato, aplicarlo (origen `pregen`) y recogerlo de una base; generarlo está en gemini/pregen.ts.
// Ver docs/pregenerated-content.md.
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ComponentExplanation } from '../../types.ts';
import type { Snapshot } from './snapshot.ts';

export const PREGEN_FORMAT = 1;

export type PregenContent = {
	format: number;
	updatedAt: string;
	/** Kanji ya procesados, en orden de aprendizaje (para continuar donde se quedó). */
	kanji: string[];
	mnemonics: { char: string; meaning: string | null; reading: string | null }[];
	componentNames: { symbol: string; name: string }[];
	/** Opcional: los archivos anteriores no la traen. */
	componentExplanations?: { symbol: string; explanation: ComponentExplanation }[];
	glosses: { id: string; glosses: string[] }[];
	sentences: { vocabId: string; jp: string; es: string }[];
	similarTips: { a: string; b: string; tip: string }[];
};

export const emptyPregen = (): PregenContent => ({
	format: PREGEN_FORMAT,
	updatedAt: new Date(0).toISOString(),
	kanji: [],
	mnemonics: [],
	componentNames: [],
	componentExplanations: [],
	glosses: [],
	sentences: [],
	similarTips: []
});

/**
 * Aplica el contenido con origen `pregen`, solo donde no hay nada (nunca pisa JMdict ni lo del alumno).
 * Devuelve cuántos valores se escribieron.
 */
export function applyPregen(db: DB, c: PregenContent) {
	let n = 0;
	db.transaction((tx) => {
		for (const m of c.mnemonics)
			n += tx
				.update(s.kanji)
				.set({ mnemonicMeaning: m.meaning, mnemonicReading: m.reading, mnemonicSource: 'pregen' })
				.where(and(eq(s.kanji.char, m.char), isNull(s.kanji.mnemonicMeaning)))
				.returning({ k: s.kanji.char })
				.all().length;
		for (const x of c.componentNames)
			n += tx
				.update(s.component)
				.set({ nameEs: x.name, nameSource: 'pregen' })
				.where(and(eq(s.component.symbol, x.symbol), isNull(s.component.nameEs)))
				.returning({ k: s.component.symbol })
				.all().length;
		for (const x of c.componentExplanations ?? [])
			n += tx
				.update(s.component)
				.set({ explanation: x.explanation, explanationSource: 'pregen' })
				.where(and(eq(s.component.symbol, x.symbol), isNull(s.component.explanation)))
				.returning({ k: s.component.symbol })
				.all().length;
		for (const g of c.glosses)
			n += tx
				.update(s.vocab)
				.set({ glossesEs: g.glosses, glossesEsSource: 'pregen' })
				.where(and(eq(s.vocab.id, g.id), isNull(s.vocab.glossesEs)))
				.returning({ k: s.vocab.id })
				.all().length;
		for (const x of c.sentences)
			n += tx
				.update(s.sentence)
				.set({ es: x.es, esSource: 'pregen' })
				.where(and(eq(s.sentence.vocabId, x.vocabId), eq(s.sentence.jp, x.jp), isNull(s.sentence.es)))
				.returning({ k: s.sentence.id })
				.all().length;
		for (const t of c.similarTips)
			n += tx
				.update(s.similarKanji)
				.set({ tip: t.tip, tipSource: 'pregen' })
				.where(and(eq(s.similarKanji.a, t.a), eq(s.similarKanji.b, t.b), isNull(s.similarKanji.tip)))
				.returning({ k: s.similarKanji.a })
				.all().length;
	});
	return n;
}

/**
 * Recoge de una base todo el contenido generado (por Gemini o ya pregenerado) relacionado con `chars`:
 * sus mnemotecnias, sus componentes, su vocabulario (glosas y frases) y sus pares de parecidos. Ordenado y estable
 * (el archivo resultante se versiona en el repo: los diffs deben ser legibles).
 */
export function collectGenerated(db: DB, chars: string[]): Required<Omit<PregenContent, 'format' | 'updatedAt' | 'kanji'>> {
	if (!chars.length) return { mnemonics: [], componentNames: [], componentExplanations: [], glosses: [], sentences: [], similarTips: [] };
	const gen = (col: unknown) => sql`coalesce(${col}, 'gemini') in ('gemini', 'pregen')`;
	const symbols = db
		.selectDistinct({ symbol: s.kanjiComponent.symbol })
		.from(s.kanjiComponent)
		.where(inArray(s.kanjiComponent.kanji, chars))
		.all()
		.map((r) => r.symbol);
	const vocabIds = db
		.selectDistinct({ id: s.vocabKanji.vocabId })
		.from(s.vocabKanji)
		.where(inArray(s.vocabKanji.kanji, chars))
		.all()
		.map((r) => r.id);
	const chunks = <T>(xs: T[], n = 400) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
	return {
		mnemonics: db
			.select({ char: s.kanji.char, meaning: s.kanji.mnemonicMeaning, reading: s.kanji.mnemonicReading })
			.from(s.kanji)
			.where(and(inArray(s.kanji.char, chars), isNotNull(s.kanji.mnemonicMeaning), gen(s.kanji.mnemonicSource)))
			.orderBy(s.kanji.char)
			.all(),
		componentNames: symbols.length
			? (db
					.select({ symbol: s.component.symbol, name: s.component.nameEs })
					.from(s.component)
					.where(and(inArray(s.component.symbol, symbols), inArray(s.component.nameSource, ['gemini', 'pregen'])))
					.orderBy(s.component.symbol)
					.all() as { symbol: string; name: string }[])
			: [],
		componentExplanations: symbols.length
			? (db
					.select({ symbol: s.component.symbol, explanation: s.component.explanation })
					.from(s.component)
					.where(and(inArray(s.component.symbol, symbols), isNotNull(s.component.explanation)))
					.orderBy(s.component.symbol)
					.all() as { symbol: string; explanation: ComponentExplanation }[])
			: [],
		glosses: chunks(vocabIds)
			.flatMap(
				(ids) =>
					db
						.select({ id: s.vocab.id, glosses: s.vocab.glossesEs })
						.from(s.vocab)
						.where(and(inArray(s.vocab.id, ids), inArray(s.vocab.glossesEsSource, ['gemini', 'pregen'])))
						.all() as { id: string; glosses: string[] }[]
			)
			.sort((a, b) => a.id.localeCompare(b.id)),
		sentences: chunks(vocabIds)
			.flatMap(
				(ids) =>
					db
						.select({ vocabId: s.sentence.vocabId, jp: s.sentence.jp, es: s.sentence.es })
						.from(s.sentence)
						.where(and(inArray(s.sentence.vocabId, ids), isNotNull(s.sentence.es), gen(s.sentence.esSource)))
						.all() as { vocabId: string; jp: string; es: string }[]
			)
			.sort((a, b) => a.vocabId.localeCompare(b.vocabId) || a.jp.localeCompare(b.jp)),
		similarTips: db
			.select({ a: s.similarKanji.a, b: s.similarKanji.b, tip: s.similarKanji.tip })
			.from(s.similarKanji)
			.where(and(or(inArray(s.similarKanji.a, chars), inArray(s.similarKanji.b, chars)), isNotNull(s.similarKanji.tip), gen(s.similarKanji.tipSource)))
			.orderBy(s.similarKanji.a, s.similarKanji.b)
			.all() as { a: string; b: string; tip: string }[]
	};
}

/** Fallos (en Review) a partir de los que una tarjeta «se resiste» (igual que LEECH_LAPSES en srs/service.ts). */
const LEECH_LAPSES = 6;

export type PregenCandidate = Omit<PregenContent, 'format' | 'updatedAt' | 'kanji'> & {
	/** Mnemotecnias que NO se publican, con el motivo. */
	excluded: { char: string; reason: string }[];
};

/**
 * Del contenido de una exportación (Snapshot), lo que se puede publicar como pregenerado: solo lo generado por
 * Gemini que no sea personal. Se excluyen las mnemotecnias `personal`, las de kanji con una «Nueva mnemotecnia»
 * del tutor y las de kanji con tarjetas que se resistieron (pudieron regenerarse con tus intereses sin dejar
 * registro), y todo lo de palabras propias (`u:`).
 */
export function pregenFromSnapshot(snap: Snapshot): PregenCandidate {
	const c = snap.content;
	const tutorRegen = new Set(
		(snap.tutor.actions ?? [])
			.filter((a) => a.name === 'regenerate_mnemonic' && a.status === 'confirmed')
			.map((a) => String((a.args as { kanji?: unknown }).kanji ?? ''))
	);
	const leeches = new Set(
		snap.progress.cards
			.filter((x) => x.itemType === 'kanji' && Number((x.fsrs as { lapses?: number }).lapses ?? 0) >= LEECH_LAPSES)
			.map((x) => x.itemKey)
	);
	const excluded: PregenCandidate['excluded'] = [];
	const mnemonics = c.mnemonics.filter((m) => {
		const reason =
			m.source === 'personal'
				? 'hecha con tus intereses'
				: tutorRegen.has(m.char)
					? 'regenerada por el tutor'
					: leeches.has(m.char)
						? 'kanji que se resistió (pudo regenerarse con tus intereses)'
						: !m.meaning
							? 'vacía'
							: null;
		if (reason) excluded.push({ char: m.char, reason });
		return !reason;
	});
	const jm = (id: string) => id.startsWith('jm:');
	return {
		mnemonics: mnemonics.map(({ char, meaning, reading }) => ({ char, meaning, reading })),
		componentNames: c.componentNames.filter((x) => x.name).map(({ symbol, name }) => ({ symbol, name })),
		componentExplanations: c.componentExplanations ?? [],
		glosses: c.glosses.filter((g) => jm(g.id) && g.glosses?.length).map(({ id, glosses }) => ({ id, glosses })),
		sentences: c.sentences.filter((x) => jm(x.vocabId) && x.es),
		similarTips: c.similarTips ?? [],
		excluded
	};
}

/**
 * Suma `incoming` a `base` sin pisar nada de lo que ya tiene (lo publicado gana). Ordenado como collectGenerated
 * para que el diff del repo sea legible. La lista `kanji` (tandas completas) no cambia: esto es contenido suelto.
 */
export function mergePregen(base: PregenContent, incoming: Omit<PregenContent, 'format' | 'updatedAt' | 'kanji'>, now = new Date()) {
	const added: Record<string, number> = {};
	const merge = <T>(name: string, a: T[], b: T[], key: (x: T) => string, order: (x: T, y: T) => number) => {
		const seen = new Set(a.map(key));
		const extra = b.filter((x) => {
			const k = key(x);
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
		added[name] = extra.length;
		return [...a, ...extra].sort(order);
	};
	const by = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
	const content: PregenContent = {
		...base,
		format: PREGEN_FORMAT,
		updatedAt: now.toISOString(),
		mnemonics: merge('mnemonics', base.mnemonics, incoming.mnemonics, (x) => x.char, (x, y) => by(x.char, y.char)),
		componentNames: merge('componentNames', base.componentNames, incoming.componentNames, (x) => x.symbol, (x, y) => by(x.symbol, y.symbol)),
		componentExplanations: merge(
			'componentExplanations',
			base.componentExplanations ?? [],
			incoming.componentExplanations ?? [],
			(x) => x.symbol,
			(x, y) => by(x.symbol, y.symbol)
		),
		glosses: merge('glosses', base.glosses, incoming.glosses, (x) => x.id, (x, y) => by(x.id, y.id)),
		sentences: merge('sentences', base.sentences, incoming.sentences, (x) => `${x.vocabId}\u0000${x.jp}`, (x, y) => by(x.vocabId, y.vocabId) || by(x.jp, y.jp)),
		similarTips: merge('similarTips', base.similarTips, incoming.similarTips, (x) => `${x.a}${x.b}`, (x, y) => by(x.a, y.a) || by(x.b, y.b))
	};
	return { content, added };
}

/** Kanji en orden de aprendizaje: los `count` siguientes a partir de `skip` (los ya procesados). */
export function kanjiInOrder(db: DB, count: number, skip = 0): string[] {
	return db
		.select({ c: s.kanji.char })
		.from(s.kanji)
		.where(isNotNull(s.kanji.learnOrder))
		.orderBy(s.kanji.learnOrder)
		.limit(count)
		.offset(skip)
		.all()
		.map((r) => r.c);
}
