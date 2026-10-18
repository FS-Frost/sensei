/// <reference lib="webworker" />
// Service worker (PWA): la app abre sin conexión. Precachea el shell, el Worker de la base y sus .wasm.
// El diccionario (dict/, decenas de MB) NO se precachea: tras instalarlo vive en OPFS.
// Gemini y demás orígenes externos no se interceptan.
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Servido en `<base>/service-worker.js`: de ahí sale la base del sitio.
const BASE = sw.location.pathname.replace(/\/service-worker\.js$/, '');
const SHELL = `${BASE}/`;
const CACHE = `sensei-${version}`;

const url = (p: string) => `${BASE}/${p.replace(/^\//, '')}`;
const isDict = (p: string) => p.replace(/^\//, '').startsWith('dict/');
const PRECACHE = [...immutable.map((f) => url(f.path)), ...assets.filter((f) => !isDict(f.path)).map((f) => url(f.path))];
const PRECACHED = new Set(PRECACHE);

/**
 * Kit solo lista el punto de entrada del Worker de la base; sus chunks dinámicos (sqlite3-worker1, fsrs) y los
 * .wasm (SQLite, fsrs-rs) no. Se recorren las referencias desde ese punto de entrada para que la base
 * abra sin conexión desde la primera visita: absolutas («/base/_app/immutable/workers/…») y relativas («./chunks/x.js»).
 */
async function precacheWorkerGraph(cache: Cache) {
	const seen = new Set<string>();
	const queue = PRECACHE.filter((p) => p.includes('/_app/immutable/workers/') && p.endsWith('.js'));
	queue.forEach((p) => seen.add(p));
	while (queue.length) {
		const p = queue.shift()!;
		const res = await cache.match(p);
		if (!res) continue;
		const js = await res.text();
		const refs = [
			...[...js.matchAll(/[`"']([^`"'\s]*\/_app\/immutable\/workers\/[\w./-]+\.(?:js|wasm))[`"']/g)].map((m) => m[1]),
			...[...js.matchAll(/[`"'](\.{1,2}\/[\w./-]+\.js)[`"']/g)].map((m) => new URL(m[1], new URL(p, sw.location.origin)).pathname)
		];
		for (const r of refs) {
			const path = new URL(r, sw.location.origin).pathname;
			if (seen.has(path)) continue;
			seen.add(path);
			try {
				await cache.add(path);
				if (path.endsWith('.js')) queue.push(path);
			} catch {
				/* referencia que no es un archivo real: se ignora */
			}
		}
	}
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([...PRECACHE, SHELL]);
			await precacheWorkerGraph(cache);
			// Sin skipWaiting: si una página vieja sigue abierta, activarse ahora borraría la caché de la que aún carga
			// chunks diferidos. La página lo pide (client/pwa.ts → applyUpdate) justo antes de recargar.
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key.startsWith('sensei-') && key !== CACHE && key !== 'sensei-kanjivg') await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const u = new URL(req.url);
	if (u.origin !== sw.location.origin) return;
	// Diccionario: siempre de la red (el Worker lo descarga una vez y lo guarda en OPFS).
	if (u.pathname.startsWith(`${BASE}/dict/`)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Archivos con hash (incluido el grafo del Worker) y estáticos: caché primero.
			if (PRECACHED.has(u.pathname) || u.pathname.startsWith(`${BASE}/_app/immutable/`)) {
				const hit = await cache.match(u.pathname);
				if (hit) return hit;
			}
			// Navegación (SPA): red primero; sin conexión, el shell.
			if (req.mode === 'navigate') {
				try {
					return await fetch(req);
				} catch {
					return (await cache.match(SHELL)) ?? Response.error();
				}
			}
			// Resto: red con relleno de caché; sin conexión, lo cacheado.
			try {
				const res = await fetch(req);
				if (res.ok && res.type === 'basic') void cache.put(req, res.clone());
				return res;
			} catch {
				return (await cache.match(req)) ?? Response.error();
			}
		})()
	);
});
