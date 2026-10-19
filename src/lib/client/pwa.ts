// PWA: registro del service worker (solo en build; en dev Vite no lo genera igual y la caché estorba).
// Actualizar: el SW nuevo se instala y ESPERA; `applyUpdate` lo activa y recarga (aviso en components/UpdateNotice.svelte).
import { base } from './base.ts';
import { KEPT_CACHES } from './pwa-core.ts';

let reg: ServiceWorkerRegistration | undefined;

export async function registerServiceWorker() {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
	try {
		reg = await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
		// Un SW en espera al abrir: esta página ya vino de la red (navegación «red primero»), es decir, ya es la versión
		// nueva. Activarlo no rompe nada y renueva la caché sin conexión.
		if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage('SKIP_WAITING');
	} catch (err) {
		console.error('[sensei] registro del service worker falló', err);
	}
}

/** Espera a que un SW en instalación termine (instalado o descartado), como mucho `ms`. */
function installed(w: ServiceWorker, ms = 20_000) {
	return new Promise<ServiceWorker | null>((resolve) => {
		const done = () => {
			if (w.state === 'installed' || w.state === 'activated') resolve(w);
			else if (w.state === 'redundant') resolve(null);
		};
		w.addEventListener('statechange', done);
		setTimeout(() => resolve(null), ms);
		done();
	});
}

/** Versión que se intentó cargar con «Actualizar» (para detectar, tras recargar, que no llegó). */
const TARGET = 'sensei.updateTarget';

async function publishedVersion() {
	const res = await fetch(`${base}/_app/version.json`, { cache: 'no-cache' });
	return ((await res.json()) as { version: string }).version;
}

/**
 * ¿El shell que sirve el hosting ya es el de esa versión? Justo tras publicar, la CDN de GitHub Pages puede dar el
 * `version.json` nuevo y aún unos minutos el `index.html` viejo: recargar entonces volvería a la versión anterior.
 * `cache: 'reload'` además refresca la caché HTTP del navegador con lo que llegue.
 */
async function shellIs(version: string) {
	const html = await (await fetch(`${base}/`, { cache: 'reload' })).text();
	return html.includes(`version: "${version}"`) || html.includes(`version:"${version}"`);
}

export type UpdateResult = 'reloading' | 'publishing' | 'offline';

let applying = false;

/**
 * Pasa a la versión publicada: comprueba que ya se sirve, baja el SW nuevo (si lo hay), lo activa y recarga una sola
 * vez. Si la versión aún se está publicando o no hay conexión, no recarga y lo dice.
 */
export async function applyUpdate(): Promise<UpdateResult> {
	if (applying) return 'reloading';
	applying = true;
	let target: string;
	try {
		target = await publishedVersion();
		if (!(await shellIs(target))) {
			applying = false;
			return 'publishing';
		}
	} catch {
		applying = false;
		return 'offline';
	}
	try {
		sessionStorage.setItem(TARGET, target);
	} catch {
		/* sin almacenamiento: no se podrá avisar si falla */
	}
	let reloaded = false;
	const reload = () => {
		if (reloaded) return;
		reloaded = true;
		location.reload();
	};
	const r = reg ?? (await navigator.serviceWorker?.getRegistration(`${base}/`).catch(() => undefined));
	if (!r || !navigator.serviceWorker.controller) {
		reload();
		return 'reloading';
	}
	try {
		await r.update();
	} catch {
		/* el shell ya llegó: se recarga igual */
	}
	const next = r.waiting ?? (r.installing ? await installed(r.installing) : null);
	if (!next || next === navigator.serviceWorker.controller) {
		reload();
		return 'reloading';
	}
	navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
	next.postMessage('SKIP_WAITING');
	setTimeout(reload, 4000); // respaldo si `controllerchange` no llega
	return 'reloading';
}

/**
 * Tras recargar por «Actualizar»: la versión que se pidió si NO es la que corre (la actualización no llegó), o null.
 * Se consume: solo informa una vez.
 */
export function failedUpdate(current: string) {
	try {
		const t = sessionStorage.getItem(TARGET);
		sessionStorage.removeItem(TARGET);
		return t && t !== current ? t : null;
	} catch {
		return null;
	}
}

/** Último recurso: quita el service worker y la caché de la app (no los datos) y recarga desde la red. */
export async function forceReload() {
	try {
		for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
		for (const k of await caches.keys()) if (k.startsWith('sensei-') && !KEPT_CACHES.includes(k)) await caches.delete(k);
	} catch {
		/* se recarga igual */
	}
	location.reload();
}
