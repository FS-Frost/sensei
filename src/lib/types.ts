// Tipos compartidos cliente/servidor.

export type ItemType = 'kana' | 'component' | 'kanji' | 'vocab' | 'grammar' | 'sentence';
/** `writing`: trazar el kanji (opcional; no cuenta para el estado del ítem). */
export type Facet = 'meaning' | 'reading' | 'writing';

/**
 * Cómo se responde: romaji puro (kana), romaji→kana en vivo (lecturas), español (significados),
 * elegir entre opciones (gramática) o trazar el kanji (escritura).
 */
export type AnswerMode = 'romaji' | 'kana' | 'meaning' | 'choice' | 'trace';

/** Cómo respondió el alumno de verdad (se guarda en `review_log.via`): las opciones son reconocer, no recordar. */
export type AnswerVia = 'typed' | 'choice' | 'voice' | 'trace';

/** Forma de responder por defecto en los repasos (si el ítem admite ambas; se cambia en la propia sesión). */
export type AnswerStyle = 'choice' | 'typed';

/** Fuente con la que se muestra el enunciado (variedad para reconocer kanji en manga, juegos, carteles). */
export type PromptFont = 'gothic' | 'mincho' | 'kyokasho' | 'maru' | 'brush' | 'manga';

export type ReviewItem = {
	cardId: number | null;
	itemType: ItemType;
	itemKey: string;
	facet: Facet;
	prompt: string;
	answerMode: AnswerMode;
	/** Etiqueta de la pregunta, p. ej. "Kanji · significado". */
	label: string;
	/** Respuestas correctas para mostrar tras responder. */
	answers: string[];
	/**
	 * Opciones (la correcta y 3 distractores). Con answerMode 'choice' son la única forma de responder; en el resto, una
	 * alternativa a escribir (ausentes si no hay distractores que no sean también correctos).
	 */
	options?: string[];
	/** Frases: la palabra objetivo dentro del enunciado (se resalta). */
	highlight?: string;
	font?: PromptFont;
	extra?: {
		reading?: string;
		meaning?: string;
		mnemonic?: string | null;
		/** Frase de ejemplo (contexto) que se muestra tras responder. */
		example?: { jp: string; es: string | null } | null;
		/** Explicación (gramática). */
		explanation?: string;
		/** Kanji parecidos ya estudiados (con cómo distinguirlos). */
		similar?: { char: string; tip: string | null }[];
	};
};

export type GradeResult = {
	correct: boolean;
	/** Tarjeta con muchos fallos acumulados (se ofrece tratamiento especial). */
	leech?: boolean;
	answers: string[];
	/** Si la respuesta coincide con otro ítem (confusión), cuál. */
	confusedWith?: string | null;
	/** Lectura válida pero no la que se pedía (p. ej. kun en vez de on en vocabulario). */
	nearMiss?: boolean;
	/** Respuesta por voz: la alternativa del reconocedor que se tomó como respuesta. */
	heard?: string;
	/** Respuesta por voz: el alumno dijo «no sé». */
	gaveUp?: boolean;
};

export type KanjiInfo = {
	char: string;
	meaningsEs: string[];
	meaningsEn: string[];
	onReadings: string[];
	kunReadings: string[];
	strokes: number | null;
	grade: number | null;
	freq: number | null;
	jlpt: number | null;
	learnOrder: number | null;
	mnemonicMeaning: string | null;
	mnemonicReading: string | null;
	components: { symbol: string; nameEs: string | null; isKanji: boolean }[];
	usedIn: string[];
	vocab: VocabInfo[];
	status: ItemStatus;
};

export type VocabInfo = {
	id: string;
	mainForm: string;
	mainReading: string;
	kanjiForms: string[];
	kanaForms: string[];
	common: boolean;
	pos: string[];
	glossesEs: string[] | null;
	glossesEn: string[];
	status?: ItemStatus;
	sentences?: { jp: string; en: string | null; es: string | null }[];
	/** Si se encontró deconjugando: la forma buscada y las transformaciones (p. ej. ['pasiva', 'pasado']). */
	inflection?: { surface: string; reasons: string[] };
};

/** Explicación de un componente (Gemini o pregenerada): qué dibuja, por qué el nombre y cómo actúa en los kanji. */
export type ComponentExplanation = {
	/** Qué representa el dibujo y de dónde viene. */
	depicts: string;
	/** Por qué el nombre tiene sentido. */
	why: string;
	/** Su papel en los kanji: pista de significado, de sonido o solo de forma. */
	role: string;
	/** Kanji de ejemplo donde se ve por qué tiene sentido. */
	examples: { char: string; note: string }[];
	/** Gancho corto para usarlo en mnemotecnias. */
	hook: string;
};

export type ComponentInfo = {
	symbol: string;
	nameEs: string | null;
	strokes: number | null;
	usedIn: string[];
	/** Kanji del que es variante (氵 → 水), si lo hay. */
	fullForm: { char: string; meaning: string | null } | null;
	explanation: ComponentExplanation | null;
	/** Ejemplos útiles: primero los kanji que ya estudias, luego los próximos de la ruta. */
	examples: { char: string; meaning: string; status: ItemStatus }[];
	/** Kanji cercanos en la ruta que no lo llevan (para «¿en cuál aparece?»). */
	distractors: string[];
};

/** Estado de aprendizaje de un ítem: none (sin tarjeta), learning, review, mastered. */
export type ItemStatus = 'none' | 'learning' | 'review' | 'mastered';

