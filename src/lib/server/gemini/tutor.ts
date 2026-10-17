// Tutor conversacional: sesiones, historial, bucle de function calling con streaming y memoria.
import type { Content, GenerateContentResponseUsageMetadata, Part } from '@google/genai';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ChatMode, Quiz, QuizAnswer, ScreenContext, UiBlock } from '../../types.ts';
import { meaningMatches, normalizeReading, readingMatches } from '../../jp.ts';
import { buildProfile } from '../profile.ts';
import { logAnswer } from '../srs/service.ts';
import { lookupWord } from '../items.ts';
import { nextSteps } from '../guide.ts';
import { ai, GeminiUnavailableError, generateText, isTransient, models } from './client.ts';
import { assertBudget, recordUsage } from './usage.ts';
import { executeTool, normalizeQuiz, PRESENT_QUIZ, SILENT_TOOLS, TOOL_LABELS, toolDeclarations } from './tools.ts';
import { ActionError, pendingReports } from './actions.ts';

const MAX_STEPS = 6;
const RETRY_DELAYS = [1500, 4000];

export const MODE_LABELS: Record<ChatMode, string> = {
	conversacion: 'Conversación-quiz',
	quiz: 'Quiz a medida',
	explicador: 'Explicador',
	confusiones: 'Detective de confusiones',
	libre: 'Libre'
};

const MODE_PROMPTS: Record<ChatMode, string> = {
	conversacion:
		'MODO CONVERSACIÓN-QUIZ: lleva la iniciativa. Haz UNA pregunta por turno sobre kanji, vocabulario o lectura de frases cortas, ' +
		'adaptada a su nivel (consulta su perfil y sus kanji conocidos al empezar). Espera la respuesta, corrige con una explicación breve ' +
		'y sube o baja la dificultad. Alterna preguntas abiertas en el chat con present_quiz (2-4 preguntas) de vez en cuando. ' +
		'Prioriza sus ítems débiles y repasos pendientes.',
	quiz:
		'MODO QUIZ A MEDIDA: el alumno pide un quiz sobre un tema. Usa get_known_kanji y lookup_dictionary para construirlo con material real ' +
		'y llama a present_quiz con 5-10 preguntas variadas (mezcla tipos). Tras recibir los resultados, comenta los errores y ofrece otro.',
	explicador:
		'MODO EXPLICADOR: el alumno pega frases japonesas (de manga, juegos, carteles…). Desglósalas: palabra por palabra con furigana, ' +
		'forma base, función gramatical y traducción natural. Verifica lecturas con lookup_dictionary. Ofrece añadir palabras útiles al SRS.',
	confusiones:
		'MODO DETECTIVE DE CONFUSIONES: llama a get_confusions. Para cada par, explica en qué se diferencian (componentes, forma, ' +
		'significado) y prepara ejercicios de discriminación con present_quiz que mezclen ambos. Si no hay confusiones registradas, ' +
		'propón pares típicos para su nivel (p. ej. 未/末, 土/士, 人/入).',
	libre: 'MODO LIBRE: responde a lo que pida el alumno como tutor experto de lectura en japonés.'
};

