// Enrutador del «servidor en el navegador»: el Worker resuelve las peticiones a /api/* con los mismos
// manejadores que tenía SvelteKit (`+server.ts`, ahora en src/lib/server/api/) y los `load` de servidor
// (src/lib/server/loads/).

export type RequestEvent = { request: Request; params: Record<string, string>; url: URL };
export type RequestHandler = (event: RequestEvent) => Response | Promise<Response>;

export type ServerLoadEvent = { params: Record<string, string>; url: URL };
export type ServerLoad<T = unknown> = (event: ServerLoadEvent) => T | Promise<T>;

/**
 * `redirect()`/`error()` para los `load` que corren en el Worker: los de @sveltejs/kit usan `window`
 * (no existe en un Worker). La página los convierte en los de Kit (client/backend.svelte.ts).
 */
export class LoadRedirect {
	constructor(
		readonly status: number,
		readonly location: string
	) {}
}
export class LoadError {
	constructor(
		readonly status: number,
		readonly message: string
	) {}
}
export function redirect(status: number, location: string): never {
	throw new LoadRedirect(status, location);
}
export function error(status: number, message: string): never {
	throw new LoadError(status, message);
}

type Methods = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', RequestHandler>>;

type Route = { pattern: RegExp; keys: string[]; methods: Methods; path: string };

/** `/src/lib/server/api/chat/[id]/end/+server.ts` → `/api/chat/[id]/end`. */
export function routePath(file: string) {
	return file.replace(/^.*\/src\/lib\/server\/api/, '/api').replace(/\/\+server\.ts$/, '') || '/api';
}

export function compile(path: string): { pattern: RegExp; keys: string[] } {
	const keys: string[] = [];
	const re = path
		.split('/')
		.map((seg) => {
			const m = seg.match(/^\[(\.\.\.)?(\w+)\]$/);
			if (!m) return seg.replace(/[.*+?^${}()|\\]/g, '\\$&');
			keys.push(m[2]);
			return m[1] ? '(.+)' : '([^/]+)';
		})
		.join('/');
	return { pattern: new RegExp(`^${re}/?$`), keys };
}

export function buildRoutes(modules: Record<string, unknown>): Route[] {
	return (
		Object.entries(modules)
			.map(([file, mod]) => {
				const path = routePath(file);
				return { path, ...compile(path), methods: mod as Methods };
			})
			// Rutas fijas antes que las dinámicas (/api/chat/start antes que /api/chat/[id]).
			.sort((a, b) => a.keys.length - b.keys.length || b.path.length - a.path.length)
	);
}

export function match(routes: Route[], pathname: string) {
	for (const r of routes) {
		const m = pathname.match(r.pattern);
		if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
	}
	return null;
}

export async function dispatch(routes: Route[], request: Request): Promise<Response> {
	const url = new URL(request.url);
	const found = match(routes, url.pathname);
	if (!found) return Response.json({ error: `No existe ${url.pathname}` }, { status: 404 });
	const method = request.method.toUpperCase();
	const handler = found.route.methods[(method === 'HEAD' ? 'GET' : method) as keyof Methods];
	if (!handler) return Response.json({ error: `Método ${method} no permitido` }, { status: 405 });
	return handler({ request, params: found.params, url });
}
