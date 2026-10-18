// Almacenamiento (Datos → Almacenamiento): tamaño de la base y de las copias, comprobación de integridad,
// compactación (VACUUM, con copia previa) y poda inmediata de copias. Las cachés y la cuota del sitio las mide
// la página (components/StoragePanel.svelte): el Worker no ve la Cache API del documento de forma fiable.
// El tamaño de la base sale de PRAGMA (no de OPFS): el VFS opfs-sahpool tiene los archivos abiertos en exclusiva.
import { sql } from 'drizzle-orm';
import { one, type DB } from '../db/index.ts';
import { createBackup, deleteBackup, listBackups } from './backups.ts';
import { getInternal } from '../settings.ts';

export type DbStats = {
	bytes: number;
	pageSize: number;
	pages: number;
	freePages: number;
	/** Fracción de páginas libres (0-1): por encima de ~10 % compactar recupera espacio. */
	freeRatio: number;
	/** Tablas más grandes (si el SQLite tiene `dbstat`; si no, vacío). */
	tables: { name: string; bytes: number }[];
};

const pragma = (db: DB, name: string) => Number(Object.values(one<Record<string, number>>(sql.raw(`PRAGMA ${name}`), db) ?? {})[0] ?? 0);

export function dbStats(db: DB): DbStats {
	const pageSize = pragma(db, 'page_size');
	const pages = pragma(db, 'page_count');
	const freePages = pragma(db, 'freelist_count');
	let tables: DbStats['tables'] = [];
	try {
		tables = db
			.all<{ name: string; bytes: number }>(sql`select name, sum(pgsize) as bytes from dbstat group by name order by bytes desc limit 12`)
			.map((r) => ({ name: r.name, bytes: Number(r.bytes) }));
	} catch {
		/* SQLite compilado sin dbstat: sin desglose */
	}
	return { bytes: pageSize * pages, pageSize, pages, freePages, freeRatio: pages ? freePages / pages : 0, tables };
}

export async function storageReport(db: DB) {
	const backups = await listBackups();
	return {
		db: dbStats(db),
		dict: { variant: getInternal(db, 'dictVariant') ?? 'common', version: getInternal(db, 'dictVersion') },
		backups: { count: backups.length, bytes: backups.reduce((a, b) => a + b.size, 0), newest: backups[0]?.createdAt ?? null }
	};
}

/** `PRAGMA integrity_check`: 'ok' o la lista de problemas (como mucho 20). */
export function integrityCheck(db: DB): { ok: boolean; problems: string[] } {
	const rows = db.all<Record<string, string>>(sql`PRAGMA integrity_check(20)`).map((r) => String(Object.values(r)[0]));
	const ok = rows.length === 1 && rows[0] === 'ok';
	return { ok, problems: ok ? [] : rows };
}

/** Compacta la base. Antes, copia `pre-vacuum`. Devuelve los bytes antes y después. */
export async function vacuum(db: DB, now = new Date()) {
	const before = dbStats(db).bytes;
	const backup = await createBackup(db, 'pre-vacuum', now);
	db.run(sql`VACUUM`);
	return { before, after: dbStats(db).bytes, backup: backup.name };
}

/** Borra ahora todas las copias salvo la más reciente. Devuelve cuántas y cuánto se liberó. */
export async function pruneAllButNewest() {
	const all = await listBackups();
	let bytes = 0;
	for (const b of all.slice(1)) {
		await deleteBackup(b.name);
		bytes += b.size;
	}
	return { removed: Math.max(0, all.length - 1), bytes };
}
