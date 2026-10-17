// Lógica pura de la tabla de sesiones: filtro (nombre sin mayúsculas ni tildes, tipo) y orden en tres estados.
import type { ChatMode } from './types.ts';

export type SessionListRow = {
	id: number;
	mode: ChatMode;
	title: string | null;
	messages: number;
	lastAt: number;
	startedAt: number;
	/** Gasto acumulado en Gemini (USD). */
	costUsd: number;
};

export type SortKey = 'title' | 'mode' | 'messages' | 'costUsd' | 'lastAt' | 'startedAt';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null;

/** «Explicación» → «explicacion»: sin mayúsculas ni tildes. */
export function fold(s: string) {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
}

/** Clic en una columna: sin orden → ascendente → descendente → sin orden (por defecto). */
export function nextSort(current: Sort, key: SortKey): Sort {
	if (!current || current.key !== key) return { key, dir: 'asc' };
	if (current.dir === 'asc') return { key, dir: 'desc' };
	return null;
}

export function filterSessions<T extends SessionListRow>(rows: T[], query: string, mode: ChatMode | '', modeLabel: (m: ChatMode) => string): T[] {
	const q = fold(query.trim());
	return rows.filter((r) => (!mode || r.mode === mode) && (!q || fold(r.title ?? modeLabel(r.mode)).includes(q)));
}

/** Sin orden elegido: última actividad, más reciente primero. */
export function sortSessions<T extends SessionListRow>(rows: T[], sort: Sort, modeLabel: (m: ChatMode) => string): T[] {
	const out = [...rows];
	if (!sort) return out.sort((a, b) => b.lastAt - a.lastAt);
	const val = (r: T): string | number =>
		sort.key === 'title' ? fold(r.title ?? '') : sort.key === 'mode' ? fold(modeLabel(r.mode)) : r[sort.key];
	const k = sort.dir === 'asc' ? 1 : -1;
	return out.sort((a, b) => {
		const x = val(a);
		const y = val(b);
		const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
		return c * k || b.lastAt - a.lastAt;
	});
}