/** Token de texto japonés generado (lectura graduada / explicador). */
export type JpToken = {
	s: string; // superficie
	r?: string; // lectura en hiragana (solo si hay kanji)
	b?: string; // forma base
	g?: string; // glosa breve en español
	p?: string; // categoría gramatical
	/** Validado contra el diccionario: true = coincide, false = no coincide, undefined = sin datos. */
	v?: boolean;
	/** El lector ya domina sus kanji: ocultar furigana en modo adaptativo. */
	k?: boolean;
	/** id de vocabulario (análisis local). */
	id?: string;
	/** Conjugación detectada (p. ej. ['pasiva', 'pasado']). */
	x?: string[];
};

export type TextStats = {
	chars: number;
	words: number;
	/** Palabras con kanji o katakana (las que «cuestan»). */
	contentWords: number;
	/** % de palabras de contenido cuyo vocabulario está en repaso/dominado. */
	wordCoverage: number;
	/** % de apariciones de kanji cuyo significado conoces. */
	kanjiCoverage: number;
	unknownWords: { id: string; form: string; reading: string; gloss: string; count: number; common: boolean; kanji: string[]; status: ItemStatus }[];
	unknownKanji: { char: string; count: number; meaning: string; learnOrder: number | null }[];
	/** Palabras propuestas para estudiar antes de leer y cobertura resultante. */
	plan: { words: string[]; kanji: string[]; coverageAfter: number };
};

export type GrammarPoint = {
	id: string;
	pattern: string;
	meaning: string;
	explanation: string;
	examples: { jp: string; es: string }[];
	level: number;
	/** Kanji aprendidos necesarios para desbloquearlo. */
	unlockAt: number;
};

export type SimilarInfo = { char: string; meaning: string; tip: string | null; status: ItemStatus };

/** Ficha de un kana para su lección (contenido fijo de kanaCourse.ts). */
export type KanaInfo = {
	char: string;
	romaji: string;
	script: 'hiragana' | 'katakana';
	/** Título de su fila («Fila か (ka)»). */
	row: string;
	group: 'basic' | 'dakuten' | 'yoon' | 'special' | 'extended';
	mnemonic: string | null;
	/** «か + ゛», «き + ゃ pequeña» para los derivados. */
	formation: string | null;
	example: { word: string; es: string } | null;
	similar: { char: string; tip: string }[];
	/** Regla del grupo (dakuten, combinados…), con el primer kana de la fila. */
	rule: string | null;
	/** Se puede practicar el trazo (un solo carácter con datos de KanjiVG). */
	traceable: boolean;
	status: ItemStatus;
};

export type LessonItem =
	| { type: 'kana'; key: string; kana: KanaInfo }
	| { type: 'component'; key: string; component: ComponentInfo }
	| { type: 'kanji'; key: string; kanji: KanjiInfo; similar: SimilarInfo[] }
	| { type: 'vocab'; key: string; vocab: VocabInfo }
	| { type: 'grammar'; key: string; grammar: GrammarPoint };

// ---------- Quizzes del tutor ----------

export type QuizQuestion = {
	id: string;
	type: 'multiple_choice' | 'reading' | 'meaning' | 'fill_blank';
	prompt: string;
	/** Texto japonés de apoyo (puede usar {漢字|かんじ} para furigana). */
	jp?: string;
	options?: string[];
	answer: string;
	accepted?: string[];
	explanation?: string;
	item?: string;
};

export type Quiz = { id: string; title: string; questions: QuizQuestion[] };

export type QuizAnswer = { id: string; answer: string; correct: boolean };

export type ActionStatus = 'done' | 'undone' | 'proposed' | 'confirmed' | 'rejected' | 'failed';

/** Tarjeta informativa que el tutor muestra en el chat. */
export type InfoCard =
	| { kind: 'kanji'; kanji: KanjiInfo; similar: SimilarInfo[] }
	| { kind: 'word'; word: VocabInfo }
	| { kind: 'grammar'; grammar: GrammarPoint; status: ItemStatus };

export type UiBlock =
	| { type: 'text'; text: string }
	| { type: 'quiz'; quiz: Quiz; answers?: QuizAnswer[] }
	| { type: 'tool'; name: string; label: string }
	| { type: 'image'; mimeType: string }
	/** Mensaje de voz del alumno (el audio no se guarda en la UI; sí lo que el tutor entendió). */
	| { type: 'audio'; seconds: number; transcript?: string }
	/** Respuestas de herramientas retenidas hasta que el usuario responda el quiz (no se muestra). */
	| { type: 'pending'; parts: unknown[] }
	/** Acción del tutor: comprobante (directa, con deshacer) o propuesta (con confirmar/rechazar). */
	| { type: 'action'; actionId: number; name: string; label: string; kind: 'direct' | 'confirm'; status: ActionStatus }
	| { type: 'card'; card: InfoCard }
	/** Respuestas rápidas: al pulsar una se envía como mensaje. */
	| { type: 'choices'; options: string[] }
	/** Enlaces de navegación dentro de la app. */
	| { type: 'links'; links: { href: string; label: string }[] }
	/** Texto japonés analizado localmente (furigana adaptativa + diccionario al tacto). */
	| { type: 'jptext'; tokens: JpToken[]; es?: string }
	/** Contexto de pantalla adjuntado por el alumno. */
	| { type: 'context'; label: string };

/** Lo que el alumno está viendo cuando abre el tutor (se adjunta como contexto visible). */
export type ScreenContext = {
	kind: 'kanji' | 'component' | 'word' | 'review' | 'lesson' | 'library' | 'reading' | 'explain' | 'page' | 'daily';
	label: string;
	/** Datos concretos para el modelo (se serializan en el mensaje). */
	data: Record<string, unknown>;
};

export type FuriganaMode = 'adaptive' | 'always' | 'never';

/** `cierre`: cierre de la sesión diaria (/hoy); no aparece en la lista de modos del tutor. */
export type ChatMode = 'conversacion' | 'quiz' | 'explicador' | 'confusiones' | 'libre' | 'cierre';
