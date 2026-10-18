// Pantalla siempre encendida (Screen Wake Lock) mientras se repasa, se lee cronometrando o se sincroniza.
// El navegador la suelta al ocultar la pestaña: se vuelve a pedir al volver. Sin soporte, no hace nada.

type Sentinel = { release(): Promise<void>; released: boolean };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let holders = 0;
let sentinel: Sentinel | null = null;

const api = () => (typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock : undefined);

async function acquire() {
	const wl = api();
	if (!wl || holders === 0 || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
	try {
		sentinel = await wl.request('screen');
	} catch {
		/* sin permiso (batería baja, iframe…): la pantalla se apaga como siempre */
	}
}

function onVisible() {
	if (document.visibilityState === 'visible') void acquire();
}

/** Mantiene la pantalla encendida hasta llamar a la función devuelta (contador: varios a la vez no se pisan). */
export function keepAwake(): () => void {
	if (!api()) return () => {};
	if (holders++ === 0) document.addEventListener('visibilitychange', onVisible);
	void acquire();
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--holders > 0) return;
		document.removeEventListener('visibilitychange', onVisible);
		void sentinel?.release().catch(() => {});
		sentinel = null;
	};
}
