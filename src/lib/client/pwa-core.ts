// Lógica pura compartida por la página y el service worker (src/service-worker.ts): recordatorio de repasos y
// bandeja de lo compartido/abierto con Sensei. Sin DOM ni APIs del navegador: se testea en Bun.

/** Cachés que sobreviven a las actualizaciones (el SW borra las demás `sensei-*` al activarse). */
export const INBOX_CACHE = 'sensei-inbox';
export const REMINDER_CACHE = 'sensei-reminder';
export const KEPT_CACHES = ['sensei-kanjivg', INBOX_CACHE, REMINDER_CACHE];

export const PERIODIC_TAG = 'sensei-repasos';
/** Rutas internas (nunca se piden a la red): claves dentro de las cachés. */
export const reminderKey = (base: string) => `${base}/__sensei/reminder.json`;
export const notifiedKey = (base: string) => `${base}/__sensei/notified.json`;
export const inboxKey = (base: string, name: string) => `${base}/__sensei/inbox/${name}`;

// ---------- Recordatorio de repasos ----------

/** Lo que la página deja anotado para el SW (que no puede abrir la base: SQLite vive en un Worker dedicado). */
export type Schedule = {
	/** Vencimiento (ms) de las tarjetas que vencen pronto, ordenados. */
	due: number[];
	enabled: boolean;
	writtenAt: number;
};

export const dueAt = (s: Pick<Schedule, 'due'>, now: number) => s.due.filter((t) => t <= now).length;

/** Horario en que se puede avisar (hora local). */
export const QUIET = { from: 22, to: 8 } as const;

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Cuántos repasos anunciar ahora (0 = no avisar): activado, hay pendientes, fuera de las horas de silencio, una vez al día. */
export function toNotify(s: Schedule, now: Date, lastNotifiedDay: string | null) {
	if (!s.enabled) return 0;
	const h = now.getHours();
	if (h >= QUIET.from || h < QUIET.to) return 0;
	if (lastNotifiedDay === dayKey(now)) return 0;
	return dueAt(s, now.getTime());
}

export const reminderText = (n: number) => `Tienes ${n} repaso${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'}. ¡Unos minutos bastan!`;

// ---------- Bandeja: compartido hacia Sensei (Share Target) o abierto con Sensei (File Handling) ----------

export type InboxMeta = {
	title?: string;
	text?: string;
	url?: string;
	files: { key: string; name: string; type: string }[];
	at: number;
};

export type FileKind = 'image' | 'library' | 'backup' | 'other';

/** Qué es cada archivo: imagen (Explicador), texto/subtítulos/EPUB (Biblioteca) o copia .zip (Datos). */
export function fileKind(name: string, type: string): FileKind {
	const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
	if (type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'].includes(ext)) return 'image';
	if (['.txt', '.srt', '.epub', '.html', '.htm'].includes(ext) || type === 'text/plain' || type === 'application/epub+zip') return 'library';
	if (ext === '.zip' || type === 'application/zip' || type === 'application/x-zip-compressed') return 'backup';
	return 'other';
}

/** ¿Hay japonés (kana o kanji)? */
export const hasJapanese = (s: string) => /[぀-ヿ㐀-鿿]/.test(s);

/** Texto compartido sin la URL suelta que añaden muchas apps al final. */
export function sharedText(m: Pick<InboxMeta, 'text' | 'url'>) {
	let t = (m.text ?? '').trim();
	if (m.url) t = t.replace(m.url, '').trim();
	return t;
}
