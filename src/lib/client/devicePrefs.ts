// Preferencias de este dispositivo (localStorage) que viajan en una exportación si se eligen.
// No incluye el recordatorio (necesita el permiso de notificaciones de cada dispositivo), ni la sesión del día,
// ni avisos ya cerrados: solo gustos que tiene sentido llevar a otro navegador.
import { initTheme } from './theme.svelte.ts';

export const DEVICE_PREFS: Record<string, string> = {
	'sensei.theme': 'tema claro/oscuro',
	'sensei.ttsVoice': 'voz de lectura',
	'sensei.sound': 'sonido para sincronizar',
	'sensei.reader': 'preferencias del lector',
	'sensei.dailyMinutes': 'duración de la sesión de hoy'
};

export function readDevicePrefs(): Record<string, string> {
	const out: Record<string, string> = {};
	try {
		for (const k of Object.keys(DEVICE_PREFS)) {
			const v = localStorage.getItem(k);
			if (v !== null) out[k] = v;
		}
	} catch {
		/* sin almacenamiento */
	}
	return out;
}

/** Aplica las preferencias conocidas; devuelve las etiquetas de las que cambiaron. */
export function applyDevicePrefs(prefs: Record<string, string>): string[] {
	const changed: string[] = [];
	try {
		for (const [k, v] of Object.entries(prefs)) {
			if (!(k in DEVICE_PREFS) || typeof v !== 'string') continue;
			if (localStorage.getItem(k) !== v) changed.push(DEVICE_PREFS[k]);
			localStorage.setItem(k, v);
		}
	} catch {
		return changed;
	}
	initTheme();
	return changed;
}
