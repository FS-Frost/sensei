// Herramientas (function calling) del tutor: consultas, interfaz (bloques en el chat) y acciones (ver actions.ts).
import type { FunctionDeclaration } from '@google/genai';
import { desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { InfoCard, Quiz, QuizQuestion, UiBlock } from '../../types.ts';
import { getKanjiInfo, getVocabInfo, itemStatuses, knownKanji, lookupInflected, similarTo } from '../items.ts';
import { buildProfile } from '../profile.ts';
import { buildReviewItem, dueCards, logAnswer } from '../srs/service.ts';
import { isKanjiChar, kanjiIn } from '../../jp.ts';
import { GRAMMAR, GRAMMAR_BY_ID } from '../../grammar.ts';
import { journey, nextSteps } from '../guide.ts';
import { lessonQuota, knownGrammar, unlockedGrammar } from '../srs/lessons.ts';
import { latestReport, weekMetrics } from '../report.ts';
import { readsOf, speedHistory } from '../text/library.ts';
import { analyzeText } from '../text/analyze.ts';
import { ACTION_LABELS, actionDeclarations, ACTIONS, invokeAction, resolveItem } from './actions.ts';

export const PRESENT_QUIZ = 'present_quiz';

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required });

/** Destinos permitidos para show_links (nunca URLs arbitrarias). */
export const DESTINATIONS: Record<string, { label: string; href: (p?: string) => string }> = {
	inicio: { label: 'Inicio', href: () => '/' },
	repaso: { label: 'Ir a repaso', href: () => '/repaso' },
	leccion: { label: 'Empezar lección', href: () => '/leccion' },
	leccion_gramatica: { label: 'Lección de gramática', href: () => '/leccion?kind=grammar' },
	biblioteca: { label: 'Biblioteca', href: () => '/biblioteca' },
	biblioteca_texto: { label: 'Abrir texto', href: (p) => `/biblioteca/${encodeURIComponent(p ?? '')}` },
	lectura: { label: 'Lectura graduada', href: () => '/lectura' },
	lectura_id: { label: 'Abrir lectura', href: (p) => `/lectura?id=${encodeURIComponent(p ?? '')}` },
	explicar: { label: 'Explicador', href: () => '/explicar' },
	velocidad: { label: 'Reto de velocidad', href: () => '/velocidad' },
	informe: { label: 'Informe semanal', href: () => '/informe' },
	kanji: { label: 'Ficha del kanji', href: (p) => `/kanji/${encodeURIComponent(p ?? '')}` },
	mapa_kanji: { label: 'Mapa de kanji', href: () => '/kanji' },
	estadisticas: { label: 'Estadísticas', href: () => '/estadisticas' },
	sanguijuelas: { label: 'Tarjetas que se resisten', href: () => '/estadisticas#sanguijuelas' },
	ajustes: { label: 'Ajustes', href: () => '/ajustes' },
	objetivo: { label: 'Objetivo con fecha', href: () => '/ajustes#objetivo' },
	kana: { label: 'Diagnóstico de kana', href: () => '/kana' },
	nivel: { label: 'Test de nivel', href: () => '/nivel' },
	guia: { label: 'Guía', href: (p) => `/guia${p ? `#${encodeURIComponent(p)}` : ''}` },
	datos: { label: 'Datos y copias', href: () => '/datos' }
};

const queryDeclarations: FunctionDeclaration[] = [
	{
		name: 'get_learner_profile',
		description:
			'Perfil del alumno: progreso por tipo, repasos pendientes, precisión, racha, ítems débiles, confusiones, gramática estudiada, sanguijuelas, notas y resúmenes de sesiones anteriores.',
		parametersJsonSchema: obj()
	},
	{ name: 'get_known_kanji', description: 'Kanji ya aprendidos (significado en repaso), en orden de aprendizaje.', parametersJsonSchema: obj() },
	{
		name: 'get_due_items',
		description: 'Ítems del SRS pendientes de repaso ahora mismo (para practicarlos en conversación).',
		parametersJsonSchema: obj({ limit: { type: 'integer', description: 'máximo (por defecto 10)' } })
	},
	{
		name: 'lookup_dictionary',
		description:
			'Diccionario local (KANJIDIC2/JMdict) con deconjugación (見られなかった → 見る). Kanji suelto: lecturas, significados, componentes, vocabulario. Palabra: entradas. Úsalo SIEMPRE antes de afirmar lecturas o significados.',
		parametersJsonSchema: obj({ query: { type: 'string', description: 'kanji o palabra (conjugada o no)' } }, ['query'])
	},
	{ name: 'get_confusions', description: 'Pares que el alumno confunde (p. ej. 未/末).', parametersJsonSchema: obj() },
	{
		name: 'get_next_steps',
		description: 'Qué le conviene hacer ahora al alumno según Sensei (repasos, lecciones, relecturas, objetivo…), con el porqué, y su posición en la ruta.',
		parametersJsonSchema: obj()
	},
	{
		name: 'get_stats',
		description: 'Cupo de lecciones de hoy, repasos pendientes, precisión, racha y métricas de la semana (retención real por tipo).',
		parametersJsonSchema: obj()
	},
	{ name: 'get_weekly_report', description: 'Último informe semanal (texto y métricas).', parametersJsonSchema: obj() },
	{
		name: 'get_library',
		description: 'Textos de la Biblioteca del alumno. Con `id`: cobertura (palabras/kanji que conoce) y plan de estudio de ese texto.',
		parametersJsonSchema: obj({ id: { type: 'integer' } })
	},
	{ name: 'get_reading_history', description: 'Historial de velocidad de lectura (caracteres/minuto).', parametersJsonSchema: obj() },
	{
		name: 'get_similar_kanji',
		description: 'Kanji visualmente parecidos a uno dado, con si el alumno ya los estudió y cómo distinguirlos.',
		parametersJsonSchema: obj({ kanji: { type: 'string' } }, ['kanji'])
	},
	{
		name: 'get_grammar',
		description:
			'Pista de gramática de Sensei. Con `id`: detalle del punto y si el alumno lo estudió. Sin `id`: puntos estudiados, próximos desbloqueados y catálogo de ids.',
		parametersJsonSchema: obj({ id: { type: 'string' } })
	},
	{
		name: 'search_examples',
		description: 'Frases reales (Tatoeba y las guardadas por el alumno) que contienen una palabra. `only_known`: solo con kanji que el alumno conoce.',
		parametersJsonSchema: obj({ word: { type: 'string' }, only_known: { type: 'boolean' } }, ['word'])
	},
	{
		name: 'analyze_text',
		description: 'Analiza un texto japonés localmente: palabras, lecturas, conjugaciones, cobertura del alumno y palabras que le faltan.',
		parametersJsonSchema: obj({ text: { type: 'string' } }, ['text'])
	},
	{ name: 'get_notes', description: 'Notas guardadas sobre el alumno, con id (para forget_note).', parametersJsonSchema: obj() },
	{ name: 'get_study_queue', description: 'Ítems en cola para las próximas lecciones.', parametersJsonSchema: obj() },
	{
		name: 'record_answer',
		description: 'Registra el resultado de una pregunta hecha en la conversación (no hace falta para present_quiz, que se corrige solo).',
		parametersJsonSchema: obj(
			{ item: { type: 'string' }, correct: { type: 'boolean' }, answer: { type: 'string', description: 'lo que respondió el alumno' } },
			['item', 'correct']
		)
	}
];

const uiDeclarations: FunctionDeclaration[] = [
	{
		name: 'show_card',
		description:
			'Muestra en el chat una ficha interactiva de un kanji, palabra o punto de gramática (lecturas, componentes, parecidos, estado y botón para ponerlo en cola). Úsala al presentar un ítem concreto.',
		parametersJsonSchema: obj({ item: { type: 'string', description: 'kanji, palabra o id/patrón de gramática' } }, ['item'])
	},
	{
		name: 'offer_choices',
		description:
			'Muestra 2-4 botones de respuesta rápida bajo tu mensaje; al pulsar uno, se envía como mensaje del alumno. Úsalo SIEMPRE que hagas una pregunta cerrada o propongas opciones («¿Lo añado a tu próxima lección?» → «Sí, añádelo» / «No, gracias»).',
		parametersJsonSchema: obj({ options: { type: 'array', items: { type: 'string' } } }, ['options'])
	},
	{
		name: 'show_links',
		description: `Botones de navegación dentro de Sensei. Destinos: ${Object.keys(DESTINATIONS).join(', ')} (biblioteca_texto, lectura_id: param=id; kanji: param=kanji; guia: param=sección).`,
		parametersJsonSchema: obj(
			{
				links: {
					type: 'array',
					items: obj(
						{ to: { type: 'string', enum: Object.keys(DESTINATIONS) }, param: { type: 'string' }, label: { type: 'string' } },
						['to']
					)
				}
			},
			['links']
		)
	},
	{
		name: 'show_japanese',
		description:
			'Muestra un texto japonés analizado (furigana adaptativa según lo que el alumno domina, diccionario al tocar, conjugaciones). Úsalo para frases de ejemplo o textos a leer, en vez de escribirlos en el mensaje.',
		parametersJsonSchema: obj({ text: { type: 'string', description: 'japonés sin notación de furigana' }, es: { type: 'string', description: 'traducción (opcional)' } }, ['text'])
	},
	{
		name: PRESENT_QUIZ,
		description:
			'Muestra un quiz interactivo. Tras llamarla, termina tu turno: el resultado llegará con las respuestas del alumno ya corregidas.',
		parametersJsonSchema: obj(
			{
				title: { type: 'string' },
				questions: {
					type: 'array',
					items: obj(
						{
							type: {
								type: 'string',
								enum: ['multiple_choice', 'reading', 'meaning', 'fill_blank'],
								description: 'multiple_choice: elegir; reading: lectura en kana; meaning: significado en español; fill_blank: hueco (＿＿) en kana'
							},
							prompt: { type: 'string', description: 'enunciado en español' },
							jp: { type: 'string', description: 'japonés de la pregunta; {漢字|かんじ} solo si quieres dar furigana' },
							options: { type: 'array', items: { type: 'string' }, description: 'solo multiple_choice: 3-4 opciones' },
							answer: { type: 'string', description: 'respuesta correcta (en multiple_choice, el texto exacto de la opción)' },
							accepted: { type: 'array', items: { type: 'string' } },
							explanation: { type: 'string' },
							item: { type: 'string', description: 'kanji o palabra evaluada' }
						},
						['type', 'prompt', 'answer']
					)
				}
			},
			['title', 'questions']
		)
	}
];

export const toolDeclarations: FunctionDeclaration[] = [...queryDeclarations, ...uiDeclarations, ...actionDeclarations];

export const TOOL_LABELS: Record<string, string> = {
	get_learner_profile: 'Consultando tu perfil',
	get_known_kanji: 'Revisando tus kanji',
	get_due_items: 'Mirando tus repasos',
	lookup_dictionary: 'Buscando en el diccionario',
	get_confusions: 'Revisando confusiones',
	get_next_steps: 'Mirando tu plan',
	get_stats: 'Mirando tus estadísticas',
	get_weekly_report: 'Leyendo tu informe',
	get_library: 'Mirando tu biblioteca',
	get_reading_history: 'Mirando tu velocidad',
	get_similar_kanji: 'Buscando parecidos',
	get_grammar: 'Consultando gramática',
	search_examples: 'Buscando ejemplos',
	analyze_text: 'Analizando el texto',
	get_notes: 'Leyendo tus notas',
	get_study_queue: 'Mirando tu cola',
	record_answer: 'Registrando respuesta',
	show_card: 'Preparando ficha',
	offer_choices: 'Opciones',
	show_links: 'Enlaces',
	show_japanese: 'Preparando texto',
	[PRESENT_QUIZ]: 'Preparando quiz',
	...ACTION_LABELS
};

/** Herramientas cuyo «chip ⚙» no se muestra (su resultado ya se ve como bloque propio). */
export const SILENT_TOOLS = new Set(['offer_choices', 'show_links', 'show_card', 'show_japanese', ...Object.keys(ACTIONS)]);

export function normalizeQuiz(args: Record<string, unknown>, id?: string): Quiz {
	const qs = Array.isArray(args.questions) ? (args.questions as Partial<QuizQuestion>[]) : [];
	return {
		id: id || crypto.randomUUID(),
		title: String(args.title ?? 'Quiz'),
		questions: qs.slice(0, 15).map((q, i) => ({
			id: String(i),
			type: (['multiple_choice', 'reading', 'meaning', 'fill_blank'].includes(q.type as string)
				? q.type
				: 'meaning') as QuizQuestion['type'],
			prompt: String(q.prompt ?? ''),
			jp: q.jp ? String(q.jp) : undefined,
			options: Array.isArray(q.options) ? q.options.map(String) : undefined,
			answer: String(q.answer ?? ''),
			accepted: Array.isArray(q.accepted) ? q.accepted.map(String) : undefined,
			explanation: q.explanation ? String(q.explanation) : undefined,
			item: q.item ? String(q.item) : undefined
		}))
	};
}

/** Construye la ficha de un ítem para el chat. */
export function infoCard(db: DB, raw: string): InfoCard | null {
	const it = resolveItem(db, raw);
	if (!it) return null;
	if (it.type === 'kanji') {
		const k = getKanjiInfo(db, it.key, { vocabLimit: 4 });
		return k ? { kind: 'kanji', kanji: k, similar: similarTo(db, it.key, { limit: 3 }) } : null;
	}
	if (it.type === 'grammar') {
		const g = GRAMMAR_BY_ID.get(it.key)!;
		return { kind: 'grammar', grammar: g, status: itemStatuses(db, 'grammar', [g.id]).get(g.id) ?? 'none' };
	}
	if (it.type === 'vocab') {
		const w = getVocabInfo(db, it.key, true);
		return w ? { kind: 'word', word: w } : null;
	}
	return null;
}

export type ToolContext = { sessionId: number };
export type ToolOutcome = { response: Record<string, unknown>; ui?: UiBlock };

export async function executeTool(db: DB, ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
	if (ACTIONS[name]) return invokeAction(db, ctx.sessionId, name, args);
	switch (name) {
		case 'get_learner_profile':
			return { response: buildProfile(db) as unknown as Record<string, unknown> };
		case 'get_known_kanji': {
			const k = knownKanji(db);
			return { response: { count: k.length, kanji: k.join('') } };
		}
		case 'get_due_items': {
			const limit = Math.min(30, Number(args.limit ?? 10) || 10);
			return {
				response: {
					items: dueCards(db, Date.now(), limit).map((c) => {
						const it = buildReviewItem(db, c);
						return { prompt: it.prompt, kind: it.label, answers: it.answers };
					})
				}
			};
		}
		case 'lookup_dictionary': {
			const q = String(args.query ?? '').trim();
			if (!q) return { response: { error: 'query vacío' } };
			const out: Record<string, unknown> = {};
			if ([...q].length === 1 && isKanjiChar(q)) {
				const k = getKanjiInfo(db, q, { vocabLimit: 6 });
				if (k)
					out.kanji = {
						char: k.char,
						meanings_es: k.meaningsEs,
						meanings_en: k.meaningsEn,
						on: k.onReadings,
						kun: k.kunReadings,
						components: k.components.map((c) => `${c.symbol}${c.nameEs ? `(${c.nameEs})` : ''}`),
						vocab: k.vocab.map((v) => `${v.mainForm}【${v.mainReading}】${(v.glossesEs ?? v.glossesEn).slice(0, 2).join('; ')}`),
						student_status: k.status
					};
			}
			const words = lookupInflected(db, q, 5);
			if (words.length)
				out.words = words.map((w) => ({
					form: w.mainForm,
					inflection: w.inflection?.reasons,
					readings: w.kanaForms,
					meanings_es: w.glossesEs,
					meanings_en: w.glossesEn.slice(0, 4),
					common: w.common
				}));
			if (!out.kanji && !out.words) {
				out.not_found = true;
				out.kanji_in_query = kanjiIn(q)
					.slice(0, 6)
					.map((c) => getKanjiInfo(db, c, { vocabLimit: 0 }))
					.filter(Boolean)
					.map((k) => ({ char: k!.char, meanings_es: k!.meaningsEs, on: k!.onReadings, kun: k!.kunReadings }));
			}
			return { response: out };
		}
		case 'get_confusions':
			return { response: { confusions: buildProfile(db).confusions } };
		case 'get_next_steps': {
			const j = journey(db);
			return {
				response: {
					steps: nextSteps(db).map((x) => ({ title: x.title, why: x.why, href: x.href })),
					known_kanji: j.known,
					current_milestone: j.current?.title ?? null,
					next_milestone: j.next ? { title: j.next.title, kanji: j.next.kanji, unlocks: j.next.unlocks } : null,
					goal: j.goal
				}
			};
		}
		case 'get_stats': {
			const p = buildProfile(db);
			return { response: { quota: lessonQuota(db), due: p.due, accuracy7d: p.accuracy7d, streak: p.streakDays, counts: p.counts, week: weekMetrics(db) } };
		}
		case 'get_weekly_report': {
			const r = latestReport(db);
			return { response: r ? { date: new Date(r.weekStart).toISOString().slice(0, 10), text: r.text } : { none: true } };
		}
		case 'get_library': {
			if (args.id !== undefined) {
				const t = db.select().from(s.libraryText).where(eq(s.libraryText.id, Number(args.id))).get();
				if (!t) return { response: { error: 'texto no encontrado' } };
				const { stats } = analyzeText(db, t.content);
				return {
					response: {
						title: t.title,
						chars: stats.chars,
						word_coverage: Math.round(stats.wordCoverage * 100),
						kanji_coverage: Math.round(stats.kanjiCoverage * 100),
						top_unknown_words: stats.unknownWords.slice(0, 12).map((w) => `${w.form}【${w.reading}】${w.gloss} ×${w.count}`),
						unknown_kanji: stats.unknownKanji.slice(0, 20).map((k) => k.char).join(''),
						plan_coverage_after: Math.round(stats.plan.coverageAfter * 100),
						reads: readsOf(db, 'library', t.id).map((r) => Math.round(r.cpm))
					}
				};
			}
			const rows = db
				.select({ id: s.libraryText.id, title: s.libraryText.title, c: sql<number>`length(${s.libraryText.content})` })
				.from(s.libraryText)
				.orderBy(desc(s.libraryText.createdAt))
				.limit(30)
				.all();
			return { response: { texts: rows.map((r) => ({ id: r.id, title: r.title, chars: r.c })) } };
		}
		case 'get_reading_history':
			return {
				response: {
					reads: speedHistory(db, 20).map((r) => ({ cpm: Math.round(r.cpm), kind: r.textKind, date: new Date(r.createdAt).toISOString().slice(0, 10) }))
				}
			};
		case 'get_similar_kanji':
			return { response: { similar: similarTo(db, String(args.kanji ?? ''), { limit: 6 }) } };
		case 'get_grammar': {
			if (args.id) {
				const g = resolveItem(db, args.id);
				const p = g?.type === 'grammar' ? GRAMMAR_BY_ID.get(g.key) : undefined;
				if (!p) return { response: { error: 'punto no encontrado' } };
				return { response: { ...p, studied: itemStatuses(db, 'grammar', [p.id]).get(p.id) } };
			}
			return {
				response: {
					studied: knownGrammar(db).map((g) => `${g.id}=${g.pattern}`),
					next_unlocked: unlockedGrammar(db, 5).map((g) => `${g.id}=${g.pattern} (${g.meaning})`),
					catalog: GRAMMAR.map((g) => `${g.id}=${g.pattern}`).join('; ')
				}
			};
		}
		case 'search_examples': {
			const word = String(args.word ?? '').trim();
			if (!word) return { response: { error: 'falta word' } };
			const known = new Set(knownKanji(db));
			const rows = db.all<{ jp: string; es: string | null; en: string | null }>(sql`
				select jp, es, null as en from mined_sentence where instr(jp, ${word}) > 0
				union all
				select jp, es, en from sentence where instr(jp, ${word}) > 0
				limit 200
			`);
			const filtered = rows.filter((r) => !args.only_known || kanjiIn(r.jp).every((k) => known.has(k) || word.includes(k)));
			return { response: { examples: filtered.slice(0, 6).map((r) => ({ jp: r.jp, es: r.es ?? r.en })) } };
		}
		case 'analyze_text': {
			const text = String(args.text ?? '').slice(0, 4000);
			const { tokens, stats } = analyzeText(db, text);
			return {
				response: {
					words: tokens.filter((t) => t.id).slice(0, 60).map((t) => `${t.s}${t.r ? `【${t.r}】` : ''}${t.x ? `<${t.b}:${t.x.join('+')}>` : ''}=${t.g ?? ''}`),
					word_coverage: Math.round(stats.wordCoverage * 100),
					kanji_coverage: Math.round(stats.kanjiCoverage * 100),
					unknown_words: stats.unknownWords.slice(0, 10).map((w) => `${w.form}【${w.reading}】`)
				}
			};
		}
		case 'get_notes':
			return {
				response: {
					notes: db
						.select()
						.from(s.learnerNote)
						.orderBy(desc(s.learnerNote.createdAt))
						.limit(30)
						.all()
						.map((n) => ({ id: n.id, note: n.note }))
				}
			};
		case 'get_study_queue':
			return {
				response: {
					queue: db
						.select({ t: s.studyQueue.itemType, k: s.studyQueue.itemKey })
						.from(s.studyQueue)
						.all()
						.map((q) => `${q.t}:${q.k}`)
				}
			};
		case 'record_answer': {
			const it = resolveItem(db, args.item);
			logAnswer(db, (it?.type as 'kanji' | 'vocab') ?? 'vocab', it?.key ?? String(args.item ?? ''), !!args.correct, args.answer ? String(args.answer) : null, 'quiz');
			return { response: { ok: true } };
		}
		// ---------- Interfaz ----------
		case 'show_card': {
			const card = infoCard(db, String(args.item ?? ''));
			if (!card) return { response: { error: 'No encontrado en el diccionario ni en la gramática' } };
			return { response: { shown: true }, ui: { type: 'card', card } };
		}
		case 'offer_choices': {
			const options = (Array.isArray(args.options) ? args.options : []).map(String).filter(Boolean).slice(0, 4);
			if (!options.length) return { response: { error: 'sin opciones' } };
			return { response: { shown: true }, ui: { type: 'choices', options } };
		}
		case 'show_links': {
			const links = (Array.isArray(args.links) ? (args.links as { to?: string; param?: string; label?: string }[]) : [])
				.filter((l) => l.to && DESTINATIONS[l.to])
				.slice(0, 4)
				.map((l) => ({ href: DESTINATIONS[l.to!].href(l.param), label: (l.label || DESTINATIONS[l.to!].label).slice(0, 60) }));
			if (!links.length) return { response: { error: 'destinos inválidos' } };
			return { response: { shown: true }, ui: { type: 'links', links } };
		}
		case 'show_japanese': {
			const text = String(args.text ?? '').replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1').slice(0, 2000);
			if (!text.trim()) return { response: { error: 'texto vacío' } };
			const { tokens } = analyzeText(db, text);
			return { response: { shown: true }, ui: { type: 'jptext', tokens, es: args.es ? String(args.es) : undefined } };
		}
		default:
			return { response: { error: `Herramienta desconocida: ${name}` } };
	}
}
