// Bandeja de entrada: lo que llega compartido hacia Sensei (el SW lo guarda en caché, ver service-worker.ts) o abierto con
// Sensei (File Handling, `launchQueue`). /compartir lo lee, elige destino y lo deja en `pending` para esa pantalla.
import { base } from './base.ts';
import { INBOX_CACHE, inboxKey, type InboxMeta } from './pwa-core.ts';

export type Incoming = { title?: string; text?: string; url?: string; files: File[] };

/** Lee y vacía lo compartido (Share Target). null si no hay nada. */
export async function takeShared(): Promise<Incoming | null> {
	if (typeof caches === 'undefined') return null;
	const cache = await caches.open(INBOX_CACHE);
	const metaRes = await cache.match(inboxKey(base, 'meta.json'));
	if (!metaRes) return null;
	const meta = (await metaRes.json()) as InboxMeta;
	const files: File[] = [];
	for (const f of meta.files) {
		const r = await cache.match(inboxKey(base, f.key));
		if (r) files.push(new File([await r.blob()], f.name, { type: f.type }));
	}
	await caches.delete(INBOX_CACHE);
	return { title: meta.title, text: meta.text, url: meta.url, files };
}

type LaunchParams = { files: { getFile(): Promise<File> }[] };
type LaunchQueue = { setConsumer(cb: (p: LaunchParams) => void): void };

/** Archivos abiertos con Sensei desde el sistema (doble clic / «Abrir con»). Llama a `cb` cada vez que llegan. */
export function onOpenedFiles(cb: (files: File[]) => void) {
	const lq = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
	lq?.setConsumer(async (p) => {
		if (!p.files?.length) return;
		cb(await Promise.all(p.files.map((h) => h.getFile())));
	});
}

// Entrega a la pantalla de destino (navegación SPA: mismo documento).
type Pending = { to: 'explicar' | 'biblioteca' | 'datos'; text?: string; title?: string; files: File[] };
let pending: Pending | null = null;

export function setPending(p: Pending) {
	pending = p;
}

/** La pantalla `to` recoge lo que le llegó (una sola vez). */
export function takePending(to: Pending['to']): Pending | null {
	if (pending?.to !== to) return null;
	const p = pending;
	pending = null;
	return p;
}
