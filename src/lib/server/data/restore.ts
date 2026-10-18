import { sql } from 'drizzle-orm';
import { one, type DB } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { createBackup, type BackupKind } from './backups.ts';
import {
	applySnapshot,
	buildSnapshot,
	countSnapshot,
	readZip,
	sectionCounts,
	SnapshotError,
	type Manifest,
	type Section
} from './snapshot.ts';
import { openSecret, SecretError } from './secret.ts';
import { getInternal, setInternal, syncAiMode } from '../settings.ts';
import { setGeminiApiKey } from '../config.ts';

export const MAX_UPLOAD = 50 * 1024 * 1024;

export type RestorePreview = {
	createdAt: string;
	kind: string;
	incoming: Record<string, number>;
	current: Record<string, number>;
	/** Secciones que trae el archivo, con su recuento y el tuyo actual. */
	sections: { id: Section; incoming: Record<string, number>; current: Record<string, number> }[];
	/** Preferencias del dispositivo que trae (las aplica la página). */
	device: Record<string, string> | null;
	/** Trae la API key de Gemini cifrada. */
	hasKey: boolean;
	/** Ya hay una API key guardada aquí (importarla la sustituiría). */
	currentKey: boolean;
	dict: Manifest['dict'] | null;
};

export type RestoreOptions = {
	dry: boolean;
	backupKind: Extract<BackupKind, 'pre-import' | 'pre-restore' | 'pre-sync'>;
	/** Solo estas secciones (por defecto, todas las que trae). */
	sections?: Section[];
	/** Aplicar la API key cifrada con esta contraseña. */
	keyPassword?: string;
};

/**
 * Importa/restaura un .zip reemplazando las secciones elegidas. Antes crea una copia `pre-*` del estado actual.
 * Con `dry` solo valida y devuelve qué trae y qué tienes. Con `keyPassword`, comprueba la contraseña (también en
 * `dry`, para avisar antes de reemplazar nada) y aplica la API key.
 */
export async function restoreFromZip(
	db: DB,
	bytes: Uint8Array,
	opts: RestoreOptions
): Promise<RestorePreview & { backup?: string; applied?: Section[]; keyApplied?: boolean }> {
	let parsed;
	try {
		parsed = readZip(bytes);
	} catch (e) {
		if (e instanceof SnapshotError) throw new HttpError(400, e.message);
		throw e;
	}
	const dictionaries = one<{ n: number }>(sql`select count(*) as n from kanji`, db)?.n ?? 0;
	if (!dictionaries) throw new HttpError(409, 'Primero descarga el diccionario: el progreso se refiere a él.');
	const current = buildSnapshot(db);
	const inc = sectionCounts(parsed.snap);
	const cur = sectionCounts(current);
	const preview: RestorePreview = {
		createdAt: parsed.manifest.createdAt,
		kind: parsed.manifest.kind,
		incoming: parsed.manifest.counts ?? countSnapshot(parsed.snap),
		current: countSnapshot(current),
		sections: parsed.sections.map((id) => ({ id, incoming: inc[id], current: cur[id] })),
		device: parsed.device,
		hasKey: !!parsed.secret,
		currentKey: !!getInternal(db, 'geminiApiKey'),
		dict: parsed.manifest.dict ?? null
	};
	const chosen = (opts.sections ?? parsed.sections).filter((x) => parsed.sections.includes(x));
	let key: string | null = null;
	if (opts.keyPassword !== undefined) {
		if (!parsed.secret) throw new HttpError(400, 'El archivo no trae la API key');
		try {
			key = (await openSecret(parsed.secret.geminiApiKey, opts.keyPassword)).trim();
		} catch (e) {
			if (e instanceof SecretError) throw new HttpError(400, e.message);
			throw e;
		}
		if (!/^[\w-]{20,}$/.test(key)) throw new HttpError(400, 'La API key del archivo no es válida');
	}
	if (opts.dry) return preview;
	if (!chosen.length && key === null) throw new HttpError(400, 'Elige al menos una sección');
	const backup = await createBackup(db, opts.backupKind);
	if (chosen.length) applySnapshot(db, parsed.snap, chosen);
	// Los ajustes importados pueden traer otro modo de IA.
	syncAiMode(db);
	if (key !== null) {
		setInternal(db, 'geminiApiKey', key);
		setGeminiApiKey(key);
	}
	return { ...preview, backup: backup.name, applied: chosen, keyApplied: key !== null };
}
