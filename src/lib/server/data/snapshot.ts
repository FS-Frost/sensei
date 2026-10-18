// Exportación / importación de los datos del usuario como .zip (formato propio, versionado).
// Solo datos del usuario: los diccionarios se descargan del sitio (dict/).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { and, asc, eq, isNotNull, like, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ComponentExplanation } from '../../types.ts';
import type { SealedSecret } from './secret.ts';

export const FORMAT = 1;

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

export type Snapshot = {
	progress: {
		cards: Row<typeof s.card>[];
		reviewLog: Row<typeof s.reviewLog>[];
		confusions: Row<typeof s.confusion>[];
		// Desde la ruta del viaje (opcionales para leer copias antiguas):
		minedSentences?: Row<typeof s.minedSentence>[];
		readingLog?: Row<typeof s.readingLog>[];
		studyQueue?: Row<typeof s.studyQueue>[];
	};
	tutor: {
		sessions: Row<typeof s.session>[];
		messages: Row<typeof s.message>[];
		summaries: Row<typeof s.sessionSummary>[];
		notes: Row<typeof s.learnerNote>[];
		weeklyReports?: Row<typeof s.weeklyReport>[];
		actions?: Row<typeof s.tutorAction>[];
	};
	generated: {
		texts: Row<typeof s.generatedText>[];
		library?: Row<typeof s.libraryText>[];
		/** Registro de uso y costo de Gemini. */
		usage?: Row<typeof s.geminiUsage>[];
	};
	settings: { key: string; value: string }[];
	content: {
		/** `source` (opcional en copias antiguas): `personal` = hecha con tus intereses; nunca se publica como pregenerada. */
		mnemonics: { char: string; meaning: string | null; reading: string | null; source?: string | null }[];
		componentNames: { symbol: string; name: string; source: string | null }[];
		componentExplanations?: { symbol: string; explanation: ComponentExplanation }[];
		glosses: { id: string; glosses: string[]; source: string | null }[];
		sentences: { vocabId: string; jp: string; es: string }[];
		userVocab: { vocab: Row<typeof s.vocab>; forms: string[]; kanji: string[] }[];
		similarTips?: { a: string; b: string; tip: string }[];
	};
};

export type Manifest = {
	app: 'sensei';
	format: number;
	createdAt: string;
	kind: string;
	hash: string;
	counts: Record<string, number>;
	/** Secciones incluidas (formato 2, exportación parcial). Sin él, el archivo trae todas. */
	sections?: Section[];
	/** Archivos extra: preferencias del dispositivo, API key cifrada. */
	extras?: ('device' | 'secret')[];
	/** Diccionario del dispositivo que exportó (informativo). */
	dict?: { variant: string; version: string | null };
};

const FILES = ['progress', 'tutor', 'generated', 'settings', 'content'] as const;

/**
 * Secciones que se pueden exportar e importar por separado. `progress` incluye tus palabras propias (las tarjetas
 * las referencian); `library` = textos de la biblioteca y lecturas/explicaciones guardadas; `usage` = registro de costos.
 */
export const SECTIONS = ['progress', 'tutor', 'library', 'usage', 'settings', 'content'] as const;
export type Section = (typeof SECTIONS)[number];

/** Formato 2 = exportación parcial: las versiones anteriores la rechazan en vez de borrar lo que no trae. */
export const FORMAT_PARTIAL = 2;

/** Vacía las secciones no elegidas (para exportar solo una parte). */
export function pickSections(snap: Snapshot, sections: readonly Section[]): Snapshot {
	const on = new Set(sections);
	return {
		progress: on.has('progress')
			? snap.progress
			: { cards: [], reviewLog: [], confusions: [], minedSentences: [], readingLog: [], studyQueue: [] },
		tutor: on.has('tutor')
			? snap.tutor
			: { sessions: [], messages: [], summaries: [], notes: [], weeklyReports: [], actions: [] },
		generated: {
			texts: on.has('library') ? snap.generated.texts : [],
			library: on.has('library') ? (snap.generated.library ?? []) : [],
			usage: on.has('usage') ? (snap.generated.usage ?? []) : []
		},
		settings: on.has('settings') ? snap.settings : [],
		content: {
			...(on.has('content')
				? snap.content
				: { mnemonics: [], componentNames: [], componentExplanations: [], glosses: [], sentences: [], similarTips: [] }),
			userVocab: on.has('progress') ? snap.content.userVocab : []
		}
	};
}

