// Datos → Almacenamiento: tamaño de la base, integridad, compactar (con copia previa) y poda inmediata de copias.
import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { openDb } from '../src/lib/server/db/bun.ts';
import { setBackupStore, createBackup, listBackups } from '../src/lib/server/data/backups.ts';
import { memoryStore } from '../src/lib/server/data/store.ts';
import { dbStats, integrityCheck, pruneAllButNewest, vacuum } from '../src/lib/server/data/storage.ts';
import * as s from '../src/lib/server/db/schema.ts';

test('tamaño, integridad, compactar y podar copias', async () => {
	const db = openDb(':memory:').db;
	setBackupStore(memoryStore());
	const st = dbStats(db);
	expect(st.pageSize).toBeGreaterThan(0);
	expect(st.bytes).toBe(st.pageSize * st.pages);
	expect(integrityCheck(db)).toEqual({ ok: true, problems: [] });

	// Datos que luego se borran: deja páginas libres.
	db.insert(s.learnerNote).values(Array.from({ length: 400 }, (_, i) => ({ note: 'x'.repeat(500) + i, createdAt: Date.now() }))).run();
	db.run(sql`delete from learner_note`);
	expect(dbStats(db).freePages).toBeGreaterThan(0);

	const r = await vacuum(db, new Date('2026-10-18T10:00:00Z'));
	expect(r.after).toBeLessThan(r.before);
	expect(dbStats(db).freePages).toBe(0);
	expect(r.backup).toContain('pre-vacuum');

	await createBackup(db, 'manual', new Date('2026-10-18T11:00:00Z'));
	await createBackup(db, 'manual', new Date('2026-10-18T12:00:00Z'));
	expect(await listBackups()).toHaveLength(3);
	const p = await pruneAllButNewest();
	expect(p.removed).toBe(2);
	const left = await listBackups();
	expect(left).toHaveLength(1);
	expect(left[0].createdAt).toBe(Date.parse('2026-10-18T12:00:00Z'));
});
