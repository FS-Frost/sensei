// SQLite WASM (oficial) en un Dedicated Worker, persistido en OPFS con el VFS `opfs-sahpool`
// (no necesita cabeceras COOP/COEP, así que vale para GitHub Pages).
// Drizzle habla con él mediante BunLikeClient (wasm-client.ts), que imita a `bun:sqlite`.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.ts';
import type { DB } from './index.ts';
import { BunLikeClient, type Sqlite3 } from './wasm-client.ts';
import journal from '../../../../drizzle/meta/_journal.json';

export { BunLikeClient };

type Pool = Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>;

export const DB_FILE = '/sensei.db';

// ---------- Migraciones empaquetadas (el navegador no puede leer drizzle/ del disco) ----------

const SQL_FILES = import.meta.glob('/drizzle/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

async function sha256(text: string) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mismo formato que `readMigrationFiles` de Drizzle (mismo hash), para que sea compatible con bases creadas en Bun. */
async function bundledMigrations() {
	const out = [];
	for (const e of (journal as { entries: { tag: string; when: number; breakpoints: boolean }[] }).entries) {
		const query = SQL_FILES[`/drizzle/${e.tag}.sql`];
		if (query == null) throw new Error(`Falta la migración ${e.tag}`);
		out.push({ sql: query.split('--> statement-breakpoint'), bps: e.breakpoints, folderMillis: e.when, hash: await sha256(query) });
	}
	return out;
}

// ---------- Apertura ----------

let sqlite3: Sqlite3 | null = null;
let pool: Pool | null = null;

export async function initSqlite() {
	sqlite3 ??= await sqlite3InitModule();
	// Falla si otra pestaña ya tiene abierta la base (los access handles son exclusivos).
	pool ??= await sqlite3.installOpfsSAHPoolVfs({ name: 'sensei', initialCapacity: 6 });
	return { sqlite3, pool };
}

export async function hasDbFile() {
	const { pool } = await initSqlite();
	return pool.getFileNames().includes(DB_FILE);
}

/** Reemplaza el archivo de la base por `bytes` (diccionario descargado o restauración de la base entera). */
export async function importDbFile(bytes: Uint8Array) {
	const { pool } = await initSqlite();
	await pool.importDb(DB_FILE, bytes);
}

export async function exportDbFile() {
	const { pool } = await initSqlite();
	return pool.exportFile(DB_FILE);
}

export async function openWasmDb() {
	const { sqlite3, pool } = await initSqlite();
	const raw = new pool.OpfsSAHPoolDb(DB_FILE);
	const client = new BunLikeClient(raw, sqlite3);
	client.exec('PRAGMA foreign_keys = ON;');
	const db = drizzle({ client: client as never, schema }) as unknown as DB;
	// Aplica migraciones nuevas de la app sobre una base existente (mismo algoritmo que el migrador de Drizzle).
	const internal = db as unknown as { dialect: { migrate: (m: unknown, s: unknown, c: unknown) => void }; session: unknown };
	internal.dialect.migrate(await bundledMigrations(), internal.session, { migrationsFolder: '' });
	return { db, client };
}
