// «Servidor en el navegador»: este Dedicated Worker abre SQLite (OPFS), instala el diccionario y atiende
// las peticiones /api/* y los `load` de las páginas con los mismos manejadores que tenía la versión con servidor.
// La página habla con él mediante src/lib/client/backend.svelte.ts (fetch parcheado + loads).
import { db as activeDb, setDb, type DB } from '../server/db/index.ts';
import { exportDbFile, hasDbFile, importDbFile, initSqlite, openWasmDb, type BunLikeClient } from '../server/db/wasm.ts';
import { buildRoutes, dispatch, LoadError, LoadRedirect, type ServerLoad } from '../server/router.ts';
import { createBackup, setBackupStore, startBackupScheduler } from '../server/data/backups.ts';
import { opfsStore } from '../server/data/store.ts';
import { getInternal } from '../server/settings.ts';
import { setGeminiApiKey } from '../server/config.ts';
import {
	captureUserData,
	currentDict,
	downloadDict,
	fetchManifest,
	markDict,
	restoreUserData
} from '../server/data/dictionary.ts';
import type { BackendState, DictManifest, DictVariant, FromWorker, LoadResult, ToWorker } from '../backendProtocol.ts';

const routes = buildRoutes(import.meta.glob('/src/lib/server/api/**/+server.ts', { eager: true }));
const loads = import.meta.glob('/src/lib/server/loads/*.ts', { eager: true }) as Record<string, { load: ServerLoad }>;

let assets = '';
let state: BackendState = { state: 'starting' };
let conn: { db: DB; client: BunLikeClient } | null = null;
let manifest: DictManifest | null = null;
const aborts = new Map<number, AbortController>();

function post(msg: FromWorker, transfer: Transferable[] = []) {
	(self as unknown as Worker).postMessage(msg, transfer);
}

function setState(next: BackendState) {
	state = next;
	post({ type: 'state', value: next });
}

function errMsg(e: unknown) {
	return e instanceof Error ? e.message : String(e);
}

// ---------- Arranque ----------

/** La base es exclusiva de una pestaña: Web Locks evita que otra la abra a la vez. */
function holdLock(): Promise<boolean> {
	if (!('locks' in navigator)) return Promise.resolve(true);
	return new Promise((resolve) => {
		navigator.locks.request('sensei-db', { ifAvailable: true }, (lock) => {
			if (!lock) {
				resolve(false);
				return;
			}
			resolve(true);
			return new Promise(() => {}); // se libera al cerrar la pestaña
		});
	});
}

async function open() {
	conn?.client.close();
	conn = await openWasmDb();
	setDb(conn.db);
	setGeminiApiKey(getInternal(conn.db, 'geminiApiKey') ?? '');
	setBackupStore(opfsStore('backups'));
	// Con el proxy `db`: si luego se cambia de base (actualizar diccionario), el temporizador sigue valiendo.
	startBackupScheduler(activeDb);
}

function readyState(): BackendState {
	const dict = currentDict(conn!.db);
	// Hay versión nueva publicada (otra build del diccionario o del esquema).
	const update = manifest && dict.version && manifest.version !== dict.version ? manifest : null;
	return { state: 'ready', dict, update };
}

async function init(a: string) {
	assets = a;
	if (!(await holdLock())) return setState({ state: 'locked' });
	try {
		await initSqlite();
	} catch (e) {
		return setState({ state: 'unsupported', error: errMsg(e) });
	}
	manifest = await fetchManifest(assets);
	try {
		if (!(await hasDbFile())) return setState({ state: 'needs-dict', manifest });
		await open();
		setState(readyState());
	} catch (e) {
		setState({ state: 'error', error: errMsg(e) });
	}
}

