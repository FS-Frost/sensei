// Acciones del tutor sobre los datos del alumno.
//  · direct: reversibles; se ejecutan al momento y dejan un comprobante con «Deshacer».
//  · confirm: sensibles; el tutor las PROPONE y el alumno pulsa «Confirmar» (o «Rechazar").
// Lo que nunca debe hacer el tutor (reiniciar todo, importar/restaurar, copias, borrar sesiones) no existe aquí.
import type { FunctionDeclaration } from '@google/genai';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ActionStatus, ItemType, UiBlock } from '../../types.ts';
import { isKanjiChar } from '../../jp.ts';
import { GRAMMAR, GRAMMAR_BY_ID } from '../../grammar.ts';
import { lookupInflected } from '../items.ts';
import { ensureCard, facetsFor, pauseCard } from '../srs/service.ts';
import { enqueue } from '../srs/lessons.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { mineSentence } from '../text/sentences.ts';
import { addTexts } from '../text/library.ts';
import { addNote } from '../profile.ts';
import { regenerateMnemonic } from './enrich.ts';
import { createBackup } from '../data/backups.ts';
import { applyReset } from '../data/reset.ts';

export class ActionError extends Error {}

type Args = Record<string, unknown>;
type RunResult = { result: Record<string, unknown>; undo?: Record<string, unknown> };

type ActionDef = {
	kind: 'direct' | 'confirm';
	declaration: Omit<FunctionDeclaration, 'name'>;
	/** Valida/normaliza y devuelve la etiqueta visible. Lanza ActionError si no tiene sentido. */
	prepare: (db: DB, args: Args) => { args: Args; label: string };
	run: (db: DB, args: Args) => Promise<RunResult> | RunResult;
	revert?: (db: DB, undo: Record<string, unknown>) => void;
};

// ---------- Resolución de ítems ----------

export type ResolvedItem = { type: ItemType; key: string; display: string };

/** «日» → kanji; «食べた» → palabra (deconjugada); «te-iru» o «〜ている» → gramática; «氵» → componente. */
export function resolveItem(db: DB, raw: unknown): ResolvedItem | null {
	const t = String(raw ?? '').trim();
	if (!t) return null;
	const g = GRAMMAR_BY_ID.get(t) ?? GRAMMAR.find((x) => x.pattern === t || x.pattern.replace(/〜/g, '') === t.replace(/〜/g, ''));
	if (g) return { type: 'grammar', key: g.id, display: g.pattern };
	if ([...t].length === 1) {
		if (isKanjiChar(t) && db.select({ c: s.kanji.char }).from(s.kanji).where(eq(s.kanji.char, t)).get())
			return { type: 'kanji', key: t, display: t };
		if (db.select({ c: s.component.symbol }).from(s.component).where(eq(s.component.symbol, t)).get())
			return { type: 'component', key: t, display: t };
	}
	const w = lookupInflected(db, t, 1)[0];
	return w ? { type: 'vocab', key: w.id, display: w.mainForm } : null;
}

function mustResolve(db: DB, raw: unknown) {
	const it = resolveItem(db, raw);
	if (!it) throw new ActionError(`«${String(raw)}» no está en el diccionario local ni en la gramática`);
	return it;
}

const itemList = (db: DB, raw: unknown) => {
	const arr = Array.isArray(raw) ? raw : [raw];
	const out = arr.slice(0, 20).map((x) => mustResolve(db, x));
	if (!out.length) throw new ActionError('No hay ítems');
	return out;
};

const ITEM_PARAM = { type: 'string', description: 'kanji (日), palabra en forma de diccionario (食べる) o id/patrón de gramática (te-iru / 〜ている)' };

// ---------- Registro ----------

