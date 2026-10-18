import {
	sqliteTable,
	text,
	integer,
	real,
	primaryKey,
	index,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// ---------- Catálogo ----------

export const kanji = sqliteTable(
	'kanji',
	{
		char: text('char').primaryKey(),
		meaningsEs: json<string[]>('meanings_es').notNull().default([]),
		meaningsEn: json<string[]>('meanings_en').notNull().default([]),
		onReadings: json<string[]>('on_readings').notNull().default([]),
		kunReadings: json<string[]>('kun_readings').notNull().default([]),
		strokes: integer('strokes'),
		grade: integer('grade'),
		freq: integer('freq'),
		jlpt: integer('jlpt'),
		learnOrder: integer('learn_order'),
		mnemonicMeaning: text('mnemonic_meaning'),
		mnemonicReading: text('mnemonic_reading'),
		/**
		 * Origen de la mnemotecnia: `pregen` = publicada con el diccionario (data/pregen, no se exporta ni se borra al
		 * reiniciar el contenido generado); `gemini` (o null, datos antiguos) = generada con la key del alumno.
		 */
		mnemonicSource: text('mnemonic_source').$type<'gemini' | 'pregen'>()
	},
	(t) => [index('kanji_learn_order').on(t.learnOrder)]
);

export const component = sqliteTable(
	'component',
	{
		symbol: text('symbol').primaryKey(),
		nameEs: text('name_es'),
		/** Origen del nombre: estático (radicals.ts), significado del kanji, generado por Gemini o pregenerado (diccionario). */
		nameSource: text('name_source').$type<'static' | 'kanji' | 'gemini' | 'pregen'>(),
		strokes: integer('strokes'),
		learnOrder: integer('learn_order')
	},
	(t) => [index('component_learn_order').on(t.learnOrder)]
);

export const kanjiComponent = sqliteTable(
	'kanji_component',
	{
		kanji: text('kanji').notNull(),
		symbol: text('symbol').notNull(),
		position: integer('position').notNull()
	},
	(t) => [primaryKey({ columns: [t.kanji, t.symbol] }), index('kc_symbol').on(t.symbol)]
);

export const vocab = sqliteTable('vocab', {
	id: text('id').primaryKey(), // 'jm:<id>' | 'u:<uuid>'
	mainForm: text('main_form').notNull(),
	mainReading: text('main_reading').notNull(),
	kanjiForms: json<string[]>('kanji_forms').notNull().default([]),
	kanaForms: json<string[]>('kana_forms').notNull().default([]),
	common: integer('common', { mode: 'boolean' }).notNull().default(false),
	pos: json<string[]>('pos').notNull().default([]),
	glossesEn: json<string[]>('glosses_en').notNull().default([]),
	glossesEs: json<string[]>('glosses_es'),
	/** Origen de las glosas en español: JMdict-spa, traducción de Gemini, escritas por el usuario o pregeneradas. */
	glossesEsSource: text('glosses_es_source').$type<'jmdict' | 'gemini' | 'user' | 'pregen'>(),
	source: text('source').notNull().default('jmdict')
});

export const vocabForm = sqliteTable(
	'vocab_form',
	{
		form: text('form').notNull(),
		vocabId: text('vocab_id').notNull()
	},
	(t) => [primaryKey({ columns: [t.form, t.vocabId] }), index('vf_vocab').on(t.vocabId)]
);

export const vocabKanji = sqliteTable(
	'vocab_kanji',
	{
		vocabId: text('vocab_id').notNull(),
		kanji: text('kanji').notNull()
	},
	(t) => [primaryKey({ columns: [t.vocabId, t.kanji] }), index('vk_kanji').on(t.kanji)]
);

export const sentence = sqliteTable(
	'sentence',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		vocabId: text('vocab_id'),
		jp: text('jp').notNull(),
		en: text('en'),
		es: text('es'),
		/** Origen de la traducción `es`: Gemini con la key del alumno o pregenerada (diccionario). */
		esSource: text('es_source').$type<'gemini' | 'pregen'>(),
		source: text('source').notNull().default('tatoeba')
	},
	(t) => [index('sentence_vocab').on(t.vocabId)]
);

// ---------- SRS ----------

export type ItemType = 'kana' | 'component' | 'kanji' | 'vocab' | 'grammar' | 'sentence';
/** `writing`: trazar el kanji (opcional, ajuste `writingReviews`); no cuenta para el estado del ítem. */
export type Facet = 'meaning' | 'reading' | 'writing';

