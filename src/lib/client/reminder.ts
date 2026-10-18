// Recordatorio de repasos: insignia del icono (número de pendientes) y aviso local diario.
// Sin servidor no hay push: el aviso usa la sincronización periódica (Chromium, app instalada), que despierta al
// service worker unas pocas veces al día; este cuenta con los vencimientos que la página le deja (`publishSchedule`).
import { base } from './base.ts';
import { PERIODIC_TAG, REMINDER_CACHE, reminderKey, type Schedule } from './pwa-core.ts';

const KEY = 'sensei.reminder';

export function reminderEnabled() {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

function setEnabled(on: boolean) {
	try {
		if (on) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		/* sin almacenamiento */
	}
}

type Badging = Navigator & { setAppBadge?(n?: number): Promise<void>; clearAppBadge?(): Promise<void> };

/** Número en el icono de la app instalada (0 = sin número). */
export function setBadge(n: number) {
	const nav = navigator as Badging;
	void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
}

/** Deja al SW los vencimientos próximos (los cuenta él al despertar). */
export async function publishSchedule() {
	if (typeof caches === 'undefined') return;
	try {
		const { due } = (await (await fetch('/api/srs/upcoming')).json()) as { due: number[] };
		const s: Schedule = { due, enabled: reminderEnabled(), writtenAt: Date.now() };
		await (await caches.open(REMINDER_CACHE)).put(reminderKey(base), Response.json(s));
	} catch {
		/* base no lista o sin caché: se intentará en la próxima actualización */
	}
}

type PeriodicReg = ServiceWorkerRegistration & {
	periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void>; unregister(tag: string): Promise<void> };
};

export type ReminderSupport = { notifications: boolean; periodic: boolean; badge: boolean };

export function reminderSupport(): ReminderSupport {
	return {
		notifications: typeof Notification !== 'undefined',
		periodic: typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype,
		badge: 'setAppBadge' in navigator
	};
}

/** Activa el aviso: permiso de notificaciones + sincronización periódica. Devuelve qué quedó funcionando. */
export async function enableReminder(): Promise<{ ok: boolean; message: string }> {
	if (typeof Notification === 'undefined') return { ok: false, message: 'Este navegador no muestra notificaciones.' };
	const perm = await Notification.requestPermission();
	if (perm !== 'granted') return { ok: false, message: 'Sin permiso de notificaciones: actívalo en los ajustes del sitio.' };
	setEnabled(true);
	await publishSchedule();
	const reg = (await navigator.serviceWorker?.getRegistration?.(`${base}/`)) as PeriodicReg | undefined;
	if (!reg?.periodicSync) {
		return { ok: true, message: 'Activado, pero este navegador no despierta a la app en segundo plano: solo verás la insignia al abrirla.' };
	}
	try {
		await reg.periodicSync.register(PERIODIC_TAG, { minInterval: 6 * 3600_000 });
		return { ok: true, message: 'Activado: como mucho un aviso al día, entre las 8 y las 22 h, si tienes repasos pendientes.' };
	} catch {
		return {
			ok: true,
			message: 'Activado, pero el navegador solo despierta en segundo plano a apps instaladas (instálala arriba) que usas a menudo.'
		};
	}
}

export async function disableReminder() {
	setEnabled(false);
	await publishSchedule();
	const reg = (await navigator.serviceWorker?.getRegistration?.(`${base}/`)) as PeriodicReg | undefined;
	await reg?.periodicSync?.unregister(PERIODIC_TAG).catch(() => {});
}