/** Recuento por sección (vista previa de importar: qué trae el archivo y qué tienes ahora). */
export function sectionCounts(snap: Snapshot): Record<Section, Record<string, number>> {
	const c = countSnapshot(snap);
	return {
		progress: { cards: c.cards, reviews: c.reviews, confusions: c.confusions, minedSentences: c.minedSentences, readings: c.readings, queue: c.queue, userVocab: c.userVocab },
		tutor: { sessions: c.sessions, messages: c.messages, notes: c.notes, reports: c.reports },
		library: { library: c.library, texts: c.texts },
		usage: { usage: c.usage },
		settings: { settings: c.settings },
		content: { mnemonics: c.mnemonics, translations: c.translations }
	};
}

// ---------- Construir ----------

/**
 * Todas las consultas llevan `orderBy` por clave: el snapshot (y su hash) tiene que ser **determinista**.
 * La sincronización entre dispositivos detecta «hubo cambios» comparando hashes.
 */
export function buildSnapshot(db: DB): Snapshot {
	const userVocab = db.select().from(s.vocab).where(like(s.vocab.id, 'u:%')).orderBy(asc(s.vocab.id)).all();
	return {
		progress: {
			cards: db.select().from(s.card).orderBy(asc(s.card.id)).all(),
			reviewLog: db.select().from(s.reviewLog).orderBy(asc(s.reviewLog.id)).all(),
			confusions: db.select().from(s.confusion).orderBy(asc(s.confusion.kind), asc(s.confusion.a), asc(s.confusion.b)).all(),
			minedSentences: db.select().from(s.minedSentence).orderBy(asc(s.minedSentence.id)).all(),
			readingLog: db.select().from(s.readingLog).orderBy(asc(s.readingLog.id)).all(),
			studyQueue: db.select().from(s.studyQueue).orderBy(asc(s.studyQueue.itemType), asc(s.studyQueue.itemKey)).all()
		},
		tutor: {
			sessions: db.select().from(s.session).orderBy(asc(s.session.id)).all(),
			messages: db.select().from(s.message).orderBy(asc(s.message.id)).all(),
			summaries: db.select().from(s.sessionSummary).orderBy(asc(s.sessionSummary.sessionId)).all(),
			notes: db.select().from(s.learnerNote).orderBy(asc(s.learnerNote.id)).all(),
			weeklyReports: db.select().from(s.weeklyReport).orderBy(asc(s.weeklyReport.id)).all(),
			actions: db.select().from(s.tutorAction).orderBy(asc(s.tutorAction.id)).all()
		},
		generated: {
			texts: db.select().from(s.generatedText).orderBy(asc(s.generatedText.id)).all(),
			library: db.select().from(s.libraryText).orderBy(asc(s.libraryText.id)).all(),
			usage: db.select().from(s.geminiUsage).orderBy(asc(s.geminiUsage.id)).all()
		},
		// Los valores internos (`_…`: API key de Gemini, versión del diccionario) nunca se exportan.
		settings: db
			.select()
			.from(s.setting)
			.where(sql`substr(${s.setting.key}, 1, 1) != '_'`)
			.orderBy(asc(s.setting.key))
			.all(),
		content: {
			mnemonics: db
				.select({ char: s.kanji.char, meaning: s.kanji.mnemonicMeaning, reading: s.kanji.mnemonicReading, source: s.kanji.mnemonicSource })
				.from(s.kanji)
				// Lo pregenerado viene con el diccionario: no se exporta (data/pregen.ts).
				.where(
					sql`(${s.kanji.mnemonicMeaning} is not null or ${s.kanji.mnemonicReading} is not null) and coalesce(${s.kanji.mnemonicSource}, 'gemini') != 'pregen'`
				)
				.orderBy(asc(s.kanji.char))
				.all(),
			componentNames: db
				.select({ symbol: s.component.symbol, name: s.component.nameEs, source: s.component.nameSource })
				.from(s.component)
				.where(and(isNotNull(s.component.nameEs), eq(s.component.nameSource, 'gemini')))
				.orderBy(asc(s.component.symbol))
				.all() as { symbol: string; name: string; source: string | null }[],
			componentExplanations: db
				.select({ symbol: s.component.symbol, explanation: s.component.explanation })
				.from(s.component)
				.where(and(isNotNull(s.component.explanation), eq(s.component.explanationSource, 'gemini')))
				.orderBy(asc(s.component.symbol))
				.all() as { symbol: string; explanation: ComponentExplanation }[],
			glosses: db
				.select({ id: s.vocab.id, glosses: s.vocab.glossesEs, source: s.vocab.glossesEsSource })
				.from(s.vocab)
				.where(and(isNotNull(s.vocab.glossesEs), eq(s.vocab.glossesEsSource, 'gemini')))
				.orderBy(asc(s.vocab.id))
				.all() as { id: string; glosses: string[]; source: string | null }[],
			sentences: db
				.select({ vocabId: s.sentence.vocabId, jp: s.sentence.jp, es: s.sentence.es })
				.from(s.sentence)
				.where(and(isNotNull(s.sentence.es), isNotNull(s.sentence.vocabId), sql`coalesce(${s.sentence.esSource}, 'gemini') != 'pregen'`))
				.orderBy(asc(s.sentence.id))
				.all() as { vocabId: string; jp: string; es: string }[],
			userVocab: userVocab.map((v) => ({
				vocab: v,
				forms: db
					.select({ f: s.vocabForm.form })
					.from(s.vocabForm)
					.where(eq(s.vocabForm.vocabId, v.id))
					.orderBy(asc(s.vocabForm.form))
					.all()
					.map((r) => r.f),
				kanji: db
					.select({ k: s.vocabKanji.kanji })
					.from(s.vocabKanji)
					.where(eq(s.vocabKanji.vocabId, v.id))
					.orderBy(asc(s.vocabKanji.kanji))
					.all()
					.map((r) => r.k)
			})),
			similarTips: db
				.select({ a: s.similarKanji.a, b: s.similarKanji.b, tip: s.similarKanji.tip })
				.from(s.similarKanji)
				.where(and(isNotNull(s.similarKanji.tip), sql`coalesce(${s.similarKanji.tipSource}, 'gemini') != 'pregen'`))
				.orderBy(asc(s.similarKanji.a), asc(s.similarKanji.b))
				.all() as { a: string; b: string; tip: string }[]
		}
	};
}