export function systemPrompt(db: DB, mode: ChatMode): string {
	const p = buildProfile(db);
	const counts = Object.entries(p.counts)
		.map(([t, c]) => `${t}: ${c.learning} aprendiendo, ${c.review} en repaso, ${c.mastered} dominados`)
		.join('; ');
	const steps = nextSteps(db).slice(0, 3);
	return [
		'Eres «Sensei», tutor de japonés para un hispanohablante cuyo objetivo es LEER japonés (manga/anime, novelas, vida real, webs y videojuegos). No necesita hablarlo.',
		'Eres el guía de TODA la app: conoces su progreso, su plan, su biblioteca y puedes actuar sobre sus datos con herramientas.',
		'',
		'Formato:',
		'- Escribe siempre en español. El japonés va en kanji/kana, NUNCA en romaji.',
		'- Furigana: SOLO con la notación {漢字|かな} (llaves, kanji, barra vertical, lectura). Nunca uses llaves sin barra. Para citar una lectura suelta usa 「にち」.',
		'- Para frases o textos japoneses a leer, prefiere show_japanese (furigana adaptativa y diccionario al tocar).',
		'- Al presentar un kanji, palabra o punto de gramática concreto, usa show_card.',
		'- Sé breve y concreto; Markdown sencillo. En listas numeradas no repitas «1.»: numera 1, 2, 3.',
		'- No inventes lecturas ni significados: verifica con lookup_dictionary.',
		'',
		'Acciones (muy importante):',
		'- NUNCA preguntes «¿quieres que haga X?» sin darle una forma de responder: o usas offer_choices con las opciones, o directamente actúas.',
		'- Si el alumno pide algo reversible (aprender/añadir algo, guardar una frase o un texto, recordar u olvidar algo), HAZLO con la herramienta: verá un comprobante con «Deshacer».',
		'- Para «añadir»/«aprender» algo que aún no estudió, usa queue_for_lesson (se enseña en la próxima lección, que es lo correcto). add_to_srs solo si pide repasarlo ya.',
		'- Cambiar el ritmo, crear/quitar objetivo, apartar una tarjeta, nueva mnemotecnia o reiniciar un ítem son PROPUESTAS: llama a la herramienta y explica por qué; el alumno confirma con un botón. No digas que ya está hecho.',
		'- Los mensajes «[Sistema: …]» te informan de lo que el alumno confirmó, rechazó o deshizo. Tenlo en cuenta.',
		'- Los mensajes con «[Contexto de pantalla: …]» indican lo que el alumno está mirando en la app ahora mismo: responde sobre eso.',
		'- Para llevarle a otra parte de la app (lección, repaso, un texto…), usa show_links.',
		'- No puedes reiniciar todo, importar, restaurar copias ni borrar sesiones: si lo pide, indícale la página Datos con show_links.',
		'',
		MODE_PROMPTS[mode],
		'',
		'Estado actual del alumno:',
		`- Progreso: ${counts || 'aún sin tarjetas'}`,
		`- Repasos pendientes: ${p.due}; precisión 7 días: ${p.accuracy7d ?? '—'}%; racha: ${p.streakDays} días`,
		steps.length ? `- Siguiente paso recomendado por Sensei: ${steps.map((x) => x.title).join(' · ')}` : '',
		p.weakItems.length ? `- Ítems débiles: ${p.weakItems.map((w) => w.display).join(' ')}` : '',
		p.confusions.length ? `- Confusiones: ${p.confusions.map((c) => `${c.a}/${c.b}`).join(' ')}` : '',
		p.grammar.length
			? `- Gramática estudiada: ${p.grammar.join(', ')}. Úsala en tus frases y no des por sabida otra más avanzada sin explicarla.`
			: '- Aún no ha estudiado gramática: frases muy simples.',
		p.leeches.length ? `- Ítems que se le resisten (trátalos con mnemotecnias nuevas o contrastes): ${p.leeches.join(' ')}` : '',
		p.notes.length ? `- Notas sobre el alumno:\n${p.notes.map((n) => `  · ${n}`).join('\n')}` : '',
		p.recentSummaries.length ? `- Resúmenes de sesiones anteriores:\n${p.recentSummaries.map((x) => `  · ${x}`).join('\n')}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

// ---------- Sesiones ----------

/**
 * Crea una sesión. Solo se llama al enviar el PRIMER mensaje (no se guardan sesiones vacías).
 */
export function createSession(db: DB, mode: ChatMode, origin: 'page' | 'panel' = 'page') {
	const now = Date.now();
	return db
		.insert(s.session)
		.values({ mode, title: MODE_LABELS[mode], titleSource: null, origin, startedAt: now, lastAt: now })
		.returning()
		.get();
}

export type SessionRow = Omit<typeof s.session.$inferSelect, 'mode'> & { mode: ChatMode; messages: number; costUsd: number };

/** Sesiones con nº de mensajes visibles y costo acumulado. Las vacías no se listan (no deberían existir). */
export function listSessions(db: DB, limit = 200): SessionRow[] {
	return db.all<SessionRow>(sql`
		select s.id, s.mode, s.title, s.title_source as titleSource, s.origin, s.started_at as startedAt,
			s.last_at as lastAt, s.summarized,
			(select count(*) from message m where m.session_id = s.id and m.ui != '[]') as messages,
			(select coalesce(sum(u.cost_usd), 0) from gemini_usage u where u.session_id = s.id) as costUsd
		from session s
		where exists (select 1 from message m where m.session_id = s.id)
		order by s.last_at desc limit ${limit}
	`).map((r) => ({ ...r, summarized: !!r.summarized }));
}

export function renameSession(db: DB, id: number, title: string) {
	const t = title.trim().slice(0, 120);
	if (!t) throw new Error('Título vacío');
	db.update(s.session).set({ title: t, titleSource: 'user' }).where(eq(s.session.id, id)).run();
}

export function deleteSession(db: DB, id: number) {
	db.transaction((tx) => {
		tx.delete(s.message).where(eq(s.message.sessionId, id)).run();
		tx.delete(s.sessionSummary).where(eq(s.sessionSummary.sessionId, id)).run();
		tx.delete(s.tutorAction).where(eq(s.tutorAction.sessionId, id)).run();
		tx.delete(s.session).where(eq(s.session.id, id)).run();
	});
}

/** Sesión del panel lateral a continuar: la última del panel con actividad en las últimas 3 h. */
export const PANEL_CONTINUE_MS = 3 * 3_600_000;
export function panelSession(db: DB, now = Date.now()) {
	return (
		db
			.select()
			.from(s.session)
			.where(and(eq(s.session.origin, 'panel'), sql`${s.session.lastAt} >= ${now - PANEL_CONTINUE_MS}`))
			.orderBy(desc(s.session.lastAt))
			.limit(1)
			.get() ?? null
	);
}

function autoTitle(text: string) {
	const t = text.replace(/\s+/g, ' ').trim();
	return t.length > 70 ? `${t.slice(0, 68)}…` : t;
}

export function getSessionMessages(db: DB, sessionId: number) {
	return db.select().from(s.message).where(eq(s.message.sessionId, sessionId)).orderBy(asc(s.message.id)).all();
}

function saveMessage(db: DB, sessionId: number, role: 'user' | 'model', parts: Part[], ui: UiBlock[]) {
	const row = db
		.insert(s.message)
		.values({ sessionId, role, parts, ui, createdAt: Date.now() })
		.returning({ id: s.message.id })
		.get();
	// Mensajes nuevos: el resumen (si lo había) queda desactualizado.
	db.update(s.session).set({ lastAt: Date.now(), summarized: false }).where(eq(s.session.id, sessionId)).run();
	return row.id;
}

/** Une partes de texto consecutivas sin firma (reduce el historial sin tocar thoughtSignature). */
function compactParts(parts: Part[]): Part[] {
	const out: Part[] = [];
	for (const p of parts) {
		const prev = out[out.length - 1];
		const plain = (x: Part) => typeof x.text === 'string' && !x.thought && !x.thoughtSignature && Object.keys(x).length === 1;
		if (prev && plain(prev) && plain(p)) prev.text = (prev.text ?? '') + p.text;
		else out.push({ ...p });
	}
	return out;
}

// ---------- Quiz ----------

export function gradeQuiz(quiz: Quiz, answers: { id: string; answer: string }[]): QuizAnswer[] {
	return quiz.questions.map((q) => {
		const a = answers.find((x) => x.id === q.id)?.answer ?? '';
		const valid = [q.answer, ...(q.accepted ?? [])];
		let correct = false;
		if (q.type === 'multiple_choice') correct = a.trim() === q.answer.trim();
		else if (q.type === 'reading') correct = readingMatches(a, valid);
		else if (q.type === 'meaning') correct = meaningMatches(a, valid);
		else correct = valid.some((v) => normalizeReading(v) === normalizeReading(a) || v.trim() === a.trim());
		return { id: q.id, answer: a, correct };
	});
}

type PendingQuiz = { messageId: number; callId?: string; quiz: Quiz; heldParts: Part[] };

function findPendingQuiz(db: DB, sessionId: number): PendingQuiz | null {
	const last = db
		.select()
		.from(s.message)
		.where(eq(s.message.sessionId, sessionId))
		.orderBy(desc(s.message.id))
		.limit(1)
		.get();
	if (!last || last.role !== 'model') return null;
	const ui = last.ui as UiBlock[];
	const quizBlock = ui.find((b): b is Extract<UiBlock, { type: 'quiz' }> => b.type === 'quiz' && !b.answers);
	if (!quizBlock) return null;
	const call = (last.parts as Part[]).find((p) => p.functionCall?.name === PRESENT_QUIZ);
	const held = ui.find((b): b is Extract<UiBlock, { type: 'pending' }> => b.type === 'pending');
	return { messageId: last.id, callId: call?.functionCall?.id, quiz: quizBlock.quiz, heldParts: (held?.parts ?? []) as Part[] };
}

function itemFor(db: DB, item?: string): { type: 'kanji' | 'vocab'; key: string } | null {
	if (!item) return null;
	if ([...item].length === 1) return { type: 'kanji', key: item };
	const w = lookupWord(db, item, 1)[0];
	return w ? { type: 'vocab', key: w.id } : null;
}

// ---------- Turno ----------

export type TutorEvent =
	| { type: 'text'; delta: string }
	| { type: 'tool'; name: string; label: string }
	| { type: 'quiz'; quiz: Quiz }
	| { type: 'graded'; quizId: string; answers: QuizAnswer[] }
	/** Bloque de interfaz producido por una herramienta (acción, ficha, opciones, enlaces, texto). */
	| { type: 'block'; block: UiBlock }
	| { type: 'session'; id: number }
	| { type: 'error'; message: string }
	| { type: 'done' };

export type UserInput = {
	text?: string;
	quizAnswers?: { quizId: string; answers: { id: string; answer: string }[] };
	/** Lo que el alumno estaba mirando (panel lateral). */
	context?: ScreenContext | null;
	/** Continuar un turno que se cortó (error de Gemini) sin añadir mensaje nuevo. */
	retry?: boolean;
};

/** ¿El último turno quedó sin respuesta del modelo? (p. ej. tras un 503). */
export function turnIncomplete(db: DB, sessionId: number) {
	const last = db.select({ role: s.message.role }).from(s.message).where(eq(s.message.sessionId, sessionId)).orderBy(desc(s.message.id)).limit(1).get();
	return last?.role === 'user';
}

function contextText(c: ScreenContext) {
	return `[Contexto de pantalla: ${c.label}] ${JSON.stringify(c.data).slice(0, 2500)}`;
}

export async function* runTurn(db: DB, sessionId: number, input: UserInput): AsyncGenerator<TutorEvent> {
	const sess = db.select().from(s.session).where(eq(s.session.id, sessionId)).get();
	if (!sess) throw new Error('Sesión no encontrada');
	const mode = sess.mode as ChatMode;
	if (input.retry) {
		if (!turnIncomplete(db, sessionId)) {
			yield { type: 'done' };
			return;
		}
		yield* modelLoop(db, sessionId, mode);
		return;
	}

	// 1) Construir el contenido del usuario (respuestas pendientes de herramientas + texto).
	const userParts: Part[] = [];
	const userUi: UiBlock[] = [];
	const pending = findPendingQuiz(db, sessionId);
	if (pending) {
		userParts.push(...pending.heldParts);
		let response: Record<string, unknown>;
		if (input.quizAnswers && input.quizAnswers.quizId === pending.quiz.id) {
			const graded = gradeQuiz(pending.quiz, input.quizAnswers.answers);
			for (const g of graded) {
				const q = pending.quiz.questions.find((x) => x.id === g.id)!;
				const it = itemFor(db, q.item);
				logAnswer(db, it?.type ?? 'vocab', it?.key ?? q.item ?? q.prompt, g.correct, g.answer, 'quiz');
			}
			// Guardar las respuestas en el bloque del quiz para que el historial las muestre.
			const row = db.select().from(s.message).where(eq(s.message.id, pending.messageId)).get()!;
			const ui = (row.ui as UiBlock[])
				.filter((b) => b.type !== 'pending')
				.map((b) => (b.type === 'quiz' && b.quiz.id === pending.quiz.id ? { ...b, answers: graded } : b));
			db.update(s.message).set({ ui }).where(eq(s.message.id, pending.messageId)).run();
			yield { type: 'graded', quizId: pending.quiz.id, answers: graded };
			response = {
				score: `${graded.filter((g) => g.correct).length}/${graded.length}`,
				results: graded.map((g) => {
					const q = pending.quiz.questions.find((x) => x.id === g.id)!;
					return { question: q.prompt, jp: q.jp, expected: q.answer, student_answer: g.answer, correct: g.correct };
				})
			};
		} else {
			response = { skipped: true, note: 'El alumno no respondió el quiz y escribió otra cosa.' };
			const row = db.select().from(s.message).where(eq(s.message.id, pending.messageId)).get()!;
			const ui = (row.ui as UiBlock[])
				.filter((b) => b.type !== 'pending')
				.map((b) => (b.type === 'quiz' && b.quiz.id === pending.quiz.id ? { ...b, answers: [] } : b));
			db.update(s.message).set({ ui }).where(eq(s.message.id, pending.messageId)).run();
		}
		userParts.push({ functionResponse: { id: pending.callId, name: PRESENT_QUIZ, response } });
	}
	// Lo que pasó con acciones propuestas/deshechas desde el último turno.
	const reports = pendingReports(db, sessionId);
	if (reports.length) userParts.push({ text: reports.join('\n') });
	if (input.context) {
		userParts.push({ text: contextText(input.context) });
		userUi.push({ type: 'context', label: input.context.label });
	}
	if (input.text?.trim()) {
		userParts.push({ text: input.text.trim() });
		userUi.push({ type: 'text', text: input.text.trim() });
		// Título automático con el primer mensaje.
		if (!sess.titleSource) {
			db.update(s.session).set({ title: autoTitle(input.text), titleSource: 'auto' }).where(eq(s.session.id, sessionId)).run();
		}
	}
	if (!userParts.length) {
		yield { type: 'done' };
		return;
	}
	saveMessage(db, sessionId, 'user', userParts, userUi);
	yield* modelLoop(db, sessionId, mode);
}

/** 2) Bucle modelo ↔ herramientas a partir del historial guardado. */
async function* modelLoop(db: DB, sessionId: number, mode: ChatMode): AsyncGenerator<TutorEvent> {
	const system = systemPrompt(db, mode);
	const model = models(db).pro;

	for (let step = 0; step < MAX_STEPS; step++) {
		const history: Content[] = getSessionMessages(db, sessionId).map((m) => ({ role: m.role, parts: m.parts as Part[] }));
		const collected: Part[] = [];
		const ui: UiBlock[] = [];
		let text = '';

		// Errores pasajeros (503/429…) antes de recibir nada: se reintenta con espera creciente.
		for (let attempt = 0; ; attempt++) {
			// El uso llega acumulado en los chunks (el último trae el total de la llamada).
			let usage: GenerateContentResponseUsageMetadata | undefined;
			assertBudget(db);
			try {
				const stream = await ai().models.generateContentStream({
					model,
					contents: history,
					config: { systemInstruction: system, tools: [{ functionDeclarations: toolDeclarations }], temperature: 0.7 }
				});
				for await (const chunk of stream) {
					if (chunk.usageMetadata) usage = chunk.usageMetadata;
					for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
						collected.push(part);
						if (part.text && !part.thought) {
							text += part.text;
							yield { type: 'text', delta: part.text };
						}
					}
				}
				recordUsage(db, { model, feature: 'tutor', sessionId, usage });
				break;
			} catch (e) {
				// Cortada a mitad: lo recibido se cobra; sin nada, se registra como fallo.
				if (!(e instanceof GeminiUnavailableError)) recordUsage(db, { model, feature: 'tutor', sessionId, usage, ok: !!usage });
				if (collected.length || attempt >= RETRY_DELAYS.length || !isTransient(e)) throw e;
				await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
			}
		}
		if (text) ui.push({ type: 'text', text });

		const calls = collected.filter((p) => p.functionCall).map((p) => p.functionCall!);
		if (!calls.length) {
			saveMessage(db, sessionId, 'model', compactParts(collected), ui);
			break;
		}

		const responses: Part[] = [];
		let quiz: Quiz | null = null;
		for (const call of calls) {
			const name = call.name ?? '';
			if (name === PRESENT_QUIZ) {
				quiz = normalizeQuiz(call.args ?? {}, call.id);
				continue;
			}
			if (!SILENT_TOOLS.has(name)) {
				yield { type: 'tool', name, label: TOOL_LABELS[name] ?? name };
				ui.push({ type: 'tool', name, label: TOOL_LABELS[name] ?? name });
			}
			let result: Record<string, unknown>;
			try {
				const out = await executeTool(db, { sessionId }, name, (call.args ?? {}) as Record<string, unknown>);
				result = out.response;
				if (out.ui) {
					ui.push(out.ui);
					yield { type: 'block', block: out.ui };
				}
			} catch (e) {
				// Errores de validación de acciones: el modelo los recibe para corregirse.
				result = { error: e instanceof Error ? e.message : String(e), validation: e instanceof ActionError };
			}
			responses.push({ functionResponse: { id: call.id, name, response: result } });
		}

		if (quiz) {
			// Turno terminado: el quiz espera respuestas. Las demás respuestas se retienen para el siguiente turno.
			ui.push({ type: 'quiz', quiz });
			if (responses.length) ui.push({ type: 'pending', parts: responses });
			saveMessage(db, sessionId, 'model', compactParts(collected), ui);
			yield { type: 'quiz', quiz };
			break;
		}

		saveMessage(db, sessionId, 'model', compactParts(collected), ui);
		saveMessage(db, sessionId, 'user', responses, []);
	}
	yield { type: 'done' };
}

// ---------- Memoria ----------

export async function summarizeSession(db: DB, sessionId: number) {
	const msgs = getSessionMessages(db, sessionId);
	const transcript = msgs
		.flatMap((m) =>
			(m.ui as UiBlock[]).map((b) => {
				if (b.type === 'text') return `${m.role === 'user' ? 'Alumno' : 'Tutor'}: ${b.text}`;
				if (b.type === 'quiz')
					return `Quiz «${b.quiz.title}»: ${b.answers ? `${b.answers.filter((a) => a.correct).length}/${b.answers.length}` : 'sin responder'}`;
				return '';
			})
		)
		.filter(Boolean)
		.join('\n')
		.slice(-12000);
	if (transcript.split('\n').length < 2) {
		db.update(s.session).set({ summarized: true }).where(eq(s.session.id, sessionId)).run();
		return null;
	}
	const summary = await generateText({
		db,
		feature: 'summary',
		sessionId,
		model: models(db).flash,
		system: 'Resumes sesiones de tutoría de japonés. Español, máximo 4 frases, sin saludos.',
		contents:
			'Resume qué se practicó, qué errores cometió el alumno y qué convendría repasar la próxima vez:\n\n' + transcript,
		temperature: 0.2
	});
	db.insert(s.sessionSummary)
		.values({ sessionId, summary: summary.trim(), createdAt: Date.now() })
		.onConflictDoUpdate({ target: s.sessionSummary.sessionId, set: { summary: summary.trim(), createdAt: Date.now() } })
		.run();
	db.update(s.session).set({ summarized: true }).where(eq(s.session.id, sessionId)).run();
	// El resumen da título, salvo que el alumno haya renombrado la sesión.
	const title = summary.split(/[.\n]/)[0]?.slice(0, 80);
	const sess = db.select({ src: s.session.titleSource }).from(s.session).where(eq(s.session.id, sessionId)).get();
	if (title && sess?.src !== 'user')
		db.update(s.session).set({ title, titleSource: 'summary' }).where(eq(s.session.id, sessionId)).run();
	return summary;
}

/**
 * Resume en segundo plano las sesiones previas sin resumen e inactivas (≥ 30 min), salvo la actual.
 * Si una sesión resumida recibe mensajes nuevos, vuelve a quedar pendiente (ver saveMessage).
 */
export async function summarizePending(db: DB, exceptId?: number, now = Date.now()) {
	const rows = db
		.select({ id: s.session.id })
		.from(s.session)
		.where(
			and(
				eq(s.session.summarized, false),
				sql`${s.session.lastAt} < ${now - 30 * 60_000}`,
				exceptId ? ne(s.session.id, exceptId) : undefined
			)
		)
		.all();
	for (const r of rows) {
		try {
			await summarizeSession(db, r.id);
		} catch (e) {
			console.warn(`[tutor] no se pudo resumir la sesión ${r.id}:`, e instanceof Error ? e.message : e);
		}
	}
}
