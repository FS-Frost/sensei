import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb, type DB } from '../src/lib/server/db/bun.ts';
import { fsStore } from '../src/lib/server/data/store-fs.ts';
import * as s from '../src/lib/server/db/schema.ts';
import { applyReview, ensureCard } from '../src/lib/server/srs/service.ts';
import { applySnapshot, buildSnapshot, readZip, snapshotToZip, SnapshotError, countSnapshot } from '../src/lib/server/data/snapshot.ts';
import { applyReset, previewReset } from '../src/lib/server/data/reset.ts';
import { createBackup, ensureDailyBackup, isBackupName, listBackups, pruneBackups } from '../src/lib/server/data/backups.ts';
import { getInternal, getSettings, resetSettings, setInternal, updateSettings } from '../src/lib/server/settings.ts';
import { strToU8, zipSync } from 'fflate';

let db: DB;
const dirs: string[] = [];
const tmp = () => {
	const d = mkdtempSync(join(tmpdir(), 'sensei-bk-'));
	dirs.push(d);
	return fsStore(d);
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function seed() {
	db.insert(s.kanji)
		.values([
			{ char: '日', meaningsEs: ['día'], onReadings: ['ニチ'], learnOrder: 0, mnemonicMeaning: 'sol', mnemonicReading: 'nichi' },
			{ char: '本', meaningsEs: ['libro'], onReadings: ['ホン'], learnOrder: 2 }
		])
		.run();
	db.insert(s.component).values([
		{ symbol: '丶', nameEs: 'gota', nameSource: 'static', learnOrder: 1 },
		{ symbol: '⺈', nameEs: 'cuchillo nube', nameSource: 'gemini' }
	]).run();
	db.insert(s.vocab)
		.values([
			{ id: 'jm:1', mainForm: '日本', mainReading: 'にほん', kanaForms: ['にほん'], common: true, glossesEs: ['Japón'], glossesEsSource: 'gemini' },
			{ id: 'jm:2', mainForm: '本', mainReading: 'ほん', kanaForms: ['ほん'], common: true, glossesEs: ['libro'], glossesEsSource: 'jmdict' }
		])
		.run();
	db.insert(s.sentence).values({ vocabId: 'jm:1', jp: '日本へ行く。', en: 'Go to Japan.', es: 'Ir a Japón.' }).run();
	for (const [t, k] of [
		['kana', 'ツ'],
		['kanji', '日'],
		['kanji', '本'],
		['component', '丶'],
		['vocab', 'jm:1']
	] as const) {
		const c = ensureCard(db, t, k, t === 'kana' || t === 'component' ? (t === 'kana' ? 'reading' : 'meaning') : 'meaning');
		applyReview(db, c.id, { correct: true, source: 'review' });
	}
	db.insert(s.confusion).values({ kind: 'kanji', a: '日', b: '本', count: 2, lastAt: 1 }).run();
	db.insert(s.session).values({ id: 1, mode: 'libre', startedAt: 1, lastAt: 1 }).run();
	db.insert(s.message).values({ sessionId: 1, role: 'user', parts: [{ text: 'hola' }], ui: [{ type: 'text', text: 'hola' }], createdAt: 1 }).run();
	db.insert(s.learnerNote).values({ note: 'le gusta el manga', createdAt: 1 }).run();
	db.insert(s.generatedText).values({ kind: 'reading', params: {}, content: { title: 'x' }, createdAt: 1 }).run();
	db.insert(s.vocab).values({ id: 'u:1', mainForm: '謎語', mainReading: 'なぞご', kanaForms: ['なぞご'], glossesEs: ['acertijo'], glossesEsSource: 'user', source: 'user' }).run();
	db.insert(s.vocabForm).values({ form: '謎語', vocabId: 'u:1' }).run();
	updateSettings(db, { newKanjiPerDay: 3 });
	setInternal(db, 'session_secret', 'SECRETO');
}

beforeEach(() => {
	db = openDb(':memory:').db;
	seed();
});

describe('exportar / importar', () => {
	test('ida y vuelta conserva todo y nunca exporta el secreto', () => {
		const before = buildSnapshot(db);
		const { zip, manifest } = snapshotToZip(before, 'export');
		expect(manifest.counts.cards).toBe(5);
		expect(JSON.stringify(before)).not.toContain('SECRETO');

		applyReset(db, { progress: 'all', tutor: true, generated: true });
		resetSettings(db);
		expect(countSnapshot(buildSnapshot(db)).cards).toBe(0);

		const { snap } = readZip(zip);
		applySnapshot(db, snap);
		const after = buildSnapshot(db);
		expect(countSnapshot(after)).toEqual(countSnapshot(before));
		expect(getSettings(db).newKanjiPerDay).toBe(3);
		expect(db.select().from(s.kanji).where(eq(s.kanji.char, '日')).get()!.mnemonicMeaning).toBe('sol');
		expect(db.select().from(s.vocab).where(eq(s.vocab.id, 'jm:1')).get()!.glossesEs).toEqual(['Japón']);
		expect(db.select().from(s.sentence).get()!.es).toBe('Ir a Japón.');
		expect(db.select().from(s.vocabForm).where(eq(s.vocabForm.vocabId, 'u:1')).all()).toHaveLength(1);
		// El secreto interno sigue siendo el del servidor.
		expect(getInternal(db, 'session_secret')).toBe('SECRETO');
	});

	test('importar reemplaza (no duplica) el progreso', () => {
		const { zip } = snapshotToZip(buildSnapshot(db), 'export');
		applySnapshot(db, readZip(zip).snap);
		applySnapshot(db, readZip(zip).snap);
		expect(db.select().from(s.card).all()).toHaveLength(5);
	});

	test('rechaza archivos que no son copias de Sensei o de formato futuro', () => {
		expect(() => readZip(strToU8('hola'))).toThrow(SnapshotError);
		const other = zipSync({ 'manifest.json': strToU8(JSON.stringify({ app: 'otro', format: 1 })) });
		expect(() => readZip(other)).toThrow('No es una copia de Sensei');
		const future = zipSync({ 'manifest.json': strToU8(JSON.stringify({ app: 'sensei', format: 99 })) });
		expect(() => readZip(future)).toThrow('no soportado');
	});
});

describe('reinicio', () => {
	test('por tipo "kanji" arrastra componentes y vocabulario, no kana', () => {
		const p = previewReset(db, { progress: ['kanji'] });
		expect(p.cards).toBe(4);
		applyReset(db, { progress: ['kanji'] });
		const left = db.select().from(s.card).all();
		expect(left.map((c) => c.itemType)).toEqual(['kana']);
		expect(db.select().from(s.reviewLog).all().every((r) => r.itemType === 'kana')).toBe(true);
		expect(db.select().from(s.confusion).all()).toHaveLength(0);
		// No toca tutor ni contenido
		expect(db.select().from(s.session).all()).toHaveLength(1);
	});

	test('por ítem borra solo ese ítem, su historial y sus confusiones', () => {
		applyReset(db, { item: { type: 'kanji', key: '日' } });
		const keys = db.select().from(s.card).all().map((c) => c.itemKey);
		expect(keys).not.toContain('日');
		expect(keys).toContain('本');
		expect(db.select().from(s.confusion).all()).toHaveLength(0);
	});

	test('memoria del tutor aparte', () => {
		applyReset(db, { tutor: true });
		expect(db.select().from(s.session).all()).toHaveLength(0);
		expect(db.select().from(s.message).all()).toHaveLength(0);
		expect(db.select().from(s.learnerNote).all()).toHaveLength(0);
		expect(db.select().from(s.card).all()).toHaveLength(5);
	});

	test('contenido generado: borra lo de Gemini y conserva lo del diccionario', () => {
		applyReset(db, { generated: true });
		expect(db.select().from(s.kanji).where(eq(s.kanji.char, '日')).get()!.mnemonicMeaning).toBeNull();
		expect(db.select().from(s.vocab).where(eq(s.vocab.id, 'jm:1')).get()!.glossesEs).toBeNull();
		expect(db.select().from(s.vocab).where(eq(s.vocab.id, 'jm:2')).get()!.glossesEs).toEqual(['libro']);
		expect(db.select().from(s.component).where(eq(s.component.symbol, '丶')).get()!.nameEs).toBe('gota');
		expect(db.select().from(s.component).where(eq(s.component.symbol, '⺈')).get()!.nameEs).toBeNull();
		expect(db.select().from(s.generatedText).all()).toHaveLength(0);
		expect(db.select().from(s.card).all()).toHaveLength(5);
	});

	test('reiniciar ajustes conserva valores internos', () => {
		resetSettings(db);
		expect(getSettings(db).newKanjiPerDay).toBe(10);
		expect(getInternal(db, 'session_secret')).toBe('SECRETO');
	});
});

describe('copias de seguridad', () => {
	test('nombres válidos y protección contra rutas', () => {
		expect(isBackupName('sensei-2026-10-16T23-10-05-123-auto.zip')).toBe(true);
		expect(isBackupName('../sensei.db')).toBe(false);
		expect(isBackupName('sensei-2026-10-16T23-10-05-123-auto.zip/../../x')).toBe(false);
	});

	test('retención de 7 días que conserva siempre la más reciente', async () => {
		const dir = tmp();
		const day = 86_400_000;
		const now = Date.parse('2026-10-20T12:00:00Z');
		await createBackup(db, 'manual', new Date(now - 20 * day), dir);
		await createBackup(db, 'auto', new Date(now - 10 * day), dir);
		// Ninguna reciente: la más nueva (hace 10 días) se conserva.
		await pruneBackups(new Date(now), dir);
		expect((await listBackups(dir)).map((b) => b.kind)).toEqual(['auto']);
		await createBackup(db, 'manual', new Date(now - 1 * day), dir);
		await pruneBackups(new Date(now), dir);
		expect((await listBackups(dir)).map((b) => b.kind)).toEqual(['manual']);
	});

	test('copia diaria: una por día y se salta si nada cambió', async () => {
		const dir = tmp();
		const d1 = new Date('2026-10-20T10:00:00');
		expect(await ensureDailyBackup(db, d1, dir)).not.toBeNull();
		expect(await ensureDailyBackup(db, new Date('2026-10-20T18:00:00'), dir)).toBeNull(); // mismo día
		expect(await ensureDailyBackup(db, new Date('2026-10-21T10:00:00'), dir)).toBeNull(); // sin cambios
		ensureCard(db, 'kanji', '本', 'reading');
		expect(await ensureDailyBackup(db, new Date('2026-10-21T11:00:00'), dir)).not.toBeNull();
	});

	test('sin datos no se crea copia automática', async () => {
		const empty = openDb(':memory:').db;
		expect(await ensureDailyBackup(empty, new Date(), tmp())).toBeNull();
	});
});