export function countSnapshot(snap: Snapshot): Record<string, number> {
	return {
		cards: snap.progress.cards.length,
		reviews: snap.progress.reviewLog.length,
		confusions: snap.progress.confusions.length,
		minedSentences: snap.progress.minedSentences?.length ?? 0,
		readings: snap.progress.readingLog?.length ?? 0,
		sessions: snap.tutor.sessions.length,
		messages: snap.tutor.messages.length,
		notes: snap.tutor.notes.length,
		reports: snap.tutor.weeklyReports?.length ?? 0,
		texts: snap.generated.texts.length,
		library: snap.generated.library?.length ?? 0,
		usage: snap.generated.usage?.length ?? 0,
		settings: snap.settings.length,
		mnemonics: snap.content.mnemonics.length,
		translations:
			snap.content.componentNames.length +
			(snap.content.componentExplanations?.length ?? 0) +
			snap.content.glosses.length +
			snap.content.sentences.length +
			(snap.content.similarTips?.length ?? 0),
		queue: snap.progress.studyQueue?.length ?? 0,
		userVocab: snap.content.userVocab.length
	};
}

/**
 * Huella del contenido (sin fecha): permite saltarse copias idénticas. Síncrona y sin node:crypto
 * (corre en el navegador): dos hashes de 32 bits (cyrb) sobre el JSON. No es criptográfica, no hace falta.
 */