export const card = sqliteTable(
	'card',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		itemType: text('item_type').$type<ItemType>().notNull(),
		itemKey: text('item_key').notNull(),
		facet: text('facet').$type<Facet>().notNull(),
		state: integer('state').notNull().default(0),
		due: integer('due').notNull(),
		stability: real('stability').notNull().default(0),
		fsrs: json<Record<string, unknown>>('fsrs').notNull(),
		createdAt: integer('created_at').notNull(),
		suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [
		uniqueIndex('card_item').on(t.itemType, t.itemKey, t.facet),
		index('card_due').on(t.due),
		index('card_created').on(t.createdAt)
	]
);

export const reviewLog = sqliteTable(
	'review_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		cardId: integer('card_id'),
		itemType: text('item_type').$type<ItemType>().notNull(),
		itemKey: text('item_key').notNull(),
		facet: text('facet').$type<Facet>(),
		rating: integer('rating'),
		correct: integer('correct', { mode: 'boolean' }).notNull(),
		answer: text('answer'),
		durationMs: integer('duration_ms'),
		source: text('source').$type<'review' | 'lesson' | 'quiz' | 'diagnostic' | 'placement'>().notNull(),
		reviewedAt: integer('reviewed_at').notNull()
	},
	(t) => [index('rl_time').on(t.reviewedAt), index('rl_item').on(t.itemType, t.itemKey)]
);

export const confusion = sqliteTable(
	'confusion',
	{
		kind: text('kind').$type<ItemType>().notNull(),
		a: text('a').notNull(),
		b: text('b').notNull(),
		count: integer('count').notNull().default(1),
		lastAt: integer('last_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.kind, t.a, t.b] })]
);

// ---------- Tutor ----------

export const session = sqliteTable('session', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	mode: text('mode').notNull(),
	title: text('title'),
	/** auto = primer mensaje; summary = primera frase del resumen; user = renombrada a mano (no se pisa). */
	titleSource: text('title_source').$type<'auto' | 'summary' | 'user'>(),
	/** Dónde se abrió: página del tutor, panel lateral o cierre de la sesión diaria (/hoy). */
	origin: text('origin').$type<'page' | 'panel' | 'daily'>().notNull().default('page'),
	startedAt: integer('started_at').notNull(),
	lastAt: integer('last_at').notNull(),
	summarized: integer('summarized', { mode: 'boolean' }).notNull().default(false),
	/**
	 * Último «estado del alumno» enviado al modelo en esta sesión. El estado va como parte de usuario (no en la
	 * instrucción de sistema) y solo se reenvía si cambió: así el prefijo de la petición no cambia entre turnos y
	 * Gemini sirve el historial desde su caché (1/10 del precio). Ver docs/tutor-cache.md.
	 */
	stateSnapshot: text('state_snapshot')
});

export const message = sqliteTable(
	'message',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sessionId: integer('session_id').notNull(),
		role: text('role').$type<'user' | 'model'>().notNull(),
		// Partes crudas de Gemini (incluye thoughtSignature): se reenvían tal cual.
		parts: json<unknown[]>('parts').notNull(),
		// Bloques para la UI.
		ui: json<unknown[]>('ui').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('message_session').on(t.sessionId)]
);

/**
 * Acciones del tutor sobre los datos del alumno: directas (con deshacer) o propuestas (requieren confirmación).
 * `undo` guarda lo necesario para revertir.
 */
export const tutorAction = sqliteTable(
	'tutor_action',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sessionId: integer('session_id').notNull(),
		name: text('name').notNull(),
		args: json<Record<string, unknown>>('args').notNull(),
		status: text('status').$type<'done' | 'undone' | 'proposed' | 'confirmed' | 'rejected' | 'failed'>().notNull(),
		label: text('label').notNull(),
		result: json<Record<string, unknown>>('result'),
		undo: json<Record<string, unknown>>('undo'),
		createdAt: integer('created_at').notNull(),
		/** El resultado de una propuesta ya se comunicó al modelo. */
		reported: integer('reported', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('tutor_action_session').on(t.sessionId)]
);

export const sessionSummary = sqliteTable('session_summary', {
	sessionId: integer('session_id').primaryKey(),
	summary: text('summary').notNull(),
	createdAt: integer('created_at').notNull()
});

export const learnerNote = sqliteTable('learner_note', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	note: text('note').notNull(),
	createdAt: integer('created_at').notNull()
});

// ---------- Contenido generado ----------

