// El adaptador BunLikeClient (el mismo que usa el navegador) sobre SQLite WASM real, con el esquema y las
// migraciones de verdad: transacciones, returning, one(), $client.query y la lógica del SRS.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';
import { one, type DB } from '../src/lib/server/db/index.ts';
import { BunLikeClient } from '../src/lib/server/db/wasm-client.ts';
import { applyReview, ensureCard } from '../src/lib/server/srs/service.ts';
import { applySnapshot, buildSnapshot } from '../src/lib/server/data/snapshot.ts';
import { analyzeText } from '../src/lib/server/text/analyze.ts';

const sqlite3 = await sqlite3InitModule();

function openWasm() {
	const client = new BunLikeClient(new sqlite3.oo1.DB(':memory:'), sqlite3);
	const db = drizzle({ client: client as never, schema }) as unknown as DB;
	migrate(db, { migrationsFolder: resolve('drizzle') });
	return { db, client };
}

test('migraciones, inserciones, returning, one() y transacciones con rollback', () => {
	const { db } = openWasm();
	const row = db.insert(schema.kanji).values({ char: '山', meaningsEs: ['montaña'], learnOrder: 0 }).returning().get();
	expect(row.meaningsEs).toEqual(['montaña']); // columnas JSON
	expect(one<{ n: number }>(sql`select count(*) as n from kanji`, db)).toEqual({ n: 1 });
	expect(() =>
		db.transaction((tx) => {
			tx.insert(schema.kanji).values({ char: '川' }).run();
			throw new Error('falla a mitad');
		})
	).toThrow('falla a mitad');
	expect(db.select().from(schema.kanji).all().map((k) => k.char)).toEqual(['山']); // se deshizo
	// Booleanos y nulos
	db.insert(schema.vocab).values({ id: 'jm:1', mainForm: '山', mainReading: 'やま', kanaForms: ['やま'], common: true }).run();
	expect(db.select().from(schema.vocab).where(eq(schema.vocab.id, 'jm:1')).get()!.common).toBe(true);
	expect(db.select().from(schema.vocab).get()!.glossesEs).toBeNull();
});

test('SRS, snapshot y análisis de texto ($client.query) sobre el adaptador', () => {
	const { db } = openWasm();
	db.insert(schema.kanji).values({ char: '山', meaningsEs: ['montaña'], onReadings: ['サン'], kunReadings: ['やま'], learnOrder: 0 }).run();
	db.insert(schema.vocab).values({ id: 'jm:1', mainForm: '山', mainReading: 'やま', kanaForms: ['やま'], kanjiForms: ['山'], common: true, glossesEs: ['montaña'] }).run();
	db.insert(schema.vocabForm).values([{ form: '山', vocabId: 'jm:1' }, { form: 'やま', vocabId: 'jm:1' }]).run();

	const c = ensureCard(db, 'kanji', '山', 'meaning');
	applyReview(db, c.id, { correct: true, source: 'review' });
	expect(db.select().from(schema.reviewLog).all()).toHaveLength(1);

	const snap = buildSnapshot(db);
	const other = openWasm().db;
	other.insert(schema.kanji).values({ char: '山', learnOrder: 0 }).run();
	applySnapshot(other, snap);
	expect(other.select().from(schema.card).all()).toHaveLength(1);

	const { tokens } = analyzeText(db, '山に行く');
	expect(tokens[0]).toMatchObject({ s: '山' });
});