export function snapshotHash(snap: Snapshot) {
	const str = JSON.stringify(snap);
	let h1 = 0xdeadbeef ^ str.length;
	let h2 = 0x41c6ce57 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function isEmpty(snap: Snapshot) {
	const c = countSnapshot(snap);
	return Object.values(c).every((n) => n === 0);
}

/** Extras de una exportación (no viajan en copias automáticas ni al sincronizar). */
export type ZipExtras = {
	/** Solo estas secciones (por defecto, todas). */
	sections?: readonly Section[];
	/** Preferencias del dispositivo (`localStorage`), tal cual. */
	device?: Record<string, string>;
	/** API key de Gemini cifrada con la contraseña del alumno (data/secret.ts). */
	secret?: { geminiApiKey: SealedSecret };
	dict?: Manifest['dict'];
};

export function snapshotToZip(snap: Snapshot, kind: string, now = new Date(), extras: ZipExtras = {}): { zip: Uint8Array; manifest: Manifest } {
	const sections = extras.sections ?? SECTIONS;
	const partial = SECTIONS.some((x) => !sections.includes(x));
	const picked = partial ? pickSections(snap, sections) : snap;
	const extraFiles: ('device' | 'secret')[] = [...(extras.device ? (['device'] as const) : []), ...(extras.secret ? (['secret'] as const) : [])];
	const manifest: Manifest = {
		app: 'sensei',
		format: partial ? FORMAT_PARTIAL : FORMAT,
		createdAt: now.toISOString(),
		kind,
		hash: snapshotHash(picked),
		counts: countSnapshot(picked),
		...(partial ? { sections: [...sections] } : {}),
		...(extraFiles.length ? { extras: extraFiles } : {}),
		...(extras.dict ? { dict: extras.dict } : {})
	};
	const files: Record<string, Uint8Array> = {
		'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
		'LEEME.txt': strToU8(
			'Copia de Sensei. Para restaurarla: página Datos → Importar.\n' +
				(partial
					? `Exportación parcial: ${sections.join(', ')}.\n`
					: 'Contiene tu progreso, el historial del tutor, lecturas, ajustes y contenido generado.\n') +
				'No contiene diccionarios (se descargan del sitio).\n' +
				(extras.secret
					? 'Incluye la API key de Gemini CIFRADA: sin la contraseña no se puede leer.\n'
					: 'No contiene la API key de Gemini.\n')
		)
	};
	for (const f of FILES) files[`${f}.json`] = strToU8(JSON.stringify(picked[f]));
	if (extras.device) files['device.json'] = strToU8(JSON.stringify(extras.device));
	if (extras.secret) files['secret.json'] = strToU8(JSON.stringify(extras.secret));
	return { zip: zipSync(files, { level: 6 }), manifest };
}

// ---------- Leer y validar ----------

export class SnapshotError extends Error {}

const MAX_UNZIPPED = 200 * 1024 * 1024;

/** Lo que trae un .zip además del snapshot. */
export type ZipContents = {
	snap: Snapshot;
	manifest: Manifest;
	/** Secciones que trae (todas en copias completas y antiguas). */
	sections: Section[];
	device: Record<string, string> | null;
	secret: { geminiApiKey: SealedSecret } | null;
};

export function readZip(bytes: Uint8Array): ZipContents {
	let files: Record<string, Uint8Array>;
	try {
		let total = 0;
		files = unzipSync(bytes, {
			filter: (f) => {
				total += f.originalSize;
				if (total > MAX_UNZIPPED) throw new SnapshotError('El .zip es demasiado grande');
				return f.name.endsWith('.json');
			}
		});
	} catch (e) {
		if (e instanceof SnapshotError) throw e;
		throw new SnapshotError('No es un .zip válido');
	}
	const parse = (name: string) => {
		const f = files[name];
		if (!f) throw new SnapshotError(`Falta ${name}: no parece una copia de Sensei`);
		try {
			return JSON.parse(strFromU8(f));
		} catch {
			throw new SnapshotError(`${name} está dañado`);
		}
	};
	const manifest = parse('manifest.json') as Manifest;
	if (manifest.app !== 'sensei') throw new SnapshotError('No es una copia de Sensei');
	if (typeof manifest.format !== 'number' || manifest.format > FORMAT_PARTIAL)
		throw new SnapshotError(`Formato ${manifest.format} no soportado: actualiza Sensei`);
	const sections =
		manifest.format === FORMAT_PARTIAL
			? SECTIONS.filter((x) => Array.isArray(manifest.sections) && manifest.sections.includes(x))
			: [...SECTIONS];
	if (!sections.length) throw new SnapshotError('El archivo no trae ninguna sección');
	const snap = Object.fromEntries(FILES.map((f) => [f, parse(`${f}.json`)])) as Snapshot;
	const arrays: [unknown, string][] = [
		[snap.progress?.cards, 'progress.cards'],
		[snap.progress?.reviewLog, 'progress.reviewLog'],
		[snap.progress?.confusions, 'progress.confusions'],
		[snap.tutor?.sessions, 'tutor.sessions'],
		[snap.tutor?.messages, 'tutor.messages'],
		[snap.tutor?.summaries, 'tutor.summaries'],
		[snap.tutor?.notes, 'tutor.notes'],
		[snap.generated?.texts, 'generated.texts'],
		[snap.settings, 'settings'],
		[snap.content?.mnemonics, 'content.mnemonics'],
		[snap.content?.componentNames, 'content.componentNames'],
		[snap.content?.glosses, 'content.glosses'],
		[snap.content?.sentences, 'content.sentences'],
		[snap.content?.userVocab, 'content.userVocab']
	];
	for (const [v, name] of arrays) if (!Array.isArray(v)) throw new SnapshotError(`${name} inválido`);
	// Opcionales (copias anteriores a la ruta del viaje no los traen): si vienen, deben ser listas.
	const optional: [unknown, string][] = [
		[snap.progress.minedSentences, 'progress.minedSentences'],
		[snap.progress.readingLog, 'progress.readingLog'],
		[snap.progress.studyQueue, 'progress.studyQueue'],
		[snap.tutor.weeklyReports, 'tutor.weeklyReports'],
		[snap.tutor.actions, 'tutor.actions'],
		[snap.generated.library, 'generated.library'],
		[snap.generated.usage, 'generated.usage'],
		[snap.content.similarTips, 'content.similarTips'],
		[snap.content.componentExplanations, 'content.componentExplanations']
	];
	for (const [v, name] of optional) if (v !== undefined && !Array.isArray(v)) throw new SnapshotError(`${name} inválido`);
	const optionalFile = (name: string) => (files[name] ? parse(name) : null);
	// Preferencias: solo claves `sensei.*` con texto (las aplica la página; aquí solo se filtra).
	const rawDevice = optionalFile('device.json') as Record<string, unknown> | null;
	const device = rawDevice
		? Object.fromEntries(
				Object.entries(rawDevice).filter(([k, v]) => /^sensei\.[\w.-]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 20_000)
			) as Record<string, string>
		: null;
	const secret = optionalFile('secret.json') as { geminiApiKey: SealedSecret } | null;
	return { snap, manifest, sections, device, secret: secret?.geminiApiKey ? secret : null };
}

export function readManifest(bytes: Uint8Array): Manifest | null {
	try {
		const files = unzipSync(bytes, { filter: (f) => f.name === 'manifest.json' });
		return JSON.parse(strFromU8(files['manifest.json'])) as Manifest;
	} catch {
		return null;
	}
}

// ---------- Aplicar (reemplazo) ----------

function chunked<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/**
 * Reemplaza las secciones elegidas (por defecto todas) por las del snapshot; las demás quedan intactas.
 * El contenido generado (mnemotecnias, traducciones) se SUMA: no se borra lo existente.
 */
export function applySnapshot(db: DB, snap: Snapshot, sections: readonly Section[] = SECTIONS) {
	const on = new Set(sections);
	db.transaction((tx) => {
		const wipe = [
			...(on.has('progress') ? [s.card, s.reviewLog, s.confusion, s.minedSentence, s.readingLog, s.studyQueue] : []),
			...(on.has('tutor') ? [s.message, s.sessionSummary, s.session, s.learnerNote, s.weeklyReport, s.tutorAction] : []),
			...(on.has('library') ? [s.generatedText, s.libraryText] : []),
			...(on.has('usage') ? [s.geminiUsage] : [])
		];
		for (const t of wipe) tx.delete(t).run();
		if (on.has('settings')) tx.delete(s.setting).where(sql`substr(${s.setting.key}, 1, 1) != '_'`).run();
		// Las palabras propias van con el progreso: sus tarjetas las referencian.
		if (on.has('progress')) {
			tx.delete(s.vocabForm).where(like(s.vocabForm.vocabId, 'u:%')).run();
			tx.delete(s.vocabKanji).where(like(s.vocabKanji.vocabId, 'u:%')).run();
			tx.delete(s.vocab).where(like(s.vocab.id, 'u:%')).run();
		}

		const insert = <T>(table: Parameters<typeof tx.insert>[0], rows: T[], size = 300) => {
			for (const b of chunked(rows, size)) if (b.length) tx.insert(table).values(b as never).run();
		};
		if (on.has('progress')) {
			insert(s.card, snap.progress.cards);
			insert(s.reviewLog, snap.progress.reviewLog);
			insert(s.confusion, snap.progress.confusions);
			insert(s.minedSentence, snap.progress.minedSentences ?? []);
			insert(s.readingLog, snap.progress.readingLog ?? []);
			insert(s.studyQueue, snap.progress.studyQueue ?? []);
			for (const u of snap.content.userVocab) {
				tx.insert(s.vocab).values(u.vocab).onConflictDoNothing().run();
				for (const f of u.forms) tx.insert(s.vocabForm).values({ form: f, vocabId: u.vocab.id }).onConflictDoNothing().run();
				for (const k of u.kanji) tx.insert(s.vocabKanji).values({ vocabId: u.vocab.id, kanji: k }).onConflictDoNothing().run();
			}
		}
		if (on.has('tutor')) {
			insert(s.session, snap.tutor.sessions);
			insert(s.message, snap.tutor.messages, 100);
			insert(s.sessionSummary, snap.tutor.summaries);
			insert(s.learnerNote, snap.tutor.notes);
			insert(s.weeklyReport, snap.tutor.weeklyReports ?? [], 50);
			insert(s.tutorAction, snap.tutor.actions ?? [], 200);
		}
		if (on.has('library')) {
			insert(s.generatedText, snap.generated.texts, 50);
			insert(s.libraryText, snap.generated.library ?? [], 10);
		}
		if (on.has('usage')) insert(s.geminiUsage, snap.generated.usage ?? [], 300);
		if (on.has('settings'))
			insert(
				s.setting,
				snap.settings.filter((x) => !x.key.startsWith('_'))
			);
		if (!on.has('content')) return;

		for (const t of snap.content.similarTips ?? [])
			tx.update(s.similarKanji)
				.set({ tip: t.tip, tipSource: 'gemini' })
				.where(and(eq(s.similarKanji.a, t.a), eq(s.similarKanji.b, t.b)))
				.run();
		for (const m of snap.content.mnemonics)
			tx.update(s.kanji)
				.set({ mnemonicMeaning: m.meaning, mnemonicReading: m.reading, mnemonicSource: m.source === 'personal' ? 'personal' : 'gemini' })
				.where(eq(s.kanji.char, m.char))
				.run();
		for (const c of snap.content.componentNames)
			tx.update(s.component).set({ nameEs: c.name, nameSource: 'gemini' }).where(eq(s.component.symbol, c.symbol)).run();
		for (const c of snap.content.componentExplanations ?? [])
			tx.update(s.component)
				.set({ explanation: c.explanation, explanationSource: 'gemini' })
				.where(eq(s.component.symbol, c.symbol))
				.run();
		for (const g of snap.content.glosses)
			tx.update(s.vocab)
				// Solo si el diccionario no trae español propio.
				.set({ glossesEs: g.glosses, glossesEsSource: 'gemini' })
				.where(and(eq(s.vocab.id, g.id), sql`coalesce(${s.vocab.glossesEsSource}, '') != 'jmdict'`))
				.run();
		for (const x of snap.content.sentences)
			tx.update(s.sentence)
				.set({ es: x.es, esSource: 'gemini' })
				.where(and(eq(s.sentence.vocabId, x.vocabId), eq(s.sentence.jp, x.jp)))
				.run();
	});
}
