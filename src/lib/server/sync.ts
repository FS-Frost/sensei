// Sincronización entre dispositivos (P2P): lo que corre en el Worker. La conexión (sonido, QR, WebRTC) vive en la
// página (client/sync/); aquí solo hay estado, snapshot, aplicar y dispositivos recordados. Ver docs/sync-qr.md.
import { sql } from 'drizzle-orm';
import { one, type DB } from './db/index.ts';
import { buildSnapshot, countSnapshot, FORMAT, snapshotHash, snapshotToZip } from './data/snapshot.ts';
import { restoreFromZip } from './data/restore.ts';
import { getInternal, setInternal } from './settings.ts';

export type SyncPeer = {
	/** deviceId del otro dispositivo. */
	id: string;
	name: string;
	/** Clave compartida (base64url, 32 bytes) para reconocerse sin código. */
	key: string;
	/** Hash de MIS datos justo después de la última sincronización con él. */
	lastHash: string | null;
	lastAt: number | null;
};

export type SyncState = {
	app: 'sensei';
	format: number;
	deviceId: string;
	hash: string;
	empty: boolean;
	counts: Record<string, number>;
	/** Último cambio aproximado (máximo de varias marcas de tiempo). */
	updatedAt: number | null;
};

/** Identificador estable de este navegador (interno: nunca se exporta). */
export function deviceId(db: DB) {
	let id = getInternal(db, 'deviceId');
	if (!id) {
		id = crypto.randomUUID();
		setInternal(db, 'deviceId', id);
	}
	return id;
}

function lastChange(db: DB): number | null {
	const r = one<{ t: number | null }>(
		sql`select max(t) as t from (
			select max(reviewed_at) as t from review_log
			union all select max(created_at) from card
			union all select max(created_at) from message
			union all select max(created_at) from reading_log
			union all select max(created_at) from learner_note
			union all select max(created_at) from mined_sentence
			union all select max(at) from gemini_usage
		)`,
		db
	);
	return r?.t ?? null;
}

/** «Vacío» para sincronizar = sin progreso ni actividad (los ajustes de la bienvenida no cuentan). */
const ACTIVITY = ['cards', 'reviews', 'sessions', 'messages', 'library', 'minedSentences', 'readings', 'notes'];

export function syncState(db: DB): SyncState {
	const snap = buildSnapshot(db);
	const counts = countSnapshot(snap);
	return {
		app: 'sensei',
		format: FORMAT,
		deviceId: deviceId(db),
		hash: snapshotHash(snap),
		empty: ACTIVITY.every((k) => !counts[k]),
		counts,
		updatedAt: lastChange(db)
	};
}

/** Estado + relación con un dispositivo concreto (para el saludo del protocolo). */
export function stateFor(db: DB, peerId?: string | null) {
	const st = syncState(db);
	const peer = peerId ? getPeer(db, peerId) : null;
	return {
		...st,
		peer: peer ? { id: peer.id, name: peer.name, key: peer.key, lastAt: peer.lastAt } : null,
		changed: peer?.lastHash ? peer.lastHash !== st.hash : null
	};
}

export function syncZip(db: DB) {
	const snap = buildSnapshot(db);
	return { zip: snapshotToZip(snap, 'sync').zip, hash: snapshotHash(snap) };
}

/** Aplica lo recibido (reemplaza, con copia `pre-sync` antes). Devuelve el hash resultante. */
export async function applySync(db: DB, bytes: Uint8Array) {
	const r = await restoreFromZip(db, bytes, { dry: false, backupKind: 'pre-sync' });
	return { hash: syncState(db).hash, backup: r.backup ?? null };
}

// ---------- Dispositivos recordados (valor interno `_syncPeers`) ----------

export function listPeers(db: DB): SyncPeer[] {
	try {
		return JSON.parse(getInternal(db, 'syncPeers') ?? '[]') as SyncPeer[];
	} catch {
		return [];
	}
}

function savePeers(db: DB, peers: SyncPeer[]) {
	setInternal(db, 'syncPeers', JSON.stringify(peers));
}

export function getPeer(db: DB, id: string) {
	return listPeers(db).find((p) => p.id === id) ?? null;
}

export function upsertPeer(db: DB, peer: Pick<SyncPeer, 'id' | 'name' | 'key'>) {
	if (!/^[\w-]{8,64}$/.test(peer.id)) throw new Error('Identificador de dispositivo inválido');
	if (!/^[\w-]{40,64}$/.test(peer.key)) throw new Error('Clave inválida');
	const peers = listPeers(db);
	const old = peers.find((p) => p.id === peer.id);
	const next: SyncPeer = { lastHash: null, lastAt: null, ...old, id: peer.id, name: peer.name.slice(0, 60) || 'Dispositivo', key: peer.key };
	savePeers(db, [...peers.filter((p) => p.id !== peer.id), next]);
	return next;
}

export function renamePeer(db: DB, id: string, name: string) {
	const peers = listPeers(db);
	const p = peers.find((x) => x.id === id);
	if (!p) throw new Error('Dispositivo no encontrado');
	p.name = name.trim().slice(0, 60) || p.name;
	savePeers(db, peers);
	return p;
}

export function forgetPeer(db: DB, id: string) {
	savePeers(
		db,
		listPeers(db).filter((p) => p.id !== id)
	);
}

/** Tras sincronizar con un recordado: guarda el hash de MIS datos en ese momento. */
export function markSynced(db: DB, id: string, hash: string, at = Date.now()) {
	const peers = listPeers(db);
	const p = peers.find((x) => x.id === id);
	if (!p) return null;
	p.lastHash = hash;
	p.lastAt = at;
	savePeers(db, peers);
	return p;
}