export const generatedText = sqliteTable('generated_text', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	kind: text('kind').$type<'reading' | 'explain' | 'speed'>().notNull(),
	params: json<Record<string, unknown>>('params').notNull(),
	content: json<unknown>('content').notNull(),
	createdAt: integer('created_at').notNull()
});

// ---------- Kanji parecidos (prevención de confusiones) ----------

export const similarKanji = sqliteTable(
	'similar_kanji',
	{
		a: text('a').notNull(),
		b: text('b').notNull(), // a < b
		score: real('score').notNull(),
		/** Cómo distinguirlos (generado por Gemini y cacheado). */
		tip: text('tip'),
		tipSource: text('tip_source').$type<'gemini' | 'pregen'>()
	},
	(t) => [primaryKey({ columns: [t.a, t.b] }), index('similar_b').on(t.b)]
);

// ---------- Frases minadas (tarjetas en contexto) ----------

export const minedSentence = sqliteTable('mined_sentence', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	jp: text('jp').notNull(),
	es: text('es'),
	/** Palabra objetivo tal como aparece en la frase. */
	target: text('target').notNull(),
	targetReading: text('target_reading').notNull(),
	vocabId: text('vocab_id'),
	source: text('source').notNull(), // 'explain' | 'reading' | 'library' | 'manual'
	createdAt: integer('created_at').notNull()
});

// ---------- Biblioteca (textos reales) y registro de lecturas ----------

export const libraryText = sqliteTable('library_text', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	content: text('content').notNull(),
	origin: text('origin').notNull(), // 'paste' | 'txt' | 'epub' | 'srt' | 'image'
	createdAt: integer('created_at').notNull(),
	lastOpenedAt: integer('last_opened_at'),
	/** Lector: índice de la frase donde se dejó la lectura (viaja con la exportación y la sincronización). */
	position: integer('position'),
	/** Lector: marcadores (frase + nota opcional). */
	bookmarks: json<{ sentence: number; note: string; at: number }[]>('bookmarks')
});

export const readingLog = sqliteTable(
	'reading_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		textKind: text('text_kind').$type<'graded' | 'library' | 'speed'>().notNull(),
		textId: integer('text_id').notNull(),
		chars: integer('chars').notNull(),
		durationMs: integer('duration_ms').notNull(),
		cpm: real('cpm').notNull(),
		furigana: text('furigana').notNull(), // modo de furigana durante la lectura
		comprehension: real('comprehension'), // 0..1 si hubo preguntas
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('reading_log_text').on(t.textKind, t.textId), index('reading_log_time').on(t.createdAt)]
);

/** Ítems priorizados para las próximas lecciones (p. ej. el plan de un texto de la biblioteca). */
export const studyQueue = sqliteTable(
	'study_queue',
	{
		itemType: text('item_type').$type<ItemType>().notNull(),
		itemKey: text('item_key').notNull(),
		sourceTextId: integer('source_text_id'),
		addedAt: integer('added_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.itemType, t.itemKey] })]
);

// ---------- Informes semanales ----------

export const weeklyReport = sqliteTable('weekly_report', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	weekStart: integer('week_start').notNull(),
	metrics: json<Record<string, unknown>>('metrics').notNull(),
	text: text('text').notNull(),
	createdAt: integer('created_at').notNull()
});

// ---------- Uso y costo de Gemini ----------

/** Una fila por llamada a Gemini (cada vuelta del bucle del tutor cuenta como una). */
export const geminiUsage = sqliteTable(
	'gemini_usage',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		at: integer('at').notNull(),
		model: text('model').notNull(),
		/** Para qué se usó (ver FEATURES en gemini/usage.ts). */
		feature: text('feature').notNull(),
		sessionId: integer('session_id'),
		/** Entrada total (incluye la cacheada y las imágenes). */
		promptTokens: integer('prompt_tokens').notNull().default(0),
		cachedTokens: integer('cached_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		thoughtsTokens: integer('thoughts_tokens').notNull().default(0),
		toolPromptTokens: integer('tool_prompt_tokens').notNull().default(0),
		/** Parte de la entrada que fueron imágenes (informativo; ya está en promptTokens). */
		imageTokens: integer('image_tokens').notNull().default(0),
		/** Costo con el precio vigente al hacer la llamada; null = modelo sin precio. */
		costUsd: real('cost_usd'),
		ok: integer('ok', { mode: 'boolean' }).notNull().default(true)
	},
	(t) => [index('gemini_usage_at').on(t.at), index('gemini_usage_session').on(t.sessionId)]
);

// ---------- Config ----------

export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
