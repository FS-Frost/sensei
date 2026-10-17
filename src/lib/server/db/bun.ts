// Apertura con bun:sqlite: tests y scripts (p. ej. construir el diccionario del sitio).
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema.ts';
import type { DB } from './index.ts';

/** Abre (y migra) una base. `:memory:` para tests. */
export function openDb(path = ':memory:', opts: { wal?: boolean } = {}) {
	if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
	const sqlite = new Database(path, { create: true });
	if (opts.wal ?? path !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL;');
	sqlite.exec('PRAGMA foreign_keys = ON;');
	sqlite.exec('PRAGMA synchronous = NORMAL;');
	const db = drizzle({ client: sqlite, schema }) as unknown as DB;
	migrate(db, { migrationsFolder: resolve('drizzle') });
	return { sqlite, db };
}

export type { DB };
