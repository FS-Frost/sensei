import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import * as s from '../src/lib/server/db/schema.ts';
import {
	ACTIONS,
	ActionError,
	confirmAction,
	invokeAction,
	pendingReports,
	rejectAction,
	resolveItem,
	undoAction
} from '../src/lib/server/gemini/actions.ts';
import { toolDeclarations, executeTool, DESTINATIONS } from '../src/lib/server/gemini/tools.ts';
import { getSettings } from '../src/lib/server/settings.ts';
import { applyReview, ensureCard } from '../src/lib/server/srs/service.ts';
import { fold, filterSessions, nextSort, sortSessions } from '../src/lib/sessionsTable.ts';

let db: DB;
let sessionId: number;

beforeEach(() => {
	db = openDb(':memory:').db;
	db.insert(s.kanji).values([{ char: '日', meaningsEs: ['día'], learnOrder: 0 }, { char: '末', meaningsEs: ['final'], learnOrder: 1 }]).run();
	db.insert(s.vocab).values({ id: 'jm:1', mainForm: '食べる', mainReading: 'たべる', kanjiForms: ['食べる'], kanaForms: ['たべる'], common: true, pos: ['v1'] }).run();
	db.insert(s.vocabForm).values([{ form: '食べる', vocabId: 'jm:1' }, { form: 'たべる', vocabId: 'jm:1' }]).run();
	sessionId = db.insert(s.session).values({ mode: 'libre', startedAt: 0, lastAt: 0 }).returning().get().id;
});

describe('resolución de ítems', () => {
	test('kanji, palabra conjugada y gramática', () => {
		expect(resolveItem(db, '日')).toMatchObject({ type: 'kanji', key: '日' });
		expect(resolveItem(db, '食べた')).toMatchObject({ type: 'vocab', key: 'jm:1' });
		expect(resolveItem(db, '〜ている')).toMatchObject({ type: 'grammar', key: 'te-iru' });
		expect(resolveItem(db, 'te-iru')).toMatchObject({ type: 'grammar' });
		expect(resolveItem(db, 'xyz')).toBeNull();
	});
});

describe('acciones directas (con deshacer)', () => {
	test('poner en cola y deshacer', async () => {
		const out = await invokeAction(db, sessionId, 'queue_for_lesson', { items: ['日', '食べる'] });
		expect(out.ui).toMatchObject({ type: 'action', kind: 'direct', status: 'done' });
		expect(db.select().from(s.studyQueue).all()).toHaveLength(2);
		undoAction(db, (out.ui as { actionId: number }).actionId);
		expect(db.select().from(s.studyQueue).all()).toHaveLength(0);
		// El modelo se entera de que se deshizo.
		expect(pendingReports(db, sessionId)[0]).toContain('DESHIZO');
		expect(pendingReports(db, sessionId)).toEqual([]); // solo una vez
	});

	test('gramática en cola = tarjeta de gramática', async () => {
		await invokeAction(db, sessionId, 'queue_for_lesson', { items: ['〜ている'] });
		expect(db.select().from(s.card).where(eq(s.card.itemType, 'grammar')).all()).toHaveLength(1);
	});

	test('añadir al SRS: deshacer solo si aún no se repasó', async () => {
		const a = await invokeAction(db, sessionId, 'add_to_srs', { item: '日' });
		const id = (a.ui as { actionId: number }).actionId;
		const cards = db.select().from(s.card).all();
		expect(cards).toHaveLength(2);
		applyReview(db, cards[0].id, { correct: true, source: 'review' });
		expect(() => undoAction(db, id)).toThrow(ActionError);
	});

	test('notas: guardar, olvidar y deshacer el olvido', async () => {
		await invokeAction(db, sessionId, 'save_learner_note', { note: 'Le gusta Dragon Quest' });
		const note = db.select().from(s.learnerNote).get()!;
		const f = await invokeAction(db, sessionId, 'forget_note', { id: note.id });
		expect(db.select().from(s.learnerNote).all()).toHaveLength(0);
		undoAction(db, (f.ui as { actionId: number }).actionId);
		expect(db.select().from(s.learnerNote).get()!.note).toBe('Le gusta Dragon Quest');
	});

	test('validación: errores claros para el modelo', async () => {
		await expect(invokeAction(db, sessionId, 'add_to_srs', { item: 'zzz' })).rejects.toThrow(ActionError);
		await expect(invokeAction(db, sessionId, 'save_sentence', { jp: '猫が好き', target: '犬' })).rejects.toThrow('debe aparecer');
	});
});

