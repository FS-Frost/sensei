import { expect, mock, test } from 'bun:test';

// Gemini simulado: cada llamada a generateContentStream consume el siguiente guion.
type FakePart = Record<string, unknown>;
const scripts: FakePart[][] = [];
const seenContents: unknown[] = [];
/** Próximas llamadas que fallarán con 503. */
let failures = 0;

mock.module('../src/lib/server/gemini/client.ts', () => ({
	ai: () => ({
		models: {
			generateContentStream: async (req: { contents: unknown }) => {
				seenContents.push(structuredClone(req.contents));
				if (failures > 0) {
					failures--;
					throw new Error('{"error":{"code":503,"message":"The service is currently unavailable.","status":"UNAVAILABLE"}}');
				}
				const parts = scripts.shift() ?? [{ text: 'fin' }];
				return (async function* () {
					// El uso llega acumulado: el último chunk trae el total.
					let i = 0;
					for (const p of parts)
						yield { candidates: [{ content: { parts: [p] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10 * ++i } };
				})();
			}
		}
	}),
	models: () => ({ pro: 'fake-pro', flash: 'fake-flash' }),
	hasGemini: () => true,
	generateText: async () => 'Resumen falso.',
	generateJson: async () => ({}),
	errorMessage: (e: unknown) => String(e),
	isTransient: (e: unknown) => String(e).includes('503'),
	GeminiUnavailableError: class extends Error {},
	// El mock reemplaza el módulo para TODOS los tests del proceso (el orden varía por SO):
	// tiene que exponer todo lo que exporta client.ts.
	errorStatus: () => null,
	withRetry: <T>(fn: () => Promise<T>) => fn(),
	listModels: async () => [],
	isCompatibleModel: (id: string) =>
		id.startsWith('gemini-') && !/(tts|image|banana|embedding|live|transcribe|native-audio|audio|robotics|omni|veo|lyria|imagen|antigravity|deep-research|computer-use|aqa|gemma|learnlm)/.test(id)
}));

const { openDb } = await import('../src/lib/server/db/bun.ts');
const s = await import('../src/lib/server/db/schema.ts');
const { createSession, runTurn, getSessionMessages, summarizeSession } = await import('../src/lib/server/gemini/tutor.ts');

const db = openDb(':memory:').db;
db.insert(s.kanji).values({ char: '山', meaningsEs: ['montaña'], onReadings: ['サン'], kunReadings: ['やま'], learnOrder: 0 }).run();

async function collect(gen: AsyncGenerator<{ type: string }>) {
	const out = [];
	for await (const e of gen) out.push(e);
	return out;
}

test('bucle de herramientas, quiz pendiente y respuesta corregida', async () => {
	const sess = createSession(db, 'quiz');

	// Turno 1: el modelo consulta una herramienta, luego escribe y presenta un quiz junto a otra llamada.
	scripts.push(
		[{ functionCall: { id: 'c1', name: 'get_known_kanji', args: {} }, thoughtSignature: 'sig-1' }],
		[
			{ text: 'Vamos con un quiz. ' },
			{ functionCall: { id: 'c2', name: 'lookup_dictionary', args: { query: '山' } } },
			{
				functionCall: {
					id: 'c3',
					name: 'present_quiz',
					args: {
						title: 'Montañas',
						questions: [
							{ type: 'reading', prompt: 'Lee', jp: '山', answer: 'やま', item: '山' },
							{ type: 'multiple_choice', prompt: 'Significado', jp: '山', options: ['río', 'montaña'], answer: 'montaña' }
						]
					}
				}
			}
		]
	);
	const ev1 = await collect(runTurn(db, sess.id, { text: 'Quiero un quiz' }));
	const quizEv = ev1.find((e) => e.type === 'quiz') as { type: 'quiz'; quiz: { id: string } } | undefined;
	expect(quizEv).toBeTruthy();
	expect(quizEv!.quiz.id).toBe('c3');
	expect(ev1.some((e) => e.type === 'tool')).toBe(true);

	// La segunda llamada al modelo debe incluir la respuesta de get_known_kanji y conservar la firma.
	const second = seenContents[1] as { role: string; parts: FakePart[] }[];
	expect(second.at(-1)!.role).toBe('user');
	expect((second.at(-1)!.parts[0].functionResponse as { name: string }).name).toBe('get_known_kanji');
	expect(second.at(-2)!.parts[0].thoughtSignature).toBe('sig-1');

	// Turno 2: el alumno responde el quiz.
	scripts.push([{ text: '¡Bien hecho!' }]);
	const ev2 = await collect(
		runTurn(db, sess.id, {
			quizAnswers: {
				quizId: 'c3',
				answers: [
					{ id: '0', answer: 'ヤマ' },
					{ id: '1', answer: 'río' }
				]
			}
		})
	);
	const graded = ev2.find((e) => e.type === 'graded') as { answers: { correct: boolean }[] } | undefined;
	expect(graded!.answers.map((a) => a.correct)).toEqual([true, false]);

	// El contenido de usuario lleva la respuesta retenida (lookup) + la del quiz, en ese orden.
	const third = seenContents[2] as { role: string; parts: FakePart[] }[];
	const names = third.at(-1)!.parts.map((p) => (p.functionResponse as { name: string } | undefined)?.name);
	expect(names).toEqual(['lookup_dictionary', 'present_quiz']);
	const quizResp = third.at(-1)!.parts[1].functionResponse as { response: { score: string } };
	expect(quizResp.response.score).toBe('1/2');

	// El historial guarda el quiz ya corregido y sin el bloque "pending".
	const msgs = getSessionMessages(db, sess.id);
	const quizMsg = msgs.find((m) => (m.ui as { type: string }[]).some((b) => b.type === 'quiz'))!;
	const ui = quizMsg.ui as { type: string; answers?: unknown[] }[];
	expect(ui.some((b) => b.type === 'pending')).toBe(false);
	expect(ui.find((b) => b.type === 'quiz')!.answers).toHaveLength(2);

	// Las respuestas del quiz quedan registradas.
	expect(db.select().from(s.reviewLog).all().filter((r) => r.source === 'quiz')).toHaveLength(2);

	// Uso: una fila por llamada al modelo (3 vueltas), con la sesión y el total del último chunk.
	const usage = db.select().from(s.geminiUsage).all().filter((u) => u.sessionId === sess.id);
	expect(usage.map((u) => u.feature)).toEqual(['tutor', 'tutor', 'tutor']);
	expect(usage.map((u) => u.outputTokens)).toEqual([10, 30, 10]);
	expect(usage[0].costUsd).toBeNull(); // «fake-pro» no tiene precio
});

test('escribir sin responder el quiz lo marca como omitido', async () => {
	const sess = createSession(db, 'quiz');
	scripts.push([{ functionCall: { id: 'q1', name: 'present_quiz', args: { title: 'T', questions: [{ type: 'meaning', prompt: 'p', answer: 'x' }] } } }]);
	await collect(runTurn(db, sess.id, { text: 'hola' }));
	scripts.push([{ text: 'Vale.' }]);
	await collect(runTurn(db, sess.id, { text: 'mejor otra cosa' }));
	const last = (seenContents.at(-1) as { parts: FakePart[] }[]).at(-1)!;
	expect((last.parts[0].functionResponse as { response: { skipped: boolean } }).response.skipped).toBe(true);
	expect(last.parts[1].text).toBe('mejor otra cosa');
});

test('bloques de interfaz, acciones, contexto y título automático', async () => {
	const { listSessions, panelSession } = await import('../src/lib/server/gemini/tutor.ts');
	const { confirmAction } = await import('../src/lib/server/gemini/actions.ts');
	const { getSettings } = await import('../src/lib/server/settings.ts');

	const sess = createSession(db, 'libre', 'panel');
	expect(listSessions(db).some((x) => x.id === sess.id)).toBe(false); // vacía: no se lista

	// El modelo pone 山 en cola (directa), propone bajar el ritmo (confirmación) y ofrece opciones.
	scripts.push(
		[
			{ text: 'Hecho. ' },
			{ functionCall: { id: 'a1', name: 'queue_for_lesson', args: { items: ['山'] } } },
			{ functionCall: { id: 'a2', name: 'set_daily_pace', args: { kanji: 4, reason: 'vas cargado' } } },
			{ functionCall: { id: 'a3', name: 'offer_choices', args: { options: ['Vale', 'No'] } } }
		],
		[{ text: '¿Algo más?' }]
	);
	const ev = await collect(
		runTurn(db, sess.id, {
			text: 'Quiero aprender el kanji de montaña, que lo vi en esta ficha',
			context: { kind: 'kanji', label: 'kanji 山 · ficha', data: { kanji: '山' } }
		})
	);
	const blocks = ev.filter((e) => e.type === 'block').map((e) => (e as unknown as { block: { type: string; status?: string } }).block);
	expect(blocks.map((b) => b.type)).toEqual(['action', 'action', 'choices']);
	expect(blocks[1].status).toBe('proposed');
	expect(ev.some((e) => e.type === 'tool')).toBe(false); // herramientas «silenciosas»: sin chip ⚙

	// El contexto viajó al modelo como texto y se ve como chip en el historial.
	const firstCall = seenContents.at(-2) as { role: string; parts: FakePart[] }[];
	expect(JSON.stringify(firstCall.at(-1))).toContain('[Contexto de pantalla: kanji 山 · ficha]');
	const userMsg = getSessionMessages(db, sess.id).find((m) => m.role === 'user')!;
	expect((userMsg.ui as { type: string }[]).map((b) => b.type)).toEqual(['context', 'text']);

	// Título automático y aparece en el listado; es la sesión del panel a continuar.
	const listed = listSessions(db).find((x) => x.id === sess.id)!;
	expect(listed.title).toContain('Quiero aprender');
	expect(listed.messages).toBeGreaterThan(0);
	expect(panelSession(db)?.id).toBe(sess.id);

	// El alumno confirma la propuesta → el siguiente turno informa al modelo.
	const proposal = db.select().from(s.tutorAction).all().find((a) => a.status === 'proposed')!;
	await confirmAction(db, proposal.id);
	expect(getSettings(db).newKanjiPerDay).toBe(4);
	scripts.push([{ text: 'Perfecto.' }]);
	await collect(runTurn(db, sess.id, { text: 'Gracias' }));
	expect(JSON.stringify((seenContents.at(-1) as unknown[]).at(-1))).toContain('CONFIRMÓ');
});

test('503 pasajero: se reintenta solo; si persiste, el turno queda «incompleto» y se puede reintentar', async () => {
	const { turnIncomplete } = await import('../src/lib/server/gemini/tutor.ts');
	const sess = createSession(db, 'libre');
	failures = 1;
	scripts.push([{ text: 'Respuesta tras reintento' }]);
	const ok = await collect(runTurn(db, sess.id, { text: 'hola' }));
	expect(ok.some((e) => e.type === 'error')).toBe(false);
	expect(turnIncomplete(db, sess.id)).toBe(false);

	failures = 3; // agota los reintentos
	await expect(collect(runTurn(db, sess.id, { text: 'otra' }))).rejects.toThrow('503');
	expect(turnIncomplete(db, sess.id)).toBe(true);
	const before = getSessionMessages(db, sess.id).length;
	scripts.push([{ text: 'Ahora sí' }]);
	await collect(runTurn(db, sess.id, { retry: true }));
	const after = getSessionMessages(db, sess.id);
	expect(after.length).toBe(before + 1); // solo la respuesta del modelo: no se duplica el mensaje del alumno
	expect(turnIncomplete(db, sess.id)).toBe(false);
	// Los intentos fallidos quedan como «fallida» (no se cobran); los buenos, con sus tokens.
	const usage = db.select().from(s.geminiUsage).all().filter((u) => u.sessionId === sess.id);
	expect(usage.filter((u) => !u.ok)).toHaveLength(4);
	expect(usage.filter((u) => u.ok)).toHaveLength(2);
}, 30_000);

test('resumen de sesión', async () => {
	const sess = createSession(db, 'libre');
	scripts.push([{ text: 'Hola, ¿qué quieres leer hoy?' }]);
	await collect(runTurn(db, sess.id, { text: 'Hola' }));
	expect(await summarizeSession(db, sess.id)).toBe('Resumen falso.');
});
