// Versión de la app = short sha del commit publicado (vite.config.ts → Kit `version.name`; «dev» en local).
// Aquí solo lógica pura (testeable); el aviso está en components/UpdateNotice.svelte.

const KEY = 'sensei.version';

/** Guarda la versión actual y devuelve la anterior si cambió (null la primera vez, si no cambió o en «dev»). */
export function noteVersion(current: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string | null {
	if (!store || current === 'dev') return null;
	try {
		const prev = store.getItem(KEY);
		if (prev === current) return null;
		store.setItem(KEY, current);
		return prev;
	} catch {
		return null;
	}
}

function safeStorage() {
	try {
		return localStorage;
	} catch {
		return null;
	}
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 86400],
	['month', 30 * 86400],
	['week', 7 * 86400],
	['day', 86400],
	['hour', 3600],
	['minute', 60]
];

/** «hace 3 minutos», «ayer», «hace 2 semanas»… («hace un momento» bajo un minuto). */
export function ago(iso: string, now = Date.now()) {
	const s = Math.round((now - Date.parse(iso)) / 1000);
	if (!Number.isFinite(s)) return '';
	if (s < 60) return 'hace un momento';
	for (const [unit, secs] of STEPS) if (s >= secs) return rtf.format(-Math.floor(s / secs), unit);
	return '';
}