export const ACTIONS: Record<string, ActionDef> = {
	queue_for_lesson: {
		kind: 'direct',
		declaration: {
			description:
				'Pone kanji, palabras o puntos de gramática al principio de las próximas lecciones (se enseñarán con componentes, mnemotecnia y mini-quiz). Es la forma PREFERIDA de «añadir» algo que el alumno aún no ha estudiado.',
			parametersJsonSchema: { type: 'object', properties: { items: { type: 'array', items: ITEM_PARAM } }, required: ['items'] }
		},
		prepare: (db, a) => {
			const items = itemList(db, a.items);
			return { args: { items }, label: `En cola para tu próxima lección: ${items.map((i) => i.display).join('、')}` };
		},
		run: (db, a) => {
			const items = a.items as ResolvedItem[];
			const before = new Set(
				db
					.select({ t: s.studyQueue.itemType, k: s.studyQueue.itemKey })
					.from(s.studyQueue)
					.all()
					.map((r) => `${r.t}|${r.k}`)
			);
			// La gramática no usa la cola: se crea su tarjeta (se repasa por reconocimiento).
			const grammar = items.filter((i) => i.type === 'grammar');
			const createdCards = grammar.flatMap((g) => createCards(db, g));
			enqueue(db, items.filter((i) => i.type !== 'grammar').map((i) => ({ type: i.type, key: i.key })));
			const added = items.filter((i) => i.type !== 'grammar' && !before.has(`${i.type}|${i.key}`));
			const already = db
				.select({ k: s.card.itemKey, t: s.card.itemType })
				.from(s.card)
				.where(inArray(s.card.itemKey, items.map((i) => i.key)))
				.all();
			return {
				result: {
					queued: added.map((i) => i.display),
					grammar_cards: grammar.map((g) => g.display),
					already_studied: items.filter((i) => i.type !== 'grammar' && already.some((c) => c.k === i.key && c.t === i.type)).map((i) => i.display)
				},
				undo: { queue: added.map((i) => ({ type: i.type, key: i.key })), cards: createdCards }
			};
		},
		revert: (db, u) => {
			for (const q of (u.queue as { type: ItemType; key: string }[]) ?? [])
				db.delete(s.studyQueue).where(and(eq(s.studyQueue.itemType, q.type), eq(s.studyQueue.itemKey, q.key))).run();
			deleteCardsIfUnreviewed(db, (u.cards as number[]) ?? []);
		}
	},

	add_to_srs: {
		kind: 'direct',
		declaration: {
			description:
				'Crea YA las tarjetas de repaso de un ítem (sin lección). Úsalo solo si el alumno pide repasarlo ahora mismo; si no, usa queue_for_lesson.',
			parametersJsonSchema: { type: 'object', properties: { item: ITEM_PARAM }, required: ['item'] }
		},
		prepare: (db, a) => {
			const it = mustResolve(db, a.item);
			return { args: { item: it }, label: `Añadido a tus repasos: ${it.display}` };
		},
		run: (db, a) => {
			const it = a.item as ResolvedItem;
			const cards = createCards(db, it);
			return { result: { added: it.display, new_cards: cards.length }, undo: { cards } };
		},
		revert: (db, u) => deleteCardsIfUnreviewed(db, (u.cards as number[]) ?? [])
	},

	save_sentence: {
		kind: 'direct',
		declaration: {
			description:
				'Guarda una frase japonesa como tarjeta en contexto: el alumno verá la frase con la palabra objetivo resaltada y escribirá su lectura. Ideal para desambiguar lecturas (生 en 生ビール).',
			parametersJsonSchema: {
				type: 'object',
				properties: {
					jp: { type: 'string', description: 'frase en japonés, sin notación de furigana' },
					target: { type: 'string', description: 'palabra objetivo tal como aparece en la frase' },
					es: { type: 'string', description: 'traducción al español' }
				},
				required: ['jp', 'target']
			}
		},
		prepare: (_db, a) => {
			const jp = String(a.jp ?? '').replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1').trim();
			const target = String(a.target ?? '').trim();
			if (!jp || !target || !jp.includes(target)) throw new ActionError('La palabra objetivo debe aparecer en la frase');
			return { args: { jp, target, es: a.es ? String(a.es) : null }, label: `Frase guardada (repasarás «${target}» en contexto)` };
		},
		run: (db, a) => {
			const m = mineSentence(db, { jp: a.jp as string, target: a.target as string, es: a.es as string | null, source: 'tutor' });
			return { result: { id: m.id, reading: m.targetReading }, undo: { id: m.id } };
		},
		revert: (db, u) => {
			const id = Number(u.id);
			db.run(sql`delete from card where item_type = 'sentence' and item_key = ${String(id)}`);
			db.delete(s.minedSentence).where(eq(s.minedSentence.id, id)).run();
		}
	},

	save_to_library: {
		kind: 'direct',
		declaration: {
			description: 'Guarda un texto japonés (p. ej. uno que el alumno pegó) en su Biblioteca para analizarlo, planificarlo y leerlo cronometrando.',
			parametersJsonSchema: {
				type: 'object',
				properties: { title: { type: 'string' }, text: { type: 'string' } },
				required: ['title', 'text']
			}
		},
		prepare: (_db, a) => {
			const text = String(a.text ?? '').trim();
			if (text.length < 5) throw new ActionError('Texto demasiado corto');
			const title = String(a.title ?? '').trim().slice(0, 120) || text.slice(0, 20);
			return { args: { title, text }, label: `Guardado en tu Biblioteca: «${title}»` };
		},
		run: (db, a) => {
			const ids = addTexts(db, [{ title: a.title as string, text: a.text as string }], 'paste');
			return { result: { ids, href: `/biblioteca/${ids[0]}` }, undo: { ids } };
		},
		revert: (db, u) => {
			const ids = (u.ids as number[]) ?? [];
			if (!ids.length) return;
			db.delete(s.readingLog).where(and(eq(s.readingLog.textKind, 'library'), inArray(s.readingLog.textId, ids))).run();
			db.delete(s.libraryText).where(inArray(s.libraryText.id, ids)).run();
		}
	},

	save_learner_note: {
		kind: 'direct',
		declaration: {
			description:
				'Guarda una observación duradera sobre el alumno (intereses, dificultades recurrentes, preferencias) para futuras sesiones. El alumno la ve y puede deshacerla.',
			parametersJsonSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
		},
		prepare: (_db, a) => {
			const note = String(a.note ?? '').trim().slice(0, 500);
			if (!note) throw new ActionError('Nota vacía');
			return { args: { note }, label: `Anotado sobre ti: «${note}»` };
		},
		run: (db, a) => {
			addNote(db, a.note as string);
			const row = db.select().from(s.learnerNote).orderBy(desc(s.learnerNote.id)).limit(1).get()!;
			return { result: { id: row.id }, undo: { id: row.id } };
		},
		revert: (db, u) => db.delete(s.learnerNote).where(eq(s.learnerNote.id, Number(u.id))).run()
	},

	forget_note: {
		kind: 'direct',
		declaration: {
			description: 'Olvida (borra) una nota guardada sobre el alumno. Usa el id que da get_notes. Úsalo cuando el alumno lo pida.',
			parametersJsonSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
		},
		prepare: (db, a) => {
			const n = db.select().from(s.learnerNote).where(eq(s.learnerNote.id, Number(a.id))).get();
			if (!n) throw new ActionError('Esa nota no existe');
			return { args: { id: n.id }, label: `Olvidado: «${n.note.slice(0, 80)}»` };
		},
		run: (db, a) => {
			const n = db.select().from(s.learnerNote).where(eq(s.learnerNote.id, Number(a.id))).get()!;
			db.delete(s.learnerNote).where(eq(s.learnerNote.id, n.id)).run();
			return { result: { forgotten: n.id }, undo: { note: n.note, createdAt: n.createdAt } };
		},
		revert: (db, u) => db.insert(s.learnerNote).values({ note: String(u.note), createdAt: Number(u.createdAt) }).run()
	},

	// ---------- Con confirmación ----------

	set_daily_pace: {
		kind: 'confirm',
		declaration: {
			description: 'PROPONE cambiar el ritmo diario de lecciones (kanji, palabras y/o puntos de gramática nuevos por día). El alumno debe confirmarlo.',
			parametersJsonSchema: {
				type: 'object',
				properties: {
					kanji: { type: 'integer', description: '0-50' },
					vocab: { type: 'integer', description: '0-50' },
					grammar: { type: 'integer', description: '0-10' },
					reason: { type: 'string', description: 'por qué lo propones' }
				}
			}
		},
		prepare: (db, a) => {
			const st = getSettings(db);
			const next = {
				kanji: a.kanji === undefined ? st.newKanjiPerDay : Number(a.kanji),
				vocab: a.vocab === undefined ? st.newVocabPerDay : Number(a.vocab),
				grammar: a.grammar === undefined ? st.newGrammarPerDay : Number(a.grammar)
			};
			if (![next.kanji, next.vocab, next.grammar].every((n) => Number.isFinite(n) && n >= 0)) throw new ActionError('Valores inválidos');
			const parts = [
				next.kanji !== st.newKanjiPerDay ? `kanji ${st.newKanjiPerDay}→${next.kanji}` : '',
				next.vocab !== st.newVocabPerDay ? `palabras ${st.newVocabPerDay}→${next.vocab}` : '',
				next.grammar !== st.newGrammarPerDay ? `gramática ${st.newGrammarPerDay}→${next.grammar}` : ''
			].filter(Boolean);
			if (!parts.length) throw new ActionError('Ese ya es el ritmo actual');
			return { args: next, label: `Cambiar ritmo diario: ${parts.join(', ')}${a.reason ? ` (${String(a.reason)})` : ''}` };
		},
		run: (db, a) => {
			const st = getSettings(db);
			const before = { newKanjiPerDay: st.newKanjiPerDay, newVocabPerDay: st.newVocabPerDay, newGrammarPerDay: st.newGrammarPerDay };
			const after = updateSettings(db, { newKanjiPerDay: Number(a.kanji), newVocabPerDay: Number(a.vocab), newGrammarPerDay: Number(a.grammar) });
			return {
				result: { kanji: after.newKanjiPerDay, vocab: after.newVocabPerDay, grammar: after.newGrammarPerDay },
				undo: before
			};
		},
		revert: (db, u) => updateSettings(db, u as never)
	},

	set_goal: {
		kind: 'confirm',
		declaration: {
			description: 'PROPONE un objetivo con fecha («leer X para tal día») con los kanji necesarios. Sustituye al actual. El alumno debe confirmarlo.',
			parametersJsonSchema: {
				type: 'object',
				properties: {
					label: { type: 'string' },
					kanji: { type: 'integer', description: 'kanji aprendidos necesarios en total' },
					date: { type: 'string', description: 'yyyy-mm-dd' }
				},
				required: ['label', 'kanji', 'date']
			}
		},
		prepare: (_db, a) => {
			const date = String(a.date ?? '');
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T23:59:59`).getTime() < Date.now())
				throw new ActionError('Fecha inválida o pasada');
			const kanji = Math.round(Number(a.kanji));
			if (!(kanji >= 1 && kanji <= 3000)) throw new ActionError('Número de kanji inválido');
			const label = String(a.label ?? '').trim().slice(0, 120);
			if (!label) throw new ActionError('Falta qué quieres leer');
			return {
				args: { label, kanji, date },
				label: `Objetivo: «${label}» — ${kanji} kanji para el ${new Date(`${date}T12:00`).toLocaleDateString('es')}`
			};
		},
		run: (db, a) => {
			const before = getSettings(db).goal;
			updateSettings(db, { goal: { label: a.label as string, kanji: a.kanji as number, date: a.date as string } });
			return { result: { goal: a }, undo: { goal: before } };
		},
		revert: (db, u) => updateSettings(db, { goal: (u.goal as never) ?? null })
	},

	clear_goal: {
		kind: 'confirm',
		declaration: {
			description: 'PROPONE quitar el objetivo con fecha actual. El alumno debe confirmarlo.',
			parametersJsonSchema: { type: 'object', properties: {} }
		},
		prepare: (db) => {
			const g = getSettings(db).goal;
			if (!g) throw new ActionError('No hay objetivo');
			return { args: {}, label: `Quitar el objetivo «${g.label}»` };
		},
		run: (db) => {
			const before = getSettings(db).goal;
			updateSettings(db, { goal: null });
			return { result: { cleared: true }, undo: { goal: before } };
		},
		revert: (db, u) => updateSettings(db, { goal: (u.goal as never) ?? null })
	},

	pause_item: {
		kind: 'confirm',
		declaration: {
			description: 'PROPONE apartar unos días las tarjetas de un ítem que se resiste (vuelve con la cabeza fresca). El alumno debe confirmarlo.',
			parametersJsonSchema: {
				type: 'object',
				properties: { item: ITEM_PARAM, days: { type: 'integer', description: '1-30 (por defecto 7)' } },
				required: ['item']
			}
		},
		prepare: (db, a) => {
			const it = mustResolve(db, a.item);
			const cards = cardsOf(db, it);
			if (!cards.length) throw new ActionError(`«${it.display}» aún no tiene tarjetas`);
			const days = Math.min(30, Math.max(1, Math.round(Number(a.days ?? 7)) || 7));
			return { args: { item: it, days }, label: `Apartar «${it.display}» ${days} días` };
		},
		run: (db, a) => {
			const it = a.item as ResolvedItem;
			const cards = cardsOf(db, it);
			const before = cards.map((c) => ({ id: c.id, due: c.due, fsrs: c.fsrs }));
			let due = 0;
			for (const c of cards) due = pauseCard(db, c.id, Number(a.days));
			return { result: { until: new Date(due).toISOString().slice(0, 10) }, undo: { cards: before } };
		},
		revert: (db, u) => {
			for (const c of (u.cards as { id: number; due: number; fsrs: Record<string, unknown> }[]) ?? [])
				db.update(s.card).set({ due: c.due, fsrs: c.fsrs }).where(eq(s.card.id, c.id)).run();
		}
	},

	regenerate_mnemonic: {
		kind: 'confirm',
		declaration: {
			description:
				'PROPONE sustituir la mnemotecnia de un kanji por una nueva y personalizada (con los intereses del alumno). Útil para kanji que se resisten. Gasta una llamada a Gemini.',
			parametersJsonSchema: { type: 'object', properties: { kanji: { type: 'string' } }, required: ['kanji'] }
		},
		prepare: (db, a) => {
			const it = mustResolve(db, a.kanji);
			if (it.type !== 'kanji') throw new ActionError('Solo para kanji');
			return { args: { kanji: it.key }, label: `Nueva mnemotecnia para ${it.key}` };
		},
		run: async (db, a) => {
			const k = db.select().from(s.kanji).where(eq(s.kanji.char, String(a.kanji))).get()!;
			const notes = db.select({ n: s.learnerNote.note }).from(s.learnerNote).orderBy(desc(s.learnerNote.createdAt)).limit(10).all().map((r) => r.n);
			const res = await regenerateMnemonic(db, k.char, notes);
			return { result: res, undo: { kanji: k.char, meaning: k.mnemonicMeaning, reading: k.mnemonicReading, source: k.mnemonicSource } };
		},
		revert: (db, u) =>
			db.update(s.kanji)
				.set({
					mnemonicMeaning: (u.meaning as string) ?? null,
					mnemonicReading: (u.reading as string) ?? null,
					mnemonicSource: (u.source as 'gemini' | 'pregen' | 'personal' | null | undefined) ?? (u.meaning ? 'gemini' : null)
				})
				.where(eq(s.kanji.char, String(u.kanji)))
				.run()
	},

	reset_item: {
		kind: 'confirm',
		declaration: {
			description:
				'PROPONE reiniciar un ítem (vuelve a «sin estudiar»: se borran sus tarjetas, historial y confusiones; antes se hace copia de seguridad). Solo si el alumno lo pide.',
			parametersJsonSchema: { type: 'object', properties: { item: ITEM_PARAM }, required: ['item'] }
		},
		prepare: (db, a) => {
			const it = mustResolve(db, a.item);
			if (!cardsOf(db, it).length) throw new ActionError(`«${it.display}» no tiene progreso que reiniciar`);
			return { args: { item: it }, label: `Reiniciar «${it.display}» (se borra su progreso; hay copia previa)` };
		},
		run: async (db, a) => {
			const it = a.item as ResolvedItem;
			const backup = await createBackup(db, 'pre-reset');
			applyReset(db, { item: { type: it.type, key: it.key } });
			// Sin deshacer directo: se restaura desde la copia.
			return { result: { reset: it.display, backup: backup.name } };
		}
	}
};

export const ACTION_LABELS: Record<string, string> = {
	queue_for_lesson: 'Poniendo en cola',
	add_to_srs: 'Añadiendo al SRS',
	save_sentence: 'Guardando frase',
	save_to_library: 'Guardando en la biblioteca',
	save_learner_note: 'Tomando nota',
	forget_note: 'Olvidando nota',
	set_daily_pace: 'Proponiendo ritmo',
	set_goal: 'Proponiendo objetivo',
	clear_goal: 'Proponiendo quitar objetivo',
	pause_item: 'Proponiendo apartar',
	regenerate_mnemonic: 'Proponiendo mnemotecnia',
	reset_item: 'Proponiendo reinicio'
};

export const actionDeclarations: FunctionDeclaration[] = Object.entries(ACTIONS).map(([name, d]) => ({ name, ...d.declaration }));

// ---------- Utilidades ----------

function cardsOf(db: DB, it: ResolvedItem) {
	return db
		.select()
		.from(s.card)
		.where(and(eq(s.card.itemType, it.type), eq(s.card.itemKey, it.key)))
		.all();
}

/** Crea las tarjetas que falten y devuelve los ids NUEVOS (para poder deshacer). */
function createCards(db: DB, it: ResolvedItem): number[] {
	const existing = new Set(cardsOf(db, it).map((c) => c.facet));
	const created: number[] = [];
	for (const f of facetsFor(it.type)) {
		if (existing.has(f)) continue;
		created.push(ensureCard(db, it.type, it.key, f).id);
	}
	return created;
}

/** Deshacer «añadir»: solo si aún no se repasaron (no se borra progreso real). */
function deleteCardsIfUnreviewed(db: DB, ids: number[]) {
	if (!ids.length) return;
	const reviewed = db.select({ id: s.reviewLog.cardId }).from(s.reviewLog).where(inArray(s.reviewLog.cardId, ids)).all();
	if (reviewed.length) throw new ActionError('Ya lo repasaste: para quitarlo, reinícialo desde su ficha');
	db.delete(s.card).where(inArray(s.card.id, ids)).run();
}

// ---------- Ciclo de vida ----------

export type ActionOutcome = { response: Record<string, unknown>; ui: UiBlock };

function block(row: typeof s.tutorAction.$inferSelect): UiBlock {
	const def = ACTIONS[row.name];
	return { type: 'action', actionId: row.id, name: row.name, label: row.label, kind: def?.kind ?? 'direct', status: row.status as ActionStatus };
}

/** Llamada del modelo: ejecuta (directa) o registra la propuesta (con confirmación). */
export async function invokeAction(db: DB, sessionId: number, name: string, rawArgs: Args): Promise<ActionOutcome> {
	const def = ACTIONS[name];
	if (!def) throw new ActionError(`Acción desconocida: ${name}`);
	const { args, label } = def.prepare(db, rawArgs);
	const now = Date.now();
	if (def.kind === 'confirm') {
		const row = db
			.insert(s.tutorAction)
			.values({ sessionId, name, args, status: 'proposed', label, createdAt: now })
			.returning()
			.get();
		return {
			response: {
				status: 'proposed',
				label,
				note:
					'El alumno ya ve la propuesta con botones Confirmar/Rechazar ENCIMA de tu texto (no digas «abajo»). No asumas el resultado: te llegará en su próximo mensaje.'
			},
			ui: block(row)
		};
	}
	const { result, undo } = await def.run(db, args);
	const row = db
		.insert(s.tutorAction)
		.values({ sessionId, name, args, status: 'done', label, result, undo: undo ?? null, createdAt: now, reported: true })
		.returning()
		.get();
	return { response: { status: 'done', label, ...result }, ui: block(row) };
}

function getAction(db: DB, id: number) {
	const row = db.select().from(s.tutorAction).where(eq(s.tutorAction.id, id)).get();
	if (!row) throw new ActionError('Acción no encontrada');
	return row;
}

/** Actualiza el bloque de la acción en el mensaje que la contiene (para que el historial muestre su estado). */
function syncMessageBlock(db: DB, row: typeof s.tutorAction.$inferSelect) {
	const msgs = db.select().from(s.message).where(eq(s.message.sessionId, row.sessionId)).all();
	for (const m of msgs) {
		const ui = m.ui as UiBlock[];
		if (!ui.some((b) => b.type === 'action' && b.actionId === row.id)) continue;
		db.update(s.message)
			.set({ ui: ui.map((b) => (b.type === 'action' && b.actionId === row.id ? block(row) : b)) })
			.where(eq(s.message.id, m.id))
			.run();
	}
}

export async function confirmAction(db: DB, id: number) {
	const row = getAction(db, id);
	if (row.status !== 'proposed') throw new ActionError('Esta propuesta ya se resolvió');
	const def = ACTIONS[row.name];
	let updated;
	try {
		const { result, undo } = await def.run(db, row.args);
		updated = db
			.update(s.tutorAction)
			.set({ status: 'confirmed', result, undo: undo ?? null, reported: false })
			.where(eq(s.tutorAction.id, id))
			.returning()
			.get();
	} catch (e) {
		updated = db
			.update(s.tutorAction)
			.set({ status: 'failed', result: { error: e instanceof Error ? e.message : String(e) }, reported: false })
			.where(eq(s.tutorAction.id, id))
			.returning()
			.get();
	}
	syncMessageBlock(db, updated);
	return updated;
}

export function rejectAction(db: DB, id: number) {
	const row = getAction(db, id);
	if (row.status !== 'proposed') throw new ActionError('Esta propuesta ya se resolvió');
	const updated = db.update(s.tutorAction).set({ status: 'rejected', reported: false }).where(eq(s.tutorAction.id, id)).returning().get();
	syncMessageBlock(db, updated);
	return updated;
}

export function undoAction(db: DB, id: number) {
	const row = getAction(db, id);
	if (row.status !== 'done' && row.status !== 'confirmed') throw new ActionError('No hay nada que deshacer');
	const def = ACTIONS[row.name];
	if (!def?.revert || !row.undo) throw new ActionError('Esta acción no se puede deshacer');
	def.revert(db, row.undo);
	const updated = db.update(s.tutorAction).set({ status: 'undone', reported: false }).where(eq(s.tutorAction.id, id)).returning().get();
	syncMessageBlock(db, updated);
	return updated;
}

export function canUndo(name: string) {
	return !!ACTIONS[name]?.revert;
}

/**
 * Resultados que el modelo aún no conoce (confirmaciones, rechazos, deshacer) → texto para el siguiente turno.
 * Se marcan como comunicados.
 */
export function pendingReports(db: DB, sessionId: number): string[] {
	const rows = db
		.select()
		.from(s.tutorAction)
		.where(and(eq(s.tutorAction.sessionId, sessionId), eq(s.tutorAction.reported, false)))
		.all();
	const out: string[] = [];
	for (const r of rows) {
		const verb =
			r.status === 'confirmed'
				? 'CONFIRMÓ'
				: r.status === 'rejected'
					? 'RECHAZÓ'
					: r.status === 'undone'
						? 'DESHIZO'
						: r.status === 'failed'
							? 'confirmó pero FALLÓ'
							: null;
		if (!verb) continue;
		out.push(`[Sistema: el alumno ${verb} «${r.label}»${r.result ? `. Resultado: ${JSON.stringify(r.result)}` : ''}]`);
		db.update(s.tutorAction).set({ reported: true }).where(eq(s.tutorAction.id, r.id)).run();
	}
	return out;
}
