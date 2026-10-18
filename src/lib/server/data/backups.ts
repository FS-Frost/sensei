// Copias de seguridad: automáticas (1/día), manuales y previas a operaciones de riesgo.
// En el navegador se guardan en OPFS (store.ts); se pueden descargar, restaurar o borrar desde Datos.
// Retención: se borran las de más de 7 días, salvo la más reciente (nunca te quedas sin ninguna).
import type { DB } from '../db/index.ts';
import { buildSnapshot, isEmpty, readManifest, snapshotHash, snapshotToZip, type Manifest } from './snapshot.ts';
import { memoryStore, type BlobStore } from './store.ts';

export const RETENTION_DAYS = 7;

export type BackupKind = 'auto' | 'manual' | 'pre-import' | 'pre-restore' | 'pre-reset' | 'pre-update' | 'pre-sync' | 'pre-vacuum';
export const KIND_LABELS: Record<BackupKind, string> = {
	auto: 'Automática diaria',
	manual: 'Manual',
	'pre-import': 'Antes de importar',
	'pre-restore': 'Antes de restaurar',
	'pre-reset': 'Antes de reiniciar',
	'pre-update': 'Antes de actualizar el diccionario',
	'pre-sync': 'Antes de sincronizar',
	'pre-vacuum': 'Antes de compactar la base'
};

export type BackupInfo = { name: string; kind: BackupKind; createdAt: number; size: number; counts: Record<string, number> | null };

// sensei-2026-10-16T23-10-05-123-auto.zip
const NAME_RE = /^sensei-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})-(auto|manual|pre-import|pre-restore|pre-reset|pre-update|pre-sync|pre-vacuum)\.zip$/;

let defaultStore: BlobStore = memoryStore();

/** El Worker la configura con OPFS al arrancar. */
export function setBackupStore(store: BlobStore) {
	defaultStore = store;
}

export function isBackupName(name: string) {
	return NAME_RE.test(name);
}

function stamp(d: Date) {
	return d.toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

function parseStamp(st: string) {
	const [date, time] = st.split('T');
	const [h, m, sec, ms] = time.split('-');
	return Date.parse(`${date}T${h}:${m}:${sec}.${ms}Z`);
}

export async function listBackups(store = defaultStore): Promise<BackupInfo[]> {
	return (await store.list())
		.map(({ name, size }) => {
			const m = name.match(NAME_RE);
			if (!m) return null;
			return { name, kind: m[2] as BackupKind, createdAt: parseStamp(m[1]), size, counts: null } as BackupInfo;
		})
		.filter((b): b is BackupInfo => b !== null)
		.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readBackup(name: string, store = defaultStore): Promise<Uint8Array | null> {
	if (!isBackupName(name)) throw new Error('Nombre de copia inválido');
	return store.read(name);
}

export async function backupManifest(name: string, store = defaultStore): Promise<Manifest | null> {
	const bytes = await readBackup(name, store);
	return bytes ? readManifest(bytes) : null;
}

export async function createBackup(db: DB, kind: BackupKind, now = new Date(), store = defaultStore): Promise<BackupInfo> {
	const { zip, manifest } = snapshotToZip(buildSnapshot(db), kind, now);
	const name = `sensei-${stamp(now)}-${kind}.zip`;
	await store.write(name, zip);
	await pruneBackups(now, store);
	return { name, kind, createdAt: now.getTime(), size: zip.byteLength, counts: manifest.counts };
}

export async function deleteBackup(name: string, store = defaultStore) {
	if (!isBackupName(name)) throw new Error('Nombre de copia inválido');
	await store.remove(name);
}

/** Borra las copias de más de RETENTION_DAYS días, excepto la más reciente. Devuelve las borradas. */
export async function pruneBackups(now = new Date(), store = defaultStore): Promise<string[]> {
	const all = await listBackups(store);
	const limit = now.getTime() - RETENTION_DAYS * 86_400_000;
	const removed: string[] = [];
	for (const b of all.slice(1)) {
		if (b.createdAt < limit) {
			await store.remove(b.name);
			removed.push(b.name);
		}
	}
	return removed;
}

function localDate(t: number) {
	const d = new Date(t);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Copia automática diaria: una por día natural, salvo que no haya datos o que nada haya cambiado
 * desde la última copia (de cualquier tipo).
 */
export async function ensureDailyBackup(db: DB, now = new Date(), store = defaultStore): Promise<BackupInfo | null> {
	const all = await listBackups(store);
	if (all.some((b) => b.kind === 'auto' && localDate(b.createdAt) === localDate(now.getTime()))) return null;
	const snap = buildSnapshot(db);
	if (isEmpty(snap)) return null;
	const latest = all[0];
	if (latest) {
		const bytes = await store.read(latest.name);
		const m = bytes ? readManifest(bytes) : null;
		if (m?.hash === snapshotHash(snap)) return null;
	}
	return createBackup(db, 'auto', now, store);
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Comprueba al abrir la app y cada hora mientras siga abierta. */
export function startBackupScheduler(db: DB) {
	if (timer) return;
	const tick = () =>
		ensureDailyBackup(db)
			.then((b) => b && console.log(`[sensei] copia automática: ${b.name}`))
			.catch((e) => console.warn('[sensei] copia automática falló:', e instanceof Error ? e.message : e));
	void tick();
	timer = setInterval(tick, 3_600_000);
}
