// Puente con el Worker que hace de servidor (src/lib/worker/backend.worker.ts).
// - Parchea `fetch`: las peticiones a /api/* (con o sin la base del sitio) las atiende el Worker; el resto, la red.
//   Así el código de las páginas (client/api.ts, formularios con FormData, SSE del tutor) no cambia.
// - `serverLoad` ejecuta en el Worker los `load` que antes eran de servidor (src/lib/server/loads/).
import { base } from './base.ts';
import { error, redirect } from '@sveltejs/kit';
import type { BackendState, DictVariant, FromWorker, LoadResult, ToWorker } from '../backendProtocol.ts';

export const backend = $state<{ value: BackendState }>({ value: { state: 'starting' } });

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
	number,
	| { kind: 'fetch'; resolve: (r: Response) => void; reject: (e: Error) => void; controller?: ReadableStreamDefaultController<Uint8Array> }
	| { kind: 'load'; resolve: (r: LoadResult) => void }
>();

/** Se resuelve cuando el Worker sabe en qué estado arranca (lista, sin diccionario, bloqueada…). */
let settle: () => void = () => {};
const settled = new Promise<void>((r) => (settle = r));
let onReady: (() => void) | null = null;

/** La página registra aquí qué hacer al quedar lista (volver a ejecutar los loads). */
export function whenBecomesReady(fn: () => void) {
	onReady = fn;
}

function send(msg: ToWorker, transfer: Transferable[] = []) {
	worker!.postMessage(msg, transfer);
}

function onMessage(ev: MessageEvent<FromWorker>) {
	const msg = ev.data;
	if (msg.type === 'state') {
		const wasReady = backend.value.state === 'ready';
		backend.value = msg.value;
		if (msg.value.state !== 'starting' && msg.value.state !== 'installing') settle();
		if (msg.value.state === 'ready' && !wasReady) onReady?.();
		return;
	}
	const p = pending.get(msg.id);
	if (!p) return;
	if (msg.type === 'loaded' && p.kind === 'load') {
		pending.delete(msg.id);
		p.resolve(msg.result);
	} else if (p.kind === 'fetch') {
		if (msg.type === 'response') {
			const nullBody = [101, 204, 205, 304].includes(msg.status);
			const body = nullBody
				? null
				: new ReadableStream<Uint8Array>({
						start: (c) => {
							p.controller = c;
						},
						cancel: () => send({ type: 'abort', id: msg.id })
					});
			p.resolve(new Response(body, { status: msg.status, statusText: msg.statusText, headers: msg.headers }));
		} else if (msg.type === 'chunk') p.controller?.enqueue(msg.chunk);
		else if (msg.type === 'end') {
			p.controller?.close();
			pending.delete(msg.id);
		} else if (msg.type === 'fail') {
			const err = new Error(msg.message);
			if (p.controller) p.controller.error(err);
			else p.reject(err);
			pending.delete(msg.id);
		}
	}
}

/** Ruta de la API sin la base del sitio (`/sensei/api/x` → `/api/x`), o null si no es de la API. */
function apiPath(url: URL) {
	if (url.origin !== location.origin) return null;
	const path = base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length) : url.pathname;
	return path.startsWith('/api/') ? path : null;
}

async function workerFetch(req: Request, path: string): Promise<Response> {
	await settled;
	const id = nextId++;
	const body = ['GET', 'HEAD'].includes(req.method) ? null : await req.arrayBuffer();
	const url = new URL(path + new URL(req.url).search, location.origin).href;
	return new Promise<Response>((resolve, reject) => {
		pending.set(id, { kind: 'fetch', resolve, reject });
		req.signal?.addEventListener('abort', () => send({ type: 'abort', id }));
		send({ type: 'fetch', id, method: req.method, url, headers: [...req.headers], body }, body ? [body] : []);
	});
}

export function startBackend() {
	if (worker || typeof window === 'undefined') return;
	worker = new Worker(new URL('../worker/backend.worker.ts', import.meta.url), { type: 'module' });
	worker.onmessage = onMessage;
	worker.onerror = (e) => {
		backend.value = { state: 'error', error: e.message || 'El Worker falló al arrancar' };
		settle();
	};
	const native = window.fetch.bind(window);
	window.fetch = Object.assign(
		(input: RequestInfo | URL, init?: RequestInit) => {
			const req = new Request(input, init);
			const path = apiPath(new URL(req.url));
			return path ? workerFetch(req, path) : native(input, init);
		},
		{ preconnect: window.fetch.preconnect }
	) as typeof fetch;
	send({ type: 'init', assets: new URL(base || '/', location.origin).href.replace(/\/$/, '') });
	// Pedir que el navegador no borre los datos si falta espacio.
	void navigator.storage?.persist?.();
}

export function installDict(variant: DictVariant) {
	send({ type: 'install', variant });
}

/**
 * `load` de una página ejecutado en el Worker. Si Sensei no está listo (falta el diccionario, otra pestaña…)
 * devuelve un objeto vacío: el layout no muestra la página hasta que lo esté y entonces se vuelve a cargar.
 */
export async function serverLoad<F extends (...a: never[]) => unknown>(
	route: string,
	params: Record<string, string>,
	url: URL
): Promise<Awaited<ReturnType<F>>> {
	startBackend();
	await settled;
	if (backend.value.state !== 'ready') return {} as Awaited<ReturnType<F>>;
	const id = nextId++;
	const result = await new Promise<LoadResult>((resolve) => {
		pending.set(id, { kind: 'load', resolve });
		send({ type: 'load', id, route, params: { ...params }, url: url.href });
	});
	if (result.ok) return result.data as Awaited<ReturnType<F>>;
	if ('redirect' in result) redirect(result.redirect.status as 303, `${base}${result.redirect.location}`);
	error(result.error.status as 500, result.error.message);
}

/** Descarga un archivo que sirve la API (exportar, copias) sin enlace directo: el Worker no tiene URL propia. */
export async function downloadFrom(path: string, fallbackName: string, init?: RequestInit) {
	const res = await fetch(path, init);
	if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${res.status}`);
	const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
	const url = URL.createObjectURL(await res.blob());
	const a = Object.assign(document.createElement('a'), { href: url, download: name });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
