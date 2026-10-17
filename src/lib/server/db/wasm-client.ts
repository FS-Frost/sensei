// Cliente con la interfaz de `bun:sqlite` sobre SQLite WASM oficial (API oo1), para reutilizar el driver
// `drizzle-orm/bun-sqlite` y todo el código síncrono existente (transacciones, .get(), one(), $client.query).
// Sin dependencias del navegador: se prueba en Bun (tests/wasm-client.test.ts).
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';

export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
export type OoDb = InstanceType<Sqlite3['oo1']['DB']>;
type Bindable = string | number | bigint | null | Uint8Array;

function bindable(params: unknown[]): Bindable[] | undefined {
	if (!params.length) return undefined;
	return params.map((p) => {
		if (p === undefined) return null;
		if (typeof p === 'boolean') return p ? 1 : 0;
		if (p instanceof ArrayBuffer) return new Uint8Array(p);
		return p as Bindable;
	});
}

export class BunLikeClient {
	private cache = new Map<string, ReturnType<OoDb['prepare']>>();

	constructor(
		readonly raw: OoDb,
		private readonly sqlite3: Sqlite3
	) {}

	exec(sql: string) {
		this.raw.exec(sql);
	}

	/** Lo que usa drizzle-orm/bun-sqlite: run/all/get/values con parámetros posicionales. */
	prepare(sql: string) {
		const db = this.raw;
		const sqlite3 = this.sqlite3;
		const rows = (params: unknown[], rowMode: 'array' | 'object') =>
			db.exec({ sql, bind: bindable(params), rowMode, returnValue: 'resultRows' }) as unknown[];
		return {
			run: (...params: unknown[]) => {
				db.exec({ sql, bind: bindable(params) });
				return { changes: db.changes(), lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(db.pointer!)) };
			},
			all: (...params: unknown[]) => rows(params, 'object'),
			get: (...params: unknown[]) => rows(params, 'object')[0] ?? null,
			values: (...params: unknown[]) => rows(params, 'array')
		};
	}

	/** Como `Database.query` de bun:sqlite: sentencia preparada y cacheada (parámetros `?1`, `?2`…). */
	query<R = unknown, P extends unknown[] = unknown[]>(sql: string) {
		const stmt = () => {
			let st = this.cache.get(sql);
			if (!st) {
				st = this.raw.prepare(sql);
				this.cache.set(sql, st);
			}
			return st;
		};
		const all = (...params: P): R[] => {
			const st = stmt();
			try {
				const b = bindable(params);
				if (b) st.bind(b);
				const out: R[] = [];
				while (st.step()) out.push(st.get({}) as R);
				return out;
			} finally {
				st.reset(true);
			}
		};
		return { all, get: (...params: P): R | null => all(...params)[0] ?? null };
	}

	/** Como `bun:sqlite`: devuelve una función con variantes .deferred/.immediate/.exclusive. */
	transaction<T>(fn: () => T) {
		const run = (mode: string) => () => {
			this.raw.exec(`BEGIN ${mode}`);
			try {
				const r = fn();
				this.raw.exec('COMMIT');
				return r;
			} catch (e) {
				this.raw.exec('ROLLBACK');
				throw e;
			}
		};
		return Object.assign(run('DEFERRED'), { deferred: run('DEFERRED'), immediate: run('IMMEDIATE'), exclusive: run('EXCLUSIVE') });
	}

	close() {
		for (const st of this.cache.values()) st.finalize();
		this.cache.clear();
		this.raw.close();
	}
}
