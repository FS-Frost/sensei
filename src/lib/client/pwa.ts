// PWA: registro del service worker (solo en build; en dev Vite no lo genera igual y la caché estorba).
import { base } from './base.ts';

export async function registerServiceWorker() {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
	try {
		await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
	} catch (err) {
		console.error('[sensei] registro del service worker falló', err);
	}
}
