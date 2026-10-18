// Tema por dispositivo (localStorage). "system" = sin data-theme: manda prefers-color-scheme (ver app.css).
// El script inline de app.html aplica el valor guardado antes de pintar, para evitar el parpadeo.

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_KEY = 'sensei.theme';
const ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const META_COLOR = { light: '#f6f5f1', dark: '#14161b' } as const;

export const theme = $state({ mode: 'system' as ThemeMode });

function read(): ThemeMode {
	const v = localStorage.getItem(THEME_KEY);
	return v === 'light' || v === 'dark' ? v : 'system';
}

function resolved(mode: ThemeMode): 'light' | 'dark' {
	if (mode !== 'system') return mode;
	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(mode: ThemeMode) {
	const root = document.documentElement;
	if (mode === 'system') delete root.dataset.theme;
	else root.dataset.theme = mode;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[resolved(mode)]);
}

/** Sincroniza el estado con lo guardado y sigue los cambios del sistema (para la barra del navegador móvil). */
let listening = false;

export function initTheme() {
	theme.mode = read();
	apply(theme.mode);
	// Un solo listener aunque se llame varias veces (p. ej. tras restablecer ajustes).
	if (!listening) {
		listening = true;
		matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => theme.mode === 'system' && apply('system'));
	}
}

/** Elige un tema concreto (bienvenida → Apariencia). */
export function setTheme(mode: ThemeMode) {
	theme.mode = mode;
	if (mode === 'system') localStorage.removeItem(THEME_KEY);
	else localStorage.setItem(THEME_KEY, mode);
	apply(mode);
}

/** claro → oscuro → sistema → claro… */
export function cycleTheme() {
	setTheme(ORDER[(ORDER.indexOf(theme.mode) + 1) % ORDER.length]);
}