describe('acciones con confirmación', () => {
	test('proponer no cambia nada; confirmar sí; deshacer restaura', async () => {
		const before = getSettings(db).newKanjiPerDay;
		const p = await invokeAction(db, sessionId, 'set_daily_pace', { kanji: 6, reason: 'muchos repasos' });
		expect(p.response.status).toBe('proposed');
		expect(getSettings(db).newKanjiPerDay).toBe(before);
		const id = (p.ui as { actionId: number }).actionId;
		const row = await confirmAction(db, id);
		expect(row.status).toBe('confirmed');
		expect(getSettings(db).newKanjiPerDay).toBe(6);
		expect(pendingReports(db, sessionId)[0]).toContain('CONFIRMÓ');
		undoAction(db, id);
		expect(getSettings(db).newKanjiPerDay).toBe(before);
		await expect(confirmAction(db, id)).rejects.toThrow('ya se resolvió');
	});

	test('rechazar', async () => {
		const p = await invokeAction(db, sessionId, 'set_goal', { label: 'Leer DQ', kanji: 300, date: '2099-01-01' });
		const id = (p.ui as { actionId: number }).actionId;
		rejectAction(db, id);
		expect(getSettings(db).goal).toBeNull();
		expect(pendingReports(db, sessionId)[0]).toContain('RECHAZÓ');
	});

	test('fecha pasada o ritmo igual se rechazan al proponer', async () => {
		await expect(invokeAction(db, sessionId, 'set_goal', { label: 'x', kanji: 10, date: '2000-01-01' })).rejects.toThrow(ActionError);
		await expect(invokeAction(db, sessionId, 'set_daily_pace', {})).rejects.toThrow('ya es el ritmo');
	});

	test('apartar un ítem y deshacer', async () => {
		const c = ensureCard(db, 'kanji', '末', 'meaning');
		const p = await invokeAction(db, sessionId, 'pause_item', { item: '末', days: 7 });
		const id = (p.ui as { actionId: number }).actionId;
		await confirmAction(db, id);
		expect(db.select().from(s.card).where(eq(s.card.id, c.id)).get()!.due).toBeGreaterThan(Date.now() + 6 * 86_400_000);
		undoAction(db, id);
		expect(db.select().from(s.card).where(eq(s.card.id, c.id)).get()!.due).toBe(c.due);
	});
});

describe('límites del tutor', () => {
	test('no existen herramientas destructivas globales', () => {
		const names = toolDeclarations.map((d) => d.name!);
		for (const forbidden of ['reset_all', 'reset_progress', 'import_data', 'restore_backup', 'delete_backup', 'delete_session'])
			expect(names).not.toContain(forbidden);
		// Toda acción declarada está en el registro, y su tipo es explícito.
		for (const [name, def] of Object.entries(ACTIONS)) {
			expect(names).toContain(name);
			expect(['direct', 'confirm']).toContain(def.kind);
		}
		// Lo sensible siempre pide confirmación.
		for (const n of ['set_daily_pace', 'set_goal', 'clear_goal', 'pause_item', 'regenerate_mnemonic', 'reset_item'])
			expect(ACTIONS[n].kind).toBe('confirm');
	});

	test('show_links solo acepta destinos de la lista', async () => {
		const ok = await executeTool(db, { sessionId }, 'show_links', { links: [{ to: 'kanji', param: '日' }, { to: 'https://evil' }] });
		expect(ok.ui).toEqual({ type: 'links', links: [{ href: DESTINATIONS.kanji.href('日'), label: 'Ficha del kanji' }] });
	});

	test('show_card y offer_choices producen bloques', async () => {
		expect((await executeTool(db, { sessionId }, 'show_card', { item: '日' })).ui).toMatchObject({ type: 'card', card: { kind: 'kanji' } });
		expect((await executeTool(db, { sessionId }, 'offer_choices', { options: ['Sí', 'No', 'a', 'b', 'c'] })).ui).toEqual({
			type: 'choices',
			options: ['Sí', 'No', 'a', 'b']
		});
	});
});

describe('tabla de sesiones', () => {
	const label = (m: string) => ({ libre: 'Libre', quiz: 'Quiz a medida' })[m] ?? m;
	const rows = [
		{ id: 1, mode: 'libre' as const, title: 'Explicación de は', messages: 4, lastAt: 30, startedAt: 1, costUsd: 0.02 },
		{ id: 2, mode: 'quiz' as const, title: 'quiz de COMIDA', messages: 10, lastAt: 10, startedAt: 2, costUsd: 0.005 },
		{ id: 3, mode: 'libre' as const, title: null, messages: 2, lastAt: 20, startedAt: 3, costUsd: 0.1 }
	];

	test('buscador sin mayúsculas ni tildes, y filtro por tipo', () => {
		expect(fold('Explicación')).toBe('explicacion');
		expect(filterSessions(rows, 'EXPLICACION', '', label).map((r) => r.id)).toEqual([1]);
		expect(filterSessions(rows, 'comida', '', label).map((r) => r.id)).toEqual([2]);
		expect(filterSessions(rows, '', 'libre', label).map((r) => r.id)).toEqual([1, 3]);
		expect(filterSessions(rows, 'libre', '', label).map((r) => r.id)).toEqual([3]); // sin título: busca por el tipo
	});

	test('orden en tres estados', () => {
		let sort = nextSort(null, 'messages');
		expect(sort).toEqual({ key: 'messages', dir: 'asc' });
		expect(sortSessions(rows, sort, label).map((r) => r.id)).toEqual([3, 1, 2]);
		sort = nextSort(sort, 'messages');
		expect(sortSessions(rows, sort, label).map((r) => r.id)).toEqual([2, 1, 3]);
		sort = nextSort(sort, 'messages');
		expect(sort).toBeNull();
		expect(sortSessions(rows, sort, label).map((r) => r.id)).toEqual([1, 3, 2]); // por defecto: última actividad
		expect(nextSort({ key: 'messages', dir: 'desc' }, 'title')).toEqual({ key: 'title', dir: 'asc' });
		expect(sortSessions(rows, { key: 'costUsd', dir: 'desc' }, label).map((r) => r.id)).toEqual([3, 1, 2]);
	});
});
