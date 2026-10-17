// Conexión a la base de datos, independiente de la plataforma.
// - Navegador (sitio estático): el Worker abre SQLite WASM (db/wasm.ts) y llama a setDb().
// - Bun (tests, scripts): db/bun.ts abre bun:sqlite.
import type { SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.ts';

/** Lo que se usa del cliente crudo (`db.$client`): sentencias cacheadas con parámetros `?1`, como en bun:sqlite. */
export interface SqlClient {
	query<R = unknown, P extends unknown[] = unknown[]>(sql: string): { all(...params: P): R[]; get(...params: P): R | null };
}

export type DB = BunSQLiteDatabase<typeof schema> & { $client: SqlClient };

let current: DB | null = null;

/** Base de datos activa (la del Worker en el navegador). Falla si aún no se abrió. */
export const db: DB = new Proxy({} as DB, {
	get(_t, prop) {
		if (!current) throw new Error('Base de datos no inicializada');
		const v = (current as unknown as Record<PropertyKey, unknown>)[prop];
		// `constructor` sin enlazar: Drizzle lo usa para identificar entidades.
		return typeof v === 'function' && prop !== 'constructor' ? (v as (...a: unknown[]) => unknown).bind(current) : v;
	}
});

export function setDb(database: DB | null) {
	current = database;
}

export function hasDb() {
	return current !== null;
}

export { schema };

/**
 * Primera fila de una consulta SQL cruda como objeto.
 * Ojo: en bun-sqlite `db.get(sql…)` devuelve un array de valores ([2600]), no un objeto; usar esto en su lugar.
 */
export function one<T>(query: SQL, database: DB = db): T | undefined {
	return database.all<T>(query)[0];
}