/** Instala (primera vez) o actualiza/cambia el diccionario conservando los datos del alumno. */
async function install(variant: DictVariant) {
	try {
		manifest = (await fetchManifest(assets)) ?? manifest;
		if (!manifest) throw new Error('No se encontró el diccionario publicado (dict/manifest.json).');
		const bytes = await downloadDict(assets, manifest, variant, (loaded, total) =>
			setState({ state: 'installing', phase: 'download', loaded, total, variant })
		);
		setState({ state: 'installing', phase: 'install', loaded: 0, total: 0, variant });
		let saved: ReturnType<typeof captureUserData> | null = null;
		if (conn) {
			await createBackup(conn.db, 'pre-update');
			saved = captureUserData(conn.db);
			conn.client.close();
			conn = null;
			setDb(null);
		}
		await importDbFile(bytes);
		await open();
		if (saved) {
			setState({ state: 'installing', phase: 'restore', loaded: 0, total: 0, variant });
			restoreUserData(conn!.db, saved);
			setGeminiApiKey(getInternal(conn!.db, 'geminiApiKey') ?? '');
		}
		markDict(conn!.db, manifest, variant);
		setState(readyState());
	} catch (e) {
		if (conn) setState(readyState());
		else setState({ state: 'needs-dict', manifest, error: errMsg(e) });
		console.error('[sensei] instalación del diccionario', e);
	}
}

// ---------- Peticiones ----------

async function handleFetch(msg: Extract<ToWorker, { type: 'fetch' }>) {
	const ctrl = new AbortController();
	aborts.set(msg.id, ctrl);
	try {
		if (state.state !== 'ready') throw new Error('Sensei todavía no está listo');
		const hasBody = msg.body && !['GET', 'HEAD'].includes(msg.method.toUpperCase());
		const req = new Request(msg.url, { method: msg.method, headers: msg.headers, body: hasBody ? msg.body : undefined, signal: ctrl.signal });
		const res = await dispatch(routes, req);
		post({ type: 'response', id: msg.id, status: res.status, statusText: res.statusText, headers: [...res.headers] });
		if (res.body) {
			const reader = res.body.getReader();
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				if (ctrl.signal.aborted) {
					await reader.cancel();
					break;
				}
				const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
				post({ type: 'chunk', id: msg.id, chunk }, [chunk.buffer]);
			}
		}
		post({ type: 'end', id: msg.id });
	} catch (e) {
		console.error('[api]', msg.method, msg.url, e);
		post({ type: 'fail', id: msg.id, message: errMsg(e) });
	} finally {
		aborts.delete(msg.id);
	}
}

async function handleLoad(msg: Extract<ToWorker, { type: 'load' }>) {
	let result: LoadResult;
	try {
		const mod = loads[`/src/lib/server/loads/${msg.route}.ts`];
		if (!mod) throw new Error(`No hay load para ${msg.route}`);
		result = { ok: true, data: await mod.load({ params: msg.params, url: new URL(msg.url) }) };
	} catch (e) {
		if (e instanceof LoadRedirect) result = { ok: false, redirect: { status: e.status, location: e.location } };
		else if (e instanceof LoadError) result = { ok: false, error: { status: e.status, message: e.message } };
		else {
			console.error('[load]', msg.route, e);
			result = { ok: false, error: { status: 500, message: errMsg(e) } };
		}
	}
	post({ type: 'loaded', id: msg.id, result });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
	const msg = ev.data;
	if (msg.type === 'init') void init(msg.assets);
	else if (msg.type === 'install') void install(msg.variant);
	else if (msg.type === 'fetch') void handleFetch(msg);
	else if (msg.type === 'abort') aborts.get(msg.id)?.abort();
	else if (msg.type === 'load') void handleLoad(msg);
};

/** Comprueba que la calibración (fsrs-rs en WASM) funciona en este navegador, con un historial sintético. */
async function fsrsSelfTest() {
	const { computeParameters, FSRSBindingItem, FSRSBindingReview } = await import('@open-spaced-repetition/binding');
	// Historiales verosímiles: intervalos crecientes con algún fallo (formato de fsrs-rs: un ítem por prefijo).
	const items = [];
	let seed = 7;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	for (let c = 0; c < 400; c++) {
		const revs = [new FSRSBindingReview(3, 0)];
		let ivl = 1;
		for (let k = 0; k < 6; k++) {
			const fail = rnd() < 0.15;
			revs.push(new FSRSBindingReview(fail ? 1 : rnd() < 0.2 ? 4 : 3, ivl));
			ivl = fail ? 1 : Math.round(ivl * (2 + rnd() * 1.5));
			items.push(new FSRSBindingItem(revs.slice()));
		}
	}
	const params = await computeParameters(items, { enableShortTerm: true });
	return params.length;
}

// Para depurar desde la consola del Worker.
(self as unknown as Record<string, unknown>).__sensei = { exportDbFile, getState: () => state, fsrsSelfTest };
