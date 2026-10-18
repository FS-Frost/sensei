// Modo IA en el cliente: si se muestran las funciones de IA (tutor, lecturas, explicador, generar…) y cambiar de modo.
// El estado viene del `load` del layout (server/loads/layout.ts); cambiarlo guarda el ajuste `aiMode` y recarga.
import { page } from '$app/state';
import { refreshAll } from '$app/navigation';
import { post } from './api.ts';

export type AiMode = 'ask' | 'on' | 'off';

type LayoutAi = { aiUi?: boolean; aiMode?: AiMode; aiKey?: boolean; gemini?: boolean };
const data = () => page.data as LayoutAi;

/** Mostrar las funciones de IA (reactivo: úsalo dentro de $derived o del marcado). */
export const aiUi = () => !!data().aiUi;
export const aiMode = (): AiMode => data().aiMode ?? 'ask';
/** Hay API key guardada (aunque la IA esté apagada). */
export const aiKey = () => !!data().aiKey;

export async function setAiMode(mode: AiMode) {
	await post('/api/settings', { aiMode: mode });
	await refreshAll();
}
