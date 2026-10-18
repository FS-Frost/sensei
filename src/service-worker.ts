/// <reference lib="webworker" />
// Service worker (PWA): la app abre sin conexión. Precachea el shell, el Worker de la base y sus .wasm.
// El diccionario (dict/, decenas de MB) NO se precachea: tras instalarlo vive en OPFS.
// Gemini y demás orígenes externos no se interceptan.
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';
import {
	dayKey,
	dueAt,
	INBOX_CACHE,
	inboxKey,
	KEPT_CACHES,
	notifiedKey,
	PERIODIC_TAG,
	REMINDER_CACHE,
	reminderKey,
	reminderText,
	toNotify,
	type InboxMeta,
	type Schedule
} from './lib/client/pwa-core.ts';

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
	const isWorker = (p: string) => p.includes('/_app/immutable/workers/');
	// También los chunks del cliente: referencian módulos de workers/ (p. ej. el AudioWorklet de captura de sonido).
	const queue = PRECACHE.filter((p) => p.endsWith('.js'));
	queue.forEach((p) => seen.add(p));
	while (queue.length) {
		const p = queue.shift()!;
		const res = await cache.match(p);
		if (!res) continue;
		const js = await res.text();
		const refs = [
			...[...js.matchAll(/[`"']([^`"'\s]*\/_app\/immutable\/workers\/[\w./-]+\.(?:js|wasm))[`"']/g)].map((m) => m[1]),
			// Rutas relativas solo dentro de los workers (los chunks del cliente ya están todos en PRECACHE).
			...(isWorker(p) ? [...js.matchAll(/[`"'](\.{1,2}\/[\w./-]+\.js)[`"']/g)].map((m) => new URL(m[1], new URL(p, sw.location.origin)).pathname) : [])
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
			for (const key of await caches.keys())
				if (key.startsWith('sensei-') && key !== CACHE && !KEPT_CACHES.includes(key)) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

/**
 * Compartir hacia Sensei (manifest `share_target`, POST multipart a <base>/compartir): se guarda en la caché-bandeja y se
 * redirige a /compartir, que la lee (client/inbox.ts) y propone qué hacer.
 */
async function receiveShare(req: Request) {
	const fd = await req.formData();
	await caches.delete(INBOX_CACHE);
	const cache = await caches.open(INBOX_CACHE);
	const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	const meta: InboxMeta = {
		title: String(fd.get('title') ?? '') || undefined,
		text: String(fd.get('text') ?? '') || undefined,
		url: String(fd.get('url') ?? '') || undefined,
		files: files.map((f, i) => ({ key: `file-${i}`, name: f.name, type: f.type })),
		at: Date.now()
	};
	for (const [i, f] of files.entries()) await cache.put(inboxKey(BASE, `file-${i}`), new Response(f, { headers: { 'Content-Type': f.type } }));
	await cache.put(inboxKey(BASE, 'meta.json'), Response.json(meta));
	return Response.redirect(`${BASE}/compartir?compartido=1`, 303);
}

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	const u = new URL(req.url);
	if (req.method === 'POST' && u.origin === sw.location.origin && u.pathname.replace(/\/$/, '') === `${BASE}/compartir`) {
		event.respondWith(receiveShare(req).catch(() => Response.redirect(`${BASE}/compartir?error=1`, 303)));
		return;
	}
	if (req.method !== 'GET') return;
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

// ---------- Recordatorio de repasos (sincronización periódica: Chromium, app instalada) ----------
// El SW no puede abrir la base (SQLite vive en un Worker dedicado): cuenta con los vencimientos que dejó la página.

type Badging = { setAppBadge?(n?: number): Promise<void>; clearAppBadge?(): Promise<void> };

async function remind() {
	const cache = await caches.open(REMINDER_CACHE);
	const res = await cache.match(reminderKey(BASE));
	if (!res) return;
	const s = (await res.json()) as Schedule;
	const now = new Date();
	const n = dueAt(s, now.getTime());
	const nav = sw.navigator as unknown as Badging;
	await (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
	const last = (await (await cache.match(notifiedKey(BASE)))?.json().catch(() => null)) as { day: string } | null;
	const count = toNotify(s, now, last?.day ?? null);
	if (!count) return;
	// Con la app a la vista, no hace falta avisar.
	const windows = await sw.clients.matchAll({ type: 'window' });
	if (windows.some((c) => c.visibilityState === 'visible')) return;
	await sw.registration.showNotification('Sensei', {
		body: reminderText(count),
		tag: PERIODIC_TAG,
		icon: url('icons/icon-192.png'),
		data: { url: url('hoy') } // la sesión diaria: repasos primero, y lo demás si hay tiempo
	});
	await cache.put(notifiedKey(BASE), Response.json({ day: dayKey(now) }));
}

sw.addEventListener('periodicsync', (event) => {
	const e = event as ExtendableEvent & { tag: string };
	if (e.tag === PERIODIC_TAG) e.waitUntil(remind());
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data as { url?: string } | null)?.url ?? SHELL;
	event.waitUntil(
		(async () => {
			const windows = (await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })) as WindowClient[];
			const w = windows[0];
			if (w) {
				await w.focus();
				await w.navigate(target).catch(() => {});
			} else await sw.clients.openWindow(target);
		})()
	);
});
