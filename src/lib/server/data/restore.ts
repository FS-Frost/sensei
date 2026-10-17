import { sql } from 'drizzle-orm';
import { one, type DB } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { createBackup, type BackupKind } from './backups.ts';
import { applySnapshot, buildSnapshot, countSnapshot, readZip, SnapshotError } from './snapshot.ts';

export const MAX_UPLOAD = 50 * 1024 * 1024;

export type RestorePreview = {
	createdAt: string;
	kind: string;
	incoming: Record<string, number>;
	current: Record<string, number>;
};

/**
 * Importa/restaura un .zip reemplazando el estado actual. Antes crea una copia `pre-*` del estado actual.
 * Con `dry` solo valida y devuelve qué se reemplazaría.
 */
export async function restoreFromZip(
	db: DB,
	bytes: Uint8Array,
	opts: { dry: boolean; backupKind: Extract<BackupKind, 'pre-import' | 'pre-restore'> }
): Promise<RestorePreview & { backup?: string }> {
	let parsed;
	try {
		parsed = readZip(bytes);
	} catch (e) {
		if (e instanceof SnapshotError) throw new HttpError(400, e.message);
		throw e;
	}
	const dictionaries = one<{ n: number }>(sql`select count(*) as n from kanji`, db)?.n ?? 0;
	if (!dictionaries) throw new HttpError(409, 'Primero descarga el diccionario: el progreso se refiere a él.');
	const preview: RestorePreview = {
		createdAt: parsed.manifest.createdAt,
		kind: parsed.manifest.kind,
		incoming: parsed.manifest.counts ?? countSnapshot(parsed.snap),
		current: countSnapshot(buildSnapshot(db))
	};
	if (opts.dry) return preview;
	const backup = await createBackup(db, opts.backupKind);
	applySnapshot(db, parsed.snap);
	return { ...preview, backup: backup.name };
}
