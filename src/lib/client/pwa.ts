// PWA: registro del service worker (solo en build; en dev Vite no lo genera igual y la caché estorba).
// Actualizar: el SW nuevo se instala y ESPERA; `applyUpdate` lo activa y recarga (aviso en components/UpdateNotice.svelte).
import { base } from './base.ts';

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
function installed(w: ServiceWorker, ms = 30_000) {
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

let applying = false;

/** Pasa a la versión publicada: baja el SW nuevo (si lo hay), lo activa y recarga la página una sola vez. */
export async function applyUpdate() {
	if (applying) return;
	applying = true;
	const reload = () => location.reload();
	if (!reg || !navigator.serviceWorker.controller) return reload();
	try {
		await reg.update();
	} catch {
		/* sin conexión: se recarga igual (lo hará con lo que haya) */
	}
	const next = reg.waiting ?? (reg.installing ? await installed(reg.installing) : null);
	if (!next || next === navigator.serviceWorker.controller) return reload();
	navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
	next.postMessage('SKIP_WAITING');
	setTimeout(reload, 4000); // respaldo si `controllerchange` no llega
}
